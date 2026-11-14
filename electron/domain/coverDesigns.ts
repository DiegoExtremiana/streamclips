import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DESIGN_NAME_MAX, MAX_FONT_BYTES, isFontExt, normalizeDesign, type CoverFont, type DesignRecord } from '../../shared/coverDesign';
import { cleanAssetName, extOf } from '../../shared/covers';
import type { CoverService } from './covers';

/**
 * Diseños de portada guardados (para seguir editándolos) y tipografías propias. Cada vez que se guarda un diseño, su imagen
 * final (PNG 1280×720) entra en la biblioteca de portadas y sustituye a la versión anterior de ese mismo diseño.
 */
export class CoverDesignService {
  private designs: DesignRecord[] = [];
  private fonts: CoverFont[] = [];

  constructor(private readonly dir: string, private readonly covers: CoverService, private readonly now: () => number = Date.now) {
    try {
      const j = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as unknown;
      if (Array.isArray(j)) {
        this.designs = j
          .filter((x): x is DesignRecord => !!x && typeof x.id === 'string' && /^[a-f0-9]{12}$/.test(x.id) && typeof x.name === 'string')
          .map((x) => ({ id: x.id, name: x.name.slice(0, DESIGN_NAME_MAX), updatedAt: Number(x.updatedAt) || 0, assetId: typeof x.assetId === 'string' ? x.assetId : null, design: normalizeDesign(x.design) }));
      }
    } catch {
      /* sin diseños */
    }
    try {
      const f = JSON.parse(fs.readFileSync(this.fontsFile(), 'utf8')) as unknown;
      if (Array.isArray(f)) this.fonts = f.filter((x): x is CoverFont => !!x && typeof x.id === 'string' && /^[a-f0-9]{12}$/.test(x.id) && typeof x.name === 'string' && isFontExt(String(x.ext)));
    } catch {
      /* sin tipografías */
    }
  }

  private file = () => path.join(this.dir, 'designs.json');
  private fontsFile = () => path.join(this.dir, 'fonts.json');
  private fontPath = (f: CoverFont) => path.join(this.dir, 'fonts', `${f.id}${f.ext}`);
  private write(file: string, data: unknown): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  list(): DesignRecord[] {
    return [...this.designs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Guarda (o actualiza) un diseño y su imagen final. */
  save(input: { id?: string | null; name: string; design: unknown; png: Buffer }): DesignRecord {
    const existing = input.id ? this.designs.find((d) => d.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Ese diseño ya no existe.');
    const name = cleanAssetName(input.name || 'Portada').slice(0, DESIGN_NAME_MAX);
    const asset = this.covers.addCover(name, input.png, existing?.assetId);
    const rec: DesignRecord = { id: existing?.id ?? crypto.randomBytes(6).toString('hex'), name, updatedAt: this.now(), assetId: asset.id, design: normalizeDesign(input.design) };
    this.designs = existing ? this.designs.map((d) => (d.id === rec.id ? rec : d)) : [...this.designs, rec];
    this.write(this.file(), this.designs);
    return rec;
  }

  remove(id: string, alsoImage: boolean): void {
    const d = this.designs.find((x) => x.id === id);
    if (!d) throw new Error('Ese diseño ya no existe.');
    if (alsoImage && d.assetId) {
      try {
        this.covers.remove(d.assetId);
      } catch {
        /* la imagen ya no estaba */
      }
    }
    this.designs = this.designs.filter((x) => x.id !== id);
    this.write(this.file(), this.designs);
  }

  fontList(): CoverFont[] {
    return [...this.fonts];
  }

  fontAdd(fileName: string, data: Buffer): CoverFont {
    const ext = extOf(fileName);
    if (!isFontExt(ext)) throw new Error(`«${fileName}»: solo se admiten tipografías TTF, OTF, WOFF y WOFF2.`);
    if (data.length === 0) throw new Error(`«${fileName}» está vacío.`);
    if (data.length > MAX_FONT_BYTES) throw new Error(`«${fileName}» pesa más de ${Math.round(MAX_FONT_BYTES / 1048576)} MB.`);
    const base = cleanAssetName(fileName).replace(/_/g, ' ');
    let name = base;
    for (let i = 2; this.fonts.some((f) => f.name.toLowerCase() === name.toLowerCase()); i++) name = `${base} ${i}`;
    const font: CoverFont = { id: crypto.randomBytes(6).toString('hex'), name, ext, bytes: data.length };
    fs.mkdirSync(path.join(this.dir, 'fonts'), { recursive: true });
    fs.writeFileSync(this.fontPath(font), data);
    this.fonts.push(font);
    this.write(this.fontsFile(), this.fonts);
    return font;
  }

  fontRemove(id: string): void {
    const f = this.fonts.find((x) => x.id === id);
    if (!f) throw new Error('Esa tipografía ya no está.');
    fs.rmSync(this.fontPath(f), { force: true });
    this.fonts = this.fonts.filter((x) => x.id !== id);
    this.write(this.fontsFile(), this.fonts);
  }

  /** El archivo de la tipografía en base64 (la pantalla la registra con FontFace). */
  fontData(id: string): string {
    const f = this.fonts.find((x) => x.id === id);
    if (!f) throw new Error('Esa tipografía ya no está.');
    return fs.readFileSync(this.fontPath(f)).toString('base64');
  }
}
