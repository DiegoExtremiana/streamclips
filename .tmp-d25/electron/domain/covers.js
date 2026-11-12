"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoverService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const thumbStyle_1 = require("../../shared/thumbStyle");
const covers_1 = require("../../shared/covers");
const ffmpeg_1 = require("../services/ffmpeg");
const tools_1 = require("../services/tools");
/**
 * La biblioteca de piezas de portada. Las piezas se guardan tal cual en `files`; las miniaturas se generan al pedirlas.
 * Las portadas que compone el programa entran en la misma biblioteca (tipo «portada»), para renombrarlas o borrarlas igual.
 */
class CoverService {
    d;
    items = [];
    now;
    constructor(d) {
        this.d = d;
        this.now = d.now ?? Date.now;
        try {
            const j = JSON.parse(node_fs_1.default.readFileSync(this.indexFile(), 'utf8'));
            if (Array.isArray(j))
                this.items = j.filter((x) => !!x && typeof x.id === 'string' && typeof x.name === 'string' && (0, covers_1.isAssetKind)(x.kind) && /^[a-f0-9]{12}$/.test(x.id));
        }
        catch {
            /* biblioteca vacía */
        }
    }
    indexFile = () => node_path_1.default.join(this.d.dir, 'index.json');
    fileOf = (a) => node_path_1.default.join(this.d.dir, 'files', `${a.id}${a.ext}`);
    thumbOf = (a) => node_path_1.default.join(this.d.dir, 'thumbs', `${a.id}.png`);
    save() {
        node_fs_1.default.mkdirSync(this.d.dir, { recursive: true });
        const tmp = `${this.indexFile()}.tmp`;
        node_fs_1.default.writeFileSync(tmp, JSON.stringify(this.items));
        node_fs_1.default.renameSync(tmp, this.indexFile());
    }
    get(id) {
        const a = this.items.find((x) => x.id === id);
        if (!a)
            throw new Error('Esa pieza ya no está en la biblioteca.');
        return a;
    }
    list() {
        return [...this.items].sort((a, b) => b.addedAt - a.addedAt);
    }
    /** Ruta del archivo de una pieza (para abrirla o enseñarla en su carpeta). */
    filePath(id) {
        return this.fileOf(this.get(id));
    }
    insert(fileName, data, kind, name) {
        const ext = (0, covers_1.extOf)(fileName);
        if (!(0, covers_1.isImageExt)(ext) && !(0, covers_1.isDocExt)(ext))
            throw new Error(`«${fileName}»: solo se admiten imágenes (PNG, JPG, WEBP, GIF) y documentos (PDF, TXT, MD, DOC, DOCX, ODT).`);
        if (data.length === 0)
            throw new Error(`«${fileName}» está vacío.`);
        if (data.length > covers_1.MAX_ASSET_BYTES)
            throw new Error(`«${fileName}» pesa más de ${Math.round(covers_1.MAX_ASSET_BYTES / 1048576)} MB.`);
        const asset = {
            id: node_crypto_1.default.randomBytes(6).toString('hex'),
            name: (0, covers_1.uniqueName)((0, covers_1.cleanAssetName)(name ?? fileName), this.items.map((x) => x.name)),
            kind: (0, covers_1.isDocExt)(ext) ? 'documento' : kind,
            ext,
            bytes: data.length,
            addedAt: this.now(),
            isImage: (0, covers_1.isImageExt)(ext),
        };
        node_fs_1.default.mkdirSync(node_path_1.default.join(this.d.dir, 'files'), { recursive: true });
        node_fs_1.default.writeFileSync(this.fileOf(asset), data);
        this.items.push(asset);
        this.save();
        return asset;
    }
    /** Añade un archivo soltado o elegido por el usuario. */
    add(fileName, data) {
        return this.insert(fileName, data, (0, covers_1.guessKind)(fileName));
    }
    rename(id, name) {
        const a = this.get(id);
        const clean = (0, covers_1.cleanAssetName)(name);
        a.name = (0, covers_1.uniqueName)(clean, this.items.filter((x) => x.id !== id).map((x) => x.name));
        this.save();
        return a;
    }
    setKind(id, kind) {
        const a = this.get(id);
        if (!(0, covers_1.isAssetKind)(kind))
            throw new Error('Ese tipo no es válido.');
        if (!a.isImage && kind !== 'documento')
            throw new Error('Un documento no puede ser una imagen.');
        if (a.isImage && kind === 'documento')
            throw new Error('Una imagen no puede ser un documento.');
        a.kind = kind;
        this.save();
        return a;
    }
    remove(id) {
        const a = this.get(id);
        node_fs_1.default.rmSync(this.fileOf(a), { force: true });
        node_fs_1.default.rmSync(this.thumbOf(a), { force: true });
        this.items = this.items.filter((x) => x.id !== id);
        this.save();
    }
    /** Miniatura (data URL PNG de hasta 480 px) para la pantalla; null si es un documento o no se pudo leer. */
    async preview(id) {
        const a = this.get(id);
        if (!a.isImage)
            return null;
        const out = this.thumbOf(a);
        try {
            if (!node_fs_1.default.existsSync(out)) {
                node_fs_1.default.mkdirSync(node_path_1.default.dirname(out), { recursive: true });
                await (0, tools_1.run)(this.d.tools().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', this.fileOf(a), '-frames:v', '1', '-vf', 'scale=480:-2', out], 30_000);
            }
            return `data:image/png;base64,${node_fs_1.default.readFileSync(out).toString('base64')}`;
        }
        catch {
            return null;
        }
    }
    /** Compone una portada de 1280×720 con las piezas elegidas y la guarda en la biblioteca. */
    async compose(o) {
        const bg = this.get(o.backgroundId);
        if (!bg.isImage)
            throw new Error('El fondo tiene que ser una imagen.');
        const subject = o.subjectId ? this.get(o.subjectId) : null;
        if (subject && !subject.isImage)
            throw new Error('La pieza principal tiene que ser una imagen.');
        const text = (0, covers_1.cleanPhrase)(o.text ?? '');
        const badge = typeof o.badge === 'number' && Number.isInteger(o.badge) && o.badge >= 1 && o.badge <= 999 ? o.badge : null;
        const tmpDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'streamclips-portada-'));
        const outFile = node_path_1.default.join(tmpDir, 'portada.png');
        try {
            const fit = `scale=${thumbStyle_1.COVER_W}:${thumbStyle_1.COVER_H}:force_original_aspect_ratio=increase,crop=${thumbStyle_1.COVER_W}:${thumbStyle_1.COVER_H},setsar=1,${thumbStyle_1.COVER_GRADE}`;
            const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', this.fileOf(bg)];
            let graph = `[0:v]${fit}[bg]`;
            let last = 'bg';
            if (subject) {
                args.push('-i', this.fileOf(subject));
                graph += `;[1:v]format=rgba,scale=-2:${Math.round(thumbStyle_1.COVER_H * 0.96)}[fg];[${last}][fg]overlay=W-w-24:H-h:format=auto[v1]`;
                last = 'v1';
            }
            const ass = (0, thumbStyle_1.buildCoverAss)(text, badge);
            if (ass) {
                const f = node_path_1.default.join(tmpDir, 'cover.ass');
                node_fs_1.default.writeFileSync(f, ass);
                graph += `;[${last}]ass='${(0, ffmpeg_1.filterPath)(f)}'${this.d.fontsDir ? `:fontsdir='${(0, ffmpeg_1.filterPath)(this.d.fontsDir)}'` : ''}[v2]`;
                last = 'v2';
            }
            args.push('-filter_complex', graph, '-map', `[${last}]`, '-frames:v', '1', outFile);
            await (0, tools_1.run)(this.d.tools().ffmpeg, args, 60_000);
            if (!node_fs_1.default.existsSync(outFile) || node_fs_1.default.statSync(outFile).size === 0)
                throw new Error('no se generó la imagen');
            const label = o.name?.trim() || `Portada_${text ? text.toLocaleLowerCase('es') : bg.name}`;
            return this.insert('portada.png', node_fs_1.default.readFileSync(outFile), 'portada', label);
        }
        catch (e) {
            throw new Error(`No se pudo componer la portada: ${e.message}`);
        }
        finally {
            node_fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
    }
}
exports.CoverService = CoverService;
