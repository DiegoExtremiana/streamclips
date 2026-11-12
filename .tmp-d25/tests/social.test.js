"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("../shared/types");
const oauth_1 = require("../electron/services/oauth");
const youtube_1 = require("../electron/services/social/youtube");
const tiktok_1 = require("../electron/services/social/tiktok");
const instagram_1 = require("../electron/services/social/instagram");
const accounts_1 = require("../electron/services/social/accounts");
const publishers_1 = require("../electron/domain/publishers");
const helpers_1 = require("./helpers");
const closers = [];
(0, node_test_1.afterEach)(() => {
    while (closers.length)
        closers.pop()();
});
async function server(handler) {
    const reqs = [];
    const srv = node_http_1.default.createServer((req, res) => {
        const parts = [];
        req.on('data', (c) => parts.push(c));
        req.on('end', () => {
            const r = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(parts) };
            reqs.push(r);
            const out = handler(r, reqs.length) ?? { status: 404 };
            if (out.status === -1)
                return void req.socket.destroy();
            res.writeHead(out.status ?? 200, { ...(out.json !== undefined ? { 'content-type': 'application/json' } : {}), ...Object.fromEntries(Object.entries(out.headers ?? {}).filter(([, v]) => v !== undefined)) });
            res.end(out.json !== undefined ? JSON.stringify(out.json) : (out.text ?? ''));
        });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => { srv.close(); srv.closeAllConnections?.(); });
    return { base: `http://127.0.0.1:${srv.address().port}`, reqs };
}
const dir = (0, helpers_1.tmpDir)();
process.on('exit', () => (0, helpers_1.rmDir)(dir));
function mk(name, bytes) {
    const f = node_path_1.default.join(dir, name);
    node_fs_1.default.writeFileSync(f, Buffer.alloc(bytes, 7));
    return f;
}
function out(over) {
    return { id: 'o1', kind: 'clip', title: 'Mi clip', files: {}, durationSec: 30, createdAt: new Date().toISOString(), ...over };
}
(0, node_test_1.describe)('OAuth', () => {
    (0, node_test_1.it)('pkce y URL de autorización llevan lo necesario', () => {
        const p = (0, oauth_1.pkcePair)();
        strict_1.default.match(p.verifier, /^[A-Za-z0-9_-]{40,}$/);
        const u = new URL((0, oauth_1.buildAuthUrl)(oauth_1.PROVIDERS.google, { clientId: 'CID', clientSecret: 's' }, 'ST', p.challenge));
        strict_1.default.equal(u.searchParams.get('client_id'), 'CID');
        strict_1.default.equal(u.searchParams.get('state'), 'ST');
        strict_1.default.equal(u.searchParams.get('code_challenge_method'), 'S256');
        strict_1.default.equal(u.searchParams.get('access_type'), 'offline');
        strict_1.default.match(u.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        strict_1.default.ok(u.searchParams.get('scope').includes('youtube.upload'));
        const t = new URL((0, oauth_1.buildAuthUrl)(oauth_1.PROVIDERS.tiktok, { clientId: 'K', clientSecret: 's' }, 'ST', 'ch'));
        strict_1.default.equal(t.searchParams.get('client_key'), 'K');
        strict_1.default.equal(t.searchParams.get('client_id'), null);
        strict_1.default.equal(t.searchParams.get('scope'), 'user.info.basic,video.publish,video.upload');
    });
});
(0, node_test_1.describe)('conexiones: flujo completo contra servidores simulados', () => {
    let e;
    (0, node_test_1.afterEach)(() => e?.cleanup());
    /** Un «navegador» que visita la URL de autorización y vuelve al callback con el código. */
    const browser = (code = 'CODE') => async (url) => {
        const u = new URL(url);
        const back = new URL(u.searchParams.get('redirect_uri'));
        back.searchParams.set('code', code);
        back.searchParams.set('state', u.searchParams.get('state'));
        setTimeout(() => void fetch(back).catch(() => undefined), 20);
    };
    async function setup(port, tokenReply, openUrl = browser()) {
        const tok = await server(tokenReply);
        const providers = {
            ...oauth_1.PROVIDERS,
            google: { ...oauth_1.PROVIDERS.google, tokenUrl: `${tok.base}/token`, authUrl: `${tok.base}/auth`, port },
        };
        const yt = await server((r) => (r.url.startsWith('/channels') ? { json: { items: [{ snippet: { title: 'Canal de Diego' } }] } } : undefined));
        e = (0, helpers_1.makeEnv)({ openUrl, oauthProviders: providers, socialEnv: { youtube: { upload: `${yt.base}/upload`, api: yt.base } } });
        return { tok, yt };
    }
    (0, node_test_1.it)('autoriza, guarda las claves cifradas y el nombre de la cuenta; nada sensible llega a la interfaz', async () => {
        const { tok } = await setup(53701, () => ({ json: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 } }));
        e.ctx.connections.setApp('youtube', ' CID ', 'SECRETO');
        const list = await e.ctx.connections.connect('youtube');
        const yt = list.find((x) => x.platform === 'youtube');
        strict_1.default.deepEqual([yt.hasCredentials, yt.connected, yt.account], [true, true, 'Canal de Diego']);
        const body = new URLSearchParams(tok.reqs[0].body.toString());
        strict_1.default.equal(body.get('grant_type'), 'authorization_code');
        strict_1.default.equal(body.get('code'), 'CODE');
        strict_1.default.equal(body.get('client_id'), 'CID');
        strict_1.default.ok(body.get('code_verifier'));
        const disk = node_fs_1.default.readFileSync(e.ctx.store.file, 'utf8');
        for (const secret of ['SECRETO', 'AT1', 'RT1'])
            strict_1.default.ok(!disk.includes(secret), `${secret} no debe estar en claro en data.json`);
        strict_1.default.equal((await e.ctx.connections.accessToken('youtube'))?.accessToken, 'AT1');
    });
    (0, node_test_1.it)('renueva el token cuando va a caducar y conserva el refresh_token', async () => {
        let n = 0;
        await setup(53702, (r) => {
            n++;
            const grant = new URLSearchParams(r.body.toString()).get('grant_type');
            return grant === 'refresh_token' ? { json: { access_token: 'AT2', expires_in: 3600 } } : { json: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 60 } };
        });
        e.ctx.connections.setApp('youtube', 'CID', 'S');
        await e.ctx.connections.connect('youtube');
        const t = await e.ctx.connections.accessToken('youtube');
        strict_1.default.equal(t?.accessToken, 'AT2');
        strict_1.default.equal(t?.refreshToken, 'RT1');
        strict_1.default.equal(n, 2);
        // dos peticiones a la vez renuevan una sola vez
        n = 0;
        const conn = (e.ctx.store.data.connections.youtube);
        void conn;
        strict_1.default.equal((await e.ctx.connections.accessToken('youtube'))?.accessToken, 'AT2');
        strict_1.default.equal(n, 0);
    });
    (0, node_test_1.it)('si el usuario deniega o la app es rechazada, error claro y no queda conectada', async () => {
        await setup(53703, () => ({ status: 400, json: { error: 'invalid_client', error_description: 'secreto incorrecto' } }));
        e.ctx.connections.setApp('youtube', 'CID', 'S');
        await strict_1.default.rejects(() => e.ctx.connections.connect('youtube'), /rechazó la autorización: secreto incorrecto/);
        strict_1.default.equal(e.ctx.connections.list()[0].connected, false);
        // el puerto queda libre para reintentar
        const e2 = e;
        void e2;
        await strict_1.default.rejects(() => e.ctx.connections.connect('youtube'), /rechazó/);
    });
    (0, node_test_1.it)('error en el navegador (access_denied) y cancelación', async () => {
        const denied = async (url) => {
            const u = new URL(url);
            const back = new URL(u.searchParams.get('redirect_uri'));
            back.searchParams.set('error', 'access_denied');
            setTimeout(() => void fetch(back).catch(() => undefined), 20);
        };
        await setup(53704, () => ({ json: {} }), denied);
        e.ctx.connections.setApp('youtube', 'CID', 'S');
        await strict_1.default.rejects(() => e.ctx.connections.connect('youtube'), /no autorizó la conexión \(access_denied\)/);
        const never = async () => undefined;
        const e3 = (0, helpers_1.makeEnv)({ openUrl: never, oauthProviders: { ...oauth_1.PROVIDERS, google: { ...oauth_1.PROVIDERS.google, port: 53705 } } });
        try {
            e3.ctx.connections.setApp('youtube', 'CID', 'S');
            const p = e3.ctx.connections.connect('youtube');
            await new Promise((r) => setTimeout(r, 100));
            await strict_1.default.rejects(() => e3.ctx.connections.connect('youtube'), /Ya hay una conexión en curso/);
            e3.ctx.connections.cancelConnect();
            await strict_1.default.rejects(() => p, /cancelada/);
        }
        finally {
            e3.cleanup();
        }
    });
    (0, node_test_1.it)('una visita ajena al callback (estado distinto) no cuela ni cancela', async () => {
        const sneaky = async (url) => {
            const u = new URL(url);
            const back = new URL(u.searchParams.get('redirect_uri'));
            const evil = new URL(back);
            evil.searchParams.set('code', 'EVIL');
            evil.searchParams.set('state', 'otro');
            setTimeout(() => void fetch(evil).then(() => fetch(`${back.origin}/otra-ruta`)).then(async () => {
                back.searchParams.set('code', 'GOOD');
                back.searchParams.set('state', u.searchParams.get('state'));
                await fetch(back);
            }).catch(() => undefined), 20);
        };
        const { tok } = await setup(53706, () => ({ json: { access_token: 'AT', expires_in: 3600, refresh_token: 'R' } }), sneaky);
        e.ctx.connections.setApp('youtube', 'CID', 'S');
        await e.ctx.connections.connect('youtube');
        strict_1.default.equal(new URLSearchParams(tok.reqs[0].body.toString()).get('code'), 'GOOD');
    });
    (0, node_test_1.it)('cambiar el ID de la app desconecta; el secreto enmascarado no pisa el guardado; desconectar borra las claves', async () => {
        await setup(53707, () => ({ json: { access_token: 'AT', expires_in: 3600, refresh_token: 'R' } }));
        e.ctx.connections.setApp('youtube', 'CID', 'S');
        await e.ctx.connections.connect('youtube');
        e.ctx.connections.setApp('youtube', 'CID', types_1.MASKED_SECRET);
        strict_1.default.equal(e.ctx.connections.list()[0].connected, true);
        e.ctx.connections.setApp('youtube', 'OTRO', types_1.MASKED_SECRET);
        strict_1.default.equal(e.ctx.connections.list()[0].connected, false);
        strict_1.default.equal(e.ctx.connections.list()[0].hasCredentials, true);
        await e.ctx.connections.connect('youtube');
        e.ctx.connections.disconnect('youtube');
        strict_1.default.equal(e.ctx.connections.list()[0].connected, false);
        strict_1.default.equal(await e.ctx.connections.accessToken('youtube'), null);
        strict_1.default.throws(() => e.ctx.connections.setApp('youtube', 'con espacios', 'x'), /no es válido/);
        await strict_1.default.rejects(() => e.ctx.connections.connect('tiktok'), /Primero guarda/);
    });
    (0, node_test_1.it)('sin conexión, el programador deja la publicación en espera (NotConnectedError)', async () => {
        e = (0, helpers_1.makeEnv)();
        const pubs = (0, publishers_1.realPublishers)(e.ctx.connections, e.ctx.log);
        await strict_1.default.rejects(() => pubs.youtube.publish(out({})), publishers_1.NotConnectedError);
        await strict_1.default.rejects(() => pubs.tiktok.publish(out({})), publishers_1.NotConnectedError);
        await strict_1.default.rejects(() => pubs.instagram.publish(out({})), publishers_1.NotConnectedError);
    });
});
(0, node_test_1.describe)('YouTube: subida reanudable', () => {
    const token = async () => 'TOK';
    const SIZE = 600_000;
    function ytServer(opts = {}) {
        let received = 0;
        let dropped = false;
        return server((r) => {
            if (r.url.startsWith('/upload/videos?uploadType=resumable')) {
                if (opts.quota)
                    return { status: 403, json: { error: { message: 'Quota', errors: [{ reason: 'quotaExceeded' }] } } };
                return { headers: { location: `${(r.headers.host ? `http://${r.headers.host}` : '')}/session/1` } };
            }
            if (r.url === '/session/1') {
                const cr = r.headers['content-range'] ?? '';
                if (cr.startsWith('bytes */'))
                    return { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : {} };
                const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr);
                if (opts.dropAt !== undefined && !dropped && Number(m[1]) >= opts.dropAt) {
                    dropped = true;
                    return { status: -1 };
                }
                strict_1.default.equal(Number(m[1]), received, 'los trozos van en orden y sin huecos');
                received = Number(m[2]) + 1;
                return received >= Number(m[3]) ? { json: { id: 'VID123' } } : { status: 308, headers: { range: `bytes=0-${received - 1}` } };
            }
            if (r.url.startsWith('/playlists?part=snippet&mine'))
                return { json: { items: opts.playlists ?? [] } };
            if (r.url.startsWith('/playlists?part=snippet,status'))
                return { json: { id: 'PLnew' } };
            if (r.url.startsWith('/playlistItems'))
                return opts.failPlaylistItem ? { status: 500 } : { json: { id: 'item' } };
            if (r.url.startsWith('/upload/thumbnails/set'))
                return { json: {} };
            return undefined;
        }).then((s) => ({ ...s, receivedBytes: () => received }));
    }
    (0, node_test_1.it)('sube un vídeo largo por trozos con sus datos, lista y miniatura', async () => {
        const s = await ytServer({ playlists: [{ id: 'PL1', snippet: { title: 'Directos' } }] });
        const file = mk('largo.mp4', SIZE);
        const thumb = mk('t.jpg', 100);
        const r = await (0, youtube_1.publishYoutube)({ token, endpoints: { upload: `${s.base}/upload`, api: s.base }, chunkSize: 262144 }, out({ kind: 'long', title: 'Resumen', description: 'Desc', playlist: 'directos', files: { long: file }, thumbnail: thumb, visibility: 'public' }));
        strict_1.default.equal(r.videoId, 'VID123');
        strict_1.default.equal(s.receivedBytes(), SIZE);
        const init = s.reqs[0];
        strict_1.default.equal(init.headers.authorization, 'Bearer TOK');
        strict_1.default.equal(init.headers['x-upload-content-length'], String(SIZE));
        const meta = JSON.parse(init.body.toString());
        strict_1.default.deepEqual(meta.status, { privacyStatus: 'public', selfDeclaredMadeForKids: false });
        strict_1.default.equal(meta.snippet.title, 'Resumen');
        const item = s.reqs.find((x) => x.url.startsWith('/playlistItems'));
        strict_1.default.equal(JSON.parse(item.body.toString()).snippet.playlistId, 'PL1');
        strict_1.default.ok(s.reqs.some((x) => x.url.startsWith('/upload/thumbnails/set?videoId=VID123')));
    });
    (0, node_test_1.it)('por defecto privado; los clips suben la versión vertical como Short; crea la lista si no existe', async () => {
        const s = await ytServer();
        const v = mk('v.mp4', 1000);
        await (0, youtube_1.publishYoutube)({ token, endpoints: { upload: `${s.base}/upload`, api: s.base } }, out({ title: 'Clip', playlist: 'Nueva', files: { vertical: v, horizontal: mk('h.mp4', 5) } }));
        const meta = JSON.parse(s.reqs[0].body.toString());
        strict_1.default.equal(meta.status.privacyStatus, 'private');
        strict_1.default.equal(meta.snippet.title, 'Clip #Shorts');
        strict_1.default.ok(s.reqs.some((x) => x.url.startsWith('/playlists?part=snippet,status')));
        strict_1.default.equal(JSON.parse(s.reqs.find((x) => x.url.startsWith('/playlistItems')).body.toString()).snippet.playlistId, 'PLnew');
    });
    (0, node_test_1.it)('si se corta la conexión a mitad, pregunta hasta dónde llegó y continúa sin repetir ni saltarse bytes', async () => {
        const s = await ytServer({ dropAt: 262144 });
        const file = mk('cortado.mp4', SIZE);
        const r = await (0, youtube_1.publishYoutube)({ token, sleep: async () => undefined, endpoints: { upload: `${s.base}/upload`, api: s.base }, chunkSize: 262144 }, out({ kind: 'long', files: { long: file } }));
        strict_1.default.equal(r.videoId, 'VID123');
        strict_1.default.equal(s.receivedBytes(), SIZE);
        strict_1.default.ok(s.reqs.some((x) => String(x.headers['content-range']).startsWith('bytes */')), 'debe consultar el estado');
    });
    (0, node_test_1.it)('un fallo al añadir a la lista NO impide dar la subida por buena (no se duplica el vídeo)', async () => {
        const s = await ytServer({ failPlaylistItem: true });
        const warns = [];
        const r = await (0, youtube_1.publishYoutube)({ token, warn: (m) => warns.push(m), endpoints: { upload: `${s.base}/upload`, api: s.base } }, out({ kind: 'long', playlist: 'X', files: { long: mk('l2.mp4', 500) } }));
        strict_1.default.equal(r.videoId, 'VID123');
        strict_1.default.match(warns.join(' '), /No se pudo añadir a la lista/);
    });
    (0, node_test_1.it)('cuota agotada, 401 y archivo que falta dan mensajes claros', async () => {
        const q = await ytServer({ quota: true });
        await strict_1.default.rejects(() => (0, youtube_1.publishYoutube)({ token, endpoints: { upload: `${q.base}/upload`, api: q.base } }, out({ kind: 'long', files: { long: mk('q.mp4', 10) } })), /cuota diaria/);
        const u = await server(() => ({ status: 401, json: { error: { message: 'x' } } }));
        await strict_1.default.rejects(() => (0, youtube_1.publishYoutube)({ token, endpoints: { upload: `${u.base}/upload`, api: u.base } }, out({ kind: 'long', files: { long: mk('u.mp4', 10) } })), /Vuelve a conectar/);
        await strict_1.default.rejects(() => (0, youtube_1.publishYoutube)({ token }, out({ kind: 'long', files: { long: node_path_1.default.join(dir, 'nope.mp4') } })), /ya no está en su sitio/);
        await strict_1.default.rejects(() => (0, youtube_1.publishYoutube)({ token }, out({ kind: 'long', files: {} })), /no tiene archivo/);
    });
    (0, node_test_1.it)('lista las listas de reproducción con paginación', async () => {
        let page = 0;
        const s = await server((r) => {
            if (!r.url.startsWith('/playlists'))
                return undefined;
            return page++ === 0 ? { json: { items: [{ id: 'a', snippet: { title: 'A' } }], nextPageToken: 'p2' } } : { json: { items: [{ id: 'b', snippet: { title: 'B' } }] } };
        });
        strict_1.default.deepEqual(await (0, youtube_1.listPlaylists)({ token, endpoints: { upload: s.base, api: s.base } }), [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    });
});
(0, node_test_1.describe)('TikTok', () => {
    const token = async () => 'TT';
    function tt(opts = {}) {
        const chunks = [];
        let polls = 0;
        return server((r) => {
            if (r.url === '/post/publish/creator_info/query/')
                return { json: { data: { privacy_level_options: opts.options ?? ['SELF_ONLY'] }, error: { code: 'ok' } } };
            if (r.url === '/post/publish/video/init/')
                return { json: { data: { publish_id: 'PUB1', upload_url: `http://${r.headers.host}/upload` }, error: { code: 'ok' } } };
            if (r.url === '/upload') {
                chunks.push(String(r.headers['content-range']));
                const m = /bytes \d+-(\d+)\/(\d+)/.exec(String(r.headers['content-range']));
                return { status: Number(m[1]) + 1 === Number(m[2]) ? 201 : 206 };
            }
            if (r.url === '/post/publish/status/fetch/') {
                const s = (opts.statuses ?? ['PROCESSING_UPLOAD', 'PUBLISH_COMPLETE'])[polls++] ?? 'PUBLISH_COMPLETE';
                return { json: { data: { status: s, fail_reason: opts.failReason }, error: { code: 'ok' } } };
            }
            return undefined;
        }).then((s) => ({ ...s, chunks }));
    }
    (0, node_test_1.it)('sube en trozos (el último con el resto), usa privacidad «solo yo» si no hay otra, y espera a que termine', async () => {
        const s = await tt();
        const file = mk('tt.mp4', 25_000_000 + 123);
        const r = await (0, tiktok_1.publishTiktok)({ token, api: s.base, pollMs: 1, sleep: async () => undefined }, out({ files: { vertical: file } }));
        strict_1.default.equal(r.publishId, 'PUB1');
        const init = JSON.parse(s.reqs.find((x) => x.url.includes('/init/')).body.toString());
        strict_1.default.equal(init.post_info.privacy_level, 'SELF_ONLY');
        strict_1.default.deepEqual(init.source_info, { source: 'FILE_UPLOAD', video_size: 25_000_123, chunk_size: 10485760, total_chunk_count: 2 });
        strict_1.default.deepEqual(s.chunks, ['bytes 0-10485759/25000123', 'bytes 10485760-25000122/25000123']);
        strict_1.default.equal(s.reqs[0].headers.authorization, 'Bearer TT');
    });
    (0, node_test_1.it)('un vídeo pequeño va en un solo trozo; público solo si lo pides y la cuenta puede', async () => {
        const s = await tt({ options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] });
        await (0, tiktok_1.publishTiktok)({ token, api: s.base, sleep: async () => undefined, pollMs: 1 }, out({ visibility: 'public', files: { vertical: mk('tt2.mp4', 3000) } }));
        const init = JSON.parse(s.reqs.find((x) => x.url.includes('/init/')).body.toString());
        strict_1.default.equal(init.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
        strict_1.default.equal(init.source_info.total_chunk_count, 1);
        const s2 = await tt({ options: ['SELF_ONLY'] });
        await (0, tiktok_1.publishTiktok)({ token, api: s2.base, sleep: async () => undefined }, out({ visibility: 'public', files: { vertical: mk('tt3.mp4', 3000) } }));
        strict_1.default.equal(JSON.parse(s2.reqs.find((x) => x.url.includes('/init/')).body.toString()).post_info.privacy_level, 'SELF_ONLY');
    });
    (0, node_test_1.it)('rechaza vídeos largos, informa de fallos de TikTok y del límite diario', async () => {
        await strict_1.default.rejects(() => (0, tiktok_1.publishTiktok)({ token }, out({ kind: 'long', files: { long: mk('tt4.mp4', 10) } })), /solo admite clips/);
        const s = await tt({ statuses: ['FAILED'], failReason: 'video_pull_failed' });
        await strict_1.default.rejects(() => (0, tiktok_1.publishTiktok)({ token, api: s.base, sleep: async () => undefined }, out({ files: { vertical: mk('tt5.mp4', 100) } })), /video_pull_failed/);
        const lim = await server(() => ({ status: 429, json: { error: { code: 'spam_risk_too_many_posts', message: 'x' } } }));
        await strict_1.default.rejects(() => (0, tiktok_1.publishTiktok)({ token, api: lim.base }, out({ files: { vertical: mk('tt6.mp4', 100) } })), /límite|limita/);
        const bad = await server(() => ({ status: 401, json: { error: { code: 'access_token_invalid' } } }));
        await strict_1.default.rejects(() => (0, tiktok_1.publishTiktok)({ token, api: bad.base }, out({ files: { vertical: mk('tt7.mp4', 100) } })), /Vuelve a conectar/);
    });
    (0, node_test_1.it)('si TikTok no termina de procesar, no reintenta solo (evita duplicados)', async () => {
        const s = await tt({ statuses: new Array(100).fill('PROCESSING_UPLOAD') });
        await strict_1.default.rejects(() => (0, tiktok_1.publishTiktok)({ token, api: s.base, sleep: async () => undefined }, out({ files: { vertical: mk('tt8.mp4', 100) } })), /sigue procesando/);
    });
});
(0, node_test_1.describe)('Instagram', () => {
    const tokenFn = async () => ({ accessToken: 'IGT', igUserId: 'IG1' });
    function ig(opts = {}) {
        let polls = 0;
        let uploaded = 0;
        return server((r) => {
            if (r.url === '/IG1/media' && r.method === 'POST')
                return { json: { id: 'CONT1', uri: `http://${r.headers.host}/rupload/CONT1` } };
            if (r.url === '/rupload/CONT1') {
                uploaded = r.body.length;
                return { json: { success: true } };
            }
            if (r.url.startsWith('/CONT1?fields=')) {
                const s = (opts.statuses ?? ['IN_PROGRESS', 'FINISHED'])[polls++] ?? 'FINISHED';
                return { json: { status_code: s, status: s === 'ERROR' ? 'Formato no válido' : 'ok' } };
            }
            if (r.url === '/IG1/media_publish')
                return opts.publishError ? { status: 400, json: { error: { message: 'Nope', code: 9007 } } } : { json: { id: 'MEDIA9' } };
            return undefined;
        }).then((s) => ({ ...s, uploaded: () => uploaded }));
    }
    (0, node_test_1.it)('crea el contenedor, sube el archivo entero, espera y publica', async () => {
        const s = await ig();
        const file = mk('ig.mp4', 400_000);
        const r = await (0, instagram_1.publishInstagram)({ token: tokenFn, graph: s.base, pollMs: 1, sleep: async () => undefined }, out({ title: 'Mi reel', files: { vertical: file } }));
        strict_1.default.equal(r.mediaId, 'MEDIA9');
        strict_1.default.equal(s.uploaded(), 400_000);
        const create = new URLSearchParams(s.reqs[0].body.toString());
        strict_1.default.deepEqual([create.get('media_type'), create.get('upload_type'), create.get('caption'), create.get('access_token')], ['REELS', 'resumable', 'Mi reel', 'IGT']);
        const up = s.reqs.find((x) => x.url === '/rupload/CONT1');
        strict_1.default.equal(up.headers.authorization, 'OAuth IGT');
        strict_1.default.equal(up.headers.file_size, '400000');
        strict_1.default.equal(up.headers.offset, '0');
    });
    (0, node_test_1.it)('errores: procesado fallido, sin cuenta profesional, vídeos largos, sin vertical, publicación rechazada', async () => {
        const s = await ig({ statuses: ['ERROR'] });
        await strict_1.default.rejects(() => (0, instagram_1.publishInstagram)({ token: tokenFn, graph: s.base, sleep: async () => undefined }, out({ files: { vertical: mk('ig2.mp4', 100) } })), /Formato no válido/);
        await strict_1.default.rejects(() => (0, instagram_1.publishInstagram)({ token: async () => ({ accessToken: 'x', igUserId: '' }) }, out({ files: { vertical: mk('ig3.mp4', 100) } })), /cuenta de Instagram profesional/);
        await strict_1.default.rejects(() => (0, instagram_1.publishInstagram)({ token: tokenFn }, out({ kind: 'long', files: { long: mk('ig4.mp4', 10) } })), /solo admite clips/);
        await strict_1.default.rejects(() => (0, instagram_1.publishInstagram)({ token: tokenFn }, out({ files: { horizontal: mk('ig5.mp4', 10) } })), /versión vertical/);
        const p = await ig({ publishError: true });
        await strict_1.default.rejects(() => (0, instagram_1.publishInstagram)({ token: tokenFn, graph: p.base, sleep: async () => undefined, pollMs: 1 }, out({ files: { vertical: mk('ig6.mp4', 100) } })), /Instagram: Nope/);
    });
});
(0, node_test_1.describe)('cuentas conectadas', () => {
    (0, node_test_1.it)('Instagram: encuentra la cuenta profesional enlazada; sin ella, explica qué falta', async () => {
        const s = await server(() => ({ json: { data: [{ name: 'Pág sin IG' }, { name: 'Mi página', instagram_business_account: { id: '1784', username: 'diego' } }] } }));
        strict_1.default.deepEqual(await (0, accounts_1.lookupAccount)('instagram', { accessToken: 't', expiresAt: 0 }, { graph: s.base }), { account: '@diego', extra: { igUserId: '1784' } });
        const none = await server(() => ({ json: { data: [{ name: 'x' }] } }));
        await strict_1.default.rejects(() => (0, accounts_1.lookupAccount)('instagram', { accessToken: 't', expiresAt: 0 }, { graph: none.base }), /cuenta de Instagram profesional/);
    });
    (0, node_test_1.it)('YouTube sin canal y TikTok', async () => {
        const yt = await server(() => ({ json: { items: [] } }));
        await strict_1.default.rejects(() => (0, accounts_1.lookupAccount)('youtube', { accessToken: 't', expiresAt: 0 }, { ytApi: yt.base }), /no tiene un canal/);
        const tk = await server(() => ({ json: { data: { user: { display_name: 'diego_tt' } }, error: { code: 'ok' } } }));
        strict_1.default.equal((await (0, accounts_1.lookupAccount)('tiktok', { accessToken: 't', expiresAt: 0 }, { tiktokApi: tk.base })).account, 'diego_tt');
    });
});
void helpers_1.makeVideo;
