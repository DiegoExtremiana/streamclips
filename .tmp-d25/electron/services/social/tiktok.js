"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TT_API = void 0;
exports.tiktokFile = tiktokFile;
exports.publishTiktok = publishTiktok;
const node_fs_1 = __importDefault(require("node:fs"));
const common_1 = require("./common");
exports.TT_API = 'https://open.tiktokapis.com/v2';
const CHUNK = 10 * 1024 * 1024; // entre 5 y 64 MB; el último trozo absorbe el resto
const POLL_MS = 5000;
const POLL_MAX = 72; // 6 minutos
function tiktokFile(o) {
    if (o.kind === 'long')
        throw new common_1.PublishError('TikTok solo admite clips. Este vídeo largo no se puede publicar ahí.');
    const f = o.files.vertical ?? o.files.horizontal;
    if (!f)
        throw new common_1.PublishError('El clip no tiene archivo.');
    return f;
}
async function call(d, path, body) {
    const f = d.fetchFn ?? fetch;
    const r = await (0, common_1.timedFetch)(f, `${d.api ?? exports.TT_API}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await d.token()}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({})));
    if (r.status === 401 || j.error?.code === 'access_token_invalid')
        throw new common_1.PublishError('TikTok rechazó la conexión. Vuelve a conectar la cuenta en Conexiones.');
    if (!r.ok || (j.error?.code && j.error.code !== 'ok')) {
        const code = j.error?.code ?? r.status;
        if (code === 'spam_risk_too_many_posts')
            throw new common_1.PublishError('TikTok limita las publicaciones diarias de tu cuenta. Inténtalo mañana.');
        throw new common_1.PublishError(`TikTok: ${j.error?.message || code}`);
    }
    return j.data;
}
async function publishTiktok(d, o) {
    const f = d.fetchFn ?? fetch;
    const sleep = d.sleep ?? common_1.defaultSleep;
    const file = tiktokFile(o);
    if (!node_fs_1.default.existsSync(file))
        throw new common_1.PublishError('El archivo del vídeo ya no está en su sitio.');
    const size = node_fs_1.default.statSync(file).size;
    if (!size)
        throw new common_1.PublishError('El archivo del vídeo está vacío.');
    // privacidad: solo se publica abierto si lo has pedido Y la cuenta puede (apps sin auditar solo ofrecen «solo yo»)
    const info = await call(d, '/post/publish/creator_info/query/', {});
    const options = info.privacy_level_options ?? [];
    const wantPublic = o.visibility === 'public' && options.includes('PUBLIC_TO_EVERYONE');
    const privacy = wantPublic ? 'PUBLIC_TO_EVERYONE' : options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
    if (!privacy)
        throw new common_1.PublishError('TikTok no ofrece ninguna opción de privacidad para esta cuenta.');
    const chunk = Math.max(d.chunkSize ?? CHUNK, 1);
    const total = Math.max(1, Math.floor(size / chunk));
    const init = await call(d, '/post/publish/video/init/', {
        post_info: { title: o.title.slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: total === 1 ? size : chunk, total_chunk_count: total },
    });
    if (!init.publish_id || !init.upload_url)
        throw new common_1.PublishError('TikTok no devolvió la dirección de subida.');
    const step = total === 1 ? size : chunk;
    for (let i = 0; i < total; i++) {
        const start = i * step;
        const end = i === total - 1 ? size : start + step; // el último trozo lleva el resto
        const body = await (0, common_1.readChunk)(file, start, end);
        const r = await (0, common_1.timedFetch)(f, init.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length), 'Content-Range': `bytes ${start}-${end - 1}/${size}` }, body: new Uint8Array(body) }, 10 * 60_000);
        if (r.status !== 206 && r.status !== 201 && r.status !== 200)
            throw new common_1.PublishError(`TikTok rechazó un trozo del vídeo: ${await (0, common_1.apiMessage)(r)}`);
    }
    for (let i = 0; i < POLL_MAX; i++) {
        const st = await call(d, '/post/publish/status/fetch/', { publish_id: init.publish_id });
        if (st.status === 'PUBLISH_COMPLETE')
            return { publishId: init.publish_id };
        if (st.status === 'FAILED')
            throw new common_1.PublishError(`TikTok no pudo publicar el vídeo (${st.fail_reason ?? 'motivo desconocido'}).`);
        await sleep(d.pollMs ?? POLL_MS);
    }
    // se subió pero TikTok no ha terminado de procesarlo: no se reintenta (podría duplicarse)
    throw new common_1.PublishError('TikTok sigue procesando el vídeo. Comprueba en la app de TikTok antes de reprogramarlo.');
}
