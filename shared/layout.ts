/**
 * Composición del clip vertical (9:16): de 1 a 3 «ventanas». Cada ventana toma un rectángulo del fotograma
 * original (`src`) y lo coloca en un hueco del lienzo vertical (`dst`). Todas las coordenadas van de 0 a 1.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutWindow {
  src: Rect;
  dst: Rect;
}
export interface VerticalLayout {
  windows: LayoutWindow[];
  /** Disposición de partida elegida (solo informativa: lo que cuenta son los rectángulos). */
  preset?: string;
}

export const OUT_W = 1080;
export const OUT_H = 1920;
export const MAX_WINDOWS = 3;
export const MIN_SRC = 0.06; // tamaño mínimo de lo que se recoge del origen (fracción del fotograma)
export const MIN_DST = 0.1;
const EPS = 1e-6;

type Focus = 'cam' | 'game' | 'chat';
export interface Preset {
  id: string;
  label: string;
  count: 1 | 2 | 3;
  /** Qué suele haber en cada ventana, para colocar el recuadro de partida. */
  focus: Focus[];
  dst: Rect[];
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const PRESETS: Preset[] = [
  { id: 'una', label: 'Pantalla completa', count: 1, focus: ['game'], dst: [r(0, 0, 1, 1)] },
  { id: 'dos-camara-arriba', label: 'Cámara arriba', count: 2, focus: ['cam', 'game'], dst: [r(0, 0, 1, 0.35), r(0, 0.35, 1, 0.65)] },
  { id: 'dos-mitad', label: 'Mitad y mitad', count: 2, focus: ['cam', 'game'], dst: [r(0, 0, 1, 0.5), r(0, 0.5, 1, 0.5)] },
  { id: 'dos-juego-arriba', label: 'Juego arriba', count: 2, focus: ['game', 'cam'], dst: [r(0, 0, 1, 0.65), r(0, 0.65, 1, 0.35)] },
  { id: 'tres-franjas', label: 'Cámara, juego y chat', count: 3, focus: ['cam', 'game', 'chat'], dst: [r(0, 0, 1, 0.25), r(0, 0.25, 1, 0.5), r(0, 0.75, 1, 0.25)] },
  { id: 'tres-dos-arriba', label: 'Dos arriba y juego', count: 3, focus: ['cam', 'chat', 'game'], dst: [r(0, 0, 0.5, 0.3), r(0.5, 0, 0.5, 0.3), r(0, 0.3, 1, 0.7)] },
  { id: 'tres-dos-abajo', label: 'Juego y dos abajo', count: 3, focus: ['game', 'cam', 'chat'], dst: [r(0, 0, 1, 0.6), r(0, 0.6, 0.5, 0.4), r(0.5, 0.6, 0.5, 0.4)] },
];

export const presetsFor = (count: number): Preset[] => PRESETS.filter((p) => p.count === count);
export const findPreset = (id: string | undefined): Preset | undefined => PRESETS.find((p) => p.id === id);
export const defaultPreset = (count: number): Preset => presetsFor(count)[0] ?? PRESETS[0];

/** Punto de partida de cada tipo de ventana sobre un fotograma típico de directo (cámara arriba a la izquierda…). */
const FOCUS: Record<Focus, { cx: number; cy: number; h: number }> = {
  cam: { cx: 0.14, cy: 0.2, h: 0.36 },
  game: { cx: 0.5, cy: 0.5, h: 1 },
  chat: { cx: 0.1, cy: 0.72, h: 0.5 },
};

/**
 * Anchura (0..1 del fotograma) que debe tener un recuadro de origen para que, al llenar el hueco `dst`,
 * no se deforme ni se recorte: misma proporción en píxeles. `frameAspect` = ancho/alto del fotograma.
 */
export function srcWidthFor(dst: Rect, h: number, frameAspect: number): number {
  const dstAspect = (dst.w * OUT_W) / (dst.h * OUT_H);
  return (h * dstAspect) / frameAspect;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Recuadro con la proporción del hueco, centrado en (cx, cy) y con la altura pedida (reducida si no cabe). */
export function fitSrc(dst: Rect, cx: number, cy: number, h: number, frameAspect: number): Rect {
  const maxH = Math.min(1, 1 / (srcWidthFor(dst, 1, frameAspect) || 1));
  const hh = clamp(h, MIN_SRC, maxH);
  const ww = srcWidthFor(dst, hh, frameAspect);
  return { x: clamp(cx - ww / 2, 0, 1 - ww), y: clamp(cy - hh / 2, 0, 1 - hh), w: ww, h: hh };
}

/** Disposición de partida: el hueco de cada ventana y un recuadro de origen razonable. */
export function layoutFromPreset(preset: Preset, frameAspect: number): VerticalLayout {
  return {
    preset: preset.id,
    windows: preset.dst.map((dst, i) => {
      const f = FOCUS[preset.focus[i]];
      return { dst: { ...dst }, src: fitSrc(dst, f.cx, f.cy, f.h, frameAspect) };
    }),
  };
}

/** Cambia el hueco de las ventanas manteniendo lo que cada una estaba recogiendo (centro y alto). */
export function applyPresetKeeping(layout: VerticalLayout, preset: Preset, frameAspect: number): VerticalLayout {
  if (layout.windows.length !== preset.count) return layoutFromPreset(preset, frameAspect);
  return {
    preset: preset.id,
    windows: preset.dst.map((dst, i) => {
      const s = layout.windows[i].src;
      return { dst: { ...dst }, src: fitSrc(dst, s.x + s.w / 2, s.y + s.h / 2, s.h, frameAspect) };
    }),
  };
}

/** Mueve un recuadro sin salirse del fotograma. */
export function moveSrc(src: Rect, dx: number, dy: number): Rect {
  return { ...src, x: clamp(src.x + dx, 0, 1 - src.w), y: clamp(src.y + dy, 0, 1 - src.h) };
}

/** Cambia el tamaño manteniendo la proporción y la esquina superior izquierda fija (o el centro si no cabe). */
export function resizeSrc(src: Rect, dst: Rect, newH: number, frameAspect: number): Rect {
  const cx = src.x + src.w / 2;
  const cy = src.y + src.h / 2;
  return fitSrc(dst, cx, cy, newH, frameAspect);
}

/** Equivalente de un encuadre antiguo (`cropX`): una sola ventana a pantalla completa. */
export function layoutFromCropX(cropX: number, frameAspect: number): VerticalLayout {
  const dst = r(0, 0, 1, 1);
  const h = 1;
  const w = srcWidthFor(dst, h, frameAspect);
  const x = (1 - Math.min(1, w)) * clamp(cropX, 0, 1);
  return { preset: 'una', windows: [{ dst, src: { x, y: 0, w: Math.min(1, w), h } }] };
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function rectReason(rc: unknown, min: number, what: string): string | null {
  if (!rc || typeof rc !== 'object') return `${what} no es un rectángulo`;
  const { x, y, w, h } = rc as Rect;
  if (![x, y, w, h].every(isNum)) return `${what} tiene valores que no son números`;
  if (x < -EPS || y < -EPS || x + w > 1 + EPS || y + h > 1 + EPS) return `${what} se sale del fotograma`;
  if (w < min - EPS || h < min - EPS) return `${what} es demasiado pequeño`;
  return null;
}

/** Motivo por el que una composición no vale, o null. */
export function validateLayout(l: unknown): string | null {
  if (!l || typeof l !== 'object' || !Array.isArray((l as VerticalLayout).windows)) return 'la composición vertical no es válida';
  const ws = (l as VerticalLayout).windows;
  if (ws.length < 1 || ws.length > MAX_WINDOWS) return `la composición vertical lleva de 1 a ${MAX_WINDOWS} ventanas`;
  for (const [i, w] of ws.entries()) {
    const a = rectReason(w?.src, MIN_SRC, `el recuadro de la ventana ${i + 1}`);
    if (a) return a;
    const b = rectReason(w?.dst, MIN_DST, `el hueco de la ventana ${i + 1}`);
    if (b) return b;
  }
  return null;
}

/** Copia limpia (solo los campos conocidos, redondeados) para guardarla. */
export function normalizeLayout(l: VerticalLayout): VerticalLayout {
  const q = (n: number) => Math.round(n * 10000) / 10000;
  const nr = (rc: Rect): Rect => ({ x: q(clamp(rc.x, 0, 1)), y: q(clamp(rc.y, 0, 1)), w: q(rc.w), h: q(rc.h) });
  return { ...(l.preset ? { preset: l.preset } : {}), windows: l.windows.map((w) => ({ src: nr(w.src), dst: nr(w.dst) })) };
}

/** Rectángulo en píxeles del lienzo de salida, con bordes pares y sin huecos entre ventanas contiguas. */
export function dstPixels(dst: Rect): { x: number; y: number; w: number; h: number } {
  const ev = (n: number) => Math.round(n / 2) * 2;
  const x0 = ev(dst.x * OUT_W);
  const y0 = ev(dst.y * OUT_H);
  const x1 = ev((dst.x + dst.w) * OUT_W);
  const y1 = ev((dst.y + dst.h) * OUT_H);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Cambia el tamaño arrastrando la esquina inferior derecha: la esquina superior izquierda no se mueve, la proporción
 * se conserva y el recuadro no se sale del fotograma. (px, py) es la posición del puntero (0..1 del fotograma).
 */
export function resizeFromCorner(src: Rect, dst: Rect, px: number, py: number, frameAspect: number): Rect {
  const w1 = srcWidthFor(dst, 1, frameAspect) || 1; // anchura que corresponde a altura 1
  const wanted = Math.max(py - src.y, (px - src.x) / w1);
  const maxH = Math.max(MIN_SRC, Math.min(1 - src.y, (1 - src.x) / w1));
  const h = clamp(wanted, MIN_SRC, maxH);
  return { x: src.x, y: src.y, w: h * w1, h };
}
