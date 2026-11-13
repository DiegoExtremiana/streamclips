import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppContext, ContextOptions } from '../context';
import { ClipScoreService } from '../../domain/clipScores';
import { askJson, MIN_INTERVAL_MS, type LlmProvider } from '../../services/llm';
import { CLIP_JUDGE_SYSTEM, clipJudgePrompt, parseClipJudgement } from '../../../shared/clipCriteria';
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

/** La valoración de los clips del canal en segundo plano: de dónde saca el audio, cuándo trabaja y a qué modelo pregunta. */
export function createClipScoreService(app: AppContext, o: ContextOptions): ClipScoreService {
  return new ClipScoreService({
    file: path.join(o.userDataDir, 'clip-scores.json'),
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
      const wav = path.join(os.tmpdir(), `streamclips-score-${clip.id.replace(/[^A-Za-z0-9_-]/g, '_')}.wav`);
      try {
        await run(t.ffmpeg, ['-y', '-v', 'error', '-nostdin', '-i', url, '-vn', '-ac', '1', '-ar', '16000', '-t', '180', '-c:a', 'pcm_s16le', wav], 180_000);
        onPhase?.('volumen');
        const energyDb = await (o.energy ?? measureEnergy)(t, wav).catch(() => undefined);
        onPhase?.('transcripcion');
        const words = await app.transcripts.transcribeAudio(wav, [clip.title]);
        return { durationSec: clip.durationSec, words, energyDb };
      } finally {
        fs.rmSync(wav, { force: true });
      }
    },
    judge: async (clip, words) => {
      const conf = app.autopilot.llmConf();
      if (!conf) return null;
      await clipJudgeGate(o.llmBaseUrl ? 0 : Math.round(MIN_INTERVAL_MS[conf.provider as LlmProvider] * 0.55));
      const raw = await askJson(conf, CLIP_JUDGE_SYSTEM, clipJudgePrompt(clip.title, words, clip.durationSec), { temperature: 0.2 });
      return parseClipJudgement(raw);
    },
  });
}
