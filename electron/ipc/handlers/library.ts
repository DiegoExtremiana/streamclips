import { isCancelled } from '../../services/abort';
import { CHANNELS } from '../../../shared/types';
import type { ClipEdit, DeleteResult, OutputItem, OutputMeta, RenderKind, Platform, ScheduleEntry } from '../../../shared/types';
import type { IpcContext } from '../helpers';
import { str, obj } from '../helpers';

/** Biblioteca: vídeos y clips, piloto automático, directos, publicaciones y edición. */
export function registerLibrary({ handle, ctx, platform }: IpcContext): void {
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
    // siempre se puede volver a analizar: si había un análisis en marcha (o colgado) se cancela y se empieza de nuevo
    void ctx.autopilot.run(vodId, { restart: true }).catch((e) => {
      if (!isCancelled(e)) ctx.log.error('Piloto automático', e);
    });
    return vod;
  });
  handle(CHANNELS.themesList, () => ctx.themes.pending());
  handle(CHANNELS.themesChoose, async (id, choice) => {
    const themeId = str(id, 'id');
    const p = ctx.themes.get(themeId);
    if (!p || p.status !== 'pending') throw new Error('Esta propuesta ya no está disponible.');
    if (choice === 'dismiss') {
      ctx.themes.resolve(themeId, 'dismissed');
      return { made: 0 };
    }
    if (choice !== 'long' && choice !== 'shorts') throw new Error('Formato no válido.');
    ctx.themes.resolve(themeId, 'accepted', choice);
    // la creación tarda (descarga, transcripción, montaje): sigue en segundo plano y el programa avisa al terminar
    void ctx.autopilot.makeTheme(p, choice).catch((e) => {
      if (!isCancelled(e)) ctx.log.error('Vídeo temático', e);
    });
    return { made: choice === 'long' ? 1 : p.shorts.length };
  });
  handle(CHANNELS.autopilotCancel, (id) => ctx.autopilot.cancel(str(id, 'id')));
  handle(CHANNELS.autopilotPause, (id) => ctx.autopilot.pause(str(id, 'id')));
  handle(CHANNELS.vodsDiscard, (id) => ctx.autopilot.discard(str(id, 'id')));
  handle(CHANNELS.storageReport, () => ctx.storage.report());
  handle(CHANNELS.storageFree, () => ctx.storage.free());

  handle(CHANNELS.vodsList, () => ctx.store.data.vods);
  handle(CHANNELS.vodsAdd, (url, title) =>
    ctx.vods.add(str(url, 'url'), typeof title === 'string' ? title : undefined),
  );

  handle(CHANNELS.outputsList, () => ctx.store.data.outputs);
  // lo que se crea desde la interfaz lleva el nombre que puso (o aceptó) el usuario: no se vuelve a renombrar solo
  const byUser = async (made: Promise<OutputItem>): Promise<OutputItem> => {
    const o = await made;
    o.titleSource = 'manual';
    ctx.store.save();
    return o;
  };
  handle(CHANNELS.clipsCreate, (vodId, spec) =>
    byUser(ctx.clips.createClip(str(vodId, 'vodId'), obj(spec, 'clip') as never)),
  );
  handle(CHANNELS.clipsLong, (vodId, spec) =>
    byUser(ctx.clips.createLong(str(vodId, 'vodId'), obj(spec, 'vídeo largo') as never)),
  );
  handle(CHANNELS.planApply, async (vodId, planJson) => {
    const r = await ctx.clips.applyPlan(str(vodId, 'vodId'), str(planJson, 'plan'));
    for (const o of r.created) o.titleSource = 'manual'; // los nombres del plan los has puesto (o aceptado) tú
    ctx.store.save();
    return r;
  });

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
  handle(CHANNELS.outputsThumbCover, (id, assetId) => {
    const outputId = str(id, 'id');
    if (!ctx.store.data.outputs.some((o) => o.id === outputId)) throw new Error('El vídeo no existe.');
    return ctx.library.setThumbnailFromImage(outputId, ctx.covers.filePath(str(assetId, 'portada')));
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

}
