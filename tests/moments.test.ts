import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { savePrefs, saveSnapshot } from '../electron/services/momentStore';
import type { Judged } from '../shared/judge';
import { addDownloadedVod, makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

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

interface Server {
  url: string;
  judgeCalls: number;
  titleCalls: number;
  close: () => void;
}

/** Modelo de mentira: valora alto lo que habla de «jugada» y bajo lo de «locura»; para los títulos devuelve un JSON vacío. */
function llm(mode: 'normal' | 'fail' | 'low' = 'normal'): Promise<Server> {
  const state = { judgeCalls: 0, titleCalls: 0 };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as { messages: { content: string }[] };
      const isJudge = /EXIGENTE/.test(body.messages[0].content);
      if (!isJudge) {
        state.titleCalls++;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
        return;
      }
      state.judgeCalls++;
      if (mode === 'fail') {
        res.writeHead(500).end('{}');
        return;
      }
      const items = JSON.parse(/Fragmentos:\n(.*)$/s.exec(body.messages[1].content)![1]) as { id: string; texto: string }[];
      const juicios = items.map((it) => {
        const n = mode === 'low' ? 3 : /jugada/.test(it.texto) ? 9 : 3;
        return { id: it.id, humor: n, originalidad: n, interaccion: n, reaccion: n, contexto: n, autonomia: n, tipo: 'fail', descartar: false, inicio: 0, fin: 40, motivo: n > 5 ? 'Jugada inesperada con remate' : 'Charla sin gracia' };
      });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ juicios }) } }] }));
    });
  });
  return new Promise((ok) =>
    srv.listen(0, '127.0.0.1', () => {
      const s = Object.defineProperties({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close() }, {
        judgeCalls: { get: () => state.judgeCalls },
        titleCalls: { get: () => state.titleCalls },
      }) as unknown as Server;
      ok(s);
    }),
  );
}

function setup(url: string, auto: Record<string, unknown> = {}) {
  const e = makeEnv({ llmBaseUrl: url });
  envs.push(e);
  const vod = addDownloadedVod(e, video);
  const tr = path.join(root, `tr-${Math.random().toString(36).slice(2)}.json`);
  const words = [
    ...['Hola', 'qué', 'locura', 'tío', 'esto', 'no', 'puede', 'ser'].map((text, i) => ({ text, start: 52 + i, end: 52.5 + i })),
    ...['Increíble', 'jugada', 'no', 'me', 'lo', 'creo', 'ganamos'].map((text, i) => ({ text, start: 162 + i, end: 162.5 + i })),
  ];
  fs.writeFileSync(tr, JSON.stringify({ words }));
  e.ctx.transcripts.importFile(vod.id, tr);
  e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, requireApproval: true, platforms: ['youtube'], cleanup: false, llm: { provider: 'groq', model: 'x', apiKey: 'CLAVE' }, ...auto } });
  return { e, vod };
}


const clipsOf = (e: TestEnv) => e.ctx.store.data.outputs.filter((o) => o.auto?.role === 'clip');

describe('revisión de momentos', () => {
  it('excluir un momento y regenerar lo quita sin volver a preguntar al modelo; fijar uno flojo lo mete; limpiar lo devuelve', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url);
      await e.ctx.autopilot.run(vod.id);
      assert.equal(clipsOf(e).length, 1);
      const calls = srv.judgeCalls;
      const v1 = e.ctx.moments.list(vod.id);
      assert.equal(v1.available, true);
      assert.equal(v1.quality, 6.5);
      assert.equal(v1.pending, false);
      const good = v1.rows.find((r) => r.chosen)!;
      const weak = v1.rows.find((r) => !r.chosen && r.total < 6.5)!;
      assert.ok(good && weak, JSON.stringify(v1.rows.map((r) => [r.key, r.total, r.chosen])));
      assert.match(good.text, /jugada/);
      assert.match(good.reason, /Jugada inesperada/);
      assert.equal(weak.belowFloor, true);

      // excluir el bueno: no queda nada que supere la nota
      const v2 = e.ctx.moments.setState(vod.id, good.key, 'exclude');
      assert.equal(v2.pending, true);
      assert.equal(v2.rows.find((r) => r.key === good.key)!.excluded, true);
      await e.ctx.autopilot.run(vod.id);
      assert.equal(clipsOf(e).length, 0, e.ctx.store.data.vods[0].autopilot?.note);
      assert.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /corrección\(es\) tuyas/);
      assert.equal(srv.judgeCalls, calls, 'las valoraciones no se piden otra vez');

      // fijar el flojo: entra aunque no llegue a la nota
      e.ctx.moments.setState(vod.id, weak.key, 'include');
      await e.ctx.autopilot.run(vod.id);
      assert.equal(clipsOf(e).length, 1);
      assert.equal(srv.judgeCalls, calls);
      assert.equal(e.ctx.moments.list(vod.id).rows.find((r) => r.key === weak.key)!.chosen, true);

      // limpiar: vuelve lo que eligió el piloto
      e.ctx.moments.clear(vod.id);
      assert.equal(e.ctx.moments.list(vod.id).pending, false);
      await e.ctx.autopilot.run(vod.id);
      const back = clipsOf(e);
      assert.equal(back.length, 1);
      assert.match(back[0].auto!.reason ?? '', /Jugada inesperada/);
    } finally {
      srv.close();
    }
  });

  it('los tiempos y las claves se validan y un momento añadido a mano se puede mover y quitar', () => {
    const e = makeEnv();
    envs.push(e);
    const vod = addDownloadedVod(e, video);
    e.ctx.store.data.vods[0].durationSec = 240;
    const j = (start: number, total: number): Judged => ({ id: `c${start}`, start, end: start + 40, signal: 5, total, judgement: { id: `c${start}`, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind: 'fail', reason: 'motivo', discard: false } });
    saveSnapshot(path.join(e.userData, 'moments'), vod.id, [j(50, 8), j(160, 4)], [50], 6.5);
    assert.deepEqual(e.ctx.moments.list(vod.id).rows.map((r) => [r.key, r.chosen]), [['50', true], ['160', false]]);
    assert.throws(() => e.ctx.moments.setState(vod.id, '999', 'exclude'), /ya no existe/);
    assert.throws(() => e.ctx.moments.trim(vod.id, '50', 60, 63), /al menos/);
    assert.throws(() => e.ctx.moments.trim(vod.id, '50', 60, 300), /no puede durar más|fuera/);
    assert.throws(() => e.ctx.moments.trim(vod.id, '50', 200, 250), /fuera del directo/);
    assert.throws(() => e.ctx.moments.add(vod.id, NaN, 80), /no son válidos/);
    const t = e.ctx.moments.trim(vod.id, '50', 55, 95);
    assert.deepEqual([t.rows[0].start, t.rows[0].end, t.rows[0].edited], [55, 95, true]);
    // el recorte guardado sobrevive a leer otra vez de disco
    assert.equal(e.ctx.moments.list(vod.id).rows[0].edited, true);
    const a = e.ctx.moments.add(vod.id, 200, 230, 'Mi momento');
    assert.equal(a.rows.find((r) => r.manual)!.title, 'Mi momento');
    assert.throws(() => e.ctx.moments.add(vod.id, 200, 235), /Ya hay un momento/);
    const m = e.ctx.moments.trim(vod.id, '200', 205, 240);
    assert.deepEqual(m.rows.filter((r) => r.manual).map((r) => r.key), ['205']);
    assert.equal(e.ctx.moments.remove(vod.id, '205').rows.some((r) => r.manual), false);
    assert.equal(e.ctx.moments.setState(vod.id, '50', 'reset').rows[0].edited, false);
    assert.throws(() => e.ctx.moments.list('no-existe'), /no existe/);
  });

  it('un directo sin selección guardada lo dice en vez de inventar momentos', () => {
    const e = makeEnv();
    envs.push(e);
    const vod = addDownloadedVod(e, video);
    const v = e.ctx.moments.list(vod.id);
    assert.deepEqual([v.available, v.rows.length, v.quality], [false, 0, null]);
  });

  it('aprende de lo que descartas y fijas, sin contar dos veces lo mismo ni lo que no estaba elegido', () => {
    const e = makeEnv();
    envs.push(e);
    const vod = addDownloadedVod(e, video);
    e.ctx.store.data.vods[0].durationSec = 2000;
    const j = (start: number, total: number, kind: 'fail' | 'gracia'): Judged => ({ id: `c${start}`, start, end: start + 40, signal: 5, total, judgement: { id: `c${start}`, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind, reason: '', discard: false } });
    const all = [100, 300, 500, 700].map((s) => j(s, 8, 'fail')).concat([j(900, 3, 'gracia')]);
    saveSnapshot(path.join(e.userData, 'moments'), vod.id, all, [100, 300, 500, 700], 6.5);
    assert.deepEqual(e.ctx.moments.prefs(), { enabled: true, kinds: [] });
    e.ctx.moments.setState(vod.id, '100', 'exclude');
    e.ctx.moments.setState(vod.id, '100', 'exclude'); // repetir no cuenta
    e.ctx.moments.setState(vod.id, '900', 'exclude'); // no estaba elegido: no dice nada
    e.ctx.moments.setState(vod.id, '300', 'include'); // ya estaba elegido: tampoco
    assert.deepEqual(e.ctx.moments.prefs().kinds, [{ kind: 'fail', bias: -0.25, count: 1, active: false }]);
    e.ctx.moments.setState(vod.id, '300', 'exclude');
    e.ctx.moments.setState(vod.id, '500', 'exclude');
    assert.deepEqual(e.ctx.moments.prefs().kinds, [{ kind: 'fail', bias: -0.75, count: 3, active: true }]);
    // fijar uno que no estaba elegido sube su tipo
    e.ctx.moments.setState(vod.id, '900', 'include');
    assert.equal(e.ctx.moments.prefs().kinds.find((k) => k.kind === 'gracia')!.bias, 0.25);
    assert.equal(e.ctx.moments.setPrefsEnabled(false).enabled, false);
    assert.equal(e.ctx.moments.resetPrefs().kinds.length, 0);
    assert.equal(e.ctx.moments.prefs().enabled, false, 'borrar lo aprendido no cambia si está activado');
  });

  it('las preferencias aprendidas bajan la nota del tipo que sueles descartar y se avisa en la nota del análisis', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url);
      const prefsFile = path.join(e.userData, 'preferences.json');
      // sin lo aprendido: se ve la nota real del momento bueno
      await e.ctx.autopilot.run(vod.id);
      const score = clipsOf(e)[0].auto!.score!;
      assert.ok(score > 7, String(score));
      // la nota mínima justo por debajo de esa nota; el ajuste de -1,5 lo deja fuera
      e.ctx.settings.set({ autopilot: { minQuality: Math.floor(score * 2) / 2 } });
      savePrefs(prefsFile, { enabled: true, kindBias: { fail: -1.5 }, counts: { fail: 6 } });
      await e.ctx.autopilot.run(vod.id);
      assert.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Preferencias aprendidas aplicadas: fail -1\.5/);
      assert.equal(clipsOf(e).length, 0, 'el momento bueno de tipo fail queda por debajo de la nota mínima');
      // con ellas apagadas vuelve a salir
      e.ctx.moments.setPrefsEnabled(false);
      await e.ctx.autopilot.run(vod.id);
      assert.equal(clipsOf(e).length, 1);
      assert.doesNotMatch(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Preferencias aprendidas/);
    } finally {
      srv.close();
    }
  });
});
