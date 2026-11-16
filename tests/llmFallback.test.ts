import test from 'node:test';
import assert from 'node:assert/strict';
import { askJson, chainOf, forTask, lanesFor, prefer, visionConfig, type LlmConfig } from '../electron/services/llm';
import { assignments, orderFor } from '../shared/llmRoles';

const ok = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }), { status: 200 });
const cfg: LlmConfig = { provider: 'gemini', model: 'g', apiKey: 'A', fallbacks: [{ provider: 'groq', model: 'q', apiKey: 'B' }, { provider: 'mistral', model: 'm', apiKey: 'C' }] };

test('si la IA principal falla, la pregunta pasa a la de apoyo', async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    const u = String(url);
    seen.push(u.includes('googleapis') ? 'gemini' : u.includes('groq') ? 'groq' : 'mistral');
    return u.includes('googleapis') ? new Response('saturado', { status: 503 }) : ok({ de: 'groq' });
  }) as typeof fetch;
  const r = await askJson(cfg, 's', 'u', { fetchFn, sleep: async () => undefined });
  assert.deepEqual(r, { de: 'groq' });
  assert.equal(seen[seen.length - 1], 'groq');
  assert.ok(seen.filter((x) => x === 'gemini').length >= 2, 'antes de pasar el relevo se reintenta con la principal');
  assert.ok(!seen.includes('mistral'));
});

test('si fallan todas, el error es el de la última', async () => {
  const fetchFn = (async () => new Response('no', { status: 401 })) as typeof fetch;
  await assert.rejects(askJson(cfg, 's', 'u', { fetchFn, sleep: async () => undefined }), /rechazó la clave/);
});

test('reparto: Groq primero para valorar y solo las que ven imágenes (Gemini delante) para la vista', () => {
  assert.deepEqual(chainOf(prefer(cfg, 'groq')).map((c) => c.provider), ['groq', 'gemini', 'mistral']);
  assert.deepEqual(chainOf(prefer(cfg, 'openrouter')).map((c) => c.provider), ['gemini', 'groq', 'mistral']);
  const v = chainOf(visionConfig({ provider: 'groq', model: 'q', apiKey: 'B', fallbacks: [{ provider: 'mistral', model: 'm', apiKey: 'C' }, { provider: 'gemini', model: 'g', apiKey: 'A' }] }));
  assert.deepEqual(v.map((c) => c.provider), ['gemini', 'groq']);
  assert.notEqual(v[1].model, 'q', 'Groq usa su modelo con visión');
  assert.deepEqual(chainOf(visionConfig({ provider: 'mistral', model: 'm', apiKey: 'C' })).map((c) => c.provider), ['mistral']);
});

test('funciones claras: cada tarea tiene su IA titular y sus relevos', () => {
  const all = ['gemini', 'groq', 'mistral', 'openrouter'] as const;
  const by = Object.fromEntries(assignments([...all]).map((t) => [t.id, t.main]));
  assert.deepEqual(by, { vision: 'gemini', chronicle: 'gemini', judge: 'groq', story: 'gemini', themes: 'mistral', humor: 'groq', chief: 'gemini', titles: 'mistral' });
  assert.deepEqual(orderFor('vision', ['mistral', 'openrouter']), [], 'sin Gemini ni Groq nadie mira imágenes');
  assert.deepEqual(orderFor('judge', ['gemini']), ['gemini']);
  assert.deepEqual(chainOf(forTask(cfg, 'judge')).map((c) => c.provider), ['groq', 'gemini', 'mistral']);
  assert.deepEqual(chainOf(forTask(cfg, 'themes')).map((c) => c.provider), ['mistral', 'gemini', 'groq']);
  assert.equal(forTask({ provider: 'gemini', model: 'g', apiKey: 'A' }, 'judge').provider, 'gemini');
});

test('carriles: el trabajo largo se reparte entre las IAs, cada una con las demás de relevo', () => {
  const all: LlmConfig = { provider: 'gemini', model: 'g', apiKey: 'A', fallbacks: [{ provider: 'groq', model: 'q', apiKey: 'B' }, { provider: 'openrouter', model: 'o', apiKey: 'D' }, { provider: 'mistral', model: 'm', apiKey: 'C' }] };
  const lanes = lanesFor(all, 'chronicle');
  assert.deepEqual(lanes.map((l) => l.provider), ['gemini', 'mistral', 'groq'], 'OpenRouter no hace de carril si hay otras');
  assert.deepEqual(chainOf(lanes[1]).map((c) => c.provider), ['mistral', 'gemini', 'groq', 'openrouter']);
  assert.equal(lanesFor({ provider: 'gemini', model: 'g', apiKey: 'A' }, 'judge').length, 1);
});

test('idioma: cada IA recibe en su encargo el idioma de los directos', async () => {
  const { languageNote } = await import('../shared/languages');
  assert.match(languageNote(undefined), /español de España/);
  assert.match(languageNote('en'), /se habla inglés[\s\S]*escribe los títulos[\s\S]*en inglés/);
  assert.match(languageNote('multi'), /varios idiomas/);
  const systems: string[] = [];
  const fetchFn = (async (_u: unknown, init: { body: string }) => {
    systems.push(JSON.parse(init.body).messages[0].content);
    return ok({ hecho: true });
  }) as unknown as typeof fetch;
  await askJson({ provider: 'gemini', model: 'g', apiKey: 'A', language: 'fr', fallbacks: [{ provider: 'groq', model: 'q', apiKey: 'B', language: 'fr' }] }, 'Eres editor.', 'u', { fetchFn, sleep: async () => undefined });
  assert.match(systems[0], /^Eres editor\. IDIOMA DEL CANAL[\s\S]*francés/);
  await askJson({ provider: 'gemini', model: 'g', apiKey: 'A' }, 'Sin idioma.', 'u', { fetchFn, sleep: async () => undefined });
  assert.equal(systems[1], 'Sin idioma.');
});
