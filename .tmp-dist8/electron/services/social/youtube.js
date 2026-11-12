"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.YT_CHUNK = exports.YT_ENDPOINTS = void 0;
exports.youtubeFile = youtubeFile;
exports.publishYoutube = publishYoutube;
exports.listPlaylists = listPlaylists;
const node_fs_1 = __importDefault(require("node:fs"));
const common_1 = require("./common");
exports.YT_ENDPOINTS = {
    upload: 'https://www.googleapis.com/upload/youtube/v3',
    api: 'https://www.googleapis.com/youtube/v3',
};
/** Múltiplo de 256 KiB, como exige la subida reanudable. */
exports.YT_CHUNK = 8 * 1024 * 1024;
const MAX_RETRIES = 5;
function explain(res, msg) {
    if (res.status === 401)
        return new common_1.PublishError('YouTube rechazó la conexión. Vuelve a conectar la cuenta en Conexiones.');
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(msg))
        return new common_1.PublishError('Se agotó la cuota diaria de la API de YouTube. Se podrá volver a intentar mañana.');
    if (/uploadLimitExceeded/.test(msg))
        return new common_1.PublishError('YouTube ha alcanzado el límite de subidas de tu canal por hoy.');
    if (/forbidden|insufficientPermissions|youtubeSignupRequired/.test(msg))
        return new common_1.PublishError(`YouTube no permite esta acción con la cuenta conectada (${msg}).`);
    return new common_1.PublishError(`YouTube: ${msg}`);
}
/** Archivo que se sube: los vídeos largos tal cual, los clips en vertical (YouTube Shorts). */
function youtubeFile(o) {
    if (o.kind === 'long') {
        if (!o.files.long)
            throw new common_1.PublishError('El vídeo no tiene archivo.');
        return { file: o.files.long, short: false };
    }
    const f = o.files.vertical ?? o.files.horizontal;
    if (!f)
        throw new common_1.PublishError('El clip no tiene archivo.');
    return { file: f, short: !!o.files.vertical };
}
async function publishYoutube(d, o) {
    const f = d.fetchFn ?? fetch;
    const ep = d.endpoints ?? exports.YT_ENDPOINTS;
    const sleep = d.sleep ?? common_1.defaultSleep;
    const chunk = d.chunkSize ?? exports.YT_CHUNK;
    const { file, short } = youtubeFile(o);
    if (!node_fs_1.default.existsSync(file))
        throw new common_1.PublishError('El archivo del vídeo ya no está en su sitio.');
    const size = node_fs_1.default.statSync(file).size;
    if (!size)
        throw new common_1.PublishError('El archivo del vídeo está vacío.');
    const token = await d.token();
    const auth = { Authorization: `Bearer ${token}` };
    let title = o.title;
    if (short && !/#shorts/i.test(title) && title.length <= 92)
        title = `${title} #Shorts`;
    const meta = {
        snippet: { title, description: o.description ?? (short ? '#Shorts' : ''), categoryId: '20' },
        status: { privacyStatus: o.visibility === 'public' ? 'public' : 'private', selfDeclaredMadeForKids: false },
    };
    // 1) abrir la sesión de subida reanudable
    const init = await (0, common_1.timedFetch)(f, `${ep.upload}/videos?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
        body: JSON.stringify(meta),
    });
    if (!init.ok)
        throw explain(init, await (0, common_1.apiMessage)(init));
    const session = init.headers.get('location');
    if (!session)
        throw new common_1.PublishError('YouTube no devolvió la dirección de subida.');
    // 2) subir por trozos; si se corta, se pregunta hasta dónde llegó y se continúa
    let offset = 0;
    let retries = 0;
    let videoId = '';
    while (!videoId) {
        const end = Math.min(size, offset + chunk);
        let res = null;
        try {
            const body = await (0, common_1.readChunk)(file, offset, end);
            res = await (0, common_1.timedFetch)(f, session, { method: 'PUT', headers: { 'Content-Length': String(body.length), 'Content-Range': `bytes ${offset}-${end - 1}/${size}` }, body: new Uint8Array(body) }, 10 * 60_000);
        }
        catch (e) {
            if (!(e instanceof common_1.PublishError) || retries >= MAX_RETRIES)
                throw e;
        }
        if (res && (res.status === 200 || res.status === 201)) {
            const j = (await res.json().catch(() => ({})));
            if (!j.id)
                throw new common_1.PublishError('YouTube terminó la subida pero no devolvió el identificador del vídeo.');
            videoId = j.id;
            break;
        }
        if (res && res.status === 308) {
            offset = nextOffset(res.headers.get('range'));
            retries = 0;
            continue;
        }
        if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
            throw explain(res, await (0, common_1.apiMessage)(res));
        // fallo transitorio o de red: se consulta cuánto recibió YouTube
        if (++retries > MAX_RETRIES)
            throw new common_1.PublishError(`La subida a YouTube falló repetidamente${res ? ` (HTTP ${res.status})` : ''}.`);
        await sleep(Math.min(30_000, 1000 * 2 ** retries));
        try {
            const q = await (0, common_1.timedFetch)(f, session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } });
            if (q.status === 308)
                offset = nextOffset(q.headers.get('range'));
            else if (q.status === 200 || q.status === 201) {
                const j = (await q.json().catch(() => ({})));
                if (j.id)
                    videoId = j.id;
            }
        }
        catch {
            /* se reintenta en la vuelta siguiente */
        }
    }
    // 3) extras: el vídeo ya está subido, así que un fallo aquí NO debe hacer que se vuelva a subir
    const warn = d.warn ?? (() => undefined);
    if (o.kind === 'long' && o.thumbnail && node_fs_1.default.existsSync(o.thumbnail)) {
        try {
            const img = node_fs_1.default.readFileSync(o.thumbnail);
            const r = await (0, common_1.timedFetch)(f, `${ep.upload}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(img) });
            if (!r.ok)
                warn(`Miniatura no aceptada por YouTube: ${await (0, common_1.apiMessage)(r)}`);
        }
        catch (e) {
            warn(`Miniatura no subida: ${e.message}`);
        }
    }
    if (o.playlist) {
        try {
            const id = await ensurePlaylist(d, o.playlist);
            const r = await (0, common_1.timedFetch)(f, `${ep.api}/playlistItems?part=snippet`, {
                method: 'POST',
                headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify({ snippet: { playlistId: id, resourceId: { kind: 'youtube#video', videoId } } }),
            });
            if (!r.ok)
                warn(`No se pudo añadir a la lista "${o.playlist}": ${await (0, common_1.apiMessage)(r)}`);
        }
        catch (e) {
            warn(`Lista de reproducción: ${e.message}`);
        }
    }
    return { videoId };
}
function nextOffset(range) {
    const m = /bytes=0-(\d+)/.exec(range ?? '');
    return m ? Number(m[1]) + 1 : 0;
}
async function listPlaylists(d) {
    const f = d.fetchFn ?? fetch;
    const ep = d.endpoints ?? exports.YT_ENDPOINTS;
    const auth = { Authorization: `Bearer ${await d.token()}` };
    const out = [];
    let page = '';
    for (let i = 0; i < 20; i++) {
        const r = await (0, common_1.timedFetch)(f, `${ep.api}/playlists?part=snippet&mine=true&maxResults=50${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: auth });
        if (!r.ok)
            throw explain(r, await (0, common_1.apiMessage)(r));
        const j = (await r.json());
        for (const it of j.items ?? [])
            out.push({ id: it.id, title: it.snippet?.title ?? '' });
        if (!j.nextPageToken)
            break;
        page = j.nextPageToken;
    }
    return out;
}
async function ensurePlaylist(d, name) {
    const found = (await listPlaylists(d)).find((p) => p.title.trim().toLowerCase() === name.trim().toLowerCase());
    if (found)
        return found.id;
    const f = d.fetchFn ?? fetch;
    const ep = d.endpoints ?? exports.YT_ENDPOINTS;
    const r = await (0, common_1.timedFetch)(f, `${ep.api}/playlists?part=snippet,status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await d.token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { title: name }, status: { privacyStatus: 'private' } }),
    });
    if (!r.ok)
        throw explain(r, await (0, common_1.apiMessage)(r));
    const j = (await r.json());
    if (!j.id)
        throw new common_1.PublishError('YouTube no devolvió la lista creada.');
    return j.id;
}
