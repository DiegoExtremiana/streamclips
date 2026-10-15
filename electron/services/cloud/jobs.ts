import type { OutputItem, Platform } from '../../../shared/types';

export type CloudJobStatus = 'queued' | 'publishing' | 'published' | 'failed';

export interface CloudJob {
  v: 1;
  key: string;
  platform: Platform;
  scheduledAt: string;
  status: CloudJobStatus;
  title: string;
  description?: string;
  playlist?: string;
  visibility?: 'public' | 'private';
  kind: OutputItem['kind'];
  releaseId: number;
  releaseTag: string;
  file: { name: string; assetId: number; size: number };
  thumb?: { name: string; assetId: number };
  note?: string;
  updatedAt: string;
}

export const jobPath = (key: string): string => `queue/${key.replace(/[^\w-]/g, '__')}.json`;
export const releaseTag = (key: string): string => `q-${key.replace(/[^\w-]/g, '-')}`.slice(0, 120);

export function parseJob(text: string): CloudJob | null {
  try {
    const j = JSON.parse(text) as Partial<CloudJob>;
    if (j.v !== 1 || typeof j.key !== 'string' || typeof j.platform !== 'string' || typeof j.scheduledAt !== 'string' || !j.file) return null;
    if (!['queued', 'publishing', 'published', 'failed'].includes(String(j.status))) return null;
    return j as CloudJob;
  } catch {
    return null;
  }
}

/** Texto del trabajo con una clave en cada línea: los cambios se ven bien en el historial de GitHub. */
export const serializeJob = (j: CloudJob): string => `${JSON.stringify(j, null, 2)}\n`;
