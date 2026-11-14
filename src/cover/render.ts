import { COVER_H, COVER_W, type Design, type ImageLayer, type Layer, type TextLayer } from '../../shared/coverDesign';

export type ImageMap = Map<string, HTMLImageElement>;

export const fontCss = (l: TextLayer): string => `${l.italic ? 'italic ' : ''}${l.bold ? 'bold ' : ''}${l.size}px "${l.font}", sans-serif`;
const lineHeight = (l: TextLayer) => l.size * 1.12;

/** Tamaño que ocupa un texto con su tipografía (para el marco de selección y para acertar al hacer clic). */
export function textBox(ctx: CanvasRenderingContext2D, l: TextLayer): { w: number; h: number; lines: string[] } {
  const lines = l.text.split('\n');
  ctx.save();
  ctx.font = fontCss(l);
  const w = Math.max(8, ...lines.map((t) => ctx.measureText(t).width)) + l.strokeWidth;
  ctx.restore();
  return { w, h: lines.length * lineHeight(l) + l.strokeWidth, lines };
}

const filterOf = (a: ImageLayer['adjust']): string => {
  const parts: string[] = [];
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
  if (a.saturation !== 100) parts.push(`saturate(${a.saturation}%)`);
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
  return parts.length ? parts.join(' ') : 'none';
};

function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, imgs: ImageMap): void {
  if (!l.visible) return;
  ctx.save();
  ctx.globalAlpha = l.opacity;
  ctx.translate(l.x, l.y);
  ctx.rotate((l.rotation * Math.PI) / 180);
  if (l.type === 'rect') {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.roundRect(-l.w / 2, -l.h / 2, l.w, l.h, Math.min(l.radius, l.w / 2, l.h / 2));
    ctx.fill();
  } else if (l.type === 'image') {
    const img = imgs.get(l.assetId);
    if (img && img.complete && img.naturalWidth) {
      if (l.flipX) ctx.scale(-1, 1);
      ctx.filter = filterOf(l.adjust);
      ctx.drawImage(img, -l.w / 2, -l.h / 2, l.w, l.h);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(-l.w / 2, -l.h / 2, l.w, l.h);
    }
  } else {
    const { w, lines } = textBox(ctx, l);
    ctx.font = fontCss(l);
    ctx.textBaseline = 'middle';
    ctx.textAlign = l.align;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const x = l.align === 'left' ? -w / 2 + l.strokeWidth / 2 : l.align === 'right' ? w / 2 - l.strokeWidth / 2 : 0;
    const top = (-lines.length * lineHeight(l)) / 2 + lineHeight(l) / 2;
    lines.forEach((t, i) => {
      const y = top + i * lineHeight(l);
      if (l.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,.65)';
        ctx.shadowBlur = l.size * 0.08;
        ctx.shadowOffsetY = l.size * 0.04;
      }
      if (l.strokeWidth > 0) {
        ctx.lineWidth = l.strokeWidth;
        ctx.strokeStyle = l.strokeColor;
        ctx.strokeText(t, x, y);
      }
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = l.color;
      ctx.fillText(t, x, y);
    });
  }
  ctx.restore();
}

/** Dibuja el diseño entero (fondo y capas de abajo arriba) en un lienzo de 1280×720. */
export function drawDesign(ctx: CanvasRenderingContext2D, d: Design, imgs: ImageMap): void {
  ctx.save();
  ctx.clearRect(0, 0, COVER_W, COVER_H);
  ctx.fillStyle = d.background;
  ctx.fillRect(0, 0, COVER_W, COVER_H);
  for (const l of d.layers) drawLayer(ctx, l, imgs);
  ctx.restore();
}

/** Carga la imagen de una pieza (a buen tamaño) para dibujarla. */
export function loadPiece(assetId: string): Promise<HTMLImageElement | null> {
  return window.api
    .coversFull(assetId)
    .then(
      (src) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          if (!src) return resolve(null);
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        }),
    )
    .catch(() => null);
}

/** Registra las tipografías propias en la pantalla para poder usarlas en el lienzo. */
export async function registerFonts(fonts: { id: string; name: string; ext: string }[], done: Set<string>): Promise<void> {
  for (const f of fonts) {
    if (done.has(f.id)) continue;
    try {
      const b64 = await window.api.fontsData(f.id);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const face = new FontFace(f.name, bytes.buffer);
      await face.load();
      document.fonts.add(face);
      done.add(f.id);
    } catch {
      /* tipografía dañada: se ignora */
    }
  }
}
