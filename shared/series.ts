/** Series de directos: «Minecraft extremo Día 1», «Minecraft extremo Día 2»… */

export interface SeriesInfo {
  name: string;
  day: number;
}

const DAY_RE = /^(.*?)[\s\-–—:|,.·#]*\b(?:d[ií]a|day|cap[ií]tulo|episodio|ep\.?|parte)\s*#?\s*(\d{1,4})\b/i;

/** Si el título del directo ya dice «Minecraft extremo día 3», saca la serie y el día. */
export function detectSeries(title: string): SeriesInfo | null {
  const m = DAY_RE.exec(title.trim());
  if (!m) return null;
  const name = m[1].replace(/[\s\-–—:|,.·#]+$/g, '').replace(/\s+/g, ' ').trim();
  const day = Number(m[2]);
  if (name.length < 2 || !Number.isInteger(day) || day < 1) return null;
  return { name: name.slice(0, 60), day };
}

/** Qué serie y día toca para este directo: la del título si la trae, y si no la que el usuario tiene configurada. */
export function seriesFor(vodTitle: string, cfg: { name: string; nextDay: number }): (SeriesInfo & { fromTitle: boolean }) | null {
  const found = detectSeries(vodTitle);
  if (found) return { ...found, fromTitle: true };
  const name = cfg.name.trim();
  if (name) return { name: name.slice(0, 60), day: Math.max(1, Math.floor(cfg.nextDay) || 1), fromTitle: false };
  return null;
}

/** Títulos de los vídeos de un directo de una serie. */
export function seriesTitles(s: SeriesInfo, mains: number): { summary: string; mains: string[] } {
  const base = `${s.name} Día ${s.day}`;
  return {
    summary: `${base} - Resumen`,
    mains: Array.from({ length: mains }, (_, i) => (mains === 1 ? base : `${base} - Parte ${i + 1}`)),
  };
}
