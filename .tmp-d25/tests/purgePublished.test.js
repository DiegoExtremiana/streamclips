"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const publishers_1 = require("../electron/domain/publishers");
const helpers_1 = require("./helpers");
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
function setup(tiktokWorks) {
    const sent = [];
    const publishers = {
        youtube: { publish: async () => void sent.push('youtube') },
        tiktok: { publish: async () => { if (!tiktokWorks)
                throw new publishers_1.NotConnectedError('TikTok aún no está conectado'); sent.push('tiktok'); } },
        instagram: { publish: async () => void sent.push('instagram') },
    };
    const e = (0, helpers_1.makeEnv)({ publishers });
    envs.push(e);
    const o = (0, helpers_1.addOutput)(e);
    const file = o.files.vertical;
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    node_fs_1.default.writeFileSync(file, 'video');
    const thumb = node_path_1.default.join(e.outputDir, 'thumb.jpg');
    node_fs_1.default.writeFileSync(thumb, 'jpg');
    o.thumbnail = thumb;
    return { e, o, file, thumb, sent };
}
const due = () => new Date(Date.now() + 100).toISOString();
(0, node_test_1.describe)('borrar lo publicado', () => {
    (0, node_test_1.it)('cuando se publica en todas sus redes se borran los archivos y el vídeo, y queda el registro de lo publicado', async () => {
        const { e, o, file, thumb } = setup(true);
        e.ctx.pubs.schedule(o.id, ['youtube', 'tiktok'], due());
        await (0, helpers_1.sleep)(200);
        await e.ctx.scheduler.tick();
        strict_1.default.equal(node_fs_1.default.existsSync(file), false);
        strict_1.default.equal(node_fs_1.default.existsSync(thumb), false);
        strict_1.default.equal(e.ctx.store.data.outputs.find((x) => x.id === o.id), undefined);
        const pubs = e.ctx.store.data.publications.filter((p) => p.outputId === o.id);
        strict_1.default.equal(pubs.length, 2);
        strict_1.default.ok(pubs.every((p) => p.status === 'published'), 'el registro de lo publicado se conserva');
    });
    (0, node_test_1.it)('si queda alguna red pendiente (aquí TikTok sin conexión) no se borra nada todavía', async () => {
        const { e, o, file } = setup(false);
        e.ctx.pubs.schedule(o.id, ['youtube', 'tiktok'], due());
        await (0, helpers_1.sleep)(200);
        await e.ctx.scheduler.tick();
        strict_1.default.ok(node_fs_1.default.existsSync(file));
        strict_1.default.ok(e.ctx.store.data.outputs.some((x) => x.id === o.id));
    });
    (0, node_test_1.it)('con la opción desactivada se queda todo', async () => {
        const { e, o, file } = setup(true);
        e.ctx.settings.set({ autopilot: { purgePublished: false } });
        e.ctx.pubs.schedule(o.id, ['youtube'], due());
        await (0, helpers_1.sleep)(200);
        await e.ctx.scheduler.tick();
        strict_1.default.ok(node_fs_1.default.existsSync(file));
        strict_1.default.ok(e.ctx.store.data.outputs.some((x) => x.id === o.id));
    });
});
