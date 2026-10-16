import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppContext, type ContextOptions } from '../app/context';
import { silentNotifier } from '../domain/notifier';
import { Github, type GithubOpts } from '../services/cloud/github';
import type { TwitchClient } from '../services/twitch';
import type { TwitchVod } from '../../shared/types';
import { ENGINE_STATE_PATH, MAX_TRIES, parsePayload, parseRunState, type EnginePayload, type EngineRunState } from './payload';

/** Los directos de menos de esto no se editan (pruebas, cortes). */
const MIN_VOD_SEC = 10 * 60;
/** El directo tiene que haber terminado hace al menos esto: Twitch aún está cerrando el VOD. */
const SETTLE_MS = 3 * 60_000;
/** Margen para reconocer el VOD de un directo que empezó justo antes de «desde». */
const SINCE_SLACK_MS = 5 * 60_000;
/** Whisper (modelo small, 4 núcleos) tarda más o menos 1/1,5 de lo que dura el directo; el resto del trabajo necesita un colchón. */
const TRANSCRIBE_SPEED = 1.5;
const RESERVE_MS = 90 * 60_000;

export interface EngineOptions {
  /** Carpeta de trabajo (se borra al acabar cada directo). */
  workDir?: string;
  /** Ruta de whisper-cli (Linux). */
  whisper?: string;
  /** Tiempo disponible para todo el trabajo (ms). */
  budgetMs?: number;
  now?: () => number;
  /** Solo pruebas. */
  github?: Partial<GithubOpts>;
  twitch?: TwitchClient;
  download?: ContextOptions['download'];
  llmBaseUrl?: string;
  modelBaseUrl?: string;
  energy?: ContextOptions['energy'];
  log?: (msg: string) => void;
  sleepMs?: number;
}

export interface EngineResult {
  status: 'idle' | 'live' | 'done' | 'partial' | 'error';
  processed: string[];
  failed: string[];
  pending: number;
  note?: string;
}

const plainCipher = { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function candidates(vods: TwitchVod[], st: EngineRunState, p: EnginePayload, now: number): TwitchVod[] {
  const since = Date.parse(p.since) - SINCE_SLACK_MS;
  return [...vods]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .filter((v) => {
      if (st.done.includes(v.id) || (st.tries[v.id] ?? 0) >= MAX_TRIES) return false;
      const created = Date.parse(v.createdAt);
      if (Number.isNaN(created) || created < since) return false;
      if (v.durationSec < MIN_VOD_SEC) return false;
      return now - (created + v.durationSec * 1000) >= SETTLE_MS;
    });
}

async function readState(gh: Github): Promise<{ st: EngineRunState; sha?: string }> {
  const c = await gh.getContent(ENGINE_STATE_PATH);
  return { st: parseRunState(c?.text ?? null), sha: c?.sha };
}

async function writeState(gh: Github, st: EngineRunState, sha: string | undefined, msg: string): Promise<string | undefined> {
  const text = `${JSON.stringify(st, null, 2)}\n`;
  const next = await gh.putContent(ENGINE_STATE_PATH, text, msg, sha);
  if (next) return next;
  // alguien lo cambió a la vez (el programa en el PC): se vuelve a leer y se fusiona lo nuestro
  const cur = await gh.getContent(ENGINE_STATE_PATH);
  const merged = parseRunState(cur?.text ?? null);
  merged.done = [...new Set([...merged.done, ...st.done])];
  merged.tries = { ...merged.tries, ...st.tries };
  if (st.last) merged.last = st.last;
  return (await gh.putContent(ENGINE_STATE_PATH, `${JSON.stringify(merged, null, 2)}\n`, msg, cur?.sha)) ?? undefined;
}

/** ¿Hay algo que hacer? Barato: solo habla con Twitch y GitHub. Lo usa el flujo para no instalar nada cuando no hace falta. */
export async function checkWork(p: EnginePayload, o: EngineOptions = {}): Promise<{ work: boolean; live: boolean; vods: number }> {
  const now = (o.now ?? Date.now)();
  const gh = new Github({ token: p.cloud.token, repo: p.cloud.repo, ...o.github });
  const { st } = await readState(gh);
  const { TwitchClient } = await import('../services/twitch');
  const tw = o.twitch ?? new TwitchClient();
  const creds = p.twitch;
  const stream = await tw.streamStatus(creds);
  if (stream.live) return { work: false, live: true, vods: 0 };
  const list = candidates(await tw.listVods(creds), st, p, now);
  return { work: list.length > 0, live: false, vods: list.length };
}

/**
 * Edita los directos terminados que aún no se han tratado: descarga el VOD, lo transcribe, lo analiza, monta los vídeos y los clips
 * y los deja en la cola de la nube con su hora de publicación. No guarda nada en ningún sitio salvo en el repositorio privado.
 */
export async function runEngine(p: EnginePayload, o: EngineOptions = {}): Promise<EngineResult> {
  const nowFn = o.now ?? Date.now;
  const log = o.log ?? ((m: string) => console.log(`[streamclips] ${m}`));
  const startedAt = nowFn();
  const budget = o.budgetMs ?? 330 * 60_000;
  const deadline = startedAt + budget;
  const result: EngineResult = { status: 'idle', processed: [], failed: [], pending: 0 };

  const gh = new Github({ token: p.cloud.token, repo: p.cloud.repo, ...o.github });
  const loaded = await readState(gh);
  const st = loaded.st;
  let sha = loaded.sha;

  const work = o.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-engine-'));
  const ctx = new AppContext({
    userDataDir: path.join(work, 'data'),
    defaultOutputDir: path.join(work, 'out'),
    cipher: plainCipher,
    notifier: silentNotifier,
    headless: true,
    bundled: o.whisper ? { whisper: o.whisper } : {},
    twitch: o.twitch,
    download: o.download,
    github: o.github,
    llmBaseUrl: o.llmBaseUrl,
    modelBaseUrl: o.modelBaseUrl,
    energy: o.energy,
    canTranscribe: (durSec) => {
      const need = (durSec / TRANSCRIBE_SPEED) * 1000 + RESERVE_MS;
      return deadline - nowFn() >= need ? null : 'no queda tiempo en esta ejecución para transcribir un directo tan largo';
    },
  });
  try {
    ctx.settings.set({
      twitch: p.twitch,
      whisperModel: p.whisper.model,
      whisperLanguage: p.whisper.language,
      autopilot: { ...p.autopilot, enabled: true, requireApproval: false, chatCapture: false, llm: p.llm },
    });
    // la nube: el mismo repositorio privado que usa el programa en el PC
    ctx.store.data.cloud = { enabled: true, repo: p.cloud.repo, token: `plain:${Buffer.from(p.cloud.token, 'utf8').toString('base64')}`, lastSync: null, workflowCrons: '', known: [] };
    ctx.store.save();

    // lo que ya hay en la cola ocupa sus huecos: así no se pisan las horas de publicación
    const first = await ctx.cloud.sync();
    if (first.error) throw new Error(`No se pudo leer la cola de la nube: ${first.error}`);

    const creds = ctx.settings.twitchCreds();
    const stream = await ctx.twitch.streamStatus(creds);
    if (stream.live) {
      result.status = 'live';
      result.note = 'Hay un directo en marcha: se espera a que termine.';
      log(result.note);
      return result;
    }
    const todo = candidates(await ctx.twitch.listVods(creds), st, p, nowFn());
    result.pending = todo.length;
    if (!todo.length) {
      log('No hay directos nuevos que editar.');
      return result;
    }
    log(`${todo.length} directo(s) por editar.`);
    if (ctx.transcripts.status().engine) await ctx.transcripts.downloadModel().catch((e) => log(`Modelo de Whisper: ${(e as Error).message}`));

    for (const v of todo) {
      if (deadline - nowFn() < 20 * 60_000) {
        log('Se acaba el tiempo de esta ejecución: el resto queda para la siguiente.');
        break;
      }
      // numeración de la serie: se sigue la cuenta guardada mientras la configuración del programa no haya cambiado
      const ps = p.autopilot.series;
      const resume = st.series && st.series.name === ps.name && st.series.from === ps.nextDay ? st.series.nextDay : ps.nextDay;
      ctx.settings.set({ autopilot: { series: { name: ps.name, nextDay: resume } } });
      st.tries[v.id] = (st.tries[v.id] ?? 0) + 1;
      sha = await writeState(gh, st, sha, 'Motor: empezando un directo');
      log(`Editando el directo ${v.id} (${Math.round(v.durationSec / 60)} min), intento ${st.tries[v.id]}.`);
      try {
        await processVod(ctx, v, gh, deadline, nowFn, o.sleepMs ?? 5000, log);
        st.done.push(v.id);
        st.series = { name: ps.name, nextDay: ctx.store.data.settings.autopilot.series.nextDay, from: ps.nextDay };
        delete st.tries[v.id];
        result.processed.push(v.id);
        result.pending--;
      } catch (e) {
        result.failed.push(v.id);
        result.note = (e as Error).message;
        log(`El directo ${v.id} falló: ${(e as Error).message}`);
      }
      // se libera el disco antes del siguiente directo
      for (const vod of ctx.store.data.vods) if (vod.filePath) fs.rmSync(vod.filePath, { force: true });
      st.last = { at: new Date(nowFn()).toISOString(), processed: result.processed.length, pending: Math.max(0, result.pending), ...(result.note ? { note: result.note.slice(0, 300) } : {}) };
      sha = await writeState(gh, st, sha, result.failed.includes(v.id) ? 'Motor: fallo en un directo' : 'Motor: directo terminado');
    }
    result.status = result.failed.length ? (result.processed.length ? 'partial' : 'error') : 'done';
    return result;
  } finally {
    ctx.stop();
    if (!o.workDir) fs.rmSync(work, { recursive: true, force: true });
  }
}

async function processVod(ctx: AppContext, v: TwitchVod, gh: Github, deadline: number, now: () => number, sleepMs: number, log: (m: string) => void): Promise<void> {
  void gh;
  const job = ctx.vods.add(v.url, v.title, { origin: 'live', twitchId: v.id, streamStartedAt: v.createdAt, durationSec: v.durationSec });
  // la descarga termina → el vigilante avisa al piloto automático → este trabaja solo; aquí se espera
  for (;;) {
    const cur = ctx.store.data.vods.find((x) => x.id === job.id)!;
    if (cur.status === 'error') throw new Error(`No se pudo descargar el directo: ${cur.error ?? 'error desconocido'}`);
    const ap = cur.autopilot?.status;
    if (ap === 'error') throw new Error(`Falló la edición: ${cur.autopilot?.note ?? 'error desconocido'}`);
    if (ap === 'done' || ap === 'skipped') {
      log(`Edición terminada (${ap}).`);
      break;
    }
    if (now() > deadline) throw new Error('Se agotó el tiempo de la ejecución antes de terminar el directo.');
    await wait(sleepMs);
  }
  const mine = ctx.store.data.outputs.filter((o) => o.vodId === job.id);
  if (!mine.length) return; // el directo no tenía momentos que destacar
  // a la cola de la nube: si algo falla se reintenta una vez
  for (let i = 0; i < 2; i++) {
    const r = await ctx.cloud.sync();
    const pubs = ctx.store.data.publications.filter((pub) => mine.some((o) => o.id === pub.outputId) && pub.status !== 'failed');
    const waiting = pubs.filter((pub) => pub.cloud?.state !== 'queued');
    if (pubs.length && !waiting.length && !r.error) {
      log(`${mine.length} vídeo(s) y ${pubs.length} subida(s) dejados en la cola de la nube.`);
      return;
    }
    if (i === 1) throw new Error(`No se pudieron dejar todos los vídeos en la nube${r.error ? `: ${r.error}` : ''}.`);
    await wait(sleepMs);
  }
}

/** Punto de entrada en GitHub Actions. */
export async function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const p = parsePayload(env.STREAMCLIPS_ENGINE ?? '');
  const out = (name: string, value: string) => {
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
  };
  if (argv.includes('--check')) {
    const r = await checkWork(p);
    console.log(`[streamclips] ${r.live ? 'Directo en marcha.' : r.work ? `${r.vods} directo(s) por editar.` : 'Nada que hacer.'}`);
    out('work', r.work ? 'true' : 'false');
    await keepAlive(env);
    return;
  }
  const r = await runEngine(p, { whisper: env.STREAMCLIPS_WHISPER?.replace(/^~/, os.homedir()) || undefined });
  console.log(`[streamclips] Resultado: ${r.status}. Editados: ${r.processed.length}, fallidos: ${r.failed.length}.`);
  if (r.status === 'error' || r.status === 'partial') process.exitCode = 1;
}

/**
 * GitHub desactiva los flujos programados de un repositorio público sin actividad durante 60 días.
 * Una vez al mes se deja una marca en el propio repositorio del motor para que cuente como actividad.
 */
async function keepAlive(env: NodeJS.ProcessEnv): Promise<void> {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.STREAMCLIPS_PUBLIC_TOKEN;
  if (!repo || !token) return;
  try {
    const gh = new Github({ token, repo });
    const cur = await gh.getContent('engine/keepalive.txt');
    const last = cur ? Date.parse(cur.text.trim()) : 0;
    if (Date.now() - last < 20 * 86_400_000) return;
    await gh.putContent('engine/keepalive.txt', `${new Date().toISOString()}\n`, 'Motor: marca de actividad', cur?.sha);
  } catch (e) {
    console.log(`[streamclips] No se pudo dejar la marca de actividad: ${(e as Error).message}`);
  }
}
