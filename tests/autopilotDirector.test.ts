import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
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
  // 6 minutos con cinco subidas de volumen de medio minuto: cinco candidatos claros
  const peaks = [20, 90, 160, 230, 300].map((t) => `between(t,${t},${t + 30})`).join('+');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=360',
    '-f', 'lavfi', '-i', `aevalsrc='(0.02+0.9*(${peaks}))*sin(2*PI*300*t)':d=360:s=16000`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
});
after(() => rmDir(root));

interface Server {
  url: string;
  directorCalls: number;
  lastDirectorPrompt: string;
  close: () => void;
}

/** Modelo de mentira: valora bien todos los candidatos y, al director, le devuelve una estructura con gancho, capítulos y frases. */
function llm(mode: 'ok' | 'bad' = 'ok'): Promise<Server> {
  const state = { directorCalls: 0, lastDirectorPrompt: '' };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as { messages: { content: string }[] };
      const sys = body.messages[0].content;
      const user = body.messages[1].content;
      const reply = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
      if (/EXIGENTE/.test(sys)) {
        const items = JSON.parse(/Fragmentos:\n(.*)$/s.exec(user)![1]) as { id: string; texto: string }[];
        return reply({ juicios: items.map((it, i) => ({ id: it.id, humor: 8, originalidad: 7, interaccion: 7, reaccion: 8, contexto: 7, autonomia: 8, tipo: i % 2 ? 'fail' : 'gracia', descartar: false, inicio: 0, fin: 45, titulo: `Momento ${it.id}`, motivo: 'Bueno' })) });
      }
      if (/editor jefe/.test(sys)) {
        state.directorCalls++;
        state.lastDirectorPrompt = user;
        if (mode === 'bad') return reply({ capitulos: [] });
        const cands = JSON.parse(/relativas al inicio del momento\):\n(.*)\nDevuelve/s.exec(user)![1]) as { id: string; inicio: number; fin: number }[];
        const ids = cands.map((c) => c.id);
        return reply({
          titulo: 'El directo que se torció',
          descripcion: 'Todo iba bien hasta que dejó de ir bien.',
          miniatura: 'SE TORCIÓ',
          gancho: { id: ids[ids.length - 1], desde: 2, hasta: 10, rotulo: 'lo que pasó al final' },
          capitulos: [
            { titulo: 'Calentando', ids: ids.slice(0, 2), ritmo: 'normal' },
            { titulo: 'La racha', ids: ids.slice(2, 4), ritmo: 'rapido' },
            { titulo: 'El final', ids: ids.slice(4), ritmo: 'normal' },
          ],
          frases: [{ id: ids[0], en: 3, texto: 'no me lo creo' }],
          motivo: 'Gancho con el final y tres actos.',
        });
      }
      return reply({});
    });
  });
  return new Promise((ok) =>
    srv.listen(0, '127.0.0.1', () => {
      const s = Object.defineProperties({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close() }, {
        directorCalls: { get: () => state.directorCalls },
        lastDirectorPrompt: { get: () => state.lastDirectorPrompt },
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
  const phrases = [
    ['qué', 'jugada', 'tío', 'no', 'me', 'lo', 'creo', 'ganamos'],
    ['madre', 'mía', 'el', 'cubo', 'otra', 'vez', 'encima', 'mojado'],
    ['vamos', 'equipo', 'esto', 'está', 'hecho', 'confiad', 'en', 'mí'],
    ['no', 'puede', 'ser', 'me', 'han', 'robado', 'la', 'partida'],
    ['escuchad', 'esta', 'historia', 'del', 'instituto', 'es', 'muy', 'buena'],
    ['y', 'así', 'acaba', 'el', 'directo', 'de', 'hoy', 'adiós'],
  ];
  const words = [20, 90, 160, 230, 300].flatMap((t, k) => phrases[k].flatMap((text, i) => [0, 10, 20].map((o) => ({ text, start: t + o + i, end: t + o + i + 0.5 }))));
  fs.writeFileSync(tr, JSON.stringify({ words }));
  e.ctx.transcripts.importFile(vod.id, tr);
  // vídeo objetivo de 2 a 4 minutos (el directo de prueba dura 6)
  e.ctx.style.set({ longMinSec: 120, longMaxSec: 240 });
  e.ctx.settings.set({ autopilot: { summaryMinutes: 3, mainMinutes: 1, maxClips: 0, maxVideos: 1, requireApproval: true, platforms: ['youtube'], cleanup: false, vodVision: false, topics: false, music: false, llm: { provider: 'groq', model: 'x', apiKey: 'CLAVE' }, ...auto } });
  return { e, vod };
}

describe('director de edición en el piloto', () => {
  it('con la vista del directo activada, el jefe de edición revisa el montaje con fotogramas y el vídeo sale igual', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url, { vodVision: true });
      await e.ctx.autopilot.run(vod.id);
      const v = e.ctx.store.data.vods[0];
      assert.equal(v.autopilot?.status, 'done', v.autopilot?.note);
      assert.match(v.autopilot?.note ?? '', /Jefe de edición: Aprobado/);
      assert.equal(e.ctx.store.data.outputs.filter((o) => o.kind === 'long').length, 1, v.autopilot?.note);
    } finally {
      srv.close();
    }
  });

  it('el vídeo largo sale con la estructura del director: gancho primero, capítulos en la descripción, rótulos grabados y frase de portada', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url);
      await e.ctx.autopilot.run(vod.id);
      const v = e.ctx.store.data.vods[0];
      assert.equal(v.autopilot?.status, 'done', v.autopilot?.note);
      assert.match(v.autopilot?.note ?? '', /Editor de historia: «El directo que se torció»: 3 capítulos \(Calentando · La racha · El final\), con gancho/);
      assert.equal(srv.directorCalls, 1);
      assert.match(srv.lastDirectorPrompt, /entre 2 y 4 minutos/);
      const longs = e.ctx.store.data.outputs.filter((o) => o.kind === 'long');
      assert.equal(longs.length, 1, v.autopilot?.note);
      const o = longs[0];
      assert.match(o.title, /^Resumen \d+ de \w+ de \d{4}$/);
      assert.match(o.description ?? '', /El directo que se torció/);
      assert.equal(o.coverText, 'SE TORCIÓ');
      assert.equal(o.auto?.kind, 'dirigido');
      assert.match(o.auto?.reason ?? '', /Gancho con el final/);
      // el primer tramo es el gancho (8 s del último candidato) y después empieza por el principio
      assert.ok(o.segments!.length >= 4, JSON.stringify(o.segments));
      // los tramos guardados son los trozos conservados (ya sin silencios): el primero es parte del gancho, de 8 s como mucho
      assert.ok(o.segments![0].end - o.segments![0].start <= 8.2, 'gancho de 8 s como mucho');
      assert.ok(o.segments![0].start > Math.min(...o.segments!.map((x) => x.start)), 'el gancho viene de más adelante del directo');
      // rótulos: el aviso del gancho, una cartela por capítulo y la frase
      const titles = (o.effects ?? []).filter((x) => x.type === 'title');
      assert.deepEqual(titles.map((t) => (t.type === 'title' ? t.kind : '')).sort(), ['capitulo', 'capitulo', 'capitulo', 'cierre', 'frase', 'gancho']);
      assert.match(o.description ?? '', /Todo iba bien/);
      assert.match(o.description ?? '', /0:00 Calentando\n\d+:\d\d La racha\n\d+:\d\d El final/, `capítulos en la descripción: ${o.description}`);
      assert.ok(fs.existsSync(o.files.long!));
      // repetir el análisis no vuelve a preguntar al director (plan guardado)
      await e.ctx.autopilot.run(vod.id);
      assert.equal(srv.directorCalls, 1);
    } finally {
      srv.close();
    }
  });

  it('si el director no devuelve una estructura válida, se monta el resumen de mejores momentos de siempre', async () => {
    const srv = await llm('bad');
    try {
      const { e, vod } = setup(srv.url);
      await e.ctx.autopilot.run(vod.id);
      const v = e.ctx.store.data.vods[0];
      assert.equal(v.autopilot?.status, 'done', v.autopilot?.note);
      assert.match(v.autopilot?.note ?? '', /[Nn]o devolvió una estructura válida; se monta el resumen de siempre/);
      const longs = e.ctx.store.data.outputs.filter((o) => o.kind === 'long');
      assert.equal(longs.length, 1);
      assert.equal(longs[0].auto?.kind, 'resumen');
    } finally {
      srv.close();
    }
  });

  it('con el director desactivado no se le pregunta', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url, { director: false });
      await e.ctx.autopilot.run(vod.id);
      assert.equal(srv.directorCalls, 0);
      assert.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
    } finally {
      srv.close();
    }
  });
});
