import fs from 'node:fs';

export interface SocialDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  warn?: (msg: string) => void;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PublishError extends Error {}

/** Lee un trozo de un archivo grande sin cargarlo entero en memoria. */
export async function readChunk(file: string, start: number, endExclusive: number): Promise<Buffer> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const len = endExclusive - start;
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const { bytesRead } = await fh.read(buf, got, len - got, start + got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return got === len ? buf : buf.subarray(0, got);
  } finally {
    await fh.close();
  }
}

export async function timedFetch(f: typeof fetch, url: string, init: RequestInit, ms = 60_000): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const n = (e as Error).name;
    if (n === 'TimeoutError' || n === 'AbortError') throw new PublishError('La red social no respondió a tiempo.');
    throw new PublishError('No se pudo conectar con la red social. Comprueba tu conexión a internet.');
  }
}

/** Texto corto y limpio del error que devuelve una API (sin volcar HTML ni datos privados). */
export async function apiMessage(res: Response): Promise<string> {
  const t = await res.text().catch(() => '');
  try {
    const j = JSON.parse(t) as { error?: { message?: string; errors?: { reason?: string }[] } | string; message?: string };
    const reason = typeof j.error === 'object' ? j.error?.errors?.[0]?.reason : undefined;
    const m = typeof j.error === 'object' ? j.error?.message : (j.error ?? j.message);
    return [reason, m].filter(Boolean).join(': ').slice(0, 300) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
