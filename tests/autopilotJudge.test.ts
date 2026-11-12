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
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
      }
      state.judgeCalls++;
      if (mode === 'fail') return res.writeHead(500).end('{}');
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
      }) as Server;
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

describe('selección inteligente', () => {
  it('solo entra lo que supera la nota mínima, con su nota y su motivo, y no se rellena con lo flojo', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url);
      await e.ctx.autopilot.run(vod.id);
      const v = e.ctx.store.data.vods[0];
      assert.equal(v.autopilot?.status, 'done', v.autopilot?.note);
      const clips = e.ctx.store.data.outputs.filter((o) => o.auto?.role === 'clip');
      assert.equal(clips.length, 1, 'de 2 clips pedidos solo uno es bueno: ' + v.autopilot?.note);
      assert.equal(clips[0].auto!.kind, 'fail');
      assert.match(clips[0].auto!.reason ?? '', /Jugada inesperada/);
      assert.ok((clips[0].auto!.score ?? 0) >= 6.5);
      assert.match(v.autopilot?.note ?? '', /Selección inteligente: \d+ candidatos valorados/);
      assert.match(v.autopilot?.note ?? '', /Solo 1 de 2 clips superan la nota mínima/);
      assert.ok(srv.judgeCalls >= 1);
      // el clip empieza donde dijo el modelo (recorte de 0 a 40 s del candidato), no donde acaba el ruido
      assert.ok(clips[0].durationSec <= 41, String(clips[0].durationSec));
    } finally {
      srv.close();
    }
  });

  it('al repetir el análisis no se vuelve a preguntar por lo ya valorado', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url);
      await e.ctx.autopilot.run(vod.id);
      const first = srv.judgeCalls;
      assert.ok(first >= 1);
      await e.ctx.autopilot.run(vod.id);
      assert.equal(srv.judgeCalls, first, 'las valoraciones salen de lo guardado');
      assert.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /ya estaban guardados/);
    } finally {
      srv.close();
    }
  });

  it('si el modelo falla, se usa el volumen y el chat y se avisa', async () => {
    const srv = await llm('fail');
    try {
      const { e, vod } = setup(srv.url);
      await e.ctx.autopilot.run(vod.id);
      const v = e.ctx.store.data.vods[0];
      assert.equal(v.autopilot?.status, 'done');
      assert.match(v.autopilot?.note ?? '', /Selección inteligente no disponible/);
      assert.equal(e.ctx.store.data.outputs.length, 4, 'monta lo de siempre');
    } finally {
      srv.close();
    }
  });

  it('si nada llega a la nota mínima y no hay vídeos principales, no se genera relleno', async () => {
    const srv = await llm('low');
    try {
      const { e, vod } = setup(srv.url, { maxVideos: 0 });
      await e.ctx.autopilot.run(vod.id);
      const v = e.ctx.store.data.vods[0];
      assert.equal(v.autopilot?.status, 'skipped', v.autopilot?.note);
      assert.match(v.autopilot?.note ?? '', /nota mínima/);
      assert.equal(e.ctx.store.data.outputs.length, 0);
    } finally {
      srv.close();
    }
  });

  it('con la selección inteligente desactivada no se consulta al modelo para elegir', async () => {
    const srv = await llm();
    try {
      const { e, vod } = setup(srv.url, { smartSelect: false });
      await e.ctx.autopilot.run(vod.id);
      assert.equal(srv.judgeCalls, 0);
      assert.equal(e.ctx.store.data.outputs.length, 4);
    } finally {
      srv.close();
    }
  });
});
