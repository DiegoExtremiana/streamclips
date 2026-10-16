import fs from 'node:fs';
import { PublishError } from '../social/common';

export interface GithubOpts {
  token: string;
  /** "usuario/repositorio" */
  repo: string;
  api?: string;
  uploads?: string;
  fetchFn?: typeof fetch;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Content {
  sha: string;
  text: string;
}

/** Cliente mínimo de la API REST de GitHub: solo lo que usa el modo nube. */
export class Github {
  private api: string;
  private uploads: string;
  private f: typeof fetch;

  constructor(private o: GithubOpts) {
    this.api = o.api ?? 'https://api.github.com';
    this.uploads = o.uploads ?? 'https://uploads.github.com';
    this.f = o.fetchFn ?? fetch;
  }

  private async req(method: string, url: string, init: { json?: unknown; headers?: Record<string, string>; body?: BodyInit; duplex?: boolean; timeout?: number } = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.f(url.startsWith('http') ? url : `${this.api}${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.o.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'StreamClips',
          ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        signal: AbortSignal.timeout(init.timeout ?? 60_000),
        ...(init.duplex ? { duplex: 'half' } : {}),
      } as RequestInit);
    } catch {
      throw new GithubError('No se pudo conectar con GitHub. Comprueba tu conexión a internet.', 0);
    }
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    const m = j.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new GithubError('GitHub rechazó el token. Revisa que no haya caducado.', 401);
    if (res.status === 403 && /rate limit/i.test(m)) throw new GithubError('GitHub limitó las peticiones. Se reintentará más tarde.', 403);
    if (res.status === 403) throw new GithubError(`GitHub no permite ${what} con este token (${m}). Revisa los permisos del token.`, 403);
    if (res.status === 404) throw new GithubError(`GitHub no encuentra ${what}. Comprueba el nombre del repositorio y los permisos del token.`, 404);
    throw new GithubError(`GitHub: ${what}: ${m}`, res.status);
  }

  async repoInfo(): Promise<{ private: boolean; fullName: string; defaultBranch: string }> {
    const r = await this.req('GET', `/repos/${this.o.repo}`);
    if (!r.ok) await this.fail(r, 'el repositorio');
    const j = (await r.json()) as { private: boolean; full_name: string; default_branch: string };
    return { private: j.private, fullName: j.full_name, defaultBranch: j.default_branch };
  }

  async getContent(path: string): Promise<Content | null> {
    const r = await this.req('GET', `/repos/${this.o.repo}/contents/${encodePath(path)}`);
    if (r.status === 404) return null;
    if (!r.ok) await this.fail(r, `el archivo ${path}`);
    const j = (await r.json()) as { sha: string; content?: string; encoding?: string };
    return { sha: j.sha, text: Buffer.from(j.content ?? '', 'base64').toString('utf8') };
  }

  /** Crea o actualiza. Con `sha`, solo si nadie lo ha cambiado desde (así dos procesos no pisan el mismo trabajo). Devuelve el nuevo sha, o null si el archivo cambió. */
  async putContent(path: string, text: string, message: string, sha?: string): Promise<string | null> {
    const r = await this.req('PUT', `/repos/${this.o.repo}/contents/${encodePath(path)}`, {
      json: { message, content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}) },
    });
    if (r.status === 409 || r.status === 422) return null;
    if (!r.ok) await this.fail(r, `guardar ${path}`);
    return ((await r.json()) as { content: { sha: string } }).content.sha;
  }

  async deleteContent(path: string, sha: string, message: string): Promise<void> {
    const r = await this.req('DELETE', `/repos/${this.o.repo}/contents/${encodePath(path)}`, { json: { message, sha } });
    if (!r.ok && r.status !== 404 && r.status !== 409) await this.fail(r, `borrar ${path}`);
  }

  async listDir(path: string): Promise<{ name: string; sha: string }[]> {
    const r = await this.req('GET', `/repos/${this.o.repo}/contents/${encodePath(path)}`);
    if (r.status === 404) return [];
    if (!r.ok) await this.fail(r, `la carpeta ${path}`);
    const j = (await r.json()) as { name: string; sha: string; type: string }[];
    return Array.isArray(j) ? j.filter((x) => x.type === 'file').map((x) => ({ name: x.name, sha: x.sha })) : [];
  }

  async createRelease(tag: string, name: string): Promise<{ id: number }> {
    const r = await this.req('POST', `/repos/${this.o.repo}/releases`, { json: { tag_name: tag, name, draft: false, prerelease: true, body: 'Vídeo en cola de StreamClips. Se borra solo al publicarse.' } });
    if (!r.ok) await this.fail(r, 'crear la versión de subida');
    return { id: ((await r.json()) as { id: number }).id };
  }

  async uploadAsset(releaseId: number, name: string, file: string, contentType: string): Promise<{ id: number; size: number }> {
    const size = fs.statSync(file).size;
    const r = await this.req('POST', `${this.uploads}/repos/${this.o.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
      headers: { 'Content-Type': contentType, 'Content-Length': String(size) },
      body: fs.createReadStream(file) as unknown as BodyInit,
      duplex: true,
      timeout: 60 * 60_000,
    });
    if (r.status === 422) throw new GithubError(`GitHub no admite este archivo (${name}); el máximo por archivo son 2 GB.`, 422);
    if (!r.ok) await this.fail(r, 'subir el vídeo');
    const j = (await r.json()) as { id: number; size: number };
    if (j.size !== size) throw new GithubError('La subida a GitHub quedó incompleta. Se reintentará.', 0);
    return { id: j.id, size: j.size };
  }

  async downloadAsset(assetId: number, dest: string): Promise<void> {
    const r = await this.req('GET', `/repos/${this.o.repo}/releases/assets/${assetId}`, { headers: { Accept: 'application/octet-stream' }, timeout: 60 * 60_000 });
    if (!r.ok || !r.body) await this.fail(r, 'descargar el vídeo');
    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(Readable.fromWeb(r.body as never), fs.createWriteStream(dest));
  }

  /** Borra la versión y su etiqueta (y con ella los archivos). */
  async deleteRelease(releaseId: number, tag: string): Promise<void> {
    const r = await this.req('DELETE', `/repos/${this.o.repo}/releases/${releaseId}`);
    if (!r.ok && r.status !== 404) await this.fail(r, 'borrar la versión');
    const t = await this.req('DELETE', `/repos/${this.o.repo}/git/refs/tags/${encodeURIComponent(tag)}`);
    if (!t.ok && t.status !== 404 && t.status !== 422) await this.fail(t, 'borrar la etiqueta');
  }

  async publicKey(): Promise<{ keyId: string; key: string }> {
    const r = await this.req('GET', `/repos/${this.o.repo}/actions/secrets/public-key`);
    if (!r.ok) await this.fail(r, 'la clave pública de secretos');
    const j = (await r.json()) as { key_id: string; key: string };
    return { keyId: j.key_id, key: j.key };
  }

  async putSecret(name: string, encryptedBase64: string, keyId: string): Promise<void> {
    const r = await this.req('PUT', `/repos/${this.o.repo}/actions/secrets/${name}`, { json: { encrypted_value: encryptedBase64, key_id: keyId } });
    if (!r.ok) await this.fail(r, `guardar el secreto ${name}`);
  }

  async deleteSecret(name: string): Promise<void> {
    const r = await this.req('DELETE', `/repos/${this.o.repo}/actions/secrets/${name}`);
    if (!r.ok && r.status !== 404) await this.fail(r, `borrar el secreto ${name}`);
  }

  async dispatch(workflowFile: string, ref: string): Promise<void> {
    const r = await this.req('POST', `/repos/${this.o.repo}/actions/workflows/${workflowFile}/dispatches`, { json: { ref } });
    if (!r.ok) await this.fail(r, 'lanzar el flujo de publicación');
  }
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export { PublishError };
