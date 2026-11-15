import test from 'node:test';
import assert from 'node:assert/strict';
import { askJson, chainOf, prefer, visionConfig, type LlmConfig } from '../electron/services/llm';

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
