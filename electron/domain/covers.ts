import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { COVER_GRADE, COVER_H, COVER_W, buildCoverAss } from '../../shared/thumbStyle';
import {
  MAX_ASSET_BYTES,
  cleanAssetName,
  cleanPhrase,
  extOf,
  guessKind,
  isAssetKind,
  isDocExt,
  isImageExt,
  uniqueName,
  type AssetKind,
  type ComposeOpts,
  type CoverAsset,
} from '../../shared/covers';
import { filterPath } from '../services/ffmpeg';
import { run, type ToolPaths } from '../services/tools';

export interface CoverDeps {
  /** Carpeta propia de las portadas (index.json, files y thumbs). */
  dir: string;
  tools: () => ToolPaths;
  fontsDir?: string;
  now?: () => number;
}

/**
 * La biblioteca de piezas de portada. Las piezas se guardan tal cual en `files`; las miniaturas se generan al pedirlas.
 * Las portadas que compone el programa entran en la misma biblioteca (tipo «portada»), para renombrarlas o borrarlas igual.
 */
export class CoverService {
  private items: CoverAsset[] = [];
  private readonly now: () => number;

  constructor(private readonly d: CoverDeps) {
    this.now = d.now ?? Date.now;
    try {
      const j = JSON.parse(fs.readFileSync(this.indexFile(), 'utf8')) as unknown;
      if (Array.isArray(j)) this.items = j.filter((x): x is CoverAsset => !!x && typeof x.id === 'string' && typeof x.name === 'string' && isAssetKind(x.kind) && /^[a-f0-9]{12}$/.test(x.id));
    } catch {
      /* biblioteca vacía */
    }
  }

  private indexFile = () => path.join(this.d.dir, 'index.json');
  private fileOf = (a: CoverAsset) => path.join(this.d.dir, 'files', `${a.id}${a.ext}`);
  private thumbOf = (a: CoverAsset) => path.join(this.d.dir, 'thumbs', `${a.id}.png`);

  private save(): void {
    fs.mkdirSync(this.d.dir, { recursive: true });
    const tmp = `${this.indexFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items));
    fs.renameSync(tmp, this.indexFile());
  }

  private get(id: string): CoverAsset {
    const a = this.items.find((x) => x.id === id);
    if (!a) throw new Error('Esa pieza ya no está en la biblioteca.');
    return a;
  }

  list(): CoverAsset[] {
    return [...this.items].sort((a, b) => b.addedAt - a.addedAt);
  }

  /** Ruta del archivo de una pieza (para abrirla o enseñarla en su carpeta). */
  filePath(id: string): string {
    return this.fileOf(this.get(id));
  }

  private insert(fileName: string, data: Buffer, kind: AssetKind, name?: string): CoverAsset {
    const ext = extOf(fileName);
    if (!isImageExt(ext) && !isDocExt(ext)) throw new Error(`«${fileName}»: solo se admiten imágenes (PNG, JPG, WEBP, GIF) y documentos (PDF, TXT, MD, DOC, DOCX, ODT).`);
    if (data.length === 0) throw new Error(`«${fileName}» está vacío.`);
    if (data.length > MAX_ASSET_BYTES) throw new Error(`«${fileName}» pesa más de ${Math.round(MAX_ASSET_BYTES / 1048576)} MB.`);
    const asset: CoverAsset = {
      id: crypto.randomBytes(6).toString('hex'),
      name: uniqueName(cleanAssetName(name ?? fileName), this.items.map((x) => x.name)),
      kind: isDocExt(ext) ? 'documento' : kind,
      ext,
      bytes: data.length,
      addedAt: this.now(),
      isImage: isImageExt(ext),
    };
    fs.mkdirSync(path.join(this.d.dir, 'files'), { recursive: true });
    fs.writeFileSync(this.fileOf(asset), data);
    this.items.push(asset);
    this.save();
    return asset;
  }

  /** Añade un archivo soltado o elegido por el usuario. */
  add(fileName: string, data: Buffer): CoverAsset {
    return this.insert(fileName, data, guessKind(fileName));
  }

  rename(id: string, name: string): CoverAsset {
    const a = this.get(id);
    const clean = cleanAssetName(name);
    a.name = uniqueName(clean, this.items.filter((x) => x.id !== id).map((x) => x.name));
    this.save();
    return a;
  }

  setKind(id: string, kind: unknown): CoverAsset {
    const a = this.get(id);
    if (!isAssetKind(kind)) throw new Error('Ese tipo no es válido.');
    if (!a.isImage && kind !== 'documento') throw new Error('Un documento no puede ser una imagen.');
    if (a.isImage && kind === 'documento') throw new Error('Una imagen no puede ser un documento.');
    a.kind = kind;
    this.save();
    return a;
  }

  remove(id: string): void {
    const a = this.get(id);
    fs.rmSync(this.fileOf(a), { force: true });
    fs.rmSync(this.thumbOf(a), { force: true });
    this.items = this.items.filter((x) => x.id !== id);
    this.save();
  }

  /** Miniatura (data URL PNG de hasta 480 px) para la pantalla; null si es un documento o no se pudo leer. */
  async preview(id: string): Promise<string | null> {
    const a = this.get(id);
    if (!a.isImage) return null;
    const out = this.thumbOf(a);
    try {
      if (!fs.existsSync(out)) {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await run(this.d.tools().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', this.fileOf(a), '-frames:v', '1', '-vf', 'scale=480:-2', out], 30_000);
      }
      return `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** Compone una portada de 1280×720 con las piezas elegidas y la guarda en la biblioteca. */
  async compose(o: ComposeOpts): Promise<CoverAsset> {
    const bg = this.get(o.backgroundId);
    if (!bg.isImage) throw new Error('El fondo tiene que ser una imagen.');
    const subject = o.subjectId ? this.get(o.subjectId) : null;
    if (subject && !subject.isImage) throw new Error('La pieza principal tiene que ser una imagen.');
    const text = cleanPhrase(o.text ?? '');
    const badge = typeof o.badge === 'number' && Number.isInteger(o.badge) && o.badge >= 1 && o.badge <= 999 ? o.badge : null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-portada-'));
    const outFile = path.join(tmpDir, 'portada.png');
    try {
      const fit = `scale=${COVER_W}:${COVER_H}:force_original_aspect_ratio=increase,crop=${COVER_W}:${COVER_H},setsar=1,${COVER_GRADE}`;
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', this.fileOf(bg)];
      let graph = `[0:v]${fit}[bg]`;
      let last = 'bg';
      if (subject) {
        args.push('-i', this.fileOf(subject));
        graph += `;[1:v]format=rgba,scale=-2:${Math.round(COVER_H * 0.96)}[fg];[${last}][fg]overlay=W-w-24:H-h:format=auto[v1]`;
        last = 'v1';
      }
      const ass = buildCoverAss(text, badge);
      if (ass) {
        const f = path.join(tmpDir, 'cover.ass');
        fs.writeFileSync(f, ass);
        graph += `;[${last}]ass='${filterPath(f)}'${this.d.fontsDir ? `:fontsdir='${filterPath(this.d.fontsDir)}'` : ''}[v2]`;
        last = 'v2';
      }
      args.push('-filter_complex', graph, '-map', `[${last}]`, '-frames:v', '1', outFile);
      await run(this.d.tools().ffmpeg, args, 60_000);
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) throw new Error('no se generó la imagen');
      const label = o.name?.trim() || `Portada_${text ? text.toLocaleLowerCase('es') : bg.name}`;
      return this.insert('portada.png', fs.readFileSync(outFile), 'portada', label);
    } catch (e) {
      throw new Error(`No se pudo componer la portada: ${(e as Error).message}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
