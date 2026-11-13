import fs from 'node:fs';
import { CHANNELS } from '../../../shared/types';
import type { GroupKind, GroupPatch, Section } from '../../../shared/types';
import type { IpcContext } from '../helpers';
import { str, obj, isAllowedPath } from '../helpers';

/** Carpetas de la Biblioteca y apertura de archivos. */
export function registerGroups({ handle, ctx, platform }: IpcContext): void {
  handle(CHANNELS.groupsList, () => ctx.groups.list());
  handle(CHANNELS.groupsCreate, (name, kind, section, parentId) =>
    ctx.groups.create(
      str(name, 'nombre'),
      str(kind, 'tipo') as GroupKind,
      str(section, 'sección') as Section,
      parentId === undefined || parentId === null ? undefined : str(parentId, 'carpeta'),
    ),
  );
  handle(CHANNELS.groupsUpdate, (id, patch) => ctx.groups.update(str(id, 'id'), obj(patch, 'cambios') as GroupPatch));
  handle(CHANNELS.groupsDelete, (id) => {
    ctx.groups.delete(str(id, 'id'));
  });
  handle(CHANNELS.groupsMove, (id, parentId) =>
    ctx.groups.move(str(id, 'id'), parentId === null || parentId === undefined ? null : str(parentId, 'carpeta')),
  );
  handle(CHANNELS.outputsMove, (id, groupId) =>
    ctx.groups.moveOutput(str(id, 'id'), groupId === null || groupId === undefined ? null : str(groupId, 'carpeta')),
  );

  handle(CHANNELS.shellOpen, async (p) => {
    const target = str(p, 'ruta');
    if (!isAllowedPath(ctx, target)) throw new Error('Esa ruta no pertenece a la aplicación.');
    if (target === ctx.clipScores.notesPath()) ctx.clipScores.writeNotes();
    if (fs.existsSync(target) && fs.statSync(target).isFile()) platform.showItem(target);
    else await platform.openFolder(target);
  });
}
