import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoverService } from '../electron/domain/covers';
import { CoverDesignService } from '../electron/domain/coverDesigns';
import { emptyDesign, newRectLayer, newTextLayer } from '../shared/coverDesign';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32, 1)]);
const tools = () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' }) as never;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-designs-'));
  const covers = new CoverService({ dir, tools });
  return { dir, covers, designs: new CoverDesignService(dir, covers) };
}

describe('diseños de portada guardados', () => {
  it('guarda el diseño y su imagen; guardar otra vez sustituye la imagen anterior', () => {
    const { covers, designs } = setup();
    const d = { ...emptyDesign(), layers: [newTextLayer('HOLA'), newRectLayer()] };
    const a = designs.save({ name: 'Mi portada', design: d, png: PNG });
    assert.equal(designs.list().length, 1);
    assert.equal(covers.list().length, 1);
    assert.equal(covers.list()[0].kind, 'portada');
    const b = designs.save({ id: a.id, name: 'Mi portada', design: d, png: PNG });
    assert.equal(b.id, a.id);
    assert.equal(designs.list().length, 1, 'no se duplica');
    assert.equal(covers.list().length, 1, 'la imagen vieja se sustituye');
    assert.notEqual(b.assetId, a.assetId);
  });
  it('rechaza lo que no es un PNG y un diseño que no existe', () => {
    const { designs } = setup();
    assert.throws(() => designs.save({ name: 'x', design: emptyDesign(), png: Buffer.from('no es png') }), /PNG/);
    assert.throws(() => designs.save({ id: 'aaaaaaaaaaaa', name: 'x', design: emptyDesign(), png: PNG }), /no existe/);
  });
  it('un diseño guardado se recupera limpio tras reabrir', () => {
    const { dir, covers, designs } = setup();
    designs.save({ name: 'Otra', design: { background: 'malo', layers: [{ type: 'text', text: 'Hi', size: 99999 }, { type: 'ovni' }] }, png: PNG });
    const again = new CoverDesignService(dir, covers).list();
    assert.equal(again.length, 1);
    assert.equal(again[0].design.layers.length, 1);
    const t = again[0].design.layers[0];
    assert.equal(t.type === 'text' && t.size, 600);
  });
  it('borrar un diseño borra también su imagen', () => {
    const { covers, designs } = setup();
    const a = designs.save({ name: 'Adiós', design: emptyDesign(), png: PNG });
    designs.remove(a.id, true);
    assert.equal(designs.list().length, 0);
    assert.equal(covers.list().length, 0);
  });
  it('tipografías propias: se añaden, se leen y se borran; solo TTF/OTF/WOFF', () => {
    const { designs } = setup();
    assert.throws(() => designs.fontAdd('virus.exe', Buffer.from('x')), /TTF, OTF/);
    const f = designs.fontAdd('Mi_Fuente-Bold.ttf', Buffer.from('datos'));
    assert.equal(f.name, 'Mi Fuente-Bold');
    assert.equal(Buffer.from(designs.fontData(f.id), 'base64').toString(), 'datos');
    const g = designs.fontAdd('Mi_Fuente-Bold.otf', Buffer.from('otros'));
    assert.notEqual(g.name, f.name, 'el nombre no se repite');
    designs.fontRemove(f.id);
    assert.equal(designs.fontList().length, 1);
  });
});
