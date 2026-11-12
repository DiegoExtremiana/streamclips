"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const helpers_1 = require("./helpers");
const types_1 = require("../shared/types");
const schedulePlan_1 = require("../shared/schedulePlan");
(0, node_test_1.describe)('vídeos solo a YouTube, clips a todas las redes', () => {
    const setup = () => {
        const e = (0, helpers_1.makeEnv)();
        (0, helpers_1.addOutput)(e, 'clip1');
        const v = (0, helpers_1.addOutput)(e, 'vid1');
        v.kind = 'long';
        v.files = { long: v.files.vertical };
        return e;
    };
    const when = () => new Date(Date.now() + 3600_000).toISOString();
    (0, node_test_1.it)('platformsFor', () => {
        strict_1.default.deepEqual([...(0, types_1.platformsFor)('long')], ['youtube']);
        strict_1.default.deepEqual([...(0, types_1.platformsFor)('clip')], ['youtube', 'tiktok', 'instagram']);
    });
    (0, node_test_1.it)('un clip se programa en las tres redes', () => {
        const e = setup();
        strict_1.default.equal(e.ctx.pubs.schedule('clip1', ['youtube', 'tiktok', 'instagram'], when()).scheduled.length, 3);
        e.cleanup();
    });
    (0, node_test_1.it)('un vídeo solo admite YouTube: el resto de redes se omite con motivo', () => {
        const e = setup();
        const r = e.ctx.pubs.schedule('vid1', ['youtube', 'tiktok', 'instagram'], when());
        strict_1.default.deepEqual(r.scheduled.map((p) => p.platform), ['youtube']);
        strict_1.default.deepEqual(r.skipped.map((s) => s.platform).sort(), ['instagram', 'tiktok']);
        strict_1.default.match(r.skipped[0].reason, /solo se publican en YouTube/);
        strict_1.default.equal(e.ctx.store.data.publications.length, 1);
        e.cleanup();
    });
    (0, node_test_1.it)('un vídeo solo en TikTok se rechaza sin crear nada', () => {
        const e = setup();
        strict_1.default.throws(() => e.ctx.pubs.schedule('vid1', ['tiktok'], when()), /solo se publican en YouTube/);
        strict_1.default.equal(e.ctx.store.data.publications.length, 0);
        e.cleanup();
    });
    (0, node_test_1.it)('setSchedule rechaza redes no permitidas para un vídeo y no cambia nada', () => {
        const e = setup();
        e.ctx.pubs.schedule('vid1', ['youtube'], when());
        strict_1.default.throws(() => e.ctx.pubs.setSchedule('vid1', [{ platform: 'youtube', atIso: when() }, { platform: 'instagram', atIso: when() }]), /solo se publican en YouTube/);
        strict_1.default.equal(e.ctx.store.data.publications.length, 1);
        strict_1.default.doesNotThrow(() => e.ctx.pubs.setSchedule('clip1', [{ platform: 'instagram', atIso: when() }]));
        e.cleanup();
    });
    (0, node_test_1.it)('los bloques de la línea de tiempo indican si son vídeo o clip', () => {
        const e = setup();
        e.ctx.pubs.schedule('vid1', ['youtube'], when());
        e.ctx.pubs.schedule('clip1', ['tiktok'], when());
        const b = (0, schedulePlan_1.groupBlocks)(e.ctx.store.data.publications, e.ctx.store.data.outputs);
        strict_1.default.deepEqual(b.map((x) => x.kind).sort(), ['clip', 'long']);
        e.cleanup();
    });
});
