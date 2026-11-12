"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublishError = exports.Github = exports.GithubError = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const common_1 = require("../social/common");
Object.defineProperty(exports, "PublishError", { enumerable: true, get: function () { return common_1.PublishError; } });
class GithubError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
exports.GithubError = GithubError;
/** Cliente mínimo de la API REST de GitHub: solo lo que usa el modo nube. */
class Github {
    o;
    api;
    uploads;
    f;
    constructor(o) {
        this.o = o;
        this.api = o.api ?? 'https://api.github.com';
        this.uploads = o.uploads ?? 'https://uploads.github.com';
        this.f = o.fetchFn ?? fetch;
    }
    async req(method, url, init = {}) {
        let res;
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
            });
        }
        catch {
            throw new GithubError('No se pudo conectar con GitHub. Comprueba tu conexión a internet.', 0);
        }
        return res;
    }
    async fail(res, what) {
        const j = (await res.json().catch(() => ({})));
        const m = j.message ?? `HTTP ${res.status}`;
        if (res.status === 401)
            throw new GithubError('GitHub rechazó el token. Revisa que no haya caducado.', 401);
        if (res.status === 403 && /rate limit/i.test(m))
            throw new GithubError('GitHub limitó las peticiones. Se reintentará más tarde.', 403);
        if (res.status === 403)
            throw new GithubError(`GitHub no permite ${what} con este token (${m}). Revisa los permisos del token.`, 403);
        if (res.status === 404)
            throw new GithubError(`GitHub no encuentra ${what}. Comprueba el nombre del repositorio y los permisos del token.`, 404);
        throw new GithubError(`GitHub: ${what}: ${m}`, res.status);
    }
    async repoInfo() {
        const r = await this.req('GET', `/repos/${this.o.repo}`);
        if (!r.ok)
            await this.fail(r, 'el repositorio');
        const j = (await r.json());
        return { private: j.private, fullName: j.full_name, defaultBranch: j.default_branch };
    }
    async getContent(path) {
        const r = await this.req('GET', `/repos/${this.o.repo}/contents/${encodePath(path)}`);
        if (r.status === 404)
            return null;
        if (!r.ok)
            await this.fail(r, `el archivo ${path}`);
        const j = (await r.json());
        return { sha: j.sha, text: Buffer.from(j.content ?? '', 'base64').toString('utf8') };
    }
    /** Crea o actualiza. Con `sha`, solo si nadie lo ha cambiado desde (así dos procesos no pisan el mismo trabajo). Devuelve el nuevo sha, o null si el archivo cambió. */
    async putContent(path, text, message, sha) {
        const r = await this.req('PUT', `/repos/${this.o.repo}/contents/${encodePath(path)}`, {
            json: { message, content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}) },
        });
        if (r.status === 409 || r.status === 422)
            return null;
        if (!r.ok)
            await this.fail(r, `guardar ${path}`);
        return (await r.json()).content.sha;
    }
    async deleteContent(path, sha, message) {
        const r = await this.req('DELETE', `/repos/${this.o.repo}/contents/${encodePath(path)}`, { json: { message, sha } });
        if (!r.ok && r.status !== 404 && r.status !== 409)
            await this.fail(r, `borrar ${path}`);
    }
    async listDir(path) {
        const r = await this.req('GET', `/repos/${this.o.repo}/contents/${encodePath(path)}`);
        if (r.status === 404)
            return [];
        if (!r.ok)
            await this.fail(r, `la carpeta ${path}`);
        const j = (await r.json());
        return Array.isArray(j) ? j.filter((x) => x.type === 'file').map((x) => ({ name: x.name, sha: x.sha })) : [];
    }
    async createRelease(tag, name) {
        const r = await this.req('POST', `/repos/${this.o.repo}/releases`, { json: { tag_name: tag, name, draft: false, prerelease: true, body: 'Vídeo en cola de StreamClips. Se borra solo al publicarse.' } });
        if (!r.ok)
            await this.fail(r, 'crear la versión de subida');
        return { id: (await r.json()).id };
    }
    async uploadAsset(releaseId, name, file, contentType) {
        const size = node_fs_1.default.statSync(file).size;
        const r = await this.req('POST', `${this.uploads}/repos/${this.o.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
            headers: { 'Content-Type': contentType, 'Content-Length': String(size) },
            body: node_fs_1.default.createReadStream(file),
            duplex: true,
            timeout: 60 * 60_000,
        });
        if (r.status === 422)
            throw new GithubError(`GitHub no admite este archivo (${name}); el máximo por archivo son 2 GB.`, 422);
        if (!r.ok)
            await this.fail(r, 'subir el vídeo');
        const j = (await r.json());
        if (j.size !== size)
            throw new GithubError('La subida a GitHub quedó incompleta. Se reintentará.', 0);
        return { id: j.id, size: j.size };
    }
    async downloadAsset(assetId, dest) {
        const r = await this.req('GET', `/repos/${this.o.repo}/releases/assets/${assetId}`, { headers: { Accept: 'application/octet-stream' }, timeout: 60 * 60_000 });
        if (!r.ok || !r.body)
            await this.fail(r, 'descargar el vídeo');
        const { Readable } = await Promise.resolve().then(() => __importStar(require('node:stream')));
        const { pipeline } = await Promise.resolve().then(() => __importStar(require('node:stream/promises')));
        await pipeline(Readable.fromWeb(r.body), node_fs_1.default.createWriteStream(dest));
    }
    /** Borra la versión y su etiqueta (y con ella los archivos). */
    async deleteRelease(releaseId, tag) {
        const r = await this.req('DELETE', `/repos/${this.o.repo}/releases/${releaseId}`);
        if (!r.ok && r.status !== 404)
            await this.fail(r, 'borrar la versión');
        const t = await this.req('DELETE', `/repos/${this.o.repo}/git/refs/tags/${encodeURIComponent(tag)}`);
        if (!t.ok && t.status !== 404 && t.status !== 422)
            await this.fail(t, 'borrar la etiqueta');
    }
    async publicKey() {
        const r = await this.req('GET', `/repos/${this.o.repo}/actions/secrets/public-key`);
        if (!r.ok)
            await this.fail(r, 'la clave pública de secretos');
        const j = (await r.json());
        return { keyId: j.key_id, key: j.key };
    }
    async putSecret(name, encryptedBase64, keyId) {
        const r = await this.req('PUT', `/repos/${this.o.repo}/actions/secrets/${name}`, { json: { encrypted_value: encryptedBase64, key_id: keyId } });
        if (!r.ok)
            await this.fail(r, `guardar el secreto ${name}`);
    }
    async deleteSecret(name) {
        const r = await this.req('DELETE', `/repos/${this.o.repo}/actions/secrets/${name}`);
        if (!r.ok && r.status !== 404)
            await this.fail(r, `borrar el secreto ${name}`);
    }
    async dispatch(workflowFile, ref) {
        const r = await this.req('POST', `/repos/${this.o.repo}/actions/workflows/${workflowFile}/dispatches`, { json: { ref } });
        if (!r.ok)
            await this.fail(r, 'lanzar el flujo de publicación');
    }
}
exports.Github = Github;
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
