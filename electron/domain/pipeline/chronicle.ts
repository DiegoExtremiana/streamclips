import fs from 'node:fs';
import path from 'node:path';
import { CHRONICLE_SYSTEM, chronicleCandidates, chronicleChunks, chroniclePrompt, chunkText, parseChronicle, type ChronicleChunk } from '../../../shared/chronicle';
import { MUTED_SHARE, silentShare } from '../../../shared/highlights';
import { askJson, lanesFor, MIN_INTERVAL_MS } from '../../services/llm';
import { isCancelled, throwIfCancelled } from '../../services/abort';
import type { Phase } from './context';

const CACHE_VERSION = 1;
/** Por debajo de esto el directo se entiende con lo elegido: no hace falta cronista. */
const MIN_DURATION_SEC = 15 * 60;

/**
 * Fase del cronista (ver `shared/chronicle.ts`): parte el directo en tramos de 20 minutos y los reparte entre las IAs
 * disponibles, que los leen a la vez. Deja en el contexto las fichas de cada tramo (`ctx.chronicle`), que el estudio usa
 * como MAPA DEL DIRECTO, y añade a los candidatos los momentos que señala (lo que destaca por lo que se dice, no por el
 * volumen). Necesita texto de todo el directo (la lectura completa); si no lo hay o falla, el análisis sigue sin él.
 */
export const chroniclePhase: Phase = async (ctx) => {
  const { host, vod, task, notes } = ctx;
  const d = host.d;
  if (host.cfg.chronicle === false || !ctx.llmConf || ctx.duration < MIN_DURATION_SEC) return 'continue';
  const words = ctx.words;
  const segs = chronicleChunks(ctx.duration);
  const covered = segs.filter((s) => words.some((w) => w.start >= s.start && w.start < s.end)).length;
  if (words.length < 300 || covered < Math.ceil(segs.length / 2)) return 'continue';
  ctx.clock.mark('cronista');
  task.update(56, 'El cronista lee el directo por tramos…');
  const file = d.judgeDir ? path.join(d.judgeDir, `${vod.id}.chronicle.json`) : undefined;
  const key = `${CACHE_VERSION}|${segs.length}|${words.length}`;
  let chunks: ChronicleChunk[] | null = null;
  try {
    const saved = file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { key: string; chunks: ChronicleChunk[] }) : null;
    if (saved?.key === key) chunks = saved.chunks;
  } catch {
    chunks = null;
  }
  let lanesUsed = 1;
  if (!chunks) {
    const lanes = lanesFor(ctx.llmConf, 'chronicle');
    lanesUsed = lanes.length;
    const results: (ChronicleChunk | null)[] = segs.map(() => null);
    let done = 0;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await Promise.all(
      lanes.map(async (lane, li) => {
        for (let k = li, first = true; k < segs.length; k += lanes.length) {
          throwIfCancelled();
          const text = chunkText(words, segs[k]);
          if (text.length >= 200) {
            if (!first) await sleep(MIN_INTERVAL_MS[lane.provider]);
            first = false;
            try {
              results[k] = parseChronicle(await askJson(lane, CHRONICLE_SYSTEM, chroniclePrompt(text, segs[k], vod.title ?? ''), { fetchFn: d.llmFetch, temperature: 0.2 }), segs[k]);
            } catch (e) {
              if (isCancelled(e)) throw e;
            }
          }
          done++;
          task.update(56 + (done / segs.length) * 3, `El cronista lee el directo (${done} de ${segs.length} tramos)…`);
        }
      }),
    );
    chunks = results.filter((c): c is ChronicleChunk => c !== null);
    // solo se guarda si se leyó casi todo: si no, la próxima vez se vuelve a intentar
    if (file && chunks.length >= covered * 0.8) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ key, chunks }));
      } catch {
        /* sin caché solo se vuelve a leer */
      }
    }
  }
  if (!chunks.length) {
    notes.push('El cronista no pudo leer el directo (las IAs no respondieron); se sigue con lo elegido por volumen y conversación.');
    return 'continue';
  }
  ctx.chronicle = chunks;
  const extra = chronicleCandidates(chunks, ctx.pool, ctx.duration).filter((c) => silentShare(ctx.sig.energyDb, c) < MUTED_SHARE);
  extra.forEach((c, i) => ctx.pool.push({ id: `k${i + 1}`, start: c.start, end: c.end, signal: 6 }));
  notes.push(
    `Cronista: ${chunks.length} de ${segs.length} tramos de 20 min leídos${lanesUsed > 1 ? ` por ${lanesUsed} IAs a la vez` : ''}; ${extra.length} momento(s) señalados por lo que se dice añadidos a los candidatos.`,
  );
  return 'continue';
};
