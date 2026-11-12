"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPublishers = exports.NotConnectedError = void 0;
exports.realPublishers = realPublishers;
exports.youtubePlaylists = youtubePlaylists;
const youtube_1 = require("../services/social/youtube");
const tiktok_1 = require("../services/social/tiktok");
const instagram_1 = require("../services/social/instagram");
const common_1 = require("../services/social/common");
/** La red todavía no está conectada: nada se ha enviado, así que es seguro volver a intentarlo más tarde. */
class NotConnectedError extends Error {
}
exports.NotConnectedError = NotConnectedError;
function pending(label) {
    return {
        async publish() {
            throw new NotConnectedError(`${label} aún no está conectado (pestaña Conexiones).`);
        },
    };
}
/** Sin conexiones configuradas (pruebas antiguas y arranque sin servicios). */
exports.defaultPublishers = {
    youtube: pending('YouTube'),
    tiktok: pending('TikTok'),
    instagram: pending('Instagram'),
};
/** Conectores reales: usan las claves guardadas en Conexiones y las renuevan cuando caducan. */
function realPublishers(conn, log, env = {}) {
    const warn = (m) => log.warn(m);
    const base = { fetchFn: env.fetchFn, sleep: env.sleep, warn };
    const need = async (p, label) => {
        const t = await conn.accessToken(p);
        if (!t)
            throw new NotConnectedError(`${label} aún no está conectado (pestaña Conexiones).`);
        return t;
    };
    return {
        youtube: {
            async publish(o) {
                await need('youtube', 'YouTube');
                const r = await (0, youtube_1.publishYoutube)({ ...base, token: async () => (await need('youtube', 'YouTube')).accessToken, endpoints: env.youtube, chunkSize: env.chunkSize }, o);
                log.info(`YouTube: subido ${r.videoId} ("${o.title}")`);
            },
        },
        tiktok: {
            async publish(o) {
                await need('tiktok', 'TikTok');
                const r = await (0, tiktok_1.publishTiktok)({ ...base, token: async () => (await need('tiktok', 'TikTok')).accessToken, api: env.tiktokApi, chunkSize: env.chunkSize, pollMs: env.pollMs }, o);
                log.info(`TikTok: publicado ${r.publishId} ("${o.title}")`);
            },
        },
        instagram: {
            async publish(o) {
                await need('instagram', 'Instagram');
                const r = await (0, instagram_1.publishInstagram)({
                    ...base,
                    graph: env.graph,
                    pollMs: env.pollMs,
                    token: async () => {
                        const t = await need('instagram', 'Instagram');
                        return { accessToken: t.accessToken, igUserId: t.extra?.igUserId ?? '' };
                    },
                }, o);
                log.info(`Instagram: publicado ${r.mediaId} ("${o.title}")`);
            },
        },
    };
}
async function youtubePlaylists(conn, env = {}) {
    const t = await conn.accessToken('youtube');
    if (!t)
        throw new common_1.PublishError('Conecta YouTube en la pestaña Conexiones.');
    return (0, youtube_1.listPlaylists)({ fetchFn: env.fetchFn, token: async () => (await conn.accessToken('youtube'))?.accessToken ?? t.accessToken, endpoints: env.youtube });
}
