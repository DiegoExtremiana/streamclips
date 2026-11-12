"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const helpers_1 = require("./helpers");
const store_1 = require("../electron/services/store");
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
function setup() {
    const env = (0, helpers_1.makeEnv)();
    envs.push(env);
    const out = (id, kind) => {
        const o = { id, kind, title: id, files: kind === 'long' ? { long: `/x/${id}.mp4` } : { vertical: `/x/${id}.mp4` }, durationSec: 5, createdAt: 'x' };
        env.ctx.store.data.outputs.push(o);
        return o;
    };
    return { env, g: env.ctx.groups, out };
}
(0, node_test_1.describe)('Biblioteca: carpetas', () => {
    (0, node_test_1.it)('crea, renombra, cambia de tipo y lo guarda en disco', () => {
        const { env, g } = setup();
        const a = g.create('  Pokémon ', 'theme', 'clips');
        strict_1.default.equal(a.name, 'Pokémon');
        g.update(a.id, { name: 'Pokémon Rojo', kind: 'series' });
        const reloaded = new store_1.Store(env.userData, env.outputDir);
        strict_1.default.deepEqual(reloaded.data.groups.map((x) => [x.name, x.kind]), [['Pokémon Rojo', 'series']]);
    });
    (0, node_test_1.it)('valida nombre, tipo, sección y duplicados (sin distinguir mayúsculas) solo entre hermanas', () => {
        const { g } = setup();
        strict_1.default.throws(() => g.create('   ', 'theme', 'clips'), /vacío/);
        strict_1.default.throws(() => g.create('x'.repeat(61), 'theme', 'clips'), /60/);
        strict_1.default.throws(() => g.create('a', 'otro', 'clips'), /tema/);
        strict_1.default.throws(() => g.create('a', 'theme', 'nada'), /Sección/);
        const a = g.create('Just Chatting', 'theme', 'clips');
        strict_1.default.throws(() => g.create('just chatting', 'theme', 'clips'), /Ya hay una carpeta/);
        g.create('just chatting', 'theme', 'videos'); // otra sección: vale
        g.create('Just Chatting', 'series', 'clips', a.id); // otro nivel: vale
        const b = g.create('Otra', 'theme', 'clips');
        strict_1.default.throws(() => g.update(b.id, { name: 'JUST CHATTING' }), /Ya hay una carpeta/);
        strict_1.default.equal(g.update(a.id, { name: 'JUST CHATTING' }).name, 'JUST CHATTING'); // cambiar mayúsculas de la propia no es duplicado
    });
    (0, node_test_1.it)('anida carpetas dentro de carpetas hasta 5 niveles', () => {
        const { g } = setup();
        let parent;
        for (let i = 1; i <= 5; i++)
            parent = g.create(`n${i}`, 'theme', 'clips', parent).id;
        strict_1.default.throws(() => g.create('n6', 'theme', 'clips', parent), /5 niveles/);
        strict_1.default.throws(() => g.create('x', 'theme', 'videos', parent), /otra sección/);
        strict_1.default.throws(() => g.create('x', 'theme', 'clips', 'no-existe'), /no existe/);
    });
    (0, node_test_1.it)('mover: no admite ciclos, ni pasarse de profundidad, ni cambiar de sección', () => {
        const { g } = setup();
        const a = g.create('a', 'theme', 'clips');
        const b = g.create('b', 'theme', 'clips', a.id);
        const c = g.create('c', 'theme', 'clips', b.id);
        strict_1.default.throws(() => g.move(a.id, a.id), /sí misma/);
        strict_1.default.throws(() => g.move(a.id, c.id), /sí misma/); // dentro de un descendiente
        strict_1.default.equal(g.move(c.id, null).parentId, undefined);
        strict_1.default.equal(g.move(c.id, a.id).parentId, a.id);
        const v = g.create('v', 'theme', 'videos');
        strict_1.default.throws(() => g.move(a.id, v.id), /otra sección/);
        // cadena de 4 + mover una de 2 niveles debajo => 6
        let p;
        for (let i = 0; i < 4; i++)
            p = g.create(`d${i}`, 'theme', 'clips', p).id;
        const two = g.create('top', 'theme', 'clips');
        g.create('child', 'theme', 'clips', two.id);
        strict_1.default.throws(() => g.move(two.id, p), /5 niveles/);
    });
    (0, node_test_1.it)('mover a un sitio donde ya hay una carpeta con ese nombre falla y no cambia nada', () => {
        const { g } = setup();
        const a = g.create('a', 'theme', 'clips');
        const x1 = g.create('x', 'theme', 'clips');
        g.create('x', 'theme', 'clips', a.id);
        strict_1.default.throws(() => g.move(x1.id, a.id), /Ya hay una carpeta/);
        strict_1.default.equal(x1.parentId, undefined);
    });
    (0, node_test_1.it)('vídeos: cada tipo va a carpetas de su sección y se puede sacar de la carpeta', () => {
        const { g, out } = setup();
        out('c1', 'clip');
        const hor = out('c2', 'clip');
        const long = out('l1', 'long');
        const gc = g.create('Clips', 'theme', 'clips');
        const gv = g.create('Vídeos', 'series', 'videos');
        strict_1.default.equal(g.moveOutput('c1', gc.id).groupId, gc.id);
        strict_1.default.equal(g.moveOutput('c2', gc.id).groupId, gc.id);
        strict_1.default.throws(() => g.moveOutput('l1', gc.id), /Vídeos/);
        strict_1.default.throws(() => g.moveOutput('c1', gv.id), /Clips/);
        strict_1.default.equal(g.moveOutput('l1', gv.id).groupId, gv.id);
        strict_1.default.equal(g.moveOutput('c1', null).groupId, undefined);
        strict_1.default.throws(() => g.moveOutput('nope', null), /no existe/);
        strict_1.default.throws(() => g.moveOutput('c1', 'nope'), /no existe/);
        strict_1.default.equal(hor.groupId, gc.id);
        strict_1.default.equal(long.groupId, gv.id);
    });
    (0, node_test_1.it)('borrar una carpeta no borra nada: vídeos y subcarpetas suben un nivel', () => {
        const { g, out, env } = setup();
        const top = g.create('top', 'theme', 'clips');
        const mid = g.create('mid', 'series', 'clips', top.id);
        const leaf = g.create('leaf', 'series', 'clips', mid.id);
        out('c1', 'clip');
        g.moveOutput('c1', mid.id);
        g.delete(mid.id);
        strict_1.default.equal(env.ctx.store.data.outputs[0].groupId, top.id);
        strict_1.default.equal(leaf.parentId, top.id);
        strict_1.default.equal(env.ctx.store.data.outputs.length, 1);
        g.delete(top.id); // raíz: lo de dentro queda sin carpeta
        strict_1.default.equal(env.ctx.store.data.outputs[0].groupId, undefined);
        strict_1.default.equal(leaf.parentId, undefined);
        strict_1.default.throws(() => g.delete('nope'), /no existe/);
    });
});
