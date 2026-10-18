import { describe, it, afterEach, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { nextFreeSlot, nextSlot } from '../shared/slots';
import type { OutputItem } from '../shared/types';
import { addDownloadedVod, makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

describe('horas de publicación', () => {
  const at = (s: string) => new Date(s);
  it('la siguiente hora local, estrictamente posterior; si ya pasó hoy, mañana', () => {
    const a = nextSlot(at('2026-10-15T05:00:00'), '07:00');
    assert.equal(a.getHours(), 7);
    assert.equal(a.getDate(), 15);
    assert.equal(nextSlot(at('2026-10-15T07:00:00'), '07:00').getDate(), 16);
    assert.equal(nextSlot(at('2026-10-15T23:59:00'), '16:00').getDate(), 16);
  });
  it('salta las horas ocupadas', () => {
    const taken = new Set([nextSlot(at('2026-10-15T05:00:00'), '07:00').getTime()]);
    const b = nextSlot(at('2026-10-15T05:00:00'), '07:00', taken);
    assert.equal(b.getDate(), 16);
    assert.equal(b.getHours(), 7);
  });
  it('nextFreeSlot elige el primer hueco libre entre varias horas y pasa al día siguiente cuando se acaban', () => {
    const times = ['08:00', '12:00', '16:00', '21:30'];
    const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0, 0);
    assert.deepEqual(nextFreeSlot(at(16, 7), times), at(16, 8));
    assert.deepEqual(nextFreeSlot(at(16, 9), times), at(16, 12));
    assert.deepEqual(nextFreeSlot(at(16, 22), times), at(17, 8));
    const taken = new Set([at(16, 8).getTime(), at(16, 12).getTime(), at(16, 16).getTime(), at(16, 21, 30).getTime(), at(17, 8).getTime()]);
    assert.deepEqual(nextFreeSlot(at(16, 7), times, taken), at(17, 12));
    assert.throws(() => nextFreeSlot(at(16, 7), []), /No hay horas/);
  });

  it('aguanta el cambio de hora de octubre/marzo', () => {
    for (const d of ['2026-10-24T20:00:00', '2027-03-27T20:00:00']) {
      const a = nextSlot(at(d), '07:00');
      assert.equal(a.getHours(), 7);
      assert.equal(a.getMinutes(), 0);
    }
  });
});

/** Directo de 4 min con dos "momentos" (ruido fuerte) hacia el segundo 60 y el 170. */
let root: string;
let video: string;
before(() => {
  root = tmpDir();
  video = path.join(root, 'live.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=240',
    '-f', 'lavfi', '-i', "aevalsrc='(0.02+0.9*(between(t,55,70)+between(t,165,180)))*sin(2*PI*300*t)':d=240:s=16000",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
});
after(() => rmDir(root));

function setup(extra: Parameters<typeof makeEnv>[0] = {}) {
  const e = makeEnv(extra);
  envs.push(e);
  const vod = addDownloadedVod(e, video);
  e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, requireApproval: true, platforms: ['youtube'] } });
  return { e, vod };
}

function llmServer(reply: () => { status: number; body: unknown }) {
  const calls: Record<string, unknown>[] = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls.push(JSON.parse(raw));
      const r = reply();
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
    });
  });
  return new Promise<{ url: string; calls: Record<string, unknown>[]; close: () => void }>((ok) =>
    srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls, close: () => srv.close() })),
  );
}

describe('piloto automático', () => {
  it('analiza, monta resumen + principal + clips y los deja pendientes de tu visto bueno', async () => {
    const { e, vod } = setup();
    const t0 = Date.now();
    await e.ctx.autopilot.run(vod.id);
    const outs = e.ctx.store.data.outputs;
    const roles = outs.map((o) => o.auto?.role).sort();
    assert.deepEqual(roles, ['clip', 'clip', 'main', 'summary'], JSON.stringify(outs.map((o) => [o.title, o.auto])));
    assert.ok(outs.every((o) => o.auto!.review === 'pending'));
    assert.equal(e.ctx.store.data.publications.length, 0, 'nada se programa sin visto bueno');
    for (const o of outs) assert.ok(Object.values(o.files).every((f) => fs.existsSync(f!)));
    const clips = outs.filter((o) => o.kind === 'clip');
    assert.ok(clips.every((c) => c.files.vertical && c.files.horizontal));
    // los clips caen sobre los momentos fuertes
    const starts = clips.map((c) => c.start!).sort((a, b) => a - b);
    assert.ok(starts[0] < 70 && clips.some((c) => c.start! < 70 && c.end! > 55), JSON.stringify(starts));
    assert.ok(clips.some((c) => c.start! < 180 && c.end! > 165));
    assert.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
    assert.ok(e.notifier.tasks.some((t) => t.kind === 'analyze' && t.status === 'done'));
    console.log(`      (piloto completo en ${Math.round((Date.now() - t0) / 1000)} s)`);
  });

  it('al dar el visto bueno rellena los huecos: vídeos en las horas de vídeos, clips en las de clips, uno por hueco', async () => {
    const { e, vod } = setup();
    await e.ctx.autopilot.run(vod.id);
    mock.timers.enable({ apis: ['Date'], now: new Date(2030, 9, 16, 7, 0, 0).getTime() });
    try {
      const order = { summary: 0, main: 1, clip: 2 } as const;
      for (const o of [...e.ctx.store.data.outputs].sort((a, b) => order[a.auto!.role] - order[b.auto!.role])) e.ctx.autopilot.approve(o.id);
    } finally {
      mock.timers.reset();
    }
    const pubs = e.ctx.store.data.publications;
    const by = (role: string) => e.ctx.store.data.outputs.filter((o) => o.auto?.role === role).map((o) => new Date(pubs.find((p) => p.outputId === o.id)!.scheduledAt));
    const [sum] = by('summary');
    const [main] = by('main');
    assert.deepEqual([sum.getDate(), sum.getHours(), sum.getMinutes()], [16, 8, 0]);
    assert.deepEqual([main.getDate(), main.getHours(), main.getMinutes()], [16, 12, 0]);
    const clips = by('clip').sort((a, b) => a.getTime() - b.getTime());
    assert.deepEqual(clips.map((d) => [d.getDate(), d.getHours()]), [[16, 10], [16, 14]]);
    assert.ok(e.ctx.store.data.outputs.every((o) => o.auto!.review === 'approved'));
    // aprobar dos veces no duplica
    e.ctx.autopilot.approve(e.ctx.store.data.outputs[0].id);
    assert.equal(e.ctx.store.data.publications.length, 4);
  });

  it('los huecos ocupados se saltan y al acabarse el día sigue con el siguiente', async () => {
    const { e, vod } = setup();
    await e.ctx.autopilot.run(vod.id);
    const others = e.ctx.store.data.outputs.filter((o) => o.auto?.role !== 'summary');
    const sum = e.ctx.store.data.outputs.find((o) => o.auto?.role === 'summary')!;
    mock.timers.enable({ apis: ['Date'], now: new Date(2030, 9, 16, 7, 0, 0).getTime() });
    try {
      // hoy ya hay algo en las 08:00, 12:00 y 16:00
      [8, 12, 16].forEach((h, i) => e.ctx.pubs.schedule(others[i].id, ['youtube'], new Date(2030, 9, 16, h, 0, 0).toISOString()));
      e.ctx.autopilot.approve(sum.id);
      const at = new Date(e.ctx.store.data.publications.find((p) => p.outputId === sum.id)!.scheduledAt);
      assert.deepEqual([at.getDate(), at.getHours(), at.getMinutes()], [16, 21, 30]);
    } finally {
      mock.timers.reset();
    }
  });

  it('sin aprobación previa lo programa todo directamente', async () => {
    const { e, vod } = setup();
    e.ctx.settings.set({ autopilot: { requireApproval: false } });
    await e.ctx.autopilot.run(vod.id);
    assert.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /4 programados/);
    assert.equal(e.ctx.store.data.publications.length, e.ctx.store.data.outputs.length);
    assert.ok(e.ctx.store.data.outputs.every((o) => o.auto!.review === 'approved'));
  });

  it('rechazar borra archivos, miniatura y publicaciones pendientes', async () => {
    const { e, vod } = setup();
    e.ctx.settings.set({ autopilot: { maxClips: 1 } });
    await e.ctx.autopilot.run(vod.id);
    const clip = e.ctx.store.data.outputs.find((o) => o.kind === 'clip')!;
    e.ctx.autopilot.approve(clip.id);
    const files = [...Object.values(clip.files), clip.thumbnail].filter(Boolean) as string[];
    assert.ok(files.length >= 2);
    e.ctx.library.remove(clip.id);
    assert.ok(files.every((f) => !fs.existsSync(f)));
    assert.ok(!e.ctx.store.data.outputs.some((o) => o.id === clip.id));
    assert.ok(!e.ctx.store.data.publications.some((p) => p.outputId === clip.id));
  });

  it('con modelo de lenguaje usa sus títulos (limpiados) y envía solo texto de la transcripción', async () => {
    const srv = await llmServer(() => ({
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ resumen: { titulo: 'Gran <b>resumen</b>', descripcion: 'Lo mejor.' }, videos: [{ id: 'video1', titulo: 'La historia', descripcion: 'Desc principal' }], clips: [{ id: 'clip1', titulo: 'Clip uno', descripcion: 'd' }, { id: 'clip2', titulo: 'Clip dos', descripcion: 'd' }] }) } }] },
    }));
    try {
      const { e, vod } = setup({ llmBaseUrl: srv.url });
      const tr = path.join(root, 'tr.json');
      fs.writeFileSync(tr, JSON.stringify({ words: [{ text: 'Hola', start: 56, end: 56.4 }, { text: 'qué', start: 57, end: 57.3 }, { text: 'locura.', start: 58, end: 58.6 }, { text: 'Increíble', start: 166, end: 166.5 }, { text: 'jugada.', start: 167, end: 167.5 }] }));
      e.ctx.transcripts.importFile(vod.id, tr);
      e.ctx.settings.set({ autopilot: { llm: { provider: 'groq', model: 'x', apiKey: 'CLAVE' } } });
      await e.ctx.autopilot.run(vod.id);
      const titles = e.ctx.store.data.outputs.map((o) => o.title).sort();
      assert.deepEqual(titles, ['Clip dos', 'Clip uno', 'Gran resumen', 'La historia']);
      assert.equal(e.ctx.store.data.outputs.find((o) => o.title === 'La historia')!.description, 'Desc principal');
      assert.equal(srv.calls.length, 1);
      assert.match(JSON.stringify(srv.calls[0]), /locura/);
      assert.ok(!JSON.stringify(srv.calls[0]).includes('CLAVE'));
    } finally {
      srv.close();
    }
  });

  it('si el modelo falla, se usan títulos propios y se avisa en la nota', async () => {
    const srv = await llmServer(() => ({ status: 500, body: {} }));
    try {
      const { e, vod } = setup({ llmBaseUrl: srv.url });
      const tr = path.join(root, 'tr2.json');
      fs.writeFileSync(tr, JSON.stringify({ words: [{ text: '¡Increíble', start: 166, end: 166.5 }, { text: 'jugada!', start: 167, end: 167.5 }] }));
      e.ctx.transcripts.importFile(vod.id, tr);
      e.ctx.settings.set({ autopilot: { llm: { provider: 'gemini', model: '', apiKey: 'k' } } });
      await e.ctx.autopilot.run(vod.id);
      assert.equal(e.ctx.store.data.outputs.length, 4);
      assert.match(e.ctx.store.data.vods[0].autopilot!.note!, /Títulos sin modelo de lenguaje/);
    } finally {
      srv.close();
    }
  });

  it('un directo plano no inventa vídeos y lo dice', async () => {
    const e = makeEnv({ energy: async () => new Array(240).fill(-30) });
    envs.push(e);
    const vod = addDownloadedVod(e, video);
    e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1 } });
    await e.ctx.autopilot.run(vod.id);
    assert.equal(e.ctx.store.data.outputs.length, 0);
    assert.equal(vod.autopilot?.status, 'skipped');
  });

  it('un fallo total deja el VOD en error con el motivo, y se puede relanzar', async () => {
    const e = makeEnv({ energy: async () => { throw new Error('boom'); } });
    envs.push(e);
    const vod = addDownloadedVod(e, video);
    e.ctx.settings.set({ autopilot: { chatCapture: false } });
    await assert.rejects(() => e.ctx.autopilot.run(vod.id), /ninguna señal/);
    assert.equal(vod.autopilot?.status, 'error');
    assert.equal(e.notifier.tasks.filter((t) => t.kind === 'analyze').pop()?.status, 'error');
  });

  it('el chat guardado de ese directo se usa como señal', async () => {
    const { e, vod } = setup({ energy: async () => new Array(240).fill(-30) });
    vod.streamStartedAt = new Date().toISOString();
    const dir = path.join(e.userData, 'chat');
    fs.mkdirSync(dir, { recursive: true });
    const bins: number[] = new Array<number>(240).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0));
    for (let i = 100; i < 115; i++) bins[i] = 15;
    fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ startedAt: vod.streamStartedAt, bins }));
    e.ctx.settings.set({ autopilot: { maxClips: 1 } });
    await e.ctx.autopilot.run(vod.id);
    const clip = e.ctx.store.data.outputs.find((o) => o.kind === 'clip')!;
    assert.ok(clip.start! < 115 && clip.end! > 100, `${clip.start}-${clip.end}`);
  });

  it('una serie configurada nombra los vídeos «Serie Día N» y el día sube solo con cada directo', async () => {
    const { e, vod } = setup();
    e.ctx.settings.set({ autopilot: { maxClips: 0, maxVideos: 1, series: { name: 'Minecraft extremo', nextDay: 3 } } });
    await e.ctx.autopilot.run(vod.id);
    const [o] = e.ctx.store.data.outputs;
    assert.equal(e.ctx.store.data.outputs.length, 1);
    assert.equal(o.title, 'Minecraft extremo Día 3 - Resumen');
    assert.equal(e.ctx.store.data.settings.autopilot.series.nextDay, 4);
    assert.match(e.ctx.store.data.vods[0].autopilot!.note!, /Serie «Minecraft extremo», día 3/);
  });

  it('si el título del directo ya dice el día, se usa ese y la cuenta configurada no se toca', async () => {
    const { e, vod } = setup();
    vod.title = 'Locke en chanclas - día 12 | directo';
    e.ctx.settings.set({ autopilot: { maxClips: 0, maxVideos: 1, series: { name: 'Otra', nextDay: 5 } } });
    await e.ctx.autopilot.run(vod.id);
    assert.equal(e.ctx.store.data.outputs[0].title, 'Locke en chanclas Día 12 - Resumen');
    assert.equal(e.ctx.store.data.settings.autopilot.series.nextDay, 5);
  });

  it('suggestTitle: título provisional según lo que se dice en el tramo; sin transcripción, nada', async () => {
    const srv = await llmServer(() => ({ status: 200, body: { choices: [{ message: { content: '{"titulo":"El susto del creeper"}' } }], candidates: [{ content: { parts: [{ text: '{"titulo":"El susto del creeper"}' }] } }] } }));
    try {
      const { e, vod } = setup({ llmBaseUrl: srv.url });
      assert.equal(await e.ctx.autopilot.suggestTitle(vod.id, 10, 40), null, 'sin transcripción no hay de qué sacarlo');
      const tr = path.join(root, 'tr-sug.json');
      fs.writeFileSync(tr, JSON.stringify({ words: ['¡No', 'me', 'lo', 'puedo', 'creer,', 'un', 'creeper', 'a', 'mis', 'espaldas!'].map((text, i) => ({ text, start: 20 + i * 0.5, end: 20.5 + i * 0.5 })) }));
      e.ctx.transcripts.importFile(vod.id, tr);
      const local = await e.ctx.autopilot.suggestTitle(vod.id, 10, 40);
      assert.equal(local?.source, 'transcript');
      assert.match(local!.title, /creeper/);
      assert.equal(await e.ctx.autopilot.suggestTitle(vod.id, 100, 130), null, 'otro tramo sin palabras');
      e.ctx.settings.set({ autopilot: { llm: { provider: 'gemini', model: '', apiKey: 'k' } } });
      const llm = await e.ctx.autopilot.suggestTitle(vod.id, 10, 40);
      assert.deepEqual(llm, { title: 'El susto del creeper', source: 'llm' });
    } finally {
      srv.close();
    }
  });

  it('nombres cortos en la Biblioteca: renombra lo largo o genérico, respeta lo escrito por el usuario y evita repetidos; al llegar la transcripción se hace solo', async () => {
    const { e, vod } = setup();
    const mk = (id: string, title: string, o: Partial<OutputItem> = {}) => {
      e.ctx.store.data.outputs.push({ id, vodId: vod.id, kind: 'clip', title, files: {}, durationSec: 30, createdAt: '2026-10-10T10:00:00Z', start: 10, end: 40, ...o });
    };
    mk('a', 'Un título larguísimo que describe todo lo que pasa en este clip de Twitch');
    mk('b', 'Mi clip favorito');
    mk('c', 'Otro título larguísimo escrito por mí mismo que no se debe tocar nunca jamás', { titleSource: 'manual' });
    mk('d', 'Clip 3', { start: 100, end: 130 });
    const tr = path.join(root, 'tr-lib.json');
    fs.writeFileSync(tr, JSON.stringify({ words: ['¡No', 'me', 'lo', 'puedo', 'creer,', 'un', 'creeper', 'a', 'mis', 'espaldas!'].map((text, i) => ({ text, start: 20 + i * 0.5, end: 20.5 + i * 0.5 })) }));
    e.ctx.transcripts.importFile(vod.id, tr); // al guardarse la transcripción, lo ya creado se nombra solo
    for (let i = 0; i < 50 && e.ctx.store.data.outputs[0].titleSource !== 'auto'; i++) await new Promise((r) => setTimeout(r, 20));
    const by = (id: string) => e.ctx.store.data.outputs.find((o) => o.id === id)!;
    assert.match(by('a').title, /creeper/i);
    assert.ok(by('a').title.length <= 40 && by('a').titleSource === 'auto', by('a').title);
    assert.equal(by('b').title, 'Mi clip favorito');
    assert.match(by('c').title, /escrito por mí mismo/);
    assert.equal(by('d').title, 'Clip 3', 'sin palabras en su tramo no hay de qué sacar el nombre');
    const r = await e.ctx.autopilot.autoNameLibrary();
    assert.deepEqual(r, { renamed: 0, described: 0, noTranscript: 1, kept: 3 });
    assert.match(by('a').description ?? '', /creeper/i, 'también se escribe la descripción de YouTube');
    assert.equal(by('a').descSource, 'auto');
    // dos elementos del mismo tramo no se llaman igual
    mk('e', 'Otro título larguísimo del mismo tramo que se tiene que distinguir del anterior');
    await e.ctx.autopilot.autoNameLibrary();
    assert.notEqual(by('e').title.toLowerCase(), by('a').title.toLowerCase());
    assert.match(by('e').title, /creeper/i);
    // lo que el usuario escribe después queda como suyo
    e.ctx.library.setMeta('a', { title: 'Mi nombre' });
    assert.equal(by('a').titleSource, 'manual');
    await e.ctx.autopilot.autoNameLibrary();
    assert.equal(by('a').title, 'Mi nombre');
  });

  it('al arrancar: renombra solo lo genérico no escrito por el usuario, describe lo que no tiene descripción y respeta la del usuario', async () => {
    const { e, vod } = setup();
    const mk = (id: string, title: string, o: Partial<OutputItem> = {}) => {
      e.ctx.store.data.outputs.push({ id, vodId: vod.id, kind: 'clip', title, files: {}, durationSec: 30, createdAt: '2026-10-10T10:00:00Z', start: 10, end: 40, ...o });
    };
    mk('g1', 'Momento 4');
    mk('g2', 'Directo del 4 de octubre (parte 2)');
    mk('g3', 'Resumen del directo - 4 de octubre', { kind: 'long', segments: [{ start: 10, end: 40 }] });
    mk('keep', 'Un título largo pero que no es genérico, así que el arranque no lo toca para nada');
    mk('mine', 'Momento 9', { titleSource: 'manual' });
    mk('desc', 'Mi clip', { description: 'Descripción mía', descSource: 'manual' });
    const tr = path.join(root, 'tr-start.json');
    fs.writeFileSync(tr, JSON.stringify({ words: ['¡No', 'me', 'lo', 'puedo', 'creer,', 'un', 'creeper', 'a', 'mis', 'espaldas!', 'Casi', 'me', 'da', 'un', 'infarto', 'aquí', 'delante', 'de', 'todos.'].map((text, i) => ({ text, start: 12 + i * 0.5, end: 12.5 + i * 0.5 })) }));
    e.ctx.transcripts.importFile(vod.id, tr);
    await new Promise((r) => setTimeout(r, 100)); // el guardado de la transcripción lanza su propio repaso
    for (const o of e.ctx.store.data.outputs) {
      if (o.id === 'keep' || o.id === 'mine') {
        o.title = o.id === 'keep' ? o.title : 'Momento 9';
        delete o.description;
        delete o.descSource;
      }
    }
    for (const id of ['g1', 'g2', 'g3']) {
      const o = e.ctx.store.data.outputs.find((x) => x.id === id)!;
      o.title = id === 'g1' ? 'Momento 4' : id === 'g2' ? 'Directo del 4 de octubre (parte 2)' : 'Resumen del directo - 4 de octubre';
      o.titleSource = undefined;
      delete o.description;
      delete o.descSource;
    }
    const r = await e.ctx.autopilot.refreshLibraryAtStart();
    const by = (id: string) => e.ctx.store.data.outputs.find((o) => o.id === id)!;
    assert.ok(r && r.renamed >= 3, JSON.stringify(r));
    for (const id of ['g1', 'g2', 'g3']) {
      assert.match(by(id).title, /creeper|infarto|espaldas/i, by(id).title);
      assert.equal(by(id).titleSource, 'auto');
      assert.ok((by(id).description ?? '').length > 30 && (by(id).description ?? '').length <= 300, by(id).description);
      assert.equal(by(id).descSource, 'auto');
    }
    assert.equal(by('keep').title.startsWith('Un título largo'), true, 'un nombre largo pero no genérico no se toca al arrancar');
    assert.equal(by('mine').title, 'Momento 9', 'lo escrito por el usuario no se toca aunque suene genérico');
    assert.equal(by('desc').description, 'Descripción mía');
    assert.equal(new Set(['g1', 'g2', 'g3'].map((id) => by(id).title.toLowerCase())).size, 3, 'sin repetidos');
  });

  it('desactivado, no hace nada al terminar un directo; los ajustes se validan', () => {
    const e = makeEnv();
    envs.push(e);
    e.ctx.settings.set({ autopilot: { enabled: false } });
    e.ctx.autopilot.onLiveVod(addDownloadedVod(e, video));
    assert.equal(e.ctx.store.data.vods[0].autopilot, undefined);
    assert.throws(() => e.ctx.settings.set({ autopilot: { videoTimes: ['25:00'] } }), /HH:MM/);
    assert.throws(() => e.ctx.settings.set({ autopilot: { clipTimes: ['9:00'] } }), /HH:MM/);
    assert.throws(() => e.ctx.settings.set({ autopilot: { maxVideos: 50 } }), /entre 0 y 12/);
    assert.deepEqual(e.ctx.settings.set({ autopilot: { videoTimes: ['21:30', '08:00', '08:00'] } }).autopilot.videoTimes, ['08:00', '21:30']);
    assert.throws(() => e.ctx.settings.set({ autopilot: { maxClips: 99 } }), /entre 0 y 20/);
    assert.throws(() => e.ctx.settings.set({ autopilot: { series: { name: 'x'.repeat(61), nextDay: 1 } } }), /60 caracteres/);
    assert.throws(() => e.ctx.settings.set({ autopilot: { series: { name: 'a', nextDay: 0 } } }), /entre 1 y 9999/);
    assert.deepEqual(e.ctx.settings.set({ autopilot: { series: { name: '  Mi   serie ', nextDay: 2 } } }).autopilot.series, { name: 'Mi serie', nextDay: 2 });
    assert.throws(() => e.ctx.settings.set({ autopilot: { platforms: ['myspace' as never] } }), /no reconocida/);
    assert.throws(() => e.ctx.settings.set({ autopilot: { subtitles: 'feo' as never } }), /subtítulos/);
    const s = e.ctx.settings.set({ autopilot: { llm: { provider: 'groq', apiKey: 'secreta' } } });
    assert.equal(s.autopilot.llm.apiKey, '********');
    assert.equal(e.ctx.settings.llmKey(), 'secreta');
    assert.ok(!fs.readFileSync(e.ctx.store.file, 'utf8').includes('secreta') || fs.readFileSync(e.ctx.store.file, 'utf8').includes('plain:') === false);
  });
});
