"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const twitchClips_1 = require("../shared/twitchClips");
const clip = (id, title, createdAt) => ({ id, title, url: `https://clips.twitch.tv/${id}`, durationSec: 10, createdAt, creator: 'x', views: 0, thumbnail: '' });
const vod = (id, twitchId, status = 'downloaded', origin = 'clip') => ({ id, url: 'u', title: 't', status, progress: 100, createdAt: '2026-10-01T00:00:00Z', twitchId, origin });
const out = (id, vodId) => ({ id, vodId, kind: 'clip', title: 'c', files: {}, durationSec: 1, createdAt: '2026-10-01T00:00:00Z' });
(0, node_test_1.describe)('clips de Twitch en la interfaz', () => {
    (0, node_test_1.it)('se ordenan del más reciente al más antiguo', () => {
        const l = (0, twitchClips_1.filterClips)([clip('a', 'A', '2026-10-01T00:00:00Z'), clip('b', 'B', '2026-10-03T00:00:00Z'), clip('c', 'C', '2026-10-02T00:00:00Z')], '');
        strict_1.default.deepEqual(l.map((c) => c.id), ['b', 'c', 'a']);
    });
    (0, node_test_1.it)('la búsqueda es por nombre, sin mayúsculas ni tildes, y no altera la lista original', () => {
        const src = [clip('a', 'Pentakill increíble', '2026-10-01T00:00:00Z'), clip('b', 'Fallo ÉPICO', '2026-10-02T00:00:00Z')];
        strict_1.default.deepEqual((0, twitchClips_1.filterClips)(src, ' epico ').map((c) => c.id), ['b']);
        strict_1.default.deepEqual((0, twitchClips_1.filterClips)(src, 'INCREIBLE').map((c) => c.id), ['a']);
        strict_1.default.deepEqual((0, twitchClips_1.filterClips)(src, 'zzz'), []);
        strict_1.default.equal(src[0].id, 'a');
    });
    (0, node_test_1.it)('estado en la Biblioteca: fuera, preparándose o dentro, según lo que hay ahora', () => {
        strict_1.default.equal((0, twitchClips_1.clipLibraryState)('x', [], []), 'none');
        strict_1.default.equal((0, twitchClips_1.clipLibraryState)('x', [vod('v1', 'x', 'downloading')], []), 'preparing');
        strict_1.default.equal((0, twitchClips_1.clipLibraryState)('x', [vod('v1', 'x')], []), 'preparing');
        strict_1.default.equal((0, twitchClips_1.clipLibraryState)('x', [vod('v1', 'x')], [out('o1', 'v1')]), 'library');
        // si se borra de la Biblioteca (y su descarga), vuelve a poder añadirse
        strict_1.default.equal((0, twitchClips_1.clipLibraryState)('x', [], [out('o1', 'v1')]), 'none');
    });
    (0, node_test_1.it)('una descarga fallida o un VOD con el mismo id que no es un clip no cuentan', () => {
        strict_1.default.equal((0, twitchClips_1.clipLibraryState)('x', [vod('v1', 'x', 'error')], []), 'none');
        strict_1.default.equal((0, twitchClips_1.clipLibraryState)('x', [vod('v1', 'x', 'downloaded', 'live')], [out('o1', 'v1')]), 'none');
    });
});
