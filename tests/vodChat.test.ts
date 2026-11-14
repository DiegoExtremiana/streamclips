import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatResponse, twitchVideoId } from '../shared/vodChat';
import { VodChatService } from '../electron/services/vodChat';
import { parseVodMediaUrl, vodMediaUrl } from '../shared/media';

const edge = (t: number, name: string | null, text: string, color = '#ff0000') => ({
  node: { contentOffsetSeconds: t, commenter: name ? { displayName: name } : null, message: { fragments: [{ text }, { text: ' :)' }], userColor: color } },
});
const resp = (edges: unknown[], hasNextPage = true) => [{ data: { video: { comments: { edges, pageInfo: { hasNextPage } } } } }];

test('lee los comentarios: tiempo, autor, texto y color', () => {
  const r = parseChatResponse(resp([edge(12.5, 'Ana', 'hola'), edge(13, null, 'sin cuenta', 'rojo'), { node: { contentOffsetSeconds: 14, message: { fragments: [{ text: '  ' }] } } }]));
  assert.ok(r);
  assert.equal(r.messages.length, 2);
  assert.deepEqual(r.messages[0], { t: 12.5, user: 'Ana', text: 'hola :)', color: '#ff0000' });
  assert.equal(r.messages[1].user, 'anónimo');
  assert.equal(r.messages[1].color, undefined);
});

test('una respuesta sin comentarios (VOD sin chat) no es válida', () => {
  assert.equal(parseChatResponse([{ data: { video: null } }]), null);
  assert.equal(parseChatResponse({}), null);
});

test('el id del vídeo sale del id guardado o de la dirección', () => {
  assert.equal(twitchVideoId({ twitchId: '123' }), '123');
  assert.equal(twitchVideoId({ url: 'https://www.twitch.tv/videos/987654' }), '987654');
  assert.equal(twitchVideoId({ twitchId: 'abc', url: 'https://example.com' }), null);
});

test('el servicio pide una página, la recuerda y avisa si falla', async () => {
  let calls = 0;
  const svc = new VodChatService({
    fetch: async (_u, init) => {
      calls++;
      const body = JSON.parse(init.body)[0];
      assert.equal(body.variables.videoID, '55');
      return { ok: true, status: 200, json: async () => resp([edge(100, 'A', 'x'), edge(130, 'B', 'y')]) };
    },
  });
  const p = await svc.page('55', 99.7);
  assert.equal(p.ok, true);
  assert.equal(p.to, 130);
  await svc.page('55', 99.2);
  assert.equal(calls, 1, 'la misma página no se pide dos veces');
  const bad = await new VodChatService({ fetch: async () => { throw new Error('red'); } }).page('55', 0);
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? '', /chat/);
  const none = await new VodChatService({ fetch: async () => ({ ok: true, status: 200, json: async () => [{ data: { video: null } }] }) }).page('55', 0);
  assert.equal(none.ok, false);
});

test('la dirección del directo completo se escribe y se lee', () => {
  assert.equal(parseVodMediaUrl(vodMediaUrl('abc-1', 'x')), 'abc-1');
  assert.equal(parseVodMediaUrl('sc-media://o/abc/long'), null);
});
