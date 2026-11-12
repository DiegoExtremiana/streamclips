import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cleanAssetName, cleanPhrase, guessKind, uniqueName, extOf } from '../shared/covers';
import { CoverService } from '../electron/domain/covers';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-covers-'));
  dirs.push(d);
  return d;
};
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const png = (dir: string, name: string, color: string, size = '320x180') => {
  const f = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', f]);
  return fs.readFileSync(f);
};
const svc = (dir: string) => new CoverService({ dir: path.join(dir, 'covers'), tools: () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' }) });

describe('piezas de portada (reglas)', () => {
  it('los nombres salen limpios, sin extensión y únicos', () => {
    assert.equal(cleanAssetName('Diego Sorprendido.png'), 'Diego_Sorprendido');
    assert.equal(cleanAssetName('  ../../x:y*z?.jpg '), 'xyz');
    assert.equal(cleanAssetName('!!!'), 'Sin_nombre');
    assert.equal(cleanAssetName('a'.repeat(80)).length, 40);
    assert.equal(uniqueName('Fondo', ['fondo']), 'Fondo_2');
    assert.equal(uniqueName('Fondo', ['fondo', 'Fondo_2']), 'Fondo_3');
    assert.equal(uniqueName('Otro', ['fondo']), 'Otro');
  });
  it('el tipo se supone por la extensión y el nombre', () => {
    assert.equal(guessKind('guion.pdf'), 'documento');
    assert.equal(guessKind('Fondo_Ciudad.png'), 'fondo');
    assert.equal(guessKind('foto_playa.jpg'), 'foto');
    assert.equal(guessKind('Diego_Sorprendido.png'), 'imagen');
    assert.equal(extOf('A.PNG'), '.png');
  });
  it('la frase queda en mayúsculas, corta y sin signos raros', () => {
    assert.equal(cleanPhrase('no lo esperaba'), 'NO LO ESPERABA');
    assert.equal(cleanPhrase('uno dos tres cuatro cinco'), 'UNO DOS TRES CUATRO');
    assert.ok(cleanPhrase('palabralarguisima otra palabralarguisima').length <= 28);
    assert.equal(cleanPhrase('<b>hola</b>'), 'B HOLA B');
  });
});

describe('biblioteca de portadas', () => {
  it('añade, renombra, cambia el tipo, recuerda en disco y borra', () => {
    const d = tmp();
    const s = svc(d);
    const a = s.add('Diego Sorprendido.png', Buffer.from('x'));
    const b = s.add('Diego Sorprendido.png', Buffer.from('y'));
    const doc = s.add('guion.pdf', Buffer.from('%PDF'));
    assert.deepEqual([a.name, b.name], ['Diego_Sorprendido', 'Diego_Sorprendido_2']);
    assert.equal(doc.kind, 'documento');
    assert.equal(s.rename(a.id, 'Fondo Ciudad').name, 'Fondo_Ciudad');
    assert.equal(s.rename(b.id, 'fondo ciudad').name, 'fondo_ciudad_2');
    assert.equal(s.setKind(a.id, 'fondo').kind, 'fondo');
    assert.throws(() => s.setKind(a.id, 'documento'), /no puede ser un documento/);
    assert.throws(() => s.setKind(doc.id, 'foto'), /no puede ser una imagen/);
    assert.throws(() => s.setKind(a.id, 'raro'), /no es válido/);
    const again = svc(d);
    assert.equal(again.list().length, 3);
    assert.equal(again.list().find((x) => x.id === a.id)!.kind, 'fondo');
    assert.ok(fs.existsSync(again.filePath(a.id)));
    again.remove(a.id);
    assert.equal(again.list().length, 2);
    assert.throws(() => again.filePath(a.id), /ya no está/);
  });

  it('rechaza lo que no es imagen ni documento, lo vacío y lo enorme', () => {
    const s = svc(tmp());
    assert.throws(() => s.add('virus.exe', Buffer.from('x')), /solo se admiten/);
    assert.throws(() => s.add('vacio.png', Buffer.alloc(0)), /vacío/);
    assert.throws(() => s.add('grande.png', Buffer.alloc(26 * 1024 * 1024)), /pesa más/);
  });

  it('una biblioteca estropeada se ignora', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, 'covers'));
    fs.writeFileSync(path.join(d, 'covers', 'index.json'), '[{"id":"../../x","name":"a","kind":"fondo"},');
    assert.equal(svc(d).list().length, 0);
  });

  it('compone una portada 1280x720 con fondo, pieza principal y frase, y la guarda como portada', { skip: !hasFfmpeg }, async () => {
    const d = tmp();
    const s = svc(d);
    const bg = s.add('Fondo_Ciudad.png', png(d, 'bg.png', 'blue', '640x360'));
    const fg = s.add('Diego_Sorprendido.png', png(d, 'fg.png', 'red', '200x300'));
    const doc = s.add('guion.pdf', Buffer.from('%PDF'));
    const made = await s.compose({ backgroundId: bg.id, subjectId: fg.id, text: 'no lo esperaba', badge: 3 });
    assert.equal(made.kind, 'portada');
    assert.match(made.name, /^Portada_no_lo_esperaba/);
    const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', s.filePath(made.id)]).toString().trim();
    assert.equal(dims, '1280,720');
    const prev = await s.preview(made.id);
    assert.match(prev ?? '', /^data:image\/png;base64,/);
    assert.equal(await s.preview(doc.id), null);
    await assert.rejects(() => s.compose({ backgroundId: doc.id }), /imagen/);
    await assert.rejects(() => s.compose({ backgroundId: 'nope' }), /ya no está/);
    const plain = await s.compose({ backgroundId: bg.id, name: 'Solo fondo' });
    assert.equal(plain.name, 'Solo_fondo');
  });
});
