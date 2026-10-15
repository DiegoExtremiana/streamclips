export type LlmProvider = 'groq' | 'gemini';

export const LLM_PROVIDERS: Record<LlmProvider, { label: string; baseUrl: string; defaultModel: string }> = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
};

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  /** Solo pruebas. */
  baseUrl?: string;
}

export interface LlmDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const TIMEOUT_MS = 90_000;

/** Saca el primer objeto JSON de una respuesta (los modelos a veces lo envuelven en ```json ... ```). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(body.slice(a, b + 1));
      } catch {
        /* cae al error de abajo */
      }
    }
    throw new Error('El modelo no devolvió un JSON válido.');
  }
}

/** Una pregunta a un modelo con API compatible con OpenAI (Groq y Gemini la ofrecen gratis con límites). Devuelve JSON. */
export async function askJson(cfg: LlmConfig, system: string, user: string, d: LlmDeps = {}): Promise<unknown> {
  if (!cfg.apiKey) throw new Error('Falta la clave del modelo de lenguaje (Ajustes > Piloto automático).');
  const fetchFn = d.fetchFn ?? fetch;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${cfg.baseUrl ?? LLM_PROVIDERS[cfg.provider].baseUrl}/chat/completions`;
  const body = JSON.stringify({
    model: cfg.model,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const n = (e as Error).name;
      throw new Error(n === 'TimeoutError' || n === 'AbortError' ? 'El modelo de lenguaje no respondió a tiempo.' : 'No se pudo conectar con el modelo de lenguaje.');
    }
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(30, Number(res.headers.get('retry-after')) || 5 * (attempt + 1));
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error('El modelo de lenguaje rechazó la clave. Revísala en Ajustes.');
    if (res.status === 429) throw new Error('Se agotó el límite gratuito del modelo de lenguaje. Se reintentará en el próximo directo.');
    if (!res.ok) throw new Error(`Error del modelo de lenguaje (${res.status}).`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = j.choices?.[0]?.message?.content;
    if (!content) throw new Error('El modelo de lenguaje devolvió una respuesta vacía.');
    return extractJson(content);
  }
}
