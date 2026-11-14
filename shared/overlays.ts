import { assColor, assEscape } from './subtitles';
import type { TitleKind } from './types';

/** Un rótulo ya en el tiempo del vídeo resultante. */
export interface Overlay {
  start: number;
  end: number;
  text: string;
  kind: TitleKind;
}

const assTime = (s: number): string => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

/**
 * Rótulos en pantalla como los de los canales grandes, en un archivo ASS aparte de los subtítulos:
 *  - capitulo: cartela abajo a la izquierda con fondo, al empezar cada capítulo;
 *  - frase: una frase clave grande arriba en el centro;
 *  - gancho: aviso del arranque («LO QUE PASÓ…»), arriba, en mayúsculas y color vivo.
 * Entran y salen con fundido. Nunca se solapan: si dos coinciden, el segundo empieza cuando acaba el primero.
 */
export function buildOverlayAss(items: Overlay[], w: number, h: number, fontFamily = 'Inter'): string {
  const base = Math.round(Math.min(w, h) * 0.05);
  const marginH = Math.round(w * 0.05);
  const style = (name: string, size: number, color: string, outline: string, box: boolean, align: number, marginV: number) =>
    `Style: ${name},${fontFamily},${size},${assColor(color)},${assColor(color)},${box ? assColor(outline, 0.75) : assColor(outline)},${assColor('#000000', 0.5)},-1,0,0,0,100,100,0,0,${box ? 3 : 1},${box ? Math.round(size * 0.35) : Math.max(2, Math.round(size * 0.09))},0,${align},${marginH},${marginH},${marginV},1`;
  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Capitulo', Math.round(base * 1.1), '#FFFFFF', '#111111', true, 1, Math.round(h * 0.12)),
    style('Frase', Math.round(base * 1.25), '#FFFFFF', '#000000', false, 8, Math.round(h * 0.08)),
    style('Gancho', Math.round(base * 1.2), '#FFE14D', '#000000', false, 8, Math.round(h * 0.08)),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const sorted = [...items].filter((o) => o.text.trim() && o.end > o.start).sort((a, b) => a.start - b.start);
  let lastEnd = -1;
  for (const o of sorted) {
    const start = Math.max(o.start, lastEnd);
    const end = Math.max(start + 0.5, o.end);
    lastEnd = end;
    const styleName = o.kind === 'capitulo' ? 'Capitulo' : o.kind === 'gancho' ? 'Gancho' : 'Frase';
    const text = assEscape(o.kind === 'gancho' ? o.text.toLocaleUpperCase('es') : o.text);
    lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},${styleName},,0,0,0,,{\\fad(200,300)}${text}`);
  }
  return `${lines.join('\n')}\n`;
}
