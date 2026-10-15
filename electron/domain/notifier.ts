import type { ChannelStatus, TaskInfo, UpdateStatus, VodJob } from '../../shared/types';

/** Avisos hacia la interfaz. En Electron se envían por IPC; en las pruebas se sustituyen. */
export interface Notifier {
  vod(job: VodJob): void;
  changed(): void;
  task(t: TaskInfo): void;
  channel(s: ChannelStatus): void;
  update(s: UpdateStatus): void;
}

export const silentNotifier: Notifier = { vod: () => undefined, changed: () => undefined, task: () => undefined, channel: () => undefined, update: () => undefined };
