import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { OutputItem, Platform } from '../shared/types';
import { NotConnectedError, type Publishers } from '../electron/domain/publishers';
import { addOutput, makeEnv, sleep, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

function setup(tiktokWorks: boolean) {
  const sent: Platform[] = [];
  const publishers: Publishers = {
    youtube: { publish: async () => void sent.push('youtube') },
    tiktok: { publish: async () => { if (!tiktokWorks) throw new NotConnectedError('TikTok aún no está conectado'); sent.push('tiktok'); } },
    instagram: { publish: async () => void sent.push('instagram') },
  };
  const e = makeEnv({ publishers });
  envs.push(e);
  const o: OutputItem = addOutput(e);
  const file = o.files.vertical!;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'video');
  const thumb = path.join(e.outputDir, 'thumb.jpg');
  fs.writeFileSync(thumb, 'jpg');
  o.thumbnail = thumb;
  return { e, o, file, thumb, sent };
}

const due = () => new Date(Date.now() + 100).toISOString();

describe('borrar lo publicado', () => {
  it('cuando se publica en todas sus redes se borran los archivos y el vídeo, y queda el registro de lo publicado', async () => {
    const { e, o, file, thumb } = setup(true);
    e.ctx.pubs.schedule(o.id, ['youtube', 'tiktok'], due());
    await sleep(200);
    await e.ctx.scheduler.tick();
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(thumb), false);
    assert.equal(e.ctx.store.data.outputs.find((x) => x.id === o.id), undefined);
    const pubs = e.ctx.store.data.publications.filter((p) => p.outputId === o.id);
    assert.equal(pubs.length, 2);
    assert.ok(pubs.every((p) => p.status === 'published'), 'el registro de lo publicado se conserva');
  });

  it('si queda alguna red pendiente (aquí TikTok sin conexión) no se borra nada todavía', async () => {
    const { e, o, file } = setup(false);
    e.ctx.pubs.schedule(o.id, ['youtube', 'tiktok'], due());
    await sleep(200);
    await e.ctx.scheduler.tick();
    assert.ok(fs.existsSync(file));
    assert.ok(e.ctx.store.data.outputs.some((x) => x.id === o.id));
  });

  it('con la opción desactivada se queda todo', async () => {
    const { e, o, file } = setup(true);
    e.ctx.settings.set({ autopilot: { purgePublished: false } });
    e.ctx.pubs.schedule(o.id, ['youtube'], due());
    await sleep(200);
    await e.ctx.scheduler.tick();
    assert.ok(fs.existsSync(file));
    assert.ok(e.ctx.store.data.outputs.some((x) => x.id === o.id));
  });
});
