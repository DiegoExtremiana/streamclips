"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fakeGithub = fakeGithub;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_http_1 = __importDefault(require("node:http"));
const libsodium_wrappers_1 = __importDefault(require("libsodium-wrappers"));
/** GitHub de mentira, con memoria: contenidos con sha, versiones, archivos, secretos. */
async function fakeGithub(opts = {}) {
    const mk = (isPrivate) => ({ isPrivate, files: new Map(), releases: new Map(), secrets: new Map(), dispatches: [] });
    const repos = new Map([['diego/nube', mk(opts.isPrivate ?? true)], ...Object.entries(opts.repos ?? {}).map(([n, r]) => [n, mk(r.isPrivate)])]);
    const main = repos.get('diego/nube');
    const { files, releases, secrets, dispatches } = main;
    const log = [];
    let nextId = 100;
    await libsodium_wrappers_1.default.ready;
    const kp = libsodium_wrappers_1.default.crypto_box_keypair();
    const sha = (t) => node_crypto_1.default.createHash('sha1').update(t).digest('hex');
    const srv = node_http_1.default.createServer((req, res) => {
        const parts = [];
        req.on('data', (c) => parts.push(c));
        req.on('end', () => {
            const body = Buffer.concat(parts);
            const u = new URL(req.url ?? '/', 'http://x');
            const rm = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(u.pathname);
            const R = rm ? repos.get(rm[1]) : undefined;
            const p = rm?.[2] ?? '';
            const files = R?.files ?? main.files;
            const releases = R?.releases ?? main.releases;
            const secrets = R?.secrets ?? main.secrets;
            const dispatches = R?.dispatches ?? main.dispatches;
            const send = (status, json, raw) => {
                res.writeHead(status, json !== undefined ? { 'content-type': 'application/json' } : {});
                res.end(raw ?? (json !== undefined ? JSON.stringify(json) : ''));
            };
            log.push(`${req.method} ${p}`);
            if (req.headers.authorization !== 'Bearer GHTOKEN')
                return send(401, { message: 'Bad credentials' });
            if (!R)
                return send(404, { message: 'Not Found' });
            if (p === '' && req.method === 'GET')
                return send(200, { private: R.isPrivate, full_name: rm[1], default_branch: 'main' });
            const c = /^\/contents\/(.+)$/.exec(p);
            if (c) {
                const f = decodeURIComponent(c[1]);
                if (req.method === 'GET') {
                    if (files.has(f))
                        return send(200, { sha: sha(files.get(f)), content: Buffer.from(files.get(f)).toString('base64'), encoding: 'base64', type: 'file' });
                    const dir = [...files.keys()].filter((k) => k.startsWith(`${f}/`));
                    return dir.length ? send(200, dir.map((k) => ({ name: k.slice(f.length + 1), sha: sha(files.get(k)), type: 'file' }))) : send(404, { message: 'Not Found' });
                }
                const j = JSON.parse(body.toString());
                if (req.method === 'PUT') {
                    if (files.has(f) && j.sha !== sha(files.get(f)))
                        return send(files.has(f) && !j.sha ? 422 : 409, { message: 'sha mismatch' });
                    if (!files.has(f) && j.sha)
                        return send(422, { message: 'no existe' });
                    const text = Buffer.from(j.content, 'base64').toString('utf8');
                    files.set(f, text);
                    return send(200, { content: { sha: sha(text) } });
                }
                if (req.method === 'DELETE') {
                    if (!files.has(f))
                        return send(404, { message: 'Not Found' });
                    if (j.sha !== sha(files.get(f)))
                        return send(409, { message: 'sha mismatch' });
                    files.delete(f);
                    return send(200, {});
                }
                return send(405, {});
            }
            if (p === '/releases' && req.method === 'POST') {
                const j = JSON.parse(body.toString());
                if ([...releases.values()].some((r) => r.tag === j.tag_name))
                    return send(422, { message: 'already_exists' });
                const id = nextId++;
                releases.set(id, { tag: j.tag_name, assets: new Map() });
                return send(201, { id });
            }
            const up = /^\/releases\/(\d+)\/assets$/.exec(p);
            if (up && req.method === 'POST') {
                const rel = releases.get(Number(up[1]));
                if (!rel)
                    return send(404, { message: 'Not Found' });
                const id = nextId++;
                rel.assets.set(id, { name: u.searchParams.get('name'), data: body });
                return send(201, { id, size: body.length });
            }
            const as = /^\/releases\/assets\/(\d+)$/.exec(p);
            if (as && req.method === 'GET') {
                for (const r of releases.values()) {
                    const a = r.assets.get(Number(as[1]));
                    if (a)
                        return send(200, undefined, a.data);
                }
                return send(404, { message: 'Not Found' });
            }
            const rd = /^\/releases\/(\d+)$/.exec(p);
            if (rd && req.method === 'DELETE')
                return releases.delete(Number(rd[1])) ? send(204) : send(404, { message: 'Not Found' });
            if (p.startsWith('/git/refs/tags/') && req.method === 'DELETE')
                return send(204);
            if (p === '/actions/secrets/public-key')
                return send(200, { key_id: 'KID', key: libsodium_wrappers_1.default.to_base64(kp.publicKey, libsodium_wrappers_1.default.base64_variants.ORIGINAL) });
            const sec = /^\/actions\/secrets\/(\w+)$/.exec(p);
            if (sec && req.method === 'PUT') {
                const j = JSON.parse(body.toString());
                secrets.set(sec[1], { value: j.encrypted_value, keyId: j.key_id });
                return send(201);
            }
            if (sec && req.method === 'DELETE')
                return secrets.delete(sec[1]) ? send(204) : send(404, { message: 'Not Found' });
            if (/^\/actions\/workflows\/.+\/dispatches$/.test(p)) {
                dispatches.push(p);
                return send(204);
            }
            return send(404, { message: `sin ruta ${p}` });
        });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    return {
        base, files, releases, secrets, dispatches, log,
        repo: (name) => repos.get(name),
        decryptSecret: (name, repo = 'diego/nube') => libsodium_wrappers_1.default.to_string(libsodium_wrappers_1.default.crypto_box_seal_open(libsodium_wrappers_1.default.from_base64(repos.get(repo).secrets.get(name).value, libsodium_wrappers_1.default.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey)),
        close: () => { srv.close(); srv.closeAllConnections?.(); },
    };
}
