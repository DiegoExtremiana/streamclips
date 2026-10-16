import fs from 'node:fs';
import { ALL_PLATFORMS, CHANNELS } from '../../shared/types';
import type { ClipEdit, DeleteResult, OutputMeta, RenderKind, GroupKind, GroupPatch, Platform, Result, ScheduleEntry, Section, SettingsPatch } from '../../shared/types';
import type { AppContext } from '../app/context';
import { checkTools } from '../services/tools';
import { allFiles } from '../../shared/outputs';
import { isInside } from '../services/files';

/** Lo mínimo que usamos de ipcMain (se sustituye por uno falso en las pruebas). */
export interface IpcLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Acciones que dependen del sistema (diálogos, explorador de archivos). */
export interface IpcPlatform {
  pickFolder(): Promise<string | null>;
  showItem(file: string): void;
  openFolder(dir: string): Promise<void>;
  pickImage(): Promise<string | null>;
  /** Selector de transcripción (JSON, SRT, VTT); null si se cancela. */
  pickTranscript(): Promise<string | null>;
  /** Cuadro «Guardar como»; null si se cancela. */
  pickSavePath(defaultName: string): Promise<string | null>;
}

function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Parámetro no válido: ${name}.`);
  return v;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Error(`Parámetro no válido: ${name}.`);
  return v;
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`Parámetro no válido: ${name}.`);
  return v as Record<string, unknown>;
}

/** El renderizador solo puede abrir cosas que pertenecen a la aplicación. */
export function isAllowedPath(ctx: AppContext, p: string): boolean {
  const { store } = ctx;
  if (isInside(store.data.settings.outputDir, p)) return true;
  return store.data.vods.some((v) => v.filePath === p) || store.data.outputs.some((o) => allFiles(o).includes(p));
}

export function registerIpc(ipc: IpcLike, ctx: AppContext, platform: IpcPlatform): void {
  /** Convierte lanzamientos de error en un Result: el mensaje llega limpio, sin el prefijo de Electron. */
  const handle = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>) =>
    ipc.handle(channel, async (_event, ...args): Promise<Result<T>> => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        ctx.log.warn(`IPC ${channel}: ${message}`);
        return { ok: false, error: message };
      }
    });

  handle(CHANNELS.settingsGet, () => ctx.settings.get());
  handle(CHANNELS.settingsSet, (patch) => ctx.settings.set(obj(patch, 'ajustes') as SettingsPatch));
  handle(CHANNELS.pickFolder, () => platform.pickFolder());
  handle(CHANNELS.toolsCheck, () => checkTools(ctx.tools()));

  handle(CHANNELS.twitchTest, () => ctx.twitch.testConnection(ctx.settings.twitchCreds()));
  handle(CHANNELS.twitchVods, () => ctx.twitch.listVods(ctx.settings.twitchCreds()));

  handle(CHANNELS.channelStatus, () => ctx.channel.status());
  handle(CHANNELS.channelRefresh, () => ctx.channel.poll());
  handle(CHANNELS.channelClips, () => ctx.channel.clips());
  handle(CHANNELS.channelImportClip, (id) => ctx.channel.importClip(str(id, 'clip')));
  handle(CHANNELS.channelClipStream, (id) => ctx.channel.clipStream(str(id, 'clip')));
  handle(CHANNELS.channelAuto, (on) => {
    if (typeof on !== 'boolean') throw new Error('Valor no válido.');
    return ctx.channel.setAutoImport(on);
  });

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
  handle(CHANNELS.outputsApprove, (id) => ctx.autopilot.approve(str(id, 'id')));
  const afterDelete = (r: DeleteResult): DeleteResult => {
    // si había algo subido a la nube de lo borrado, se retira en la siguiente sincronización
    if (r.removed && ctx.cloud.status().enabled) void ctx.cloud.sync().catch((e) => ctx.log.warn(`Nube: ${(e as Error).message}`));
    return r;
  };
  handle(CHANNELS.outputsDelete, (id) => {
    const r = ctx.library.removeMany([str(id, 'id')]);
    if (r.errors.length) throw new Error(r.errors[0].reason);
    return afterDelete(r);
  });
  handle(CHANNELS.outputsDeleteMany, (ids) => {
    if (!Array.isArray(ids) || ids.length > 500 || ids.some((i) => typeof i !== 'string')) throw new Error('Selección no válida.');
    return afterDelete(ctx.library.removeMany(ids as string[]));
  });
  handle(CHANNELS.autopilotRun, async (id) => {
    const vodId = str(id, 'id');
    const vod = ctx.store.data.vods.find((v) => v.id === vodId);
    if (!vod) throw new Error('El VOD no existe.');
    if (vod.status !== 'downloaded') throw new Error('El VOD todavía no está descargado.');
    void ctx.autopilot.run(vodId).catch((e) => ctx.log.error('Piloto automático', e));
    return vod;
  });

  handle(CHANNELS.vodsList, () => ctx.store.data.vods);
  handle(CHANNELS.vodsAdd, (url, title) =>
    ctx.vods.add(str(url, 'url'), typeof title === 'string' ? title : undefined),
  );

  handle(CHANNELS.outputsList, () => ctx.store.data.outputs);
  handle(CHANNELS.clipsCreate, (vodId, spec) =>
    ctx.clips.createClip(str(vodId, 'vodId'), obj(spec, 'clip') as never),
  );
  handle(CHANNELS.clipsLong, (vodId, spec) =>
    ctx.clips.createLong(str(vodId, 'vodId'), obj(spec, 'vídeo largo') as never),
  );
  handle(CHANNELS.planApply, (vodId, planJson) => ctx.clips.applyPlan(str(vodId, 'vodId'), str(planJson, 'plan')));

  handle(CHANNELS.pubsList, () => ctx.pubs.list());
  handle(CHANNELS.pubsSchedule, (outputId, platforms, atIso) => {
    if (!Array.isArray(platforms)) throw new Error('Parámetro no válido: redes.');
    return ctx.pubs.schedule(str(outputId, 'outputId'), platforms as Platform[], str(atIso, 'fecha'));
  });
  handle(CHANNELS.pubsCancel, (key) => {
    ctx.pubs.cancel(str(key, 'key'));
  });

  handle(CHANNELS.pubsSet, (outputId, entries) => {
    if (!Array.isArray(entries)) throw new Error('Parámetro no válido: programación.');
    const list = entries.map((e) => {
      const o = obj(e, 'programación');
      return { platform: str(o.platform, 'red') as Platform, atIso: str(o.atIso, 'fecha') } satisfies ScheduleEntry;
    });
    return ctx.pubs.setSchedule(str(outputId, 'outputId'), list);
  });

  handle(CHANNELS.outputsRename, (id, title) => ctx.library.rename(str(id, 'id'), str(title, 'nombre')));
  handle(CHANNELS.outputsMeta, (id, meta) => ctx.library.setMeta(str(id, 'id'), obj(meta, 'datos') as OutputMeta));
  handle(CHANNELS.outputsThumbFrame, (id, at) => {
    if (typeof at !== 'number') throw new Error('Parámetro no válido: instante.');
    return ctx.library.setThumbnailFromFrame(str(id, 'id'), at);
  });
  handle(CHANNELS.outputsThumbImage, async (id) => {
    const outputId = str(id, 'id');
    if (!ctx.store.data.outputs.some((o) => o.id === outputId)) throw new Error('El vídeo no existe.');
    const img = await platform.pickImage();
    return img ? ctx.library.setThumbnailFromImage(outputId, img) : null;
  });
  handle(CHANNELS.outputsReedit, (id, edit) => ctx.library.reeditClip(str(id, 'id'), obj(edit, 'edición') as ClipEdit));
  handle(CHANNELS.outputsExport, async (id, version) => {
    const outputId = str(id, 'id');
    const v = str(version, 'versión') as RenderKind;
    const name = ctx.library.exportName(outputId, v); // valida que exista esa versión antes de preguntar
    const dest = await platform.pickSavePath(name);
    return dest ? ctx.library.exportFile(outputId, v, dest) : null;
  });
  handle(CHANNELS.outputsFraming, (id) => ctx.library.framingPreview(str(id, 'id')));

  handle(CHANNELS.tasksList, () => ctx.tasks.list());
  handle(CHANNELS.whisperStatus, () => ctx.transcripts.status());
  handle(CHANNELS.whisperModel, () => ctx.transcripts.downloadModel());
  handle(CHANNELS.transcriptGet, (vodId) => ctx.transcripts.words(str(vodId, 'vodId')));
  handle(CHANNELS.transcriptImport, async (vodId) => {
    const id = str(vodId, 'vodId');
    const file = await platform.pickTranscript();
    return file ? ctx.transcripts.importFile(id, file) : null;
  });
  handle(CHANNELS.clipContext, (id) => ctx.library.clipContext(str(id, 'id')));
  handle(CHANNELS.suggestTitle, (vodId, start, end) => ctx.autopilot.suggestTitle(str(vodId, 'vodId'), num(start, 'start'), num(end, 'end')));
  handle(CHANNELS.transcriptRun, (vodId) => ctx.transcripts.transcribe(str(vodId, 'vodId')));
  handle(CHANNELS.transcriptPrompt, async (vodId) => {
    const id = str(vodId, 'vodId');
    const dur = await ctx.clips.vodDuration(id);
    return ctx.transcripts.claudePrompt(id, dur);
  });

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
    if (fs.existsSync(target) && fs.statSync(target).isFile()) platform.showItem(target);
    else await platform.openFolder(target);
  });
}
