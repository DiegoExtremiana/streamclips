"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAllowedPath = isAllowedPath;
exports.registerIpc = registerIpc;
const abort_1 = require("../services/abort");
const node_fs_1 = __importDefault(require("node:fs"));
const types_1 = require("../../shared/types");
const tools_1 = require("../services/tools");
const outputs_1 = require("../../shared/outputs");
const files_1 = require("../services/files");
function num(v, name) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error(`Parámetro no válido: ${name}.`);
    return v;
}
function str(v, name) {
    if (typeof v !== 'string')
        throw new Error(`Parámetro no válido: ${name}.`);
    return v;
}
function obj(v, name) {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        throw new Error(`Parámetro no válido: ${name}.`);
    return v;
}
/** El renderizador solo puede abrir cosas que pertenecen a la aplicación. */
function isAllowedPath(ctx, p) {
    const { store } = ctx;
    if ((0, files_1.isInside)(store.data.settings.outputDir, p))
        return true;
    return store.data.vods.some((v) => v.filePath === p) || store.data.outputs.some((o) => (0, outputs_1.allFiles)(o).includes(p));
}
function registerIpc(ipc, ctx, platform) {
    /** Convierte lanzamientos de error en un Result: el mensaje llega limpio, sin el prefijo de Electron. */
    const handle = (channel, fn) => ipc.handle(channel, async (_event, ...args) => {
        try {
            return { ok: true, value: await fn(...args) };
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            ctx.log.warn(`IPC ${channel}: ${message}`);
            return { ok: false, error: message };
        }
    });
    handle(types_1.CHANNELS.settingsGet, () => ctx.settings.get());
    handle(types_1.CHANNELS.settingsSet, (patch) => ctx.settings.set(obj(patch, 'ajustes')));
    handle(types_1.CHANNELS.pickFolder, () => platform.pickFolder());
    handle(types_1.CHANNELS.toolsCheck, () => (0, tools_1.checkTools)(ctx.tools()));
    handle(types_1.CHANNELS.twitchTest, () => ctx.twitch.testConnection(ctx.settings.twitchCreds()));
    handle(types_1.CHANNELS.twitchVods, () => ctx.twitch.listVods(ctx.settings.twitchCreds()));
    handle(types_1.CHANNELS.channelStatus, () => ctx.channel.status());
    handle(types_1.CHANNELS.channelRefresh, () => ctx.channel.poll());
    handle(types_1.CHANNELS.channelAnalyze, (id) => ctx.channel.analyze(str(id, 'id')));
    handle(types_1.CHANNELS.channelClips, (force, login) => (typeof login === 'string' && login.trim() ? ctx.channel.clipsOf(login, force === true) : ctx.channel.clips(force === true)));
    handle(types_1.CHANNELS.channelImportClip, (id) => ctx.channel.importClip(str(id, 'clip')));
    handle(types_1.CHANNELS.channelClipStream, (id) => ctx.channel.clipStream(str(id, 'clip')));
    handle(types_1.CHANNELS.channelAuto, (on) => {
        if (typeof on !== 'boolean')
            throw new Error('Valor no válido.');
        return ctx.channel.setAutoImport(on);
    });
    const platformArg = (v) => {
        if (typeof v !== 'string' || !types_1.ALL_PLATFORMS.includes(v))
            throw new Error('Red social no reconocida.');
        return v;
    };
    handle(types_1.CHANNELS.connList, () => ctx.connections.list());
    handle(types_1.CHANNELS.connSet, (p, id, secret) => ctx.connections.setApp(platformArg(p), str(id, 'id'), str(secret, 'secreto')));
    handle(types_1.CHANNELS.connConnect, (p) => ctx.connections.connect(platformArg(p)));
    handle(types_1.CHANNELS.connCancel, () => ctx.connections.cancelConnect());
    handle(types_1.CHANNELS.connDisconnect, (p) => ctx.connections.disconnect(platformArg(p)));
    handle(types_1.CHANNELS.ytPlaylists, () => ctx.playlists());
    handle(types_1.CHANNELS.updateStatus, () => ctx.updates.status());
    handle(types_1.CHANNELS.updateCheck, () => ctx.updates.check());
    handle(types_1.CHANNELS.updateInstall, () => ctx.updates.tryRestart(true));
    handle(types_1.CHANNELS.cloudStatus, () => ctx.cloud.status());
    handle(types_1.CHANNELS.engineStatus, () => ctx.engine.status());
    handle(types_1.CHANNELS.engineSetup, (repo, token) => ctx.engine.setup(str(repo, 'repositorio'), str(token, 'token')));
    handle(types_1.CHANNELS.engineSync, () => ctx.engine.sync());
    handle(types_1.CHANNELS.engineDisable, () => ctx.engine.disable());
    handle(types_1.CHANNELS.cloudSetup, (repo, token) => ctx.cloud.setup(str(repo, 'repositorio'), str(token, 'token')));
    handle(types_1.CHANNELS.cloudSync, async () => {
        await ctx.cloud.syncCreds().catch(() => undefined);
        return ctx.cloud.sync();
    });
    handle(types_1.CHANNELS.cloudDisable, () => ctx.cloud.disable());
    handle(types_1.CHANNELS.outputsApprove, (id) => ctx.autopilot.approve(str(id, 'id')));
    const afterDelete = (r) => {
        // si había algo subido a la nube de lo borrado, se retira en la siguiente sincronización
        if (r.removed && ctx.cloud.status().enabled)
            void ctx.cloud.sync().catch((e) => ctx.log.warn(`Nube: ${e.message}`));
        return r;
    };
    handle(types_1.CHANNELS.outputsDelete, (id) => {
        const r = ctx.library.removeMany([str(id, 'id')]);
        if (r.errors.length)
            throw new Error(r.errors[0].reason);
        return afterDelete(r);
    });
    handle(types_1.CHANNELS.outputsDeleteMany, (ids) => {
        if (!Array.isArray(ids) || ids.length > 500 || ids.some((i) => typeof i !== 'string'))
            throw new Error('Selección no válida.');
        return afterDelete(ctx.library.removeMany(ids));
    });
    handle(types_1.CHANNELS.autopilotRun, async (id) => {
        const vodId = str(id, 'id');
        const vod = ctx.store.data.vods.find((v) => v.id === vodId);
        if (!vod)
            throw new Error('El VOD no existe.');
        if (vod.status !== 'downloaded')
            throw new Error('El VOD todavía no está descargado.');
        // siempre se puede volver a analizar: si había un análisis en marcha (o colgado) se cancela y se empieza de nuevo
        void ctx.autopilot.run(vodId, { restart: true }).catch((e) => {
            if (!(0, abort_1.isCancelled)(e))
                ctx.log.error('Piloto automático', e);
        });
        return vod;
    });
    handle(types_1.CHANNELS.autopilotCancel, (id) => ctx.autopilot.cancel(str(id, 'id')));
    handle(types_1.CHANNELS.autopilotPause, (id) => ctx.autopilot.pause(str(id, 'id')));
    handle(types_1.CHANNELS.vodsDiscard, (id) => ctx.autopilot.discard(str(id, 'id')));
    handle(types_1.CHANNELS.vodsList, () => ctx.store.data.vods);
    handle(types_1.CHANNELS.vodsAdd, (url, title) => ctx.vods.add(str(url, 'url'), typeof title === 'string' ? title : undefined));
    handle(types_1.CHANNELS.outputsList, () => ctx.store.data.outputs);
    // lo que se crea desde la interfaz lleva el nombre que puso (o aceptó) el usuario: no se vuelve a renombrar solo
    const byUser = async (made) => {
        const o = await made;
        o.titleSource = 'manual';
        ctx.store.save();
        return o;
    };
    handle(types_1.CHANNELS.clipsCreate, (vodId, spec) => byUser(ctx.clips.createClip(str(vodId, 'vodId'), obj(spec, 'clip'))));
    handle(types_1.CHANNELS.clipsLong, (vodId, spec) => byUser(ctx.clips.createLong(str(vodId, 'vodId'), obj(spec, 'vídeo largo'))));
    handle(types_1.CHANNELS.planApply, async (vodId, planJson) => {
        const r = await ctx.clips.applyPlan(str(vodId, 'vodId'), str(planJson, 'plan'));
        for (const o of r.created)
            o.titleSource = 'manual'; // los nombres del plan los has puesto (o aceptado) tú
        ctx.store.save();
        return r;
    });
    handle(types_1.CHANNELS.pubsList, () => ctx.pubs.list());
    handle(types_1.CHANNELS.pubsSchedule, (outputId, platforms, atIso) => {
        if (!Array.isArray(platforms))
            throw new Error('Parámetro no válido: redes.');
        return ctx.pubs.schedule(str(outputId, 'outputId'), platforms, str(atIso, 'fecha'));
    });
    handle(types_1.CHANNELS.pubsCancel, (key) => {
        ctx.pubs.cancel(str(key, 'key'));
    });
    handle(types_1.CHANNELS.pubsSet, (outputId, entries) => {
        if (!Array.isArray(entries))
            throw new Error('Parámetro no válido: programación.');
        const list = entries.map((e) => {
            const o = obj(e, 'programación');
            return { platform: str(o.platform, 'red'), atIso: str(o.atIso, 'fecha') };
        });
        return ctx.pubs.setSchedule(str(outputId, 'outputId'), list);
    });
    handle(types_1.CHANNELS.outputsRename, (id, title) => ctx.library.rename(str(id, 'id'), str(title, 'nombre')));
    handle(types_1.CHANNELS.outputsMeta, (id, meta) => ctx.library.setMeta(str(id, 'id'), obj(meta, 'datos')));
    handle(types_1.CHANNELS.outputsThumbFrame, (id, at) => {
        if (typeof at !== 'number')
            throw new Error('Parámetro no válido: instante.');
        return ctx.library.setThumbnailFromFrame(str(id, 'id'), at);
    });
    handle(types_1.CHANNELS.outputsThumbImage, async (id) => {
        const outputId = str(id, 'id');
        if (!ctx.store.data.outputs.some((o) => o.id === outputId))
            throw new Error('El vídeo no existe.');
        const img = await platform.pickImage();
        return img ? ctx.library.setThumbnailFromImage(outputId, img) : null;
    });
    handle(types_1.CHANNELS.outputsReedit, (id, edit) => ctx.library.reeditClip(str(id, 'id'), obj(edit, 'edición')));
    handle(types_1.CHANNELS.outputsExport, async (id, version) => {
        const outputId = str(id, 'id');
        const v = str(version, 'versión');
        const name = ctx.library.exportName(outputId, v); // valida que exista esa versión antes de preguntar
        const dest = await platform.pickSavePath(name);
        return dest ? ctx.library.exportFile(outputId, v, dest) : null;
    });
    handle(types_1.CHANNELS.outputsFraming, (id) => ctx.library.framingPreview(str(id, 'id')));
    handle(types_1.CHANNELS.tasksList, () => ctx.tasks.list());
    handle(types_1.CHANNELS.whisperStatus, () => ctx.transcripts.status());
    handle(types_1.CHANNELS.whisperModel, () => ctx.transcripts.downloadModel());
    handle(types_1.CHANNELS.transcriptGet, (vodId) => ctx.transcripts.words(str(vodId, 'vodId')));
    handle(types_1.CHANNELS.transcriptImport, async (vodId) => {
        const id = str(vodId, 'vodId');
        const file = await platform.pickTranscript();
        return file ? ctx.transcripts.importFile(id, file) : null;
    });
    handle(types_1.CHANNELS.clipContext, (id) => ctx.library.clipContext(str(id, 'id')));
    handle(types_1.CHANNELS.autoName, async () => (await ctx.autopilot.refreshLibraryAtStart({ generic: false })) ?? { renamed: 0, described: 0, noTranscript: 0, kept: 0 });
    handle(types_1.CHANNELS.suggestTitle, (vodId, start, end) => ctx.autopilot.suggestTitle(str(vodId, 'vodId'), num(start, 'start'), num(end, 'end')));
    handle(types_1.CHANNELS.transcriptRun, (vodId) => ctx.transcripts.transcribe(str(vodId, 'vodId')));
    handle(types_1.CHANNELS.transcriptEdit, (vodId, changes) => ctx.transcripts.editLines(str(vodId, 'vodId'), changes));
    handle(types_1.CHANNELS.vocabGet, () => ctx.transcripts.vocabulary());
    handle(types_1.CHANNELS.momentsGet, (v) => ctx.moments.list(str(v, 'vodId')));
    handle(types_1.CHANNELS.momentsState, (v, k, st) => {
        if (st !== 'include' && st !== 'exclude' && st !== 'reset')
            throw new Error('Estado no válido.');
        return ctx.moments.setState(str(v, 'vodId'), str(k, 'key'), st);
    });
    handle(types_1.CHANNELS.momentsTrim, (v, k, a, b) => ctx.moments.trim(str(v, 'vodId'), str(k, 'key'), num(a, 'start'), num(b, 'end')));
    handle(types_1.CHANNELS.momentsAdd, (v, a, b, t) => ctx.moments.add(str(v, 'vodId'), num(a, 'start'), num(b, 'end'), typeof t === 'string' ? t : undefined));
    handle(types_1.CHANNELS.momentsRemove, (v, k) => ctx.moments.remove(str(v, 'vodId'), str(k, 'key')));
    handle(types_1.CHANNELS.momentsClear, (v) => ctx.moments.clear(str(v, 'vodId')));
    handle(types_1.CHANNELS.coversList, () => ctx.covers.list());
    handle(types_1.CHANNELS.coversAdd, (n, d) => {
        if (!(d instanceof Uint8Array))
            throw new Error('Parámetro no válido: archivo.');
        return ctx.covers.add(str(n, 'nombre'), Buffer.from(d));
    });
    handle(types_1.CHANNELS.coversRename, (id, n) => ctx.covers.rename(str(id, 'id'), str(n, 'nombre')));
    handle(types_1.CHANNELS.coversKind, (id, k) => ctx.covers.setKind(str(id, 'id'), k));
    handle(types_1.CHANNELS.coversRemove, (id) => ctx.covers.remove(str(id, 'id')));
    handle(types_1.CHANNELS.coversPreview, (id) => ctx.covers.preview(str(id, 'id')));
    handle(types_1.CHANNELS.coversCompose, (o) => {
        const r = obj(o, 'portada');
        return ctx.covers.compose({
            backgroundId: str(r.backgroundId, 'fondo'),
            subjectId: typeof r.subjectId === 'string' && r.subjectId ? r.subjectId : undefined,
            text: typeof r.text === 'string' ? r.text : '',
            badge: typeof r.badge === 'number' ? r.badge : null,
            name: typeof r.name === 'string' ? r.name : undefined,
        });
    });
    handle(types_1.CHANNELS.coversReveal, (id) => platform.showItem(ctx.covers.filePath(str(id, 'id'))));
    handle(types_1.CHANNELS.styleGet, () => ctx.style.get());
    handle(types_1.CHANNELS.styleSet, (p) => ctx.style.set(p));
    handle(types_1.CHANNELS.styleAddLore, (n, note, tr) => ctx.style.addLore(str(n, 'name'), typeof note === 'string' ? note : '', Array.isArray(tr) ? tr.filter((x) => typeof x === 'string') : []));
    handle(types_1.CHANNELS.styleRemoveLore, (id) => ctx.style.removeLore(str(id, 'id')));
    handle(types_1.CHANNELS.styleReset, () => ctx.style.reset());
    handle(types_1.CHANNELS.prefsGet, () => ctx.moments.prefs());
    handle(types_1.CHANNELS.prefsEnabled, (on) => ctx.moments.setPrefsEnabled(on === true));
    handle(types_1.CHANNELS.prefsReset, () => ctx.moments.resetPrefs());
    handle(types_1.CHANNELS.speakersGet, () => ({ available: ctx.speakers.available(), profiles: ctx.speakers.profiles() }));
    handle(types_1.CHANNELS.speakersRename, (id, alias) => ctx.speakers.rename(num(id, 'id'), typeof alias === 'string' ? alias : ''));
    handle(types_1.CHANNELS.speakersSelf, (id) => ctx.speakers.setSelf(id === null ? null : num(id, 'id')));
    handle(types_1.CHANNELS.speakersMerge, (from, into) => ctx.speakers.merge(num(from, 'from'), num(into, 'into')));
    handle(types_1.CHANNELS.vocabSet, (v) => ctx.transcripts.setVocabulary(v));
    handle(types_1.CHANNELS.transcriptPrompt, async (vodId) => {
        const id = str(vodId, 'vodId');
        const dur = await ctx.clips.vodDuration(id);
        return ctx.transcripts.claudePrompt(id, dur);
    });
    handle(types_1.CHANNELS.groupsList, () => ctx.groups.list());
    handle(types_1.CHANNELS.groupsCreate, (name, kind, section, parentId) => ctx.groups.create(str(name, 'nombre'), str(kind, 'tipo'), str(section, 'sección'), parentId === undefined || parentId === null ? undefined : str(parentId, 'carpeta')));
    handle(types_1.CHANNELS.groupsUpdate, (id, patch) => ctx.groups.update(str(id, 'id'), obj(patch, 'cambios')));
    handle(types_1.CHANNELS.groupsDelete, (id) => {
        ctx.groups.delete(str(id, 'id'));
    });
    handle(types_1.CHANNELS.groupsMove, (id, parentId) => ctx.groups.move(str(id, 'id'), parentId === null || parentId === undefined ? null : str(parentId, 'carpeta')));
    handle(types_1.CHANNELS.outputsMove, (id, groupId) => ctx.groups.moveOutput(str(id, 'id'), groupId === null || groupId === undefined ? null : str(groupId, 'carpeta')));
    handle(types_1.CHANNELS.shellOpen, async (p) => {
        const target = str(p, 'ruta');
        if (!isAllowedPath(ctx, target))
            throw new Error('Esa ruta no pertenece a la aplicación.');
        if (node_fs_1.default.existsSync(target) && node_fs_1.default.statSync(target).isFile())
            platform.showItem(target);
        else
            await platform.openFolder(target);
    });
}
