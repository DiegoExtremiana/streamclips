import { orderFor, type AiTask } from '../../shared/llmRoles';
export type LlmProvider = 'groq' | 'gemini' | 'openrouter' | 'mistral';

export const LLM_PROVIDERS: Record<LlmProvider, { label: string; baseUrl: string; defaultModel: string; /** Modelo que entiende imágenes (el de texto de Groq no). */ visionModel?: string; /** El modelo de texto ya ve imágenes. */ sees?: boolean }> = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b', visionModel: 'qwen/qwen3.8-27b' },
  gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3.5-flash-lite', sees: true },
  // OpenRouter: «openrouter/free» reparte entre los modelos gratuitos que haya en cada momento (no se garantiza que vean imágenes)
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/free' },
  // Mistral: plan gratuito «Experiment» de La Plateforme
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest' },
};

/** Todas las IAs configuradas, en orden: la principal y sus relevos. */
export function chainOf(cfg: LlmConfig): LlmConfig[] {
  const { fallbacks, ...main } = cfg;
  return [main, ...(fallbacks ?? []).map(({ fallbacks: _f, ...c }) => c)];
}

const fromChain = (chain: LlmConfig[]): LlmConfig => (chain.length > 1 ? { ...chain[0], fallbacks: chain.slice(1) } : chain[0]);

/** La misma configuración pero empezando por el proveedor indicado si está entre las IAs (el resto queda de relevo). */
export function prefer(cfg: LlmConfig, provider: LlmProvider): LlmConfig {
  const chain = chainOf(cfg);
  const first = chain.filter((c) => c.provider === provider);
  return first.length ? fromChain([...first, ...chain.filter((c) => c.provider !== provider)]) : cfg;
}

/** La configuración ordenada para una tarea: su IA titular primero y las demás de relevo (ver `shared/llmRoles.ts`). */
export function forTask(cfg: LlmConfig, task: AiTask): LlmConfig {
  const chain = chainOf(cfg);
  if (chain.length < 2 || chain.some((c) => c.baseUrl)) return cfg;
  const order = orderFor(task, chain.map((c) => c.provider));
  const sorted = order.flatMap((p) => chain.filter((c) => c.provider === p));
  return sorted.length ? fromChain(sorted) : cfg;
}

/**
 * Las IAs que ven imágenes, con Gemini por delante (admite más imágenes por petición); Groq usa su modelo con visión.
 * Si ninguna de las configuradas ve, se devuelve la principal tal cual (y la petición con imágenes fallará con su aviso).
 */
export function visionConfig(cfg: LlmConfig): LlmConfig {
  const one = (c: LlmConfig): LlmConfig | null => {
    if (c.baseUrl) return c;
    const p = LLM_PROVIDERS[c.provider];
    return p.visionModel ? { ...c, model: p.visionModel } : p.sees ? c : null;
  };
  const chain = chainOf(cfg).map(one).filter((c): c is LlmConfig => c !== null);
  if (!chain.length) return cfg;
  return fromChain([...chain.filter((c) => c.provider === 'gemini'), ...chain.filter((c) => c.provider !== 'gemini')]);
}

/** Modelos que ya no existen: se sustituyen por el recomendado (Google retiró los Gemini 1.5 y 2.0 en 2026). */
export function resolveModel(provider: LlmProvider, model: string): string {
  const m = model.trim();
  if (!m) return LLM_PROVIDERS[provider].defaultModel;
  // Groq retiró los Llama 3.x/4 de texto y visión en 2026 (el 404 «no existe» de cada petición)
  if (provider === 'groq' && /^(meta-llama\/llama-4|llama-3\.[0-3]-70b|llama3-70b|llama-3\.2-)/.test(m)) return LLM_PROVIDERS.groq.defaultModel;
  if (provider === 'gemini' && /^gemini-(1\.5|2\.0)/.test(m)) return LLM_PROVIDERS.gemini.defaultModel;
  return m;
}

/** Pausa mínima entre dos peticiones seguidas para no pasar el límite gratuito por minuto (Groq: 12.000 tokens/min en el modelo grande). */
export const MIN_INTERVAL_MS: Record<LlmProvider, number> = { groq: 14_000, gemini: 4_000, openrouter: 6_000, mistral: 3_000 };

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  /** Solo pruebas. */
  baseUrl?: string;
  /** Otras IAs que toman el relevo, en orden, cuando esta falla (saturada, sin cuota, sin respuesta). */
  fallbacks?: LlmConfig[];
}

export interface LlmDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Por defecto 0.4; para valorar se usa algo más bajo (respuestas más estables). */
  temperature?: number;
  /** Imágenes (data URL JPEG) que se envían junto a la pregunta; el modelo debe admitir visión. */
  images?: string[];
}

const TIMEOUT_MS = 90_000;
/** Esperas antes de reintentar cuando el servidor del modelo está saturado (5xx). En las pruebas automáticas no se espera. */
const SERVER_BACKOFF_MS = process.env.NODE_TEST_CONTEXT ? [5, 5, 5] : [6_000, 15_000, 30_000];

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
  const chain = chainOf(cfg);
  for (let i = 0; ; i++) {
    try {
      return await askOne(chain[i], system, user, d);
    } catch (e) {
      // con otra IA de relevo, se le pasa la pregunta; sin ella, el error es el de la última
      if ((e as Error).name === 'CancelledError' || i >= chain.length - 1) throw e;
    }
  }
}

async function askOne(cfg: LlmConfig, system: string, user: string, d: LlmDeps = {}): Promise<unknown> {
  if (!cfg.apiKey) throw new Error('Falta la clave del modelo de lenguaje (Ajustes > Piloto automático).');
  const fetchFn = d.fetchFn ?? fetch;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${cfg.baseUrl ?? LLM_PROVIDERS[cfg.provider].baseUrl}/chat/completions`;
  const body = JSON.stringify({
    model: cfg.model,
    temperature: d.temperature ?? 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: d.images?.length ? [{ type: 'text', text: user }, ...d.images.map((url) => ({ type: 'image_url', image_url: { url } }))] : user },
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
    if (res.status === 429 && attempt < 4) {
      // el plan gratuito limita las peticiones por minuto: esperar un minuto suele bastar; solo si sigue lleno se da por agotado
      const wait = Math.min(90, Number(res.headers.get('retry-after')) || 15 * (attempt + 1));
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 500 && res.status <= 504 && attempt < SERVER_BACKOFF_MS.length) {
      // servidor saturado (Gemini gratis devuelve 503 a menudo): esperar y volver a intentarlo en vez de dar el análisis por perdido
      await sleep(SERVER_BACKOFF_MS[Math.min(attempt, SERVER_BACKOFF_MS.length - 1)]);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error('El modelo de lenguaje rechazó la clave. Revísala en Ajustes.');
    if (res.status === 429) throw new Error('Se agotó el límite gratuito del modelo de lenguaje. Se reintentará en el próximo directo.');
    if (res.status === 404) throw new Error(`El modelo «${cfg.model}» no existe o ya no está disponible. Cámbialo en Ajustes › Piloto automático.`);
    if (res.status === 400 && d.images?.length) throw new Error('El modelo no admite imágenes.');
    if (!res.ok) throw new Error(`Error del modelo de lenguaje (${res.status}).`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = j.choices?.[0]?.message?.content;
    if (!content) throw new Error('El modelo de lenguaje devolvió una respuesta vacía.');
    return extractJson(content);
  }
}
