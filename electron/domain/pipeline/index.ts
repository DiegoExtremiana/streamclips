import type { VodJob } from '../../../shared/types';
import { PhaseClock } from '../../../shared/phaseClock';
import { audioEnergy } from '../../services/audioEnergy';
import { isCancelled } from '../../services/abort';
import { newContext, type Host, type Phase, type RunContext } from './context';
import { transcribeChosenPhase, transcribePhase } from './transcribe';
import { signalsPhase } from './signals';
import { judgePhase, qualityGatePhase, speakersPhase } from './judge';
import { studioPhase } from './studio';
import { renderPhase, titlesPhase } from './render';
import { finishPhase } from './finish';

/** Las fases, en orden. Cada una lee del contexto lo que necesita y deja lo suyo; «stop» termina el análisis con éxito. */
export const PHASES: { name: string; run: Phase }[] = [
  { name: 'transcripción', run: transcribePhase },
  { name: 'señales', run: signalsPhase },
  { name: 'transcripción de lo elegido', run: transcribeChosenPhase },
  { name: 'valoración', run: judgePhase },
  { name: 'estudio de edición', run: studioPhase },
  { name: 'nota mínima', run: qualityGatePhase },
  { name: 'hablantes', run: speakersPhase },
  { name: 'títulos', run: titlesPhase },
  { name: 'montaje', run: renderPhase },
  { name: 'cierre', run: finishPhase },
];

/**
 * Analiza un directo descargado de principio a fin: transcribe, mide, elige, dirige, titula, monta y cierra.
 * Los errores que no sean una cancelación se marcan en el directo y se vuelven a lanzar.
 */
export async function runPipeline(host: Host, vod: VodJob, pauseRequested: Set<string>, phases = PHASES): Promise<VodJob> {
  const task = host.d.tasks.start('analyze', `Piloto automático: ${vod.title || 'directo'}`, vod.id);
  const clock = new PhaseClock();
  clock.mark('lectura de audio y chat');
  const energyJob = (async () => {
    try {
      return { v: await (host.d.energy ?? audioEnergy)(host.d.tools(), vod.filePath!, () => undefined) };
    } catch (e) {
      return { e };
    }
  })();
  const ctx: RunContext = newContext(host, vod, task, clock, () => Date.now(), energyJob);
  try {
    for (const p of phases) {
      const r = await p.run(ctx);
      if (r === 'stop') return vod;
    }
    return vod;
  } catch (e) {
    if (isCancelled(e)) {
      const paused = pauseRequested.delete(vod.id);
      if (paused) host.markPaused(vod);
      else host.mark(vod, 'error', 'Análisis cancelado.');
      task.fail(paused ? 'En pausa' : 'Cancelado');
      host.d.log.info(`Análisis ${paused ? 'en pausa' : 'cancelado'}: "${vod.title}".`);
      throw e;
    }
    host.mark(vod, 'error', (e as Error).message);
    task.fail((e as Error).message);
    host.d.log.error('Piloto automático fallido', e);
    throw e;
  }
}
