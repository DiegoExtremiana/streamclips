"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IG_GRAPH = void 0;
exports.instagramFile = instagramFile;
exports.publishInstagram = publishInstagram;
const node_fs_1 = __importDefault(require("node:fs"));
const common_1 = require("./common");
exports.IG_GRAPH = 'https://graph.facebook.com/v21.0';
const POLL_MS = 5000;
const POLL_MAX = 120; // 10 minutos
function instagramFile(o) {
    if (o.kind === 'long')
        throw new common_1.PublishError('Instagram solo admite clips (Reels). Este vídeo largo no se puede publicar ahí.');
    const f = o.files.vertical;
    if (!f)
        throw new common_1.PublishError('Instagram necesita la versión vertical del clip.');
    return f;
}
async function graphJson(r) {
    const j = (await r.json().catch(() => ({})));
    if (!r.ok || j.error) {
        const e = j.error;
        if (r.status === 401 || e?.code === 190)
            throw new common_1.PublishError('Instagram rechazó la conexión. Vuelve a conectar la cuenta en Conexiones.');
        throw new common_1.PublishError(`Instagram: ${e?.message ?? `HTTP ${r.status}`}`);
    }
    return j;
}
async function publishInstagram(d, o) {
    const f = d.fetchFn ?? fetch;
    const sleep = d.sleep ?? common_1.defaultSleep;
    const graph = d.graph ?? exports.IG_GRAPH;
    const file = instagramFile(o);
    if (!node_fs_1.default.existsSync(file))
        throw new common_1.PublishError('El archivo del vídeo ya no está en su sitio.');
    const size = node_fs_1.default.statSync(file).size;
    if (!size)
        throw new common_1.PublishError('El archivo del vídeo está vacío.');
    const { accessToken, igUserId } = await d.token();
    if (!igUserId)
        throw new common_1.PublishError('No hay una cuenta de Instagram profesional enlazada. Vuelve a conectar la cuenta en Conexiones.');
    // 1) contenedor del Reel con subida directa (no hace falta alojar el vídeo en una URL pública)
    const create = await graphJson(await (0, common_1.timedFetch)(f, `${graph}/${encodeURIComponent(igUserId)}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: o.title.slice(0, 2200), share_to_feed: 'true', access_token: accessToken }),
    }));
    if (!create.id)
        throw new common_1.PublishError('Instagram no creó el contenedor del vídeo.');
    const uploadUri = create.uri ?? `https://rupload.facebook.com/ig-api-upload/v21.0/${create.id}`;
    // 2) subir el archivo (en flujo: no se carga entero en memoria)
    const up = await (0, common_1.timedFetch)(f, uploadUri, {
        method: 'POST',
        headers: { Authorization: `OAuth ${accessToken}`, offset: '0', file_size: String(size) },
        body: node_fs_1.default.createReadStream(file),
        // @ts-expect-error opción de Node necesaria para enviar un flujo
        duplex: 'half',
    }, 30 * 60_000);
    await graphJson(up);
    // 3) esperar a que Instagram lo procese
    let status = '';
    for (let i = 0; i < POLL_MAX; i++) {
        const s = await graphJson(await (0, common_1.timedFetch)(f, `${graph}/${create.id}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`, {}));
        status = s.status_code ?? '';
        if (status === 'FINISHED')
            break;
        if (status === 'ERROR' || status === 'EXPIRED')
            throw new common_1.PublishError(`Instagram no pudo procesar el vídeo (${s.status ?? status}).`);
        await sleep(d.pollMs ?? POLL_MS);
    }
    if (status !== 'FINISHED')
        throw new common_1.PublishError('Instagram sigue procesando el vídeo. Comprueba en la app antes de reprogramarlo.');
    // 4) publicar
    const pub = await graphJson(await (0, common_1.timedFetch)(f, `${graph}/${encodeURIComponent(igUserId)}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: create.id, access_token: accessToken }),
    }));
    if (!pub.id)
        throw new common_1.PublishError('Instagram no confirmó la publicación.');
    return { mediaId: pub.id };
}
