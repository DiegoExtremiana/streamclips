import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, type TestEnv } from './helpers';
import { Store } from '../electron/services/store';
import type { OutputItem } from '../shared/types';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

function setup() {
  const env = makeEnv();
  envs.push(env);
  const out = (id: string, kind: OutputItem['kind']): OutputItem => {
    const o: OutputItem = { id, kind, title: id, files: kind === 'long' ? { long: `/x/${id}.mp4` } : { vertical: `/x/${id}.mp4` }, durationSec: 5, createdAt: 'x' };
    env.ctx.store.data.outputs.push(o);
    return o;
  };
  return { env, g: env.ctx.groups, out };
}

describe('Biblioteca: carpetas', () => {
  it('crea, renombra, cambia de tipo y lo guarda en disco', () => {
    const { env, g } = setup();
    const a = g.create('  Pokémon ', 'theme', 'clips');
    assert.equal(a.name, 'Pokémon');
    g.update(a.id, { name: 'Pokémon Rojo', kind: 'series' });
    const reloaded = new Store(env.userData, env.outputDir);
    assert.deepEqual(reloaded.data.groups.map((x) => [x.name, x.kind]), [['Pokémon Rojo', 'series']]);
  });

  it('valida nombre, tipo, sección y duplicados (sin distinguir mayúsculas) solo entre hermanas', () => {
    const { g } = setup();
    assert.throws(() => g.create('   ', 'theme', 'clips'), /vacío/);
    assert.throws(() => g.create('x'.repeat(61), 'theme', 'clips'), /60/);
    assert.throws(() => g.create('a', 'otro' as never, 'clips'), /tema/);
    assert.throws(() => g.create('a', 'theme', 'nada' as never), /Sección/);
    const a = g.create('Just Chatting', 'theme', 'clips');
    assert.throws(() => g.create('just chatting', 'theme', 'clips'), /Ya hay una carpeta/);
    g.create('just chatting', 'theme', 'videos'); // otra sección: vale
    g.create('Just Chatting', 'series', 'clips', a.id); // otro nivel: vale
    const b = g.create('Otra', 'theme', 'clips');
    assert.throws(() => g.update(b.id, { name: 'JUST CHATTING' }), /Ya hay una carpeta/);
    assert.equal(g.update(a.id, { name: 'JUST CHATTING' }).name, 'JUST CHATTING'); // cambiar mayúsculas de la propia no es duplicado
  });

  it('anida carpetas dentro de carpetas hasta 5 niveles', () => {
    const { g } = setup();
    let parent: string | undefined;
    for (let i = 1; i <= 5; i++) parent = g.create(`n${i}`, 'theme', 'clips', parent).id;
    assert.throws(() => g.create('n6', 'theme', 'clips', parent), /5 niveles/);
    assert.throws(() => g.create('x', 'theme', 'videos', parent), /otra sección/);
    assert.throws(() => g.create('x', 'theme', 'clips', 'no-existe'), /no existe/);
  });

  it('mover: no admite ciclos, ni pasarse de profundidad, ni cambiar de sección', () => {
    const { g } = setup();
    const a = g.create('a', 'theme', 'clips');
    const b = g.create('b', 'theme', 'clips', a.id);
    const c = g.create('c', 'theme', 'clips', b.id);
    assert.throws(() => g.move(a.id, a.id), /sí misma/);
    assert.throws(() => g.move(a.id, c.id), /sí misma/); // dentro de un descendiente
    assert.equal(g.move(c.id, null).parentId, undefined);
    assert.equal(g.move(c.id, a.id).parentId, a.id);
    const v = g.create('v', 'theme', 'videos');
    assert.throws(() => g.move(a.id, v.id), /otra sección/);
    // cadena de 4 + mover una de 2 niveles debajo => 6
    let p: string | undefined;
    for (let i = 0; i < 4; i++) p = g.create(`d${i}`, 'theme', 'clips', p).id;
    const two = g.create('top', 'theme', 'clips');
    g.create('child', 'theme', 'clips', two.id);
    assert.throws(() => g.move(two.id, p!), /5 niveles/);
  });

  it('mover a un sitio donde ya hay una carpeta con ese nombre falla y no cambia nada', () => {
    const { g } = setup();
    const a = g.create('a', 'theme', 'clips');
    const x1 = g.create('x', 'theme', 'clips');
    g.create('x', 'theme', 'clips', a.id);
    assert.throws(() => g.move(x1.id, a.id), /Ya hay una carpeta/);
    assert.equal(x1.parentId, undefined);
  });

  it('vídeos: cada tipo va a carpetas de su sección y se puede sacar de la carpeta', () => {
    const { g, out } = setup();
    out('c1', 'clip');
    const hor = out('c2', 'clip');
    const long = out('l1', 'long');
    const gc = g.create('Clips', 'theme', 'clips');
    const gv = g.create('Vídeos', 'series', 'videos');
    assert.equal(g.moveOutput('c1', gc.id).groupId, gc.id);
    assert.equal(g.moveOutput('c2', gc.id).groupId, gc.id);
    assert.throws(() => g.moveOutput('l1', gc.id), /Vídeos/);
    assert.throws(() => g.moveOutput('c1', gv.id), /Clips/);
    assert.equal(g.moveOutput('l1', gv.id).groupId, gv.id);
    assert.equal(g.moveOutput('c1', null).groupId, undefined);
    assert.throws(() => g.moveOutput('nope', null), /no existe/);
    assert.throws(() => g.moveOutput('c1', 'nope'), /no existe/);
    assert.equal(hor.groupId, gc.id);
    assert.equal(long.groupId, gv.id);
  });

  it('borrar una carpeta no borra nada: vídeos y subcarpetas suben un nivel', () => {
    const { g, out, env } = setup();
    const top = g.create('top', 'theme', 'clips');
    const mid = g.create('mid', 'series', 'clips', top.id);
    const leaf = g.create('leaf', 'series', 'clips', mid.id);
    out('c1', 'clip');
    g.moveOutput('c1', mid.id);
    g.delete(mid.id);
    assert.equal(env.ctx.store.data.outputs[0].groupId, top.id);
    assert.equal(leaf.parentId, top.id);
    assert.equal(env.ctx.store.data.outputs.length, 1);
    g.delete(top.id); // raíz: lo de dentro queda sin carpeta
    assert.equal(env.ctx.store.data.outputs[0].groupId, undefined);
    assert.equal(leaf.parentId, undefined);
    assert.throws(() => g.delete('nope'), /no existe/);
  });
});
