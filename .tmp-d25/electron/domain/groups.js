"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupService = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const types_1 = require("../../shared/types");
/** Carpetas de la Biblioteca. Borrar una carpeta nunca borra vídeos: su contenido sube un nivel. */
class GroupService {
    store;
    notifier;
    constructor(store, notifier) {
        this.store = store;
        this.notifier = notifier;
    }
    list() {
        return this.store.data.groups;
    }
    find(id) {
        const g = this.store.data.groups.find((x) => x.id === id);
        if (!g)
            throw new Error('La carpeta no existe.');
        return g;
    }
    done() {
        this.store.save();
        this.notifier.changed();
    }
    cleanName(name) {
        const n = typeof name === 'string' ? name.trim() : '';
        if (!n)
            throw new Error('El nombre de la carpeta no puede estar vacío.');
        if (n.length > types_1.MAX_GROUP_NAME_LEN)
            throw new Error(`El nombre no puede pasar de ${types_1.MAX_GROUP_NAME_LEN} caracteres.`);
        return n;
    }
    assertKind(kind) {
        if (kind !== 'theme' && kind !== 'series')
            throw new Error('El tipo debe ser "tema" o "serie".');
        return kind;
    }
    assertUnique(name, section, parentId, exceptId) {
        const lower = name.toLowerCase();
        const clash = this.store.data.groups.some((g) => g.id !== exceptId && g.section === section && g.parentId === parentId && g.name.toLowerCase() === lower);
        if (clash)
            throw new Error(`Ya hay una carpeta llamada "${name}" en ese sitio.`);
    }
    /** Nº de niveles desde la raíz hasta la carpeta (la raíz vale 1). */
    depth(id) {
        let d = 0;
        let cur = id;
        while (cur) {
            d++;
            cur = this.store.data.groups.find((g) => g.id === cur)?.parentId;
            if (d > 100)
                break; // defensa ante datos corruptos con ciclos
        }
        return d;
    }
    /** Altura del subárbol que cuelga de la carpeta (ella misma cuenta 1). */
    height(id) {
        const kids = this.store.data.groups.filter((g) => g.parentId === id);
        return 1 + Math.max(0, ...kids.map((k) => this.height(k.id)));
    }
    create(name, kind, section, parentId) {
        const n = this.cleanName(name);
        this.assertKind(kind);
        if (section !== 'clips' && section !== 'videos')
            throw new Error('Sección no válida.');
        if (parentId !== undefined) {
            const parent = this.find(parentId);
            if (parent.section !== section)
                throw new Error('La carpeta superior es de otra sección.');
            if (this.depth(parentId) >= types_1.MAX_GROUP_DEPTH)
                throw new Error(`No se pueden anidar más de ${types_1.MAX_GROUP_DEPTH} niveles.`);
        }
        this.assertUnique(n, section, parentId);
        const g = { id: node_crypto_1.default.randomUUID(), name: n, kind, section, parentId, createdAt: new Date().toISOString() };
        this.store.data.groups.push(g);
        this.done();
        return g;
    }
    update(id, patch) {
        const g = this.find(id);
        const name = patch.name === undefined ? g.name : this.cleanName(patch.name);
        const kind = patch.kind === undefined ? g.kind : this.assertKind(patch.kind);
        this.assertUnique(name, g.section, g.parentId, g.id);
        g.name = name;
        g.kind = kind;
        this.done();
        return g;
    }
    delete(id) {
        const g = this.find(id);
        // El contenido sube a la carpeta superior. Si allí ya existe otra con el mismo nombre no pasa nada: solo se valida al crear o mover a mano.
        for (const o of this.store.data.outputs)
            if (o.groupId === id)
                o.groupId = g.parentId;
        for (const c of this.store.data.groups)
            if (c.parentId === id)
                c.parentId = g.parentId;
        this.store.data.groups = this.store.data.groups.filter((x) => x.id !== id);
        this.done();
    }
    move(id, parentId) {
        const g = this.find(id);
        const target = parentId ?? undefined;
        if (target !== undefined) {
            const parent = this.find(target);
            if (parent.section !== g.section)
                throw new Error('No se puede mover una carpeta a otra sección.');
            // no se puede meter una carpeta dentro de sí misma ni de sus descendientes
            for (let cur = target, i = 0; cur && i < 100; i++) {
                if (cur === g.id)
                    throw new Error('Una carpeta no se puede meter dentro de sí misma.');
                cur = this.store.data.groups.find((x) => x.id === cur)?.parentId;
            }
            if (this.depth(target) + this.height(g.id) > types_1.MAX_GROUP_DEPTH) {
                throw new Error(`No se pueden anidar más de ${types_1.MAX_GROUP_DEPTH} niveles.`);
            }
        }
        if (g.parentId === target)
            return g;
        this.assertUnique(g.name, g.section, target, g.id);
        g.parentId = target;
        this.done();
        return g;
    }
    moveOutput(outputId, groupId) {
        const o = this.store.data.outputs.find((x) => x.id === outputId);
        if (!o)
            throw new Error('El vídeo no existe.');
        if (groupId !== null) {
            const g = this.find(groupId);
            if (g.section !== (0, types_1.sectionOf)(o.kind)) {
                throw new Error(g.section === 'clips' ? 'Esa carpeta es de Clips; los vídeos largos van en carpetas de Vídeos.' : 'Esa carpeta es de Vídeos; los clips van en carpetas de Clips.');
            }
        }
        const next = groupId ?? undefined;
        if (o.groupId !== next) {
            o.groupId = next;
            this.done();
        }
        return o;
    }
}
exports.GroupService = GroupService;
