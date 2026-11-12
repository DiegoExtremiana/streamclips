"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const covers_1 = require("../shared/covers");
const covers_2 = require("../electron/domain/covers");
const dirs = [];
(0, node_test_1.afterEach)(() => {
    while (dirs.length)
        node_fs_1.default.rmSync(dirs.pop(), { recursive: true, force: true });
});
const tmp = () => {
    const d = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'sc-covers-'));
    dirs.push(d);
    return d;
};
const hasFfmpeg = (() => {
    try {
        (0, node_child_process_1.execFileSync)('ffmpeg', ['-version'], { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
})();
const png = (dir, name, color, size = '320x180') => {
    const f = node_path_1.default.join(dir, name);
    (0, node_child_process_1.execFileSync)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', f]);
    return node_fs_1.default.readFileSync(f);
};
const svc = (dir) => new covers_2.CoverService({ dir: node_path_1.default.join(dir, 'covers'), tools: () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' }) });
(0, node_test_1.describe)('piezas de portada (reglas)', () => {
    (0, node_test_1.it)('los nombres salen limpios, sin extensión y únicos', () => {
        strict_1.default.equal((0, covers_1.cleanAssetName)('Diego Sorprendido.png'), 'Diego_Sorprendido');
        strict_1.default.equal((0, covers_1.cleanAssetName)('  ../../x:y*z?.jpg '), 'xyz');
        strict_1.default.equal((0, covers_1.cleanAssetName)('!!!'), 'Sin_nombre');
        strict_1.default.equal((0, covers_1.cleanAssetName)('a'.repeat(80)).length, 40);
        strict_1.default.equal((0, covers_1.uniqueName)('Fondo', ['fondo']), 'Fondo_2');
        strict_1.default.equal((0, covers_1.uniqueName)('Fondo', ['fondo', 'Fondo_2']), 'Fondo_3');
        strict_1.default.equal((0, covers_1.uniqueName)('Otro', ['fondo']), 'Otro');
    });
    (0, node_test_1.it)('el tipo se supone por la extensión y el nombre', () => {
        strict_1.default.equal((0, covers_1.guessKind)('guion.pdf'), 'documento');
        strict_1.default.equal((0, covers_1.guessKind)('Fondo_Ciudad.png'), 'fondo');
        strict_1.default.equal((0, covers_1.guessKind)('foto_playa.jpg'), 'foto');
        strict_1.default.equal((0, covers_1.guessKind)('Diego_Sorprendido.png'), 'imagen');
        strict_1.default.equal((0, covers_1.extOf)('A.PNG'), '.png');
    });
    (0, node_test_1.it)('la frase queda en mayúsculas, corta y sin signos raros', () => {
        strict_1.default.equal((0, covers_1.cleanPhrase)('no lo esperaba'), 'NO LO ESPERABA');
        strict_1.default.equal((0, covers_1.cleanPhrase)('uno dos tres cuatro cinco'), 'UNO DOS TRES CUATRO');
        strict_1.default.ok((0, covers_1.cleanPhrase)('palabralarguisima otra palabralarguisima').length <= 28);
        strict_1.default.equal((0, covers_1.cleanPhrase)('<b>hola</b>'), 'B HOLA B');
    });
});
(0, node_test_1.describe)('biblioteca de portadas', () => {
    (0, node_test_1.it)('añade, renombra, cambia el tipo, recuerda en disco y borra', () => {
        const d = tmp();
        const s = svc(d);
        const a = s.add('Diego Sorprendido.png', Buffer.from('x'));
        const b = s.add('Diego Sorprendido.png', Buffer.from('y'));
        const doc = s.add('guion.pdf', Buffer.from('%PDF'));
        strict_1.default.deepEqual([a.name, b.name], ['Diego_Sorprendido', 'Diego_Sorprendido_2']);
        strict_1.default.equal(doc.kind, 'documento');
        strict_1.default.equal(s.rename(a.id, 'Fondo Ciudad').name, 'Fondo_Ciudad');
        strict_1.default.equal(s.rename(b.id, 'fondo ciudad').name, 'fondo_ciudad_2');
        strict_1.default.equal(s.setKind(a.id, 'fondo').kind, 'fondo');
        strict_1.default.throws(() => s.setKind(a.id, 'documento'), /no puede ser un documento/);
        strict_1.default.throws(() => s.setKind(doc.id, 'foto'), /no puede ser una imagen/);
        strict_1.default.throws(() => s.setKind(a.id, 'raro'), /no es válido/);
        const again = svc(d);
        strict_1.default.equal(again.list().length, 3);
        strict_1.default.equal(again.list().find((x) => x.id === a.id).kind, 'fondo');
        strict_1.default.ok(node_fs_1.default.existsSync(again.filePath(a.id)));
        again.remove(a.id);
        strict_1.default.equal(again.list().length, 2);
        strict_1.default.throws(() => again.filePath(a.id), /ya no está/);
    });
    (0, node_test_1.it)('rechaza lo que no es imagen ni documento, lo vacío y lo enorme', () => {
        const s = svc(tmp());
        strict_1.default.throws(() => s.add('virus.exe', Buffer.from('x')), /solo se admiten/);
        strict_1.default.throws(() => s.add('vacio.png', Buffer.alloc(0)), /vacío/);
        strict_1.default.throws(() => s.add('grande.png', Buffer.alloc(26 * 1024 * 1024)), /pesa más/);
    });
    (0, node_test_1.it)('una biblioteca estropeada se ignora', () => {
        const d = tmp();
        node_fs_1.default.mkdirSync(node_path_1.default.join(d, 'covers'));
        node_fs_1.default.writeFileSync(node_path_1.default.join(d, 'covers', 'index.json'), '[{"id":"../../x","name":"a","kind":"fondo"},');
        strict_1.default.equal(svc(d).list().length, 0);
    });
    (0, node_test_1.it)('compone una portada 1280x720 con fondo, pieza principal y frase, y la guarda como portada', { skip: !hasFfmpeg }, async () => {
        const d = tmp();
        const s = svc(d);
        const bg = s.add('Fondo_Ciudad.png', png(d, 'bg.png', 'blue', '640x360'));
        const fg = s.add('Diego_Sorprendido.png', png(d, 'fg.png', 'red', '200x300'));
        const doc = s.add('guion.pdf', Buffer.from('%PDF'));
        const made = await s.compose({ backgroundId: bg.id, subjectId: fg.id, text: 'no lo esperaba', badge: 3 });
        strict_1.default.equal(made.kind, 'portada');
        strict_1.default.match(made.name, /^Portada_no_lo_esperaba/);
        const dims = (0, node_child_process_1.execFileSync)('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', s.filePath(made.id)]).toString().trim();
        strict_1.default.equal(dims, '1280,720');
        const prev = await s.preview(made.id);
        strict_1.default.match(prev ?? '', /^data:image\/png;base64,/);
        strict_1.default.equal(await s.preview(doc.id), null);
        await strict_1.default.rejects(() => s.compose({ backgroundId: doc.id }), /imagen/);
        await strict_1.default.rejects(() => s.compose({ backgroundId: 'nope' }), /ya no está/);
        const plain = await s.compose({ backgroundId: bg.id, name: 'Solo fondo' });
        strict_1.default.equal(plain.name, 'Solo_fondo');
    });
});
