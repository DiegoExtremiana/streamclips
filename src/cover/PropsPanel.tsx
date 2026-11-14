import { useRef } from 'react';
import { FONT_CHOICES, NO_ADJUST, type CoverFont, type ImageLayer, type Layer, type RectLayer, type TextLayer } from '../../shared/coverDesign';
import { MAX_FONT_BYTES } from '../../shared/coverDesign';
import { errMsg, notify } from '../lib';

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; onBegin: () => void }) {
  return (
    <label className="cve-field">
      <span className="small">{props.label} <span className="muted">{Math.round(props.value * 10) / 10}{props.unit ?? ''}</span></span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} aria-label={props.label} onPointerDown={props.onBegin} onKeyDown={props.onBegin} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

/** Propiedades de la capa elegida: cambian según sea imagen, texto o rectángulo. */
export default function PropsPanel(props: {
  layer: Layer | null;
  fonts: CoverFont[];
  onBegin: () => void;
  onPatch: (patch: (l: Layer) => Layer) => void;
  onFontsChanged: () => void;
}) {
  const { layer: l, onBegin } = props;
  const fontInput = useRef<HTMLInputElement>(null);
  if (!l) return <div className="muted small cve-empty">Elige una capa en el lienzo o en la lista para cambiar su aspecto.</div>;
  const set = <T extends Layer>(p: Partial<T>) => props.onPatch((x) => ({ ...x, ...p }) as Layer);
  const common = (
    <>
      <label className="cve-field">
        <span className="small">Nombre de la capa</span>
        <input type="text" value={l.name} maxLength={40} onFocus={onBegin} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <Slider label="Opacidad" value={Math.round(l.opacity * 100)} min={0} max={100} unit=" %" onBegin={onBegin} onChange={(v) => set({ opacity: v / 100 })} />
      <Slider label="Giro" value={l.rotation} min={-180} max={180} unit="°" onBegin={onBegin} onChange={(v) => set({ rotation: v })} />
    </>
  );

  if (l.type === 'text') {
    const t: TextLayer = l;
    const allFonts = [...FONT_CHOICES, ...props.fonts.map((f) => f.name)];
    async function addFont(file: File | undefined) {
      if (!file) return;
      try {
        if (file.size > MAX_FONT_BYTES) throw new Error(`«${file.name}» pesa más de ${Math.round(MAX_FONT_BYTES / 1048576)} MB.`);
        const f = await window.api.fontsAdd(file.name, new Uint8Array(await file.arrayBuffer()));
        props.onFontsChanged();
        set<TextLayer>({ font: f.name });
        notify(`Tipografía «${f.name}» añadida.`);
      } catch (e) {
        notify(errMsg(e), 'bad');
      }
    }
    return (
      <div className="cve-props" data-testid="cover-props-text">
        <label className="cve-field">
          <span className="small">Texto</span>
          <textarea aria-label="Texto de la capa" rows={2} value={t.text} maxLength={200} onFocus={onBegin} onChange={(e) => set<TextLayer>({ text: e.target.value })} />
        </label>
        <label className="cve-field">
          <span className="small">Tipografía</span>
          <select aria-label="Tipografía" value={t.font} onChange={(e) => { onBegin(); set<TextLayer>({ font: e.target.value }); }}>
            {!allFonts.includes(t.font) && <option value={t.font}>{t.font}</option>}
            {allFonts.map((f) => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}
          </select>
        </label>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost small" onClick={() => fontInput.current?.click()}>Subir tipografía…</button>
          <input ref={fontInput} type="file" hidden accept=".ttf,.otf,.woff,.woff2" data-testid="cover-font-input" onChange={(e) => { void addFont(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <Slider label="Tamaño" value={t.size} min={16} max={400} unit=" px" onBegin={onBegin} onChange={(v) => set<TextLayer>({ size: v })} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`chip ${t.bold ? 'on' : ''}`} aria-pressed={t.bold} onClick={() => { onBegin(); set<TextLayer>({ bold: !t.bold }); }}><b>N</b></button>
          <button className={`chip ${t.italic ? 'on' : ''}`} aria-pressed={t.italic} onClick={() => { onBegin(); set<TextLayer>({ italic: !t.italic }); }}><i>K</i></button>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={`chip ${t.align === a ? 'on' : ''}`} aria-pressed={t.align === a} onClick={() => { onBegin(); set<TextLayer>({ align: a }); }}>{a === 'left' ? 'Izq.' : a === 'center' ? 'Centro' : 'Der.'}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <label className="cve-field"><span className="small">Color</span><input type="color" aria-label="Color del texto" value={t.color} onFocus={onBegin} onChange={(e) => set<TextLayer>({ color: e.target.value })} /></label>
          <label className="cve-field"><span className="small">Contorno</span><input type="color" aria-label="Color del contorno" value={t.strokeColor} onFocus={onBegin} onChange={(e) => set<TextLayer>({ strokeColor: e.target.value })} /></label>
        </div>
        <Slider label="Grosor del contorno" value={t.strokeWidth} min={0} max={60} unit=" px" onBegin={onBegin} onChange={(v) => set<TextLayer>({ strokeWidth: v })} />
        <label className="opt"><input type="checkbox" checked={t.shadow} onChange={(e) => { onBegin(); set<TextLayer>({ shadow: e.target.checked }); }} /><span><strong>Sombra</strong></span></label>
        {common}
      </div>
    );
  }

  if (l.type === 'rect') {
    const r: RectLayer = l;
    return (
      <div className="cve-props" data-testid="cover-props-rect">
        <label className="cve-field"><span className="small">Color</span><input type="color" aria-label="Color del rectángulo" value={r.color} onFocus={onBegin} onChange={(e) => set<RectLayer>({ color: e.target.value })} /></label>
        <Slider label="Ancho" value={r.w} min={8} max={2000} unit=" px" onBegin={onBegin} onChange={(v) => set<RectLayer>({ w: v })} />
        <Slider label="Alto" value={r.h} min={8} max={1200} unit=" px" onBegin={onBegin} onChange={(v) => set<RectLayer>({ h: v })} />
        <Slider label="Esquinas redondeadas" value={r.radius} min={0} max={200} unit=" px" onBegin={onBegin} onChange={(v) => set<RectLayer>({ radius: v })} />
        {common}
      </div>
    );
  }

  const im: ImageLayer = l;
  const adj = (p: Partial<ImageLayer['adjust']>) => set<ImageLayer>({ adjust: { ...im.adjust, ...p } });
  return (
    <div className="cve-props" data-testid="cover-props-image">
      <Slider label="Brillo" value={im.adjust.brightness} min={0} max={200} unit=" %" onBegin={onBegin} onChange={(v) => adj({ brightness: v })} />
      <Slider label="Contraste" value={im.adjust.contrast} min={0} max={200} unit=" %" onBegin={onBegin} onChange={(v) => adj({ contrast: v })} />
      <Slider label="Saturación" value={im.adjust.saturation} min={0} max={250} unit=" %" onBegin={onBegin} onChange={(v) => adj({ saturation: v })} />
      <Slider label="Desenfoque" value={im.adjust.blur} min={0} max={30} unit=" px" onBegin={onBegin} onChange={(v) => adj({ blur: v })} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className={`chip ${im.flipX ? 'on' : ''}`} aria-pressed={im.flipX} onClick={() => { onBegin(); set<ImageLayer>({ flipX: !im.flipX }); }}>Voltear</button>
        <button className="chip" onClick={() => { onBegin(); set<ImageLayer>({ adjust: { ...NO_ADJUST } }); }}>Quitar ajustes</button>
      </div>
      {common}
    </div>
  );
}
