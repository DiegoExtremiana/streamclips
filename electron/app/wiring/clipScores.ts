import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppContext, ContextOptions } from '../context';
import { ClipScoreService } from '../../domain/clipScores';
import { askJson, MIN_INTERVAL_MS, visionConfig, type LlmProvider } from '../../services/llm';
import { CLIP_JUDGE_SYSTEM, CLIP_JUDGE_VISION_SYSTEM, clipJudgePrompt, parseClipJudgement } from '../../../shared/clipCriteria';
import { feedbackGuide } from '../../../shared/clipFeedback';
import { audioEnergy as measureEnergy } from '../../services/audioEnergy';
import { run } from '../../services/tools';

/** Separa las peticiones al modelo de los clips (hay dos clips a la vez) para no pasar el límite gratuito por minuto. */
let clipJudgeNext = 0;
async function clipJudgeGate(paceMs: number): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, clipJudgeNext);
  clipJudgeNext = at + paceMs;
  if (at > now) await new Promise<void>((r) => setTimeout(r, at - now));
}

/** Hasta 5 fotogramas equiespaciados del clip (JPEG de 512 px) como data URL; el modelo gratuito de Groq admite 5 imágenes por petición. */
export async function clipFrames(ffmpeg: string, file: string, dir: string, durationSec: number, n = 5): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const dur = Math.max(1, durationSec);
  await run(ffmpeg, ['-y', '-v', 'error', '-nostdin', '-i', file, '-an', '-vf', `fps=${(n / dur).toFixed(4)},scale=512:-2`, '-frames:v', String(n), '-q:v', '6', path.join(dir, 'f%02d.jpg')], 90_000);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => `data:image/jpeg;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`);
}

/** La valoración de los clips del canal en segundo plano: de dónde saca el audio, cuándo trabaja y a qué modelo pregunta. */
export function createClipScoreService(app: AppContext, o: ContextOptions): ClipScoreService {
  // restos de una valoración interrumpida (cierre del programa a mitad): no se deja espacio muerto en la carpeta temporal
  try {
    for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith('streamclips-score-')) fs.rmSync(path.join(os.tmpdir(), f), { recursive: true, force: true });
  } catch {
    /* no se puede limpiar: no pasa nada */
  }
  return new ClipScoreService({
    file: path.join(o.userDataDir, 'clip-scores.json'),
    feedback: app.clipFeedback,
    notesFile: path.join(o.userDataDir, 'Notas de clips.md'),
    log: app.log,
    enabled: () => app.store.data.settings.autopilot.scoreClips !== false,
    canRun: () => !app.channel.isLive() && !app.autopilot.isBusy() && app.store.data.settings.autopilot.scoreClips !== false,
    waitReason: () => (app.channel.isLive() ? 'hay un directo en marcha' : app.autopilot.isBusy() ? 'el piloto automático está analizando un directo' : null),
    hasJudge: () => Boolean(app.autopilot.llmConf()),
    ready: () => {
      const w = app.transcripts.status();
      if (!w.engine) return 'Falta Whisper (el motor que escucha los clips).';
      if (!w.modelInstalled) return `Falta descargar el modelo de Whisper «${w.model}»: en Ajustes, Voz y subtítulos, pulsa «Descargar modelo». Sin él no se puede leer lo que se dice en los clips y no se valoran.`;
      return null;
    },
    analyze: async (clip, onPhase) => {
      const t = app.tools();
      onPhase?.('descarga');
      const url = (await run(t.ytdlp, ['--no-warnings', '--no-playlist', '-g', '-f', 'b[height<=480]/b', '--', clip.url], 60_000)).stdout.trim().split('\n')[0] ?? '';
      if (!/^https?:\/\//.test(url)) throw new Error('Twitch no dio una dirección válida para el clip.');
      const key = clip.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const mp4 = path.join(os.tmpdir(), `streamclips-score-${key}.mp4`);
      const wav = path.join(os.tmpdir(), `streamclips-score-${key}.wav`);
      const shots = path.join(os.tmpdir(), `streamclips-score-${key}`);
      try {
        // el clip se baja una sola vez (pesa poco): de la copia local salen el audio y los fotogramas
        await run(t.ffmpeg, ['-y', '-v', 'error', '-nostdin', '-i', url, '-t', '180', '-c', 'copy', mp4], 180_000);
        await run(t.ffmpeg, ['-y', '-v', 'error', '-nostdin', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], 120_000);
        let frames: string[] | undefined;
        if (app.autopilot.llmConf() && o.clipVision !== false) {
          onPhase?.('imagen');
          frames = await clipFrames(t.ffmpeg, mp4, shots, clip.durationSec).catch(() => undefined);
        }
        onPhase?.('volumen');
        const energyDb = await (o.energy ?? measureEnergy)(t, wav).catch(() => undefined);
        onPhase?.('transcripcion');
        const words = await app.transcripts.transcribeAudio(wav, [clip.title]);
        return { durationSec: clip.durationSec, words, energyDb, frames };
      } finally {
        fs.rmSync(wav, { force: true });
        fs.rmSync(mp4, { force: true });
        fs.rmSync(shots, { recursive: true, force: true });
      }
    },
    judge: async (clip, words, frames) => {
      const conf = app.autopilot.llmConf();
      if (!conf) return null;
      await clipJudgeGate(o.llmBaseUrl ? 0 : Math.round(MIN_INTERVAL_MS[conf.provider as LlmProvider] * 0.55));
      if (frames?.length) {
        try {
          const raw = await askJson(visionConfig(conf), CLIP_JUDGE_VISION_SYSTEM, clipJudgePrompt(clip.title, words, clip.durationSec, frames.length, feedbackGuide(app.clipFeedback.all())), { temperature: 0.2, images: frames });
          const j = parseClipJudgement(raw, { transcript: words.map((w) => w.text).join(' '), vision: true });
          if (j) return { ...j, ai: { provider: conf.provider, model: visionConfig(conf).model, vision: true } };
        } catch (e) {
          // sin imágenes (el modelo no las admite o falló): se valora solo con lo que se oye, como antes; sin cuota no se insiste
          if (/límite gratuito|rechazó la clave/.test((e as Error).message)) throw e;
          app.log.warn(`Clip ${clip.id}: valoración con imagen no disponible (${(e as Error).message}); se valora solo el texto.`);
        }
        if (words.length < 12) return null;
      }
      const raw = await askJson(conf, CLIP_JUDGE_SYSTEM, clipJudgePrompt(clip.title, words, clip.durationSec, 0, feedbackGuide(app.clipFeedback.all())), { temperature: 0.2 });
      const j = parseClipJudgement(raw, { transcript: words.map((w) => w.text).join(' ') });
      return j ? { ...j, ai: { provider: conf.provider, model: conf.model } } : null;
    },
  });
}
