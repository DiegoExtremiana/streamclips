import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/types';
import type { Api, Result, VodJob } from '../shared/types';

/** Llama al proceso principal y convierte un Result de error en una excepción con mensaje limpio. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T>;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const api: Api = {
  getSettings: () => call(CHANNELS.settingsGet),
  setSettings: (patch) => call(CHANNELS.settingsSet, patch),
  pickFolder: () => call(CHANNELS.pickFolder),
  checkTools: () => call(CHANNELS.toolsCheck),
  twitchTest: () => call(CHANNELS.twitchTest),
  twitchVods: () => call(CHANNELS.twitchVods),
  channelStatus: () => call(CHANNELS.channelStatus),
  channelRefresh: () => call(CHANNELS.channelRefresh),
  channelAnalyze: (id) => call(CHANNELS.channelAnalyze, id),
  channelClips: (force) => call(CHANNELS.channelClips, force),
  channelImportClip: (id) => call(CHANNELS.channelImportClip, id),
  channelClipStream: (id) => call(CHANNELS.channelClipStream, id),
  listConnections: () => call(CHANNELS.connList),
  setConnectionApp: (p, id, secret) => call(CHANNELS.connSet, p, id, secret),
  connectPlatform: (p) => call(CHANNELS.connConnect, p),
  cancelConnect: () => call(CHANNELS.connCancel),
  disconnectPlatform: (p) => call(CHANNELS.connDisconnect, p),
  youtubePlaylists: () => call(CHANNELS.ytPlaylists),
  updateStatus: () => call(CHANNELS.updateStatus),
  updateCheck: () => call(CHANNELS.updateCheck),
  updateInstall: () => call(CHANNELS.updateInstall),
  onUpdate: (cb) => {
    const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s);
    ipcRenderer.on(CHANNELS.eventUpdate, h);
    return () => ipcRenderer.removeListener(CHANNELS.eventUpdate, h);
  },
  cloudStatus: () => call(CHANNELS.cloudStatus),
  cloudSetup: (repo, token) => call(CHANNELS.cloudSetup, repo, token),
  cloudSync: () => call(CHANNELS.cloudSync),
  cloudDisable: () => call(CHANNELS.cloudDisable),
  engineStatus: () => call(CHANNELS.engineStatus),
  engineSetup: (repo, token) => call(CHANNELS.engineSetup, repo, token),
  engineSync: () => call(CHANNELS.engineSync),
  engineDisable: () => call(CHANNELS.engineDisable),
  approveOutput: (id) => call(CHANNELS.outputsApprove, id),
  deleteOutput: (id) => call(CHANNELS.outputsDelete, id),
  deleteOutputs: (ids) => call(CHANNELS.outputsDeleteMany, ids),
  runAutopilot: (id) => call(CHANNELS.autopilotRun, id),
  cancelAutopilot: (id) => call(CHANNELS.autopilotCancel, id),
  discardVod: (id) => call(CHANNELS.vodsDiscard, id),
  setAutoImport: (on) => call(CHANNELS.channelAuto, on),
  onChannelUpdate: (cb) => {
    const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s);
    ipcRenderer.on(CHANNELS.eventChannel, h);
    return () => ipcRenderer.removeListener(CHANNELS.eventChannel, h);
  },
  listVods: () => call(CHANNELS.vodsList),
  addVod: (url, title) => call(CHANNELS.vodsAdd, url, title),
  listOutputs: () => call(CHANNELS.outputsList),
  createClip: (vodId, spec) => call(CHANNELS.clipsCreate, vodId, spec),
  createLong: (vodId, spec) => call(CHANNELS.clipsLong, vodId, spec),
  applyPlan: (vodId, planJson) => call(CHANNELS.planApply, vodId, planJson),
  listPublications: () => call(CHANNELS.pubsList),
  schedule: (outputId, platforms, atIso) => call(CHANNELS.pubsSchedule, outputId, platforms, atIso),
  cancelPublication: (key) => call(CHANNELS.pubsCancel, key),
  setSchedule: (outputId, entries) => call(CHANNELS.pubsSet, outputId, entries),
  updateOutputMeta: (id, meta) => call(CHANNELS.outputsMeta, id, meta),
  renameOutput: (id, title) => call(CHANNELS.outputsRename, id, title),
  setThumbnailFromFrame: (id, at) => call(CHANNELS.outputsThumbFrame, id, at),
  setThumbnailFromImage: (id) => call(CHANNELS.outputsThumbImage, id),
  reeditClip: (id, edit) => call(CHANNELS.outputsReedit, id, edit),
  framingPreview: (id) => call(CHANNELS.outputsFraming, id),
  getTranscript: (vodId) => call(CHANNELS.transcriptGet, vodId),
  importTranscript: (vodId) => call(CHANNELS.transcriptImport, vodId),
  transcribeVod: (vodId) => call(CHANNELS.transcriptRun, vodId),
  clipContext: (id) => call(CHANNELS.clipContext, id),
  suggestTitle: (vodId, start, end) => call(CHANNELS.suggestTitle, vodId, start, end),
  autoNameLibrary: () => call(CHANNELS.autoName),
  claudePrompt: (vodId) => call(CHANNELS.transcriptPrompt, vodId),
  listGroups: () => call(CHANNELS.groupsList),
  createGroup: (name, kind, section, parentId) => call(CHANNELS.groupsCreate, name, kind, section, parentId),
  updateGroup: (id, patch) => call(CHANNELS.groupsUpdate, id, patch),
  deleteGroup: (id) => call(CHANNELS.groupsDelete, id),
  moveGroup: (id, parentId) => call(CHANNELS.groupsMove, id, parentId),
  moveOutput: (id, groupId) => call(CHANNELS.outputsMove, id, groupId),
  exportOutput: (id, version) => call(CHANNELS.outputsExport, id, version),
  openPath: (p) => call(CHANNELS.shellOpen, p),
  listTasks: () => call(CHANNELS.tasksList),
  onTaskUpdate: (cb) => {
    const h = (_e: unknown, t: Parameters<typeof cb>[0]) => cb(t);
    ipcRenderer.on(CHANNELS.eventTask, h);
    return () => ipcRenderer.removeListener(CHANNELS.eventTask, h);
  },
  whisperStatus: () => call(CHANNELS.whisperStatus),
  downloadWhisperModel: () => call(CHANNELS.whisperModel),
  onVodUpdate: (cb) => {
    const h = (_e: unknown, v: VodJob) => cb(v);
    ipcRenderer.on(CHANNELS.eventVod, h);
    return () => ipcRenderer.removeListener(CHANNELS.eventVod, h);
  },
  onDataChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on(CHANNELS.eventData, h);
    return () => ipcRenderer.removeListener(CHANNELS.eventData, h);
  },
};

contextBridge.exposeInMainWorld('api', api);
