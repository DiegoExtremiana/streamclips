import fs from 'node:fs';
import path from 'node:path';
import { cleanEdits, emptyEdits, momentKey, type MomentEdits } from '../../shared/momentEdits';
import type { Judged } from '../../shared/judge';
import { cleanPrefs, type Preferences } from '../../shared/preferences';

/** Lo que el piloto vio y eligió en un directo, para poder revisarlo sin volver a analizar. */
export interface MomentSnapshot {
  /** Nota mínima con la que se eligió. */
  quality: number;
  items: {
    key: string;
    start: number;
    end: number;
    total: number;
    kind: string;
    reason: string;
    title?: string;
    scores: Record<string, number>;
    trim?: { start: number; end: number };
    discard: boolean;
  }[];
  /** Claves de los que entraron en la selección. */
  chosen: string[];
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');
const editsFile = (dir: string, id: string) => path.join(dir, `${safe(id)}.edits.json`);
const snapFile = (dir: string, id: string) => path.join(dir, `${safe(id)}.json`);

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export const loadEdits = (dir: string, vodId: string): MomentEdits => (fs.existsSync(editsFile(dir, vodId)) ? cleanEdits(readJson(editsFile(dir, vodId))) : emptyEdits());
export const saveEdits = (dir: string, vodId: string, e: MomentEdits): void => writeJson(editsFile(dir, vodId), cleanEdits(e));

export function loadSnapshot(dir: string, vodId: string): MomentSnapshot | null {
  const j = readJson(snapFile(dir, vodId)) as Partial<MomentSnapshot> | null;
  if (!j || !Array.isArray(j.items) || !Array.isArray(j.chosen)) return null;
  return { quality: typeof j.quality === 'number' ? j.quality : 6.5, items: j.items, chosen: j.chosen.filter((x): x is string => typeof x === 'string') };
}

export function saveSnapshot(dir: string, vodId: string, judged: Judged[], chosenStarts: number[], quality: number): void {
  const snap: MomentSnapshot = {
    quality,
    items: judged.map((j) => ({
      key: momentKey(j.start),
      start: j.start,
      end: j.end,
      total: j.total,
      kind: j.judgement.kind,
      reason: j.judgement.reason,
      ...(j.judgement.title ? { title: j.judgement.title } : {}),
      scores: j.judgement.scores,
      ...(j.judgement.trim ? { trim: j.judgement.trim } : {}),
      discard: j.judgement.discard,
    })),
    chosen: [...new Set(chosenStarts.map(momentKey))],
  };
  try {
    writeJson(snapFile(dir, vodId), snap);
  } catch {
    /* sin instantánea solo se pierde la pantalla de revisión de este directo */
  }
}

export const loadPrefs = (file: string): Preferences => cleanPrefs(readJson(file));
export const savePrefs = (file: string, p: Preferences): void => writeJson(file, cleanPrefs(p));
