import type { AppContext } from '../app/context';
import { isAllowedPath, makeHandle, type IpcLike, type IpcPlatform } from './helpers';
import { registerChannel } from './handlers/channel';
import { registerConnections } from './handlers/connections';
import { registerLibrary } from './handlers/library';
import { registerContent } from './handlers/content';
import { registerGroups } from './handlers/groups';

export { isAllowedPath };
export type { IpcLike, IpcPlatform };

/** Registra todos los canales IPC; cada área vive en su módulo de ipc/handlers. */
export function registerIpc(ipc: IpcLike, ctx: AppContext, platform: IpcPlatform): void {
  const c = { handle: makeHandle(ipc, ctx), ctx, platform };
  registerChannel(c);
  registerConnections(c);
  registerLibrary(c);
  registerContent(c);
  registerGroups(c);
}
