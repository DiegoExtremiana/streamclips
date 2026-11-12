"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.childGroups = childGroups;
exports.pathOf = pathOf;
exports.groupLabel = groupLabel;
exports.subtreeIds = subtreeIds;
exports.itemsIn = itemsIn;
exports.countInside = countInside;
exports.flattenGroups = flattenGroups;
const types_1 = require("./types");
/** Carpetas de una sección que cuelgan directamente de `parentId` (o de la raíz si no se indica), por nombre. */
function childGroups(groups, section, parentId) {
    return groups
        .filter((g) => g.section === section && g.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}
/** Camino desde la raíz hasta la carpeta (ella incluida). Vacío si no existe. */
function pathOf(groups, id) {
    const out = [];
    let cur = id;
    while (cur && out.length < 100) {
        const g = groups.find((x) => x.id === cur);
        if (!g)
            return [];
        out.unshift(g);
        cur = g.parentId;
    }
    return out;
}
function groupLabel(groups, id) {
    return pathOf(groups, id).map((g) => g.name).join(' / ');
}
/** Ids de la carpeta y de todo lo que cuelga de ella. */
function subtreeIds(groups, id) {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const g of groups) {
            if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                ids.add(g.id);
                grew = true;
            }
        }
    }
    return ids;
}
/**
 * Vídeos de una sección que están directamente en la carpeta (o en la raíz si no se indica).
 * Un vídeo cuya carpeta ya no existe cuenta como de la raíz: nunca queda oculto.
 */
function itemsIn(outputs, groups, section, groupId) {
    return outputs.filter((o) => {
        if ((0, types_1.sectionOf)(o.kind) !== section)
            return false;
        const effective = o.groupId && groups.some((g) => g.id === o.groupId) ? o.groupId : undefined;
        return effective === groupId;
    });
}
/** Nº de vídeos dentro de una carpeta, incluidas sus subcarpetas. */
function countInside(outputs, groups, id) {
    const ids = subtreeIds(groups, id);
    return outputs.filter((o) => o.groupId !== undefined && ids.has(o.groupId)).length;
}
/** Todas las carpetas de una sección en orden de árbol, con su nivel (para listas de destino). */
function flattenGroups(groups, section) {
    const out = [];
    const walk = (parent, depth) => {
        for (const g of childGroups(groups, section, parent)) {
            out.push({ group: g, depth });
            walk(g.id, depth + 1);
        }
    };
    walk(undefined, 0);
    return out;
}
