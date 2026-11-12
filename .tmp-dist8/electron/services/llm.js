"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_INTERVAL_MS = exports.LLM_PROVIDERS = void 0;
exports.resolveModel = resolveModel;
exports.extractJson = extractJson;
exports.askJson = askJson;
exports.LLM_PROVIDERS = {
    groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
    gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3.5-flash-lite' },
};
/** Modelos que ya no existen: se sustituyen por el recomendado (Google retiró los Gemini 1.5 y 2.0 en 2026). */
function resolveModel(provider, model) {
    const m = model.trim();
    if (!m)
        return exports.LLM_PROVIDERS[provider].defaultModel;
    if (provider === 'gemini' && /^gemini-(1\.5|2\.0)/.test(m))
        return exports.LLM_PROVIDERS.gemini.defaultModel;
    return m;
}
/** Pausa mínima entre dos peticiones seguidas para no pasar el límite gratuito por minuto (Groq: 12.000 tokens/min en el modelo grande). */
exports.MIN_INTERVAL_MS = { groq: 14_000, gemini: 4_000 };
const TIMEOUT_MS = 90_000;
/** Saca el primer objeto JSON de una respuesta (los modelos a veces lo envuelven en ```json ... ```). */
function extractJson(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const body = (fenced ? fenced[1] : text).trim();
    try {
        return JSON.parse(body);
    }
    catch {
        const a = body.indexOf('{');
        const b = body.lastIndexOf('}');
        if (a >= 0 && b > a) {
            try {
                return JSON.parse(body.slice(a, b + 1));
            }
            catch {
                /* cae al error de abajo */
            }
        }
        throw new Error('El modelo no devolvió un JSON válido.');
    }
}
/** Una pregunta a un modelo con API compatible con OpenAI (Groq y Gemini la ofrecen gratis con límites). Devuelve JSON. */
async function askJson(cfg, system, user, d = {}) {
    if (!cfg.apiKey)
        throw new Error('Falta la clave del modelo de lenguaje (Ajustes > Piloto automático).');
    const fetchFn = d.fetchFn ?? fetch;
    const sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const url = `${cfg.baseUrl ?? exports.LLM_PROVIDERS[cfg.provider].baseUrl}/chat/completions`;
    const body = JSON.stringify({
        model: cfg.model,
        temperature: d.temperature ?? 0.4,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
    });
    for (let attempt = 0;; attempt++) {
        let res;
        try {
            res = await fetchFn(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
                body,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        }
        catch (e) {
            const n = e.name;
            throw new Error(n === 'TimeoutError' || n === 'AbortError' ? 'El modelo de lenguaje no respondió a tiempo.' : 'No se pudo conectar con el modelo de lenguaje.');
        }
        if (res.status === 429 && attempt < 2) {
            const wait = Math.min(30, Number(res.headers.get('retry-after')) || 5 * (attempt + 1));
            await sleep(wait * 1000);
            continue;
        }
        if (res.status === 401 || res.status === 403)
            throw new Error('El modelo de lenguaje rechazó la clave. Revísala en Ajustes.');
        if (res.status === 429)
            throw new Error('Se agotó el límite gratuito del modelo de lenguaje. Se reintentará en el próximo directo.');
        if (res.status === 404)
            throw new Error(`El modelo «${cfg.model}» no existe o ya no está disponible. Cámbialo en Ajustes › Piloto automático.`);
        if (!res.ok)
            throw new Error(`Error del modelo de lenguaje (${res.status}).`);
        const j = (await res.json());
        const content = j.choices?.[0]?.message?.content;
        if (!content)
            throw new Error('El modelo de lenguaje devolvió una respuesta vacía.');
        return extractJson(content);
    }
}
