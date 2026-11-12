"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const twitch_1 = require("../electron/services/twitch");
const creds = { clientId: 'cid', clientSecret: 'sec', login: 'Don_Diegons' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
/** fetch falso: responde según una función y anota cada llamada. */
function mockFetch(handler) {
    const calls = [];
    const fn = (async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        return handler(url, calls.length);
    });
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
        if (url.includes('oauth2/token'))
            return json({ access_token: 'tok1', expires_in: 3600 });
        if (url.includes('/helix/users'))
            return json({ data: [{ id: '42', display_name: 'Don_Diegons' }] });
        if (url.includes('/helix/videos'))
            return json(VIDEOS);
        return json({}, 404);
    });
}
(0, node_test_1.describe)('twitch: utilidades', () => {
    (0, node_test_1.it)('parseTwitchDuration', () => {
        strict_1.default.equal((0, twitch_1.parseTwitchDuration)('3h12m5s'), 3 * 3600 + 12 * 60 + 5);
        strict_1.default.equal((0, twitch_1.parseTwitchDuration)('45m'), 2700);
        strict_1.default.equal((0, twitch_1.parseTwitchDuration)('30s'), 30);
        strict_1.default.equal((0, twitch_1.parseTwitchDuration)('1h'), 3600);
        strict_1.default.equal((0, twitch_1.parseTwitchDuration)('1h0m3s'), 3603);
        strict_1.default.equal((0, twitch_1.parseTwitchDuration)('garbage'), 0);
        strict_1.default.equal((0, twitch_1.parseTwitchDuration)(''), 0);
    });
    (0, node_test_1.it)('normalizeLogin acepta variantes y rechaza lo inválido', () => {
        strict_1.default.equal((0, twitch_1.normalizeLogin)('Don_Diegons'), 'don_diegons');
        strict_1.default.equal((0, twitch_1.normalizeLogin)('@abc'), 'abc');
        strict_1.default.equal((0, twitch_1.normalizeLogin)(' https://www.twitch.tv/Abc/videos '), 'abc');
        strict_1.default.equal((0, twitch_1.normalizeLogin)('twitch.tv/abc'), null); // sin https:// no se interpreta como URL
        for (const bad of ['', 'a b', 'ñandú', 'a'.repeat(26), 'a/b', 'a?x=1', '../x']) {
            strict_1.default.equal((0, twitch_1.normalizeLogin)(bad), null, bad);
        }
    });
});
(0, node_test_1.describe)('twitch: TwitchClient', () => {
    (0, node_test_1.it)('lista los VODs con el formato esperado y las cabeceras correctas', async () => {
        const m = happy();
        const vods = await new twitch_1.TwitchClient(m.fn).listVods(creds);
        strict_1.default.deepEqual(vods[0], {
            id: '111', title: 'Directo 1', url: 'https://www.twitch.tv/videos/111',
            durationSec: 11525, createdAt: '2026-10-14T18:00:00Z',
        });
        strict_1.default.equal(vods.length, 2);
        const users = m.calls.find((c) => c.url.includes('/helix/users'));
        strict_1.default.match(users.url, /login=don_diegons$/); // normalizado a minúsculas
        const headers = users.init.headers;
        strict_1.default.equal(headers['Client-Id'], 'cid');
        strict_1.default.equal(headers.Authorization, 'Bearer tok1');
        const videos = m.calls.find((c) => c.url.includes('/helix/videos'));
        strict_1.default.match(videos.url, /user_id=42&type=archive/);
    });
    (0, node_test_1.it)('las miniaturas y visualizaciones de los directos salen con su tamaño ya puesto', async () => {
        const m = mockFetch((url) => {
            if (url.includes('oauth2/token'))
                return json({ access_token: 't', expires_in: 3600 });
            if (url.includes('/helix/users'))
                return json({ data: [{ id: '42', display_name: 'X' }] });
            return json({ data: [{ id: '1', title: 'A', url: 'https://www.twitch.tv/videos/1', duration: '1h', created_at: '2026-10-14T18:00:00Z', thumbnail_url: 'https://cdn.example/t-%{width}x%{height}.jpg', view_count: 7 }] });
        });
        const [v] = await new twitch_1.TwitchClient(m.fn).listVods(creds);
        strict_1.default.equal(v.thumbnail, 'https://cdn.example/t-320x180.jpg');
        strict_1.default.equal(v.views, 7);
    });
    (0, node_test_1.it)('reutiliza el token mientras no caduca y pide otro cuando caduca', async () => {
        let t = 1_000_000;
        const m = happy();
        const c = new twitch_1.TwitchClient(m.fn, () => t);
        await c.listVods(creds);
        await c.listVods(creds);
        strict_1.default.equal(m.calls.filter((x) => x.url.includes('oauth2/token')).length, 1);
        t += 3600 * 1000; // caduca
        await c.listVods(creds);
        strict_1.default.equal(m.calls.filter((x) => x.url.includes('oauth2/token')).length, 2);
    });
    (0, node_test_1.it)('si Twitch devuelve 401 renueva el token y reintenta una vez', async () => {
        let tokens = 0;
        let first = true;
        const m = mockFetch((url) => {
            if (url.includes('oauth2/token'))
                return json({ access_token: `tok${++tokens}`, expires_in: 3600 });
            if (url.includes('/helix/users')) {
                if (first) {
                    first = false;
                    return json({}, 401);
                }
                return json({ data: [{ id: '42', display_name: 'X' }] });
            }
            return json(VIDEOS);
        });
        const vods = await new twitch_1.TwitchClient(m.fn).listVods(creds);
        strict_1.default.equal(vods.length, 2);
        strict_1.default.equal(tokens, 2);
    });
    (0, node_test_1.it)('401 persistente -> error claro, sin bucle infinito', async () => {
        const m = mockFetch((url) => (url.includes('oauth2/token') ? json({ access_token: 't', expires_in: 3600 }) : json({}, 401)));
        await strict_1.default.rejects(new twitch_1.TwitchClient(m.fn).listVods(creds), /rechazó la autorización/);
        strict_1.default.ok(m.calls.length <= 5);
    });
    (0, node_test_1.it)('credenciales rechazadas, límite de peticiones y errores del servidor tienen mensajes propios', async () => {
        await strict_1.default.rejects(new twitch_1.TwitchClient(mockFetch(() => json({ message: 'invalid client' }, 400)).fn).listVods(creds), /rechazó las credenciales \(400\)/);
        const limited = mockFetch((url) => (url.includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({}, 429)));
        await strict_1.default.rejects(new twitch_1.TwitchClient(limited.fn).listVods(creds), /limita las peticiones/);
        const down = mockFetch((url) => (url.includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({}, 503)));
        await strict_1.default.rejects(new twitch_1.TwitchClient(down.fn).listVods(creds), /\(503\)/);
    });
    (0, node_test_1.it)('un token sin access_token es un error, no un "undefined" colándose', async () => {
        const m = mockFetch(() => json({ expires_in: 10 }));
        await strict_1.default.rejects(new twitch_1.TwitchClient(m.fn).listVods(creds), /token válido/);
    });
    (0, node_test_1.it)('canal inexistente y login inválido', async () => {
        const m = mockFetch((url) => (url.includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({ data: [] })));
        await strict_1.default.rejects(new twitch_1.TwitchClient(m.fn).listVods(creds), /No existe el canal "don_diegons"/);
        const c = new twitch_1.TwitchClient(happy().fn);
        await strict_1.default.rejects(c.listVods({ ...creds, login: 'no válido!' }), /nombre de canal no es válido/);
    });
    (0, node_test_1.it)('sin conexión y con tiempo agotado hay mensajes comprensibles', async () => {
        const offline = new twitch_1.TwitchClient((async () => {
            throw new TypeError('fetch failed');
        }));
        await strict_1.default.rejects(offline.listVods(creds), /No se pudo conectar con Twitch/);
        const slow = new twitch_1.TwitchClient((async () => {
            throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
        }));
        await strict_1.default.rejects(slow.listVods(creds), /tiempo agotado/);
    });
    (0, node_test_1.it)('listVods exige credenciales', async () => {
        await strict_1.default.rejects(new twitch_1.TwitchClient(happy().fn).listVods({ ...creds, clientSecret: '' }), /Faltan las credenciales/);
    });
    (0, node_test_1.it)('testConnection: campos vacíos, éxito y error', async () => {
        const c = new twitch_1.TwitchClient(happy().fn);
        strict_1.default.deepEqual(await c.testConnection({ ...creds, login: '' }), { ok: false, message: 'Rellena Client ID, Client Secret y nombre de canal.' });
        const ok = await c.testConnection(creds);
        strict_1.default.equal(ok.ok, true);
        strict_1.default.match(ok.message, /Don_Diegons/);
        const bad = await new twitch_1.TwitchClient(mockFetch(() => json({}, 400)).fn).testConnection(creds);
        strict_1.default.equal(bad.ok, false);
        strict_1.default.match(bad.message, /credenciales/);
    });
    (0, node_test_1.it)('no mezcla el token de un Client ID con el de otro', async () => {
        const m = happy();
        const c = new twitch_1.TwitchClient(m.fn);
        await c.listVods(creds);
        await c.listVods({ ...creds, clientId: 'otro' });
        strict_1.default.equal(m.calls.filter((x) => x.url.includes('oauth2/token')).length, 2);
    });
});
(0, node_test_1.describe)('twitch: directo y clips', () => {
    const stream = (data) => mockFetch((url) => {
        if (url.includes('oauth2/token'))
            return json({ access_token: 'tok1', expires_in: 3600 });
        if (url.includes('/helix/users'))
            return json({ data: [{ id: '42', display_name: 'Don_Diegons' }] });
        if (url.includes('/helix/streams'))
            return json({ data });
        if (url.includes('/helix/clips'))
            return json({ data });
        return json({}, 404);
    });
    (0, node_test_1.it)('streamStatus: en directo y sin directo', async () => {
        const live = stream([{ type: 'live', title: 'Hoy toca', game_name: 'Minecraft', viewer_count: 321, started_at: '2026-10-15T18:00:00Z' }]);
        strict_1.default.deepEqual(await new twitch_1.TwitchClient(live.fn).streamStatus(creds), {
            live: true, title: 'Hoy toca', game: 'Minecraft', viewers: 321, startedAt: '2026-10-15T18:00:00Z',
        });
        strict_1.default.match(live.calls.find((c) => c.url.includes('/helix/streams')).url, /user_login=don_diegons$/);
        strict_1.default.deepEqual(await new twitch_1.TwitchClient(stream([]).fn).streamStatus(creds), { live: false });
    });
    (0, node_test_1.it)('streamStatus sin credenciales o con canal inválido da un error claro', async () => {
        await strict_1.default.rejects(() => new twitch_1.TwitchClient(stream([]).fn).streamStatus({ ...creds, clientSecret: '' }), /Faltan las credenciales/);
        await strict_1.default.rejects(() => new twitch_1.TwitchClient(stream([]).fn).streamStatus({ ...creds, login: 'no válido' }), /no es válido/);
    });
    (0, node_test_1.it)('listClips: formato y orden (recientes primero)', async () => {
        const m = stream([
            { id: 'a', title: 'Viejo', url: 'https://clips.twitch.tv/a', duration: 20.5, created_at: '2026-10-10T10:00:00Z', creator_name: 'x', view_count: 3, thumbnail_url: 'https://t/a.jpg' },
            { id: 'b', title: 'Nuevo', url: 'https://clips.twitch.tv/b', duration: 30, created_at: '2026-10-14T10:00:00Z', creator_name: 'y', view_count: 9, thumbnail_url: 'https://t/b.jpg' },
        ]);
        const clips = await new twitch_1.TwitchClient(m.fn).listClips(creds);
        strict_1.default.deepEqual(clips.map((c) => c.id), ['b', 'a']);
        strict_1.default.deepEqual(clips[0], { id: 'b', title: 'Nuevo', url: 'https://clips.twitch.tv/b', durationSec: 30, createdAt: '2026-10-14T10:00:00Z', creator: 'y', views: 9, thumbnail: 'https://t/b.jpg' });
        strict_1.default.match(m.calls.find((c) => c.url.includes('/helix/clips')).url, /broadcaster_id=42&first=100&started_at=.*&ended_at=/);
    });
    (0, node_test_1.describe)('todos los clips', () => {
        const NOW = Date.parse('2026-10-17T12:00:00Z');
        const DAY = 86_400_000;
        const mk = (n, daysAgo) => Array.from({ length: n }, (_, i) => ({ id: `c${daysAgo}-${i}`, title: `Clip ${daysAgo}-${i}`, url: `https://clips.twitch.tv/c${daysAgo}-${i}`, duration: 10, created_at: new Date(NOW - daysAgo * DAY - i * 60_000).toISOString(), creator_name: 'x', view_count: n - i, thumbnail_url: 't' }));
        // 130 clips recientes (dos páginas), 5 de hace ~200 días y nada más
        const historia = () => mockFetch((url) => {
            if (url.includes('oauth2/token'))
                return json({ access_token: 'tok1', expires_in: 3600 });
            if (url.includes('/helix/users'))
                return json({ data: [{ id: '42', display_name: 'Don_Diegons' }] });
            const from = Date.parse(decodeURIComponent(/started_at=([^&]+)/.exec(url)[1]));
            const to = Date.parse(decodeURIComponent(/ended_at=([^&]+)/.exec(url)[1]));
            const inWindow = (d) => NOW - d * DAY >= from && NOW - d * DAY <= to;
            const all = [...mk(130, 1), ...mk(5, 200)].filter((c) => inWindow((NOW - Date.parse(c.created_at)) / DAY));
            const after = /after=([^&]+)/.exec(url)?.[1];
            if (!after)
                return json({ data: all.slice(0, 100), pagination: all.length > 100 ? { cursor: 'c1' } : {} });
            return json({ data: all.slice(100), pagination: {} });
        });
        (0, node_test_1.it)('pide todos: pagina con el cursor, recorre los tramos de fechas y los ordena del más reciente al más antiguo', async () => {
            const m = historia();
            const clips = await new twitch_1.TwitchClient(m.fn, () => NOW).listClips(creds);
            strict_1.default.equal(clips.length, 135);
            strict_1.default.equal(new Set(clips.map((c) => c.id)).size, 135);
            strict_1.default.deepEqual(clips.map((c) => c.createdAt), [...clips.map((c) => c.createdAt)].sort().reverse());
            const urls = m.calls.map((c) => c.url).filter((u) => u.includes('/helix/clips'));
            strict_1.default.ok(urls.some((u) => u.includes('after=c1')), 'usa el cursor de la página siguiente');
            strict_1.default.ok(urls.every((u) => u.includes('started_at=') && u.includes('ended_at=')), 'siempre con las dos fechas (si no, Twitch solo mira una semana)');
            strict_1.default.ok(urls.length >= 8 && urls.length <= 10, `se detiene tras un año sin clips (${urls.length} peticiones)`);
        });
        (0, node_test_1.it)('si falla un tramo antiguo conserva lo ya leído y lo avisa; avisa del progreso por tramos', async () => {
            const base = historia();
            let n = 0;
            const fn = (async (u, i) => {
                if (String(u).includes('/helix/clips') && ++n === 4)
                    return new Response('{"message":"boom"}', { status: 500 });
                return base.fn(u, i);
            });
            const progress = [];
            const warns = [];
            const clips = await new twitch_1.TwitchClient(fn, () => NOW).listClips(creds, { onProgress: (l) => progress.push(l.length), onWarning: (m) => warns.push(m) });
            strict_1.default.ok(clips.length >= 130, `${clips.length}`);
            strict_1.default.ok(progress.length >= 1 && progress[0] === 130, `primero sale lo reciente (${progress})`);
            strict_1.default.equal(warns.length, 1);
            strict_1.default.match(warns[0], /Solo se han podido leer los clips hasta/);
        });
        (0, node_test_1.it)('si falla ya el primer tramo (lo reciente), el error llega', async () => {
            const fn = (async (u) => (String(u).includes('/helix/clips') ? new Response('{"message":"nope"}', { status: 500 }) : historia().fn(u)));
            await strict_1.default.rejects(() => new twitch_1.TwitchClient(fn, () => NOW).listClips(creds));
        });
        (0, node_test_1.it)('con sinceMs solo mira lo reciente', async () => {
            const m = historia();
            const clips = await new twitch_1.TwitchClient(m.fn, () => NOW).listClips(creds, { sinceMs: NOW - 3 * DAY });
            strict_1.default.equal(clips.length, 130);
            strict_1.default.equal(m.calls.filter((c) => c.url.includes('/helix/clips')).length, 2);
        });
    });
});
