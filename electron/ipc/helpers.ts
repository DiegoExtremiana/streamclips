import type { Result } from '../../shared/types';
import type { AppContext } from '../app/context';
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

export function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Parámetro no válido: ${name}.`);
  return v;
}

export function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Error(`Parámetro no válido: ${name}.`);
  return v;
}

export function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`Parámetro no válido: ${name}.`);
  return v as Record<string, unknown>;
}

/** El renderizador solo puede abrir cosas que pertenecen a la aplicación. */
export function isAllowedPath(ctx: AppContext, p: string): boolean {
  const { store } = ctx;
  if (isInside(store.data.settings.outputDir, p)) return true;
  if (isInside(ctx.database.dir, p)) return true;
  if (p === ctx.clipScores.notesPath() || p === ctx.clipScores.databasePath()) return true;
  return store.data.vods.some((v) => v.filePath === p) || store.data.outputs.some((o) => allFiles(o).includes(p));
}

/** Registra un canal IPC: convierte lanzamientos de error en un Result para que el mensaje llegue limpio a la interfaz. */
export type Handle = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>) => void;

export function makeHandle(ipc: IpcLike, ctx: AppContext): Handle {
  return <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>) =>
    ipc.handle(channel, async (_event, ...args): Promise<Result<T>> => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        ctx.log.warn(`IPC ${channel}: ${message}`);
        return { ok: false, error: message };
      }
    });
}

/** Lo que recibe cada módulo de canales: cómo registrar, el contexto de la aplicación y las acciones del sistema. */
export interface IpcContext {
  handle: Handle;
  ctx: AppContext;
  platform: IpcPlatform;
}
