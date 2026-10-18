import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TwitchClient, normalizeLogin, parseTwitchDuration, type TwitchCreds } from '../electron/services/twitch';

const creds: TwitchCreds = { clientId: 'cid', clientSecret: 'sec', login: 'Don_Diegons' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Call {
  url: string;
  init?: RequestInit;
}

/** fetch falso: responde según una función y anota cada llamada. */
function mockFetch(handler: (url: string, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, calls.length);
  }) as typeof fetch;
  return { fn, calls };
}

const VIDEOS = {
  data: [
    { id: '111', title: 'Directo 1', url: 'https://www.twitch.tv/videos/111', duration: '3h12m5s', created_at: '2026-10-14T18:00:00Z' },
    { id: '222', title: 'Directo 2', url: 'https://www.twitch.tv/videos/222', duration: '45m', created_at: '2026-10-13T18:00:00Z' },
  ],
};

function happy() {
  return mockFetch((url) => {
    if (url.includes('oauth2/token')) return json({ access_token: 'tok1', expires_in: 3600 });
    if (url.includes('/helix/users')) return json({ data: [{ id: '42', display_name: 'Don_Diegons' }] });
    if (url.includes('/helix/videos')) return json(VIDEOS);
    return json({}, 404);
  });
}

describe('twitch: utilidades', () => {
  it('parseTwitchDuration', () => {
    assert.equal(parseTwitchDuration('3h12m5s'), 3 * 3600 + 12 * 60 + 5);
    assert.equal(parseTwitchDuration('45m'), 2700);
    assert.equal(parseTwitchDuration('30s'), 30);
    assert.equal(parseTwitchDuration('1h'), 3600);
    assert.equal(parseTwitchDuration('1h0m3s'), 3603);
    assert.equal(parseTwitchDuration('garbage'), 0);
    assert.equal(parseTwitchDuration(''), 0);
  });

  it('normalizeLogin acepta variantes y rechaza lo inválido', () => {
    assert.equal(normalizeLogin('Don_Diegons'), 'don_diegons');
    assert.equal(normalizeLogin('@abc'), 'abc');
    assert.equal(normalizeLogin(' https://www.twitch.tv/Abc/videos '), 'abc');
    assert.equal(normalizeLogin('twitch.tv/abc'), null); // sin https:// no se interpreta como URL
    for (const bad of ['', 'a b', 'ñandú', 'a'.repeat(26), 'a/b', 'a?x=1', '../x']) {
      assert.equal(normalizeLogin(bad), null, bad);
    }
  });
});

describe('twitch: TwitchClient', () => {
  it('lista los VODs con el formato esperado y las cabeceras correctas', async () => {
    const m = happy();
    const vods = await new TwitchClient(m.fn).listVods(creds);
    assert.deepEqual(vods[0], {
      id: '111', title: 'Directo 1', url: 'https://www.twitch.tv/videos/111',
      durationSec: 11525, createdAt: '2026-10-14T18:00:00Z',
    });
    assert.equal(vods.length, 2);
    const users = m.calls.find((c) => c.url.includes('/helix/users'))!;
    assert.match(users.url, /login=don_diegons$/); // normalizado a minúsculas
    const headers = users.init!.headers as Record<string, string>;
    assert.equal(headers['Client-Id'], 'cid');
    assert.equal(headers.Authorization, 'Bearer tok1');
    const videos = m.calls.find((c) => c.url.includes('/helix/videos'))!;
    assert.match(videos.url, /user_id=42&type=archive/);
  });

  it('reutiliza el token mientras no caduca y pide otro cuando caduca', async () => {
    let t = 1_000_000;
    const m = happy();
    const c = new TwitchClient(m.fn, () => t);
    await c.listVods(creds);
    await c.listVods(creds);
    assert.equal(m.calls.filter((x) => x.url.includes('oauth2/token')).length, 1);
    t += 3600 * 1000; // caduca
    await c.listVods(creds);
    assert.equal(m.calls.filter((x) => x.url.includes('oauth2/token')).length, 2);
  });

  it('si Twitch devuelve 401 renueva el token y reintenta una vez', async () => {
    let tokens = 0;
    let first = true;
    const m = mockFetch((url) => {
      if (url.includes('oauth2/token')) return json({ access_token: `tok${++tokens}`, expires_in: 3600 });
      if (url.includes('/helix/users')) {
        if (first) {
          first = false;
          return json({}, 401);
        }
        return json({ data: [{ id: '42', display_name: 'X' }] });
      }
      return json(VIDEOS);
    });
    const vods = await new TwitchClient(m.fn).listVods(creds);
    assert.equal(vods.length, 2);
    assert.equal(tokens, 2);
  });

  it('401 persistente -> error claro, sin bucle infinito', async () => {
    const m = mockFetch((url) => (url.includes('oauth2/token') ? json({ access_token: 't', expires_in: 3600 }) : json({}, 401)));
    await assert.rejects(new TwitchClient(m.fn).listVods(creds), /rechazó la autorización/);
    assert.ok(m.calls.length <= 5);
  });

  it('credenciales rechazadas, límite de peticiones y errores del servidor tienen mensajes propios', async () => {
    await assert.rejects(
      new TwitchClient(mockFetch(() => json({ message: 'invalid client' }, 400)).fn).listVods(creds),
      /rechazó las credenciales \(400\)/,
    );
    const limited = mockFetch((url) => (url.includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({}, 429)));
    await assert.rejects(new TwitchClient(limited.fn).listVods(creds), /limita las peticiones/);
    const down = mockFetch((url) => (url.includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({}, 503)));
    await assert.rejects(new TwitchClient(down.fn).listVods(creds), /\(503\)/);
  });

  it('un token sin access_token es un error, no un "undefined" colándose', async () => {
    const m = mockFetch(() => json({ expires_in: 10 }));
    await assert.rejects(new TwitchClient(m.fn).listVods(creds), /token válido/);
  });

  it('canal inexistente y login inválido', async () => {
    const m = mockFetch((url) => (url.includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({ data: [] })));
    await assert.rejects(new TwitchClient(m.fn).listVods(creds), /No existe el canal "don_diegons"/);
    const c = new TwitchClient(happy().fn);
    await assert.rejects(c.listVods({ ...creds, login: 'no válido!' }), /nombre de canal no es válido/);
  });

  it('sin conexión y con tiempo agotado hay mensajes comprensibles', async () => {
    const offline = new TwitchClient((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await assert.rejects(offline.listVods(creds), /No se pudo conectar con Twitch/);
    const slow = new TwitchClient((async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    }) as typeof fetch);
    await assert.rejects(slow.listVods(creds), /tiempo agotado/);
  });

  it('listVods exige credenciales', async () => {
    await assert.rejects(new TwitchClient(happy().fn).listVods({ ...creds, clientSecret: '' }), /Faltan las credenciales/);
  });

  it('testConnection: campos vacíos, éxito y error', async () => {
    const c = new TwitchClient(happy().fn);
    assert.deepEqual(await c.testConnection({ ...creds, login: '' }), { ok: false, message: 'Rellena Client ID, Client Secret y nombre de canal.' });
    const ok = await c.testConnection(creds);
    assert.equal(ok.ok, true);
    assert.match(ok.message, /Don_Diegons/);
    const bad = await new TwitchClient(mockFetch(() => json({}, 400)).fn).testConnection(creds);
    assert.equal(bad.ok, false);
    assert.match(bad.message, /credenciales/);
  });

  it('no mezcla el token de un Client ID con el de otro', async () => {
    const m = happy();
    const c = new TwitchClient(m.fn);
    await c.listVods(creds);
    await c.listVods({ ...creds, clientId: 'otro' });
    assert.equal(m.calls.filter((x) => x.url.includes('oauth2/token')).length, 2);
  });
});

describe('twitch: directo y clips', () => {
  const stream = (data: unknown[]) =>
    mockFetch((url) => {
      if (url.includes('oauth2/token')) return json({ access_token: 'tok1', expires_in: 3600 });
      if (url.includes('/helix/users')) return json({ data: [{ id: '42', display_name: 'Don_Diegons' }] });
      if (url.includes('/helix/streams')) return json({ data });
      if (url.includes('/helix/clips')) return json({ data });
      return json({}, 404);
    });

  it('streamStatus: en directo y sin directo', async () => {
    const live = stream([{ type: 'live', title: 'Hoy toca', game_name: 'Minecraft', viewer_count: 321, started_at: '2026-10-15T18:00:00Z' }]);
    assert.deepEqual(await new TwitchClient(live.fn).streamStatus(creds), {
      live: true, title: 'Hoy toca', game: 'Minecraft', viewers: 321, startedAt: '2026-10-15T18:00:00Z',
    });
    assert.match(live.calls.find((c) => c.url.includes('/helix/streams'))!.url, /user_login=don_diegons$/);
    assert.deepEqual(await new TwitchClient(stream([]).fn).streamStatus(creds), { live: false });
  });
  it('streamStatus sin credenciales o con canal inválido da un error claro', async () => {
    await assert.rejects(() => new TwitchClient(stream([]).fn).streamStatus({ ...creds, clientSecret: '' }), /Faltan las credenciales/);
    await assert.rejects(() => new TwitchClient(stream([]).fn).streamStatus({ ...creds, login: 'no válido' }), /no es válido/);
  });
  it('listClips: formato y orden (recientes primero)', async () => {
    const m = stream([
      { id: 'a', title: 'Viejo', url: 'https://clips.twitch.tv/a', duration: 20.5, created_at: '2026-10-10T10:00:00Z', creator_name: 'x', view_count: 3, thumbnail_url: 'https://t/a.jpg' },
      { id: 'b', title: 'Nuevo', url: 'https://clips.twitch.tv/b', duration: 30, created_at: '2026-10-14T10:00:00Z', creator_name: 'y', view_count: 9, thumbnail_url: 'https://t/b.jpg' },
    ]);
    const clips = await new TwitchClient(m.fn).listClips(creds);
    assert.deepEqual(clips.map((c) => c.id), ['b', 'a']);
    assert.deepEqual(clips[0], { id: 'b', title: 'Nuevo', url: 'https://clips.twitch.tv/b', durationSec: 30, createdAt: '2026-10-14T10:00:00Z', creator: 'y', views: 9, thumbnail: 'https://t/b.jpg' });
    assert.match(m.calls.find((c) => c.url.includes('/helix/clips'))!.url, /broadcaster_id=42&first=100&started_at=.*&ended_at=/);
  });

  describe('todos los clips', () => {
    const NOW = Date.parse('2026-10-17T12:00:00Z');
    const DAY = 86_400_000;
    const mk = (n: number, daysAgo: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `c${daysAgo}-${i}`, title: `Clip ${daysAgo}-${i}`, url: `https://clips.twitch.tv/c${daysAgo}-${i}`, duration: 10, created_at: new Date(NOW - daysAgo * DAY - i * 60_000).toISOString(), creator_name: 'x', view_count: n - i, thumbnail_url: 't' }));
    // 130 clips recientes (dos páginas), 5 de hace ~200 días y nada más
    const historia = () =>
      mockFetch((url) => {
        if (url.includes('oauth2/token')) return json({ access_token: 'tok1', expires_in: 3600 });
        if (url.includes('/helix/users')) return json({ data: [{ id: '42', display_name: 'Don_Diegons' }] });
        const from = Date.parse(decodeURIComponent(/started_at=([^&]+)/.exec(url)![1]));
        const to = Date.parse(decodeURIComponent(/ended_at=([^&]+)/.exec(url)![1]));
        const inWindow = (d: number) => NOW - d * DAY >= from && NOW - d * DAY <= to;
        const all = [...mk(130, 1), ...mk(5, 200)].filter((c) => inWindow((NOW - Date.parse(c.created_at)) / DAY));
        const after = /after=([^&]+)/.exec(url)?.[1];
        if (!after) return json({ data: all.slice(0, 100), pagination: all.length > 100 ? { cursor: 'c1' } : {} });
        return json({ data: all.slice(100), pagination: {} });
      });

    it('pide todos: pagina con el cursor, recorre los tramos de fechas y los ordena del más reciente al más antiguo', async () => {
      const m = historia();
      const clips = await new TwitchClient(m.fn, () => NOW).listClips(creds);
      assert.equal(clips.length, 135);
      assert.equal(new Set(clips.map((c) => c.id)).size, 135);
      assert.deepEqual(clips.map((c) => c.createdAt), [...clips.map((c) => c.createdAt)].sort().reverse());
      const urls = m.calls.map((c) => c.url).filter((u) => u.includes('/helix/clips'));
      assert.ok(urls.some((u) => u.includes('after=c1')), 'usa el cursor de la página siguiente');
      assert.ok(urls.every((u) => u.includes('started_at=') && u.includes('ended_at=')), 'siempre con las dos fechas (si no, Twitch solo mira una semana)');
      assert.ok(urls.length >= 8 && urls.length <= 10, `se detiene tras un año sin clips (${urls.length} peticiones)`);
    });
    it('si falla un tramo antiguo conserva lo ya leído y lo avisa; avisa del progreso por tramos', async () => {
      const base = historia();
      let n = 0;
      const fn = (async (u: string, i?: RequestInit) => {
        if (String(u).includes('/helix/clips') && ++n === 4) return new Response('{"message":"boom"}', { status: 500 });
        return base.fn(u as never, i as never);
      }) as typeof base.fn;
      const progress: number[] = [];
      const warns: string[] = [];
      const clips = await new TwitchClient(fn, () => NOW).listClips(creds, { onProgress: (l) => progress.push(l.length), onWarning: (m) => warns.push(m) });
      assert.ok(clips.length >= 130, `${clips.length}`);
      assert.ok(progress.length >= 1 && progress[0] === 130, `primero sale lo reciente (${progress})`);
      assert.equal(warns.length, 1);
      assert.match(warns[0], /Solo se han podido leer los clips hasta/);
    });
    it('si falla ya el primer tramo (lo reciente), el error llega', async () => {
      const fn = (async (u: string) => (String(u).includes('/helix/clips') ? new Response('{"message":"nope"}', { status: 500 }) : historia().fn(u as never))) as ReturnType<typeof historia>['fn'];
      await assert.rejects(() => new TwitchClient(fn, () => NOW).listClips(creds));
    });
    it('con sinceMs solo mira lo reciente', async () => {
      const m = historia();
      const clips = await new TwitchClient(m.fn, () => NOW).listClips(creds, { sinceMs: NOW - 3 * DAY });
      assert.equal(clips.length, 130);
      assert.equal(m.calls.filter((c) => c.url.includes('/helix/clips')).length, 2);
    });
  });
});
