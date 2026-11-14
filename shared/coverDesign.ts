/**
 * Diseño de una portada: un lienzo de 1280×720 con capas (imágenes de tu biblioteca, textos con tipografía y rectángulos),
 * como un Photoshop pequeño. Es solo datos (JSON); dibujarlo y editarlo es cosa de la pantalla, y aquí se limpia lo que
 * llega de disco para que un archivo roto o viejo nunca rompa el editor.
 */
export const COVER_W = 1280;
export const COVER_H = 720;
export const MAX_LAYERS = 40;
export const MAX_TEXT_CHARS = 200;
export const DESIGN_NAME_MAX = 40;

export interface Adjust {
  /** Porcentajes (100 = sin cambio). */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Desenfoque en píxeles. */
  blur: number;
}
export const NO_ADJUST: Adjust = { brightness: 100, contrast: 100, saturation: 100, blur: 0 };

interface Base {
  id: string;
  name: string;
  /** Centro de la capa en el lienzo (píxeles). */
  x: number;
  y: number;
  /** Grados. */
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}
export interface ImageLayer extends Base {
  type: 'image';
  assetId: string;
  w: number;
  h: number;
  flipX: boolean;
  adjust: Adjust;
}
export interface TextLayer extends Base {
  type: 'text';
  text: string;
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
}
export interface RectLayer extends Base {
  type: 'rect';
  w: number;
  h: number;
  color: string;
  radius: number;
}
export type Layer = ImageLayer | TextLayer | RectLayer;

export interface Design {
  v: 1;
  background: string;
  layers: Layer[];
}

export const FONT_CHOICES = ['Impact', 'Arial Black', 'Bahnschrift', 'Segoe UI', 'Trebuchet MS', 'Verdana', 'Georgia', 'Comic Sans MS', 'Courier New'];

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
};
const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.slice(0, max) : fallback);
const color = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

let counter = 0;
export const newLayerId = (): string => `l${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const emptyDesign = (): Design => ({ v: 1, background: '#14101f', layers: [] });

/** Tamaño con el que entra una imagen nueva: cabe entera en el lienzo (como mucho al 80 %) y no se agranda más que él. */
export function fitSize(natW: number, natH: number, cover = false): { w: number; h: number } {
  const w0 = Math.max(1, natW);
  const h0 = Math.max(1, natH);
  const k = cover ? Math.max(COVER_W / w0, COVER_H / h0) : Math.min((COVER_W * 0.8) / w0, (COVER_H * 0.8) / h0, 1.5);
  return { w: Math.round(w0 * k), h: Math.round(h0 * k) };
}

export function newImageLayer(assetId: string, name: string, natW: number, natH: number, cover = false): ImageLayer {
  const { w, h } = fitSize(natW, natH, cover);
  return { id: newLayerId(), type: 'image', name, assetId, x: COVER_W / 2, y: COVER_H / 2, w, h, rotation: 0, opacity: 1, visible: true, locked: false, flipX: false, adjust: { ...NO_ADJUST } };
}

export function newTextLayer(text = 'TEXTO'): TextLayer {
  return {
    id: newLayerId(), type: 'text', name: 'Texto', text, font: 'Impact', size: 160, bold: false, italic: false, color: '#ffffff', align: 'center',
    strokeColor: '#000000', strokeWidth: 10, shadow: true, x: COVER_W / 2, y: COVER_H / 2, rotation: 0, opacity: 1, visible: true, locked: false,
  };
}

export function newRectLayer(): RectLayer {
  return { id: newLayerId(), type: 'rect', name: 'Rectángulo', color: '#7c5cff', radius: 0, w: 480, h: 160, x: COVER_W / 2, y: COVER_H / 2, rotation: 0, opacity: 1, visible: true, locked: false };
}

function base(r: Record<string, unknown>, fallbackName: string): Base {
  return {
    id: str(r.id, 40) || newLayerId(),
    name: str(r.name, 40, fallbackName) || fallbackName,
    x: clamp(r.x, -COVER_W, COVER_W * 2, COVER_W / 2),
    y: clamp(r.y, -COVER_H, COVER_H * 2, COVER_H / 2),
    rotation: clamp(r.rotation, -360, 360, 0),
    opacity: clamp(r.opacity, 0, 1, 1),
    visible: bool(r.visible, true),
    locked: bool(r.locked, false),
  };
}

/** Limpia un diseño leído de disco o recibido de la pantalla: lo que falte o venga mal se arregla o se descarta. */
export function normalizeDesign(raw: unknown): Design {
  const out = emptyDesign();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.background = color(r.background, out.background);
  if (!Array.isArray(r.layers)) return out;
  const seen = new Set<string>();
  for (const item of r.layers.slice(0, MAX_LAYERS)) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const b = base(l, 'Capa');
    if (seen.has(b.id)) b.id = newLayerId();
    seen.add(b.id);
    if (l.type === 'image' && typeof l.assetId === 'string' && /^[a-f0-9]{12}$/.test(l.assetId)) {
      const a = (l.adjust && typeof l.adjust === 'object' ? l.adjust : {}) as Record<string, unknown>;
      out.layers.push({
        ...b, type: 'image', name: str(l.name, 40, 'Imagen') || 'Imagen', assetId: l.assetId,
        w: clamp(l.w, 8, COVER_W * 4, 400), h: clamp(l.h, 8, COVER_H * 4, 400), flipX: bool(l.flipX, false),
        adjust: { brightness: clamp(a.brightness, 0, 250, 100), contrast: clamp(a.contrast, 0, 250, 100), saturation: clamp(a.saturation, 0, 300, 100), blur: clamp(a.blur, 0, 40, 0) },
      });
    } else if (l.type === 'text') {
      out.layers.push({
        ...b, type: 'text', name: str(l.name, 40, 'Texto') || 'Texto', text: str(l.text, MAX_TEXT_CHARS, 'TEXTO'), font: str(l.font, 80, 'Impact') || 'Impact',
        size: clamp(l.size, 8, 600, 160), bold: bool(l.bold, false), italic: bool(l.italic, false), color: color(l.color, '#ffffff'),
        align: l.align === 'left' || l.align === 'right' ? l.align : 'center', strokeColor: color(l.strokeColor, '#000000'), strokeWidth: clamp(l.strokeWidth, 0, 60, 0), shadow: bool(l.shadow, false),
      });
    } else if (l.type === 'rect') {
      out.layers.push({ ...b, type: 'rect', name: str(l.name, 40, 'Rectángulo') || 'Rectángulo', color: color(l.color, '#7c5cff'), radius: clamp(l.radius, 0, 400, 0), w: clamp(l.w, 4, COVER_W * 4, 400), h: clamp(l.h, 4, COVER_H * 4, 120) });
    }
  }
  return out;
}

/** Sube (+1) o baja (-1) una capa en el orden de dibujo (la última es la de arriba). */
export function reorder(layers: Layer[], id: string, dir: 1 | -1): Layer[] {
  const i = layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layers.length) return layers;
  const next = [...layers];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** ¿El punto (px,py) del lienzo cae dentro de la capa (con su giro)? `box` da el tamaño de los textos, que depende de la tipografía. */
export function hit(l: Layer, px: number, py: number, box?: { w: number; h: number }): boolean {
  const w = l.type === 'text' ? (box?.w ?? l.size * Math.max(1, l.text.length) * 0.55) : l.w;
  const h = l.type === 'text' ? (box?.h ?? l.size * 1.2) : l.h;
  const a = (-l.rotation * Math.PI) / 180;
  const dx = px - l.x;
  const dy = py - l.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/** Historial para deshacer y rehacer: guarda estados completos (los diseños son pequeños). */
export interface History {
  past: Design[];
  future: Design[];
}
export const HISTORY_MAX = 60;
export const emptyHistory = (): History => ({ past: [], future: [] });
export function pushState(h: History, current: Design): History {
  return { past: [...h.past, current].slice(-HISTORY_MAX), future: [] };
}
export function undo(h: History, current: Design): { history: History; design: Design } | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, design: prev };
}
export function redo(h: History, current: Design): { history: History; design: Design } | null {
  const next = h.future[0];
  if (!next) return null;
  return { history: { past: [...h.past, current], future: h.future.slice(1) }, design: next };
}

export interface DesignRecord {
  id: string;
  name: string;
  updatedAt: number;
  /** Portada (PNG) que se guardó en la biblioteca con la última versión del diseño. */
  assetId: string | null;
  design: Design;
}

export const FONT_EXT = ['.ttf', '.otf', '.woff', '.woff2'] as const;
export const MAX_FONT_BYTES = 8 * 1024 * 1024;
export interface CoverFont {
  id: string;
  /** Nombre con el que se elige en el editor (el del archivo, limpio). */
  name: string;
  ext: string;
  bytes: number;
}
export const isFontExt = (ext: string): boolean => (FONT_EXT as readonly string[]).includes(ext.toLowerCase());
