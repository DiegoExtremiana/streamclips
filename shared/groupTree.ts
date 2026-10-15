import type { Group, OutputItem, Section } from './types';
import { sectionOf } from './types';

/** Carpetas de una sección que cuelgan directamente de `parentId` (o de la raíz si no se indica), por nombre. */
export function childGroups(groups: Group[], section: Section, parentId: string | undefined): Group[] {
  return groups
    .filter((g) => g.section === section && g.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

/** Camino desde la raíz hasta la carpeta (ella incluida). Vacío si no existe. */
export function pathOf(groups: Group[], id: string | undefined): Group[] {
  const out: Group[] = [];
  let cur = id;
  while (cur && out.length < 100) {
    const g = groups.find((x) => x.id === cur);
    if (!g) return [];
    out.unshift(g);
    cur = g.parentId;
  }
  return out;
}

export function groupLabel(groups: Group[], id: string): string {
  return pathOf(groups, id).map((g) => g.name).join(' / ');
}

/** Ids de la carpeta y de todo lo que cuelga de ella. */
export function subtreeIds(groups: Group[], id: string): Set<string> {
  const ids = new Set<string>([id]);
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
export function itemsIn(outputs: OutputItem[], groups: Group[], section: Section, groupId: string | undefined): OutputItem[] {
  return outputs.filter((o) => {
    if (sectionOf(o.kind) !== section) return false;
    const effective = o.groupId && groups.some((g) => g.id === o.groupId) ? o.groupId : undefined;
    return effective === groupId;
  });
}

/** Nº de vídeos dentro de una carpeta, incluidas sus subcarpetas. */
export function countInside(outputs: OutputItem[], groups: Group[], id: string): number {
  const ids = subtreeIds(groups, id);
  return outputs.filter((o) => o.groupId !== undefined && ids.has(o.groupId)).length;
}

/** Todas las carpetas de una sección en orden de árbol, con su nivel (para listas de destino). */
export function flattenGroups(groups: Group[], section: Section): { group: Group; depth: number }[] {
  const out: { group: Group; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const g of childGroups(groups, section, parent)) {
      out.push({ group: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}
