import { ALL_PLATFORMS, CHANNELS } from '../../../shared/types';
import type { Platform } from '../../../shared/types';
import type { IpcContext } from '../helpers';
import { str } from '../helpers';

/** Redes sociales, actualizaciones, nube y motor. */
export function registerConnections({ handle, ctx }: IpcContext): void {
  const platformArg = (v: unknown): Platform => {
    if (typeof v !== 'string' || !ALL_PLATFORMS.includes(v as Platform)) throw new Error('Red social no reconocida.');
    return v as Platform;
  };
  handle(CHANNELS.connList, () => ctx.connections.list());
  handle(CHANNELS.connSet, (p, id, secret) => ctx.connections.setApp(platformArg(p), str(id, 'id'), str(secret, 'secreto')));
  handle(CHANNELS.connConnect, (p) => ctx.connections.connect(platformArg(p)));
  handle(CHANNELS.connCancel, () => ctx.connections.cancelConnect());
  handle(CHANNELS.connDisconnect, (p) => ctx.connections.disconnect(platformArg(p)));
  handle(CHANNELS.ytPlaylists, () => ctx.playlists());
  handle(CHANNELS.updateStatus, () => ctx.updates.status());
  handle(CHANNELS.updateCheck, () => ctx.updates.check());
  handle(CHANNELS.updateInstall, () => ctx.updates.tryRestart(true));
  handle(CHANNELS.cloudStatus, () => ctx.cloud.status());
  handle(CHANNELS.engineStatus, () => ctx.engine.status());
  handle(CHANNELS.engineSetup, (repo, token) => ctx.engine.setup(str(repo, 'repositorio'), str(token, 'token')));
  handle(CHANNELS.engineSync, () => ctx.engine.sync());
  handle(CHANNELS.engineDisable, () => ctx.engine.disable());
  handle(CHANNELS.cloudSetup, (repo, token) => ctx.cloud.setup(str(repo, 'repositorio'), str(token, 'token')));
  handle(CHANNELS.cloudSync, async () => {
    await ctx.cloud.syncCreds().catch(() => undefined);
    return ctx.cloud.sync();
  });
  handle(CHANNELS.cloudDisable, () => ctx.cloud.disable());
}
