"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const types_1 = require("../shared/types");
/** Llama al proceso principal y convierte un Result de error en una excepción con mensaje limpio. */
async function call(channel, ...args) {
    const r = (await electron_1.ipcRenderer.invoke(channel, ...args));
    if (!r.ok)
        throw new Error(r.error);
    return r.value;
}
const api = {
    getSettings: () => call(types_1.CHANNELS.settingsGet),
    setSettings: (patch) => call(types_1.CHANNELS.settingsSet, patch),
    pickFolder: () => call(types_1.CHANNELS.pickFolder),
    checkTools: () => call(types_1.CHANNELS.toolsCheck),
    twitchTest: () => call(types_1.CHANNELS.twitchTest),
    twitchVods: () => call(types_1.CHANNELS.twitchVods),
    channelStatus: () => call(types_1.CHANNELS.channelStatus),
    channelRefresh: () => call(types_1.CHANNELS.channelRefresh),
    channelAnalyze: (id) => call(types_1.CHANNELS.channelAnalyze, id),
    channelClips: (force, login) => call(types_1.CHANNELS.channelClips, force, login),
    channelImportClip: (id) => call(types_1.CHANNELS.channelImportClip, id),
    channelClipStream: (id) => call(types_1.CHANNELS.channelClipStream, id),
    listConnections: () => call(types_1.CHANNELS.connList),
    setConnectionApp: (p, id, secret) => call(types_1.CHANNELS.connSet, p, id, secret),
    connectPlatform: (p) => call(types_1.CHANNELS.connConnect, p),
    cancelConnect: () => call(types_1.CHANNELS.connCancel),
    disconnectPlatform: (p) => call(types_1.CHANNELS.connDisconnect, p),
    youtubePlaylists: () => call(types_1.CHANNELS.ytPlaylists),
    updateStatus: () => call(types_1.CHANNELS.updateStatus),
    updateCheck: () => call(types_1.CHANNELS.updateCheck),
    updateInstall: () => call(types_1.CHANNELS.updateInstall),
    onUpdate: (cb) => {
        const h = (_e, s) => cb(s);
        electron_1.ipcRenderer.on(types_1.CHANNELS.eventUpdate, h);
        return () => electron_1.ipcRenderer.removeListener(types_1.CHANNELS.eventUpdate, h);
    },
    cloudStatus: () => call(types_1.CHANNELS.cloudStatus),
    cloudSetup: (repo, token) => call(types_1.CHANNELS.cloudSetup, repo, token),
    cloudSync: () => call(types_1.CHANNELS.cloudSync),
    cloudDisable: () => call(types_1.CHANNELS.cloudDisable),
    engineStatus: () => call(types_1.CHANNELS.engineStatus),
    engineSetup: (repo, token) => call(types_1.CHANNELS.engineSetup, repo, token),
    engineSync: () => call(types_1.CHANNELS.engineSync),
    engineDisable: () => call(types_1.CHANNELS.engineDisable),
    approveOutput: (id) => call(types_1.CHANNELS.outputsApprove, id),
    deleteOutput: (id) => call(types_1.CHANNELS.outputsDelete, id),
    deleteOutputs: (ids) => call(types_1.CHANNELS.outputsDeleteMany, ids),
    runAutopilot: (id) => call(types_1.CHANNELS.autopilotRun, id),
    cancelAutopilot: (id) => call(types_1.CHANNELS.autopilotCancel, id),
    pauseAutopilot: (id) => call(types_1.CHANNELS.autopilotPause, id),
    discardVod: (id) => call(types_1.CHANNELS.vodsDiscard, id),
    setAutoImport: (on) => call(types_1.CHANNELS.channelAuto, on),
    onChannelUpdate: (cb) => {
        const h = (_e, s) => cb(s);
        electron_1.ipcRenderer.on(types_1.CHANNELS.eventChannel, h);
        return () => electron_1.ipcRenderer.removeListener(types_1.CHANNELS.eventChannel, h);
    },
    listVods: () => call(types_1.CHANNELS.vodsList),
    addVod: (url, title) => call(types_1.CHANNELS.vodsAdd, url, title),
    listOutputs: () => call(types_1.CHANNELS.outputsList),
    createClip: (vodId, spec) => call(types_1.CHANNELS.clipsCreate, vodId, spec),
    createLong: (vodId, spec) => call(types_1.CHANNELS.clipsLong, vodId, spec),
    applyPlan: (vodId, planJson) => call(types_1.CHANNELS.planApply, vodId, planJson),
    listPublications: () => call(types_1.CHANNELS.pubsList),
    schedule: (outputId, platforms, atIso) => call(types_1.CHANNELS.pubsSchedule, outputId, platforms, atIso),
    cancelPublication: (key) => call(types_1.CHANNELS.pubsCancel, key),
    setSchedule: (outputId, entries) => call(types_1.CHANNELS.pubsSet, outputId, entries),
    updateOutputMeta: (id, meta) => call(types_1.CHANNELS.outputsMeta, id, meta),
    renameOutput: (id, title) => call(types_1.CHANNELS.outputsRename, id, title),
    setThumbnailFromFrame: (id, at) => call(types_1.CHANNELS.outputsThumbFrame, id, at),
    setThumbnailFromImage: (id) => call(types_1.CHANNELS.outputsThumbImage, id),
    reeditClip: (id, edit) => call(types_1.CHANNELS.outputsReedit, id, edit),
    framingPreview: (id) => call(types_1.CHANNELS.outputsFraming, id),
    getTranscript: (vodId) => call(types_1.CHANNELS.transcriptGet, vodId),
    importTranscript: (vodId) => call(types_1.CHANNELS.transcriptImport, vodId),
    transcribeVod: (vodId) => call(types_1.CHANNELS.transcriptRun, vodId),
    editTranscript: (vodId, changes) => call(types_1.CHANNELS.transcriptEdit, vodId, changes),
    getVocabulary: () => call(types_1.CHANNELS.vocabGet),
    getMoments: (v) => call(types_1.CHANNELS.momentsGet, v),
    setMomentState: (v, k, st) => call(types_1.CHANNELS.momentsState, v, k, st),
    trimMoment: (v, k, a, b) => call(types_1.CHANNELS.momentsTrim, v, k, a, b),
    addMoment: (v, a, b, t) => call(types_1.CHANNELS.momentsAdd, v, a, b, t),
    removeMoment: (v, k) => call(types_1.CHANNELS.momentsRemove, v, k),
    clearMomentEdits: (v) => call(types_1.CHANNELS.momentsClear, v),
    coversList: () => call(types_1.CHANNELS.coversList),
    coversAdd: (n, d) => call(types_1.CHANNELS.coversAdd, n, d),
    coversRename: (id, n) => call(types_1.CHANNELS.coversRename, id, n),
    coversSetKind: (id, k) => call(types_1.CHANNELS.coversKind, id, k),
    coversRemove: (id) => call(types_1.CHANNELS.coversRemove, id),
    coversPreview: (id) => call(types_1.CHANNELS.coversPreview, id),
    coversCompose: (o) => call(types_1.CHANNELS.coversCompose, o),
    coversReveal: (id) => call(types_1.CHANNELS.coversReveal, id),
    getStyle: () => call(types_1.CHANNELS.styleGet),
    setStyle: (p) => call(types_1.CHANNELS.styleSet, p),
    addLore: (n, note, tr) => call(types_1.CHANNELS.styleAddLore, n, note, tr),
    removeLore: (id) => call(types_1.CHANNELS.styleRemoveLore, id),
    resetStyle: () => call(types_1.CHANNELS.styleReset),
    getPrefs: () => call(types_1.CHANNELS.prefsGet),
    setPrefsEnabled: (on) => call(types_1.CHANNELS.prefsEnabled, on),
    resetPrefs: () => call(types_1.CHANNELS.prefsReset),
    getSpeakers: () => call(types_1.CHANNELS.speakersGet),
    renameSpeaker: (id, alias) => call(types_1.CHANNELS.speakersRename, id, alias),
    setSelfSpeaker: (id) => call(types_1.CHANNELS.speakersSelf, id),
    mergeSpeakers: (from, into) => call(types_1.CHANNELS.speakersMerge, from, into),
    setVocabulary: (v) => call(types_1.CHANNELS.vocabSet, v),
    clipContext: (id) => call(types_1.CHANNELS.clipContext, id),
    suggestTitle: (vodId, start, end) => call(types_1.CHANNELS.suggestTitle, vodId, start, end),
    autoNameLibrary: () => call(types_1.CHANNELS.autoName),
    claudePrompt: (vodId) => call(types_1.CHANNELS.transcriptPrompt, vodId),
    listGroups: () => call(types_1.CHANNELS.groupsList),
    createGroup: (name, kind, section, parentId) => call(types_1.CHANNELS.groupsCreate, name, kind, section, parentId),
    updateGroup: (id, patch) => call(types_1.CHANNELS.groupsUpdate, id, patch),
    deleteGroup: (id) => call(types_1.CHANNELS.groupsDelete, id),
    moveGroup: (id, parentId) => call(types_1.CHANNELS.groupsMove, id, parentId),
    moveOutput: (id, groupId) => call(types_1.CHANNELS.outputsMove, id, groupId),
    exportOutput: (id, version) => call(types_1.CHANNELS.outputsExport, id, version),
    openPath: (p) => call(types_1.CHANNELS.shellOpen, p),
    listTasks: () => call(types_1.CHANNELS.tasksList),
    onTaskUpdate: (cb) => {
        const h = (_e, t) => cb(t);
        electron_1.ipcRenderer.on(types_1.CHANNELS.eventTask, h);
        return () => electron_1.ipcRenderer.removeListener(types_1.CHANNELS.eventTask, h);
    },
    whisperStatus: () => call(types_1.CHANNELS.whisperStatus),
    downloadWhisperModel: () => call(types_1.CHANNELS.whisperModel),
    onVodUpdate: (cb) => {
        const h = (_e, v) => cb(v);
        electron_1.ipcRenderer.on(types_1.CHANNELS.eventVod, h);
        return () => electron_1.ipcRenderer.removeListener(types_1.CHANNELS.eventVod, h);
    },
    onDataChanged: (cb) => {
        const h = () => cb();
        electron_1.ipcRenderer.on(types_1.CHANNELS.eventData, h);
        return () => electron_1.ipcRenderer.removeListener(types_1.CHANNELS.eventData, h);
    },
};
electron_1.contextBridge.exposeInMainWorld('api', api);
