// Generado por StreamClips. No lo edites: se vuelve a escribir.
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/services/cloud/runner.ts
var import_node_fs6 = __toESM(require("node:fs"));
var import_node_os = __toESM(require("node:os"));
var import_node_path = __toESM(require("node:path"));

// electron/services/oauth.ts
var PROVIDERS = {
  google: {
    id: "google",
    label: "Google (YouTube)",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.readonly"],
    scopeSeparator: " ",
    clientIdParam: "client_id",
    pkce: true,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    port: 53682
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.publish", "video.upload"],
    scopeSeparator: ",",
    clientIdParam: "client_key",
    pkce: true,
    port: 53683
  },
  meta: {
    id: "meta",
    label: "Instagram (Meta)",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"],
    scopeSeparator: ",",
    clientIdParam: "client_id",
    pkce: false,
    port: 53684
  }
};
async function tokenRequest(p, body, d) {
  const f = d.fetchFn ?? fetch;
  let res;
  try {
    res = await f(p.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(3e4)
    });
  } catch {
    throw new Error(`No se pudo conectar con ${p.label}. Comprueba tu conexi\xF3n a internet.`);
  }
  const j = await res.json().catch(() => ({}));
  const data = typeof j.data === "object" && j.data !== null ? j.data : j;
  if (!res.ok || typeof data.access_token !== "string") {
    const why = String(j.error_description ?? j.error?.message ?? j.error ?? res.status);
    throw new Error(`${p.label} rechaz\xF3 la autorizaci\xF3n: ${why}`);
  }
  const ttl = Number(data.expires_in ?? 0);
  return {
    accessToken: data.access_token,
    ...typeof data.refresh_token === "string" ? { refreshToken: data.refresh_token } : {},
    expiresAt: ttl > 0 ? (d.now ?? Date.now)() + ttl * 1e3 : 0,
    ...typeof data.scope === "string" ? { scope: data.scope } : {}
  };
}
async function refreshToken(p, c, t, d = {}) {
  if (p.id === "meta") {
    const n2 = await tokenRequest(p, { grant_type: "fb_exchange_token", client_id: c.clientId, client_secret: c.clientSecret, fb_exchange_token: t.accessToken }, d);
    return { ...t, ...n2 };
  }
  if (!t.refreshToken) throw new Error(`La conexi\xF3n con ${p.label} caduc\xF3. Vuelve a conectarla en la pesta\xF1a Conexiones.`);
  const n = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: t.refreshToken, [p.clientIdParam]: c.clientId, client_secret: c.clientSecret }, d);
  return { ...t, ...n, refreshToken: n.refreshToken ?? t.refreshToken };
}

// electron/services/social/youtube.ts
var import_node_fs2 = __toESM(require("node:fs"));

// electron/services/social/common.ts
var import_node_fs = __toESM(require("node:fs"));
var defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
var PublishError = class extends Error {
};
async function readChunk(file, start, endExclusive) {
  const fh = await import_node_fs.default.promises.open(file, "r");
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
async function timedFetch(f, url, init, ms = 6e4) {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const n = e.name;
    if (n === "TimeoutError" || n === "AbortError") throw new PublishError("La red social no respondi\xF3 a tiempo.");
    throw new PublishError("No se pudo conectar con la red social. Comprueba tu conexi\xF3n a internet.");
  }
}
async function apiMessage(res) {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    const reason = typeof j.error === "object" ? j.error?.errors?.[0]?.reason : void 0;
    const m = typeof j.error === "object" ? j.error?.message : j.error ?? j.message;
    return [reason, m].filter(Boolean).join(": ").slice(0, 300) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// electron/services/social/youtube.ts
var YT_ENDPOINTS = {
  upload: "https://www.googleapis.com/upload/youtube/v3",
  api: "https://www.googleapis.com/youtube/v3"
};
var YT_CHUNK = 8 * 1024 * 1024;
var MAX_RETRIES = 5;
function explain(res, msg) {
  if (res.status === 401) return new PublishError("YouTube rechaz\xF3 la conexi\xF3n. Vuelve a conectar la cuenta en Conexiones.");
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(msg)) return new PublishError("Se agot\xF3 la cuota diaria de la API de YouTube. Se podr\xE1 volver a intentar ma\xF1ana.");
  if (/uploadLimitExceeded/.test(msg)) return new PublishError("YouTube ha alcanzado el l\xEDmite de subidas de tu canal por hoy.");
  if (/forbidden|insufficientPermissions|youtubeSignupRequired/.test(msg)) return new PublishError(`YouTube no permite esta acci\xF3n con la cuenta conectada (${msg}).`);
  return new PublishError(`YouTube: ${msg}`);
}
function youtubeFile(o) {
  if (o.kind === "long") {
    if (!o.files.long) throw new PublishError("El v\xEDdeo no tiene archivo.");
    return { file: o.files.long, short: false };
  }
  const f = o.files.vertical ?? o.files.horizontal;
  if (!f) throw new PublishError("El clip no tiene archivo.");
  return { file: f, short: !!o.files.vertical };
}
async function publishYoutube(d, o) {
  const f = d.fetchFn ?? fetch;
  const ep = d.endpoints ?? YT_ENDPOINTS;
  const sleep = d.sleep ?? defaultSleep;
  const chunk = d.chunkSize ?? YT_CHUNK;
  const { file, short } = youtubeFile(o);
  if (!import_node_fs2.default.existsSync(file)) throw new PublishError("El archivo del v\xEDdeo ya no est\xE1 en su sitio.");
  const size = import_node_fs2.default.statSync(file).size;
  if (!size) throw new PublishError("El archivo del v\xEDdeo est\xE1 vac\xEDo.");
  const token = await d.token();
  const auth = { Authorization: `Bearer ${token}` };
  let title = o.title;
  if (short && !/#shorts/i.test(title) && title.length <= 92) title = `${title} #Shorts`;
  const meta = {
    snippet: { title, description: o.description ?? (short ? "#Shorts" : ""), categoryId: "20" },
    status: { privacyStatus: o.visibility === "public" ? "public" : "private", selfDeclaredMadeForKids: false }
  };
  const init = await timedFetch(f, `${ep.upload}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta)
  });
  if (!init.ok) throw explain(init, await apiMessage(init));
  const session = init.headers.get("location");
  if (!session) throw new PublishError("YouTube no devolvi\xF3 la direcci\xF3n de subida.");
  let offset = 0;
  let retries = 0;
  let videoId = "";
  while (!videoId) {
    const end = Math.min(size, offset + chunk);
    let res = null;
    try {
      const body = await readChunk(file, offset, end);
      res = await timedFetch(
        f,
        session,
        { method: "PUT", headers: { "Content-Length": String(body.length), "Content-Range": `bytes ${offset}-${end - 1}/${size}` }, body: new Uint8Array(body) },
        10 * 6e4
      );
    } catch (e) {
      if (!(e instanceof PublishError) || retries >= MAX_RETRIES) throw e;
    }
    if (res && (res.status === 200 || res.status === 201)) {
      const j = await res.json().catch(() => ({}));
      if (!j.id) throw new PublishError("YouTube termin\xF3 la subida pero no devolvi\xF3 el identificador del v\xEDdeo.");
      videoId = j.id;
      break;
    }
    if (res && res.status === 308) {
      offset = nextOffset(res.headers.get("range"));
      retries = 0;
      continue;
    }
    if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw explain(res, await apiMessage(res));
    if (++retries > MAX_RETRIES) throw new PublishError(`La subida a YouTube fall\xF3 repetidamente${res ? ` (HTTP ${res.status})` : ""}.`);
    await sleep(Math.min(3e4, 1e3 * 2 ** retries));
    try {
      const q = await timedFetch(f, session, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` } });
      if (q.status === 308) offset = nextOffset(q.headers.get("range"));
      else if (q.status === 200 || q.status === 201) {
        const j = await q.json().catch(() => ({}));
        if (j.id) videoId = j.id;
      }
    } catch {
    }
  }
  const warn = d.warn ?? (() => void 0);
  if (o.kind === "long" && o.thumbnail && import_node_fs2.default.existsSync(o.thumbnail)) {
    try {
      const img = import_node_fs2.default.readFileSync(o.thumbnail);
      const r = await timedFetch(f, `${ep.upload}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: "POST", headers: { ...auth, "Content-Type": "image/jpeg" }, body: new Uint8Array(img) });
      if (!r.ok) warn(`Miniatura no aceptada por YouTube: ${await apiMessage(r)}`);
    } catch (e) {
      warn(`Miniatura no subida: ${e.message}`);
    }
  }
  if (o.playlist) {
    try {
      const id = await ensurePlaylist(d, o.playlist);
      const r = await timedFetch(f, `${ep.api}/playlistItems?part=snippet`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: { playlistId: id, resourceId: { kind: "youtube#video", videoId } } })
      });
      if (!r.ok) warn(`No se pudo a\xF1adir a la lista "${o.playlist}": ${await apiMessage(r)}`);
    } catch (e) {
      warn(`Lista de reproducci\xF3n: ${e.message}`);
    }
  }
  return { videoId };
}
function nextOffset(range) {
  const m = /bytes=0-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}
async function listPlaylists(d) {
  const f = d.fetchFn ?? fetch;
  const ep = d.endpoints ?? YT_ENDPOINTS;
  const auth = { Authorization: `Bearer ${await d.token()}` };
  const out = [];
  let page = "";
  for (let i = 0; i < 20; i++) {
    const r = await timedFetch(f, `${ep.api}/playlists?part=snippet&mine=true&maxResults=50${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, { headers: auth });
    if (!r.ok) throw explain(r, await apiMessage(r));
    const j = await r.json();
    for (const it of j.items ?? []) out.push({ id: it.id, title: it.snippet?.title ?? "" });
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return out;
}
async function ensurePlaylist(d, name) {
  const found = (await listPlaylists(d)).find((p) => p.title.trim().toLowerCase() === name.trim().toLowerCase());
  if (found) return found.id;
  const f = d.fetchFn ?? fetch;
  const ep = d.endpoints ?? YT_ENDPOINTS;
  const r = await timedFetch(f, `${ep.api}/playlists?part=snippet,status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await d.token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { title: name }, status: { privacyStatus: "private" } })
  });
  if (!r.ok) throw explain(r, await apiMessage(r));
  const j = await r.json();
  if (!j.id) throw new PublishError("YouTube no devolvi\xF3 la lista creada.");
  return j.id;
}

// electron/services/social/tiktok.ts
var import_node_fs3 = __toESM(require("node:fs"));
var TT_API = "https://open.tiktokapis.com/v2";
var CHUNK = 10 * 1024 * 1024;
var POLL_MS = 5e3;
var POLL_MAX = 72;
function tiktokFile(o) {
  if (o.kind === "long") throw new PublishError("TikTok solo admite clips. Este v\xEDdeo largo no se puede publicar ah\xED.");
  const f = o.files.vertical ?? o.files.horizontal;
  if (!f) throw new PublishError("El clip no tiene archivo.");
  return f;
}
async function call(d, path2, body) {
  const f = d.fetchFn ?? fetch;
  const r = await timedFetch(f, `${d.api ?? TT_API}${path2}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await d.token()}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || j.error?.code === "access_token_invalid") throw new PublishError("TikTok rechaz\xF3 la conexi\xF3n. Vuelve a conectar la cuenta en Conexiones.");
  if (!r.ok || j.error?.code && j.error.code !== "ok") {
    const code = j.error?.code ?? r.status;
    if (code === "spam_risk_too_many_posts") throw new PublishError("TikTok limita las publicaciones diarias de tu cuenta. Int\xE9ntalo ma\xF1ana.");
    throw new PublishError(`TikTok: ${j.error?.message || code}`);
  }
  return j.data;
}
async function publishTiktok(d, o) {
  const f = d.fetchFn ?? fetch;
  const sleep = d.sleep ?? defaultSleep;
  const file = tiktokFile(o);
  if (!import_node_fs3.default.existsSync(file)) throw new PublishError("El archivo del v\xEDdeo ya no est\xE1 en su sitio.");
  const size = import_node_fs3.default.statSync(file).size;
  if (!size) throw new PublishError("El archivo del v\xEDdeo est\xE1 vac\xEDo.");
  const info = await call(d, "/post/publish/creator_info/query/", {});
  const options = info.privacy_level_options ?? [];
  const wantPublic = o.visibility === "public" && options.includes("PUBLIC_TO_EVERYONE");
  const privacy = wantPublic ? "PUBLIC_TO_EVERYONE" : options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
  if (!privacy) throw new PublishError("TikTok no ofrece ninguna opci\xF3n de privacidad para esta cuenta.");
  const chunk = Math.max(d.chunkSize ?? CHUNK, 1);
  const total = Math.max(1, Math.floor(size / chunk));
  const init = await call(d, "/post/publish/video/init/", {
    post_info: { title: o.title.slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: total === 1 ? size : chunk, total_chunk_count: total }
  });
  if (!init.publish_id || !init.upload_url) throw new PublishError("TikTok no devolvi\xF3 la direcci\xF3n de subida.");
  const step = total === 1 ? size : chunk;
  for (let i = 0; i < total; i++) {
    const start = i * step;
    const end = i === total - 1 ? size : start + step;
    const body = await readChunk(file, start, end);
    const r = await timedFetch(
      f,
      init.upload_url,
      { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(body.length), "Content-Range": `bytes ${start}-${end - 1}/${size}` }, body: new Uint8Array(body) },
      10 * 6e4
    );
    if (r.status !== 206 && r.status !== 201 && r.status !== 200) throw new PublishError(`TikTok rechaz\xF3 un trozo del v\xEDdeo: ${await apiMessage(r)}`);
  }
  for (let i = 0; i < POLL_MAX; i++) {
    const st = await call(d, "/post/publish/status/fetch/", { publish_id: init.publish_id });
    if (st.status === "PUBLISH_COMPLETE") return { publishId: init.publish_id };
    if (st.status === "FAILED") throw new PublishError(`TikTok no pudo publicar el v\xEDdeo (${st.fail_reason ?? "motivo desconocido"}).`);
    await sleep(d.pollMs ?? POLL_MS);
  }
  throw new PublishError("TikTok sigue procesando el v\xEDdeo. Comprueba en la app de TikTok antes de reprogramarlo.");
}

// electron/services/social/instagram.ts
var import_node_fs4 = __toESM(require("node:fs"));
var IG_GRAPH = "https://graph.facebook.com/v21.0";
var POLL_MS2 = 5e3;
var POLL_MAX2 = 120;
function instagramFile(o) {
  if (o.kind === "long") throw new PublishError("Instagram solo admite clips (Reels). Este v\xEDdeo largo no se puede publicar ah\xED.");
  const f = o.files.vertical;
  if (!f) throw new PublishError("Instagram necesita la versi\xF3n vertical del clip.");
  return f;
}
async function graphJson(r) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error;
    if (r.status === 401 || e?.code === 190) throw new PublishError("Instagram rechaz\xF3 la conexi\xF3n. Vuelve a conectar la cuenta en Conexiones.");
    throw new PublishError(`Instagram: ${e?.message ?? `HTTP ${r.status}`}`);
  }
  return j;
}
async function publishInstagram(d, o) {
  const f = d.fetchFn ?? fetch;
  const sleep = d.sleep ?? defaultSleep;
  const graph = d.graph ?? IG_GRAPH;
  const file = instagramFile(o);
  if (!import_node_fs4.default.existsSync(file)) throw new PublishError("El archivo del v\xEDdeo ya no est\xE1 en su sitio.");
  const size = import_node_fs4.default.statSync(file).size;
  if (!size) throw new PublishError("El archivo del v\xEDdeo est\xE1 vac\xEDo.");
  const { accessToken, igUserId } = await d.token();
  if (!igUserId) throw new PublishError("No hay una cuenta de Instagram profesional enlazada. Vuelve a conectar la cuenta en Conexiones.");
  const create = await graphJson(
    await timedFetch(f, `${graph}/${encodeURIComponent(igUserId)}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ media_type: "REELS", upload_type: "resumable", caption: o.title.slice(0, 2200), share_to_feed: "true", access_token: accessToken })
    })
  );
  if (!create.id) throw new PublishError("Instagram no cre\xF3 el contenedor del v\xEDdeo.");
  const uploadUri = create.uri ?? `https://rupload.facebook.com/ig-api-upload/v21.0/${create.id}`;
  const up = await timedFetch(
    f,
    uploadUri,
    {
      method: "POST",
      headers: { Authorization: `OAuth ${accessToken}`, offset: "0", file_size: String(size) },
      body: import_node_fs4.default.createReadStream(file),
      // @ts-expect-error opción de Node necesaria para enviar un flujo
      duplex: "half"
    },
    30 * 6e4
  );
  await graphJson(up);
  let status = "";
  for (let i = 0; i < POLL_MAX2; i++) {
    const s = await graphJson(
      await timedFetch(f, `${graph}/${create.id}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`, {})
    );
    status = s.status_code ?? "";
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") throw new PublishError(`Instagram no pudo procesar el v\xEDdeo (${s.status ?? status}).`);
    await sleep(d.pollMs ?? POLL_MS2);
  }
  if (status !== "FINISHED") throw new PublishError("Instagram sigue procesando el v\xEDdeo. Comprueba en la app antes de reprogramarlo.");
  const pub = await graphJson(
    await timedFetch(f, `${graph}/${encodeURIComponent(igUserId)}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: create.id, access_token: accessToken })
    })
  );
  if (!pub.id) throw new PublishError("Instagram no confirm\xF3 la publicaci\xF3n.");
  return { mediaId: pub.id };
}

// electron/services/cloud/github.ts
var import_node_fs5 = __toESM(require("node:fs"));
var GithubError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
var Github = class {
  constructor(o) {
    this.o = o;
    this.api = o.api ?? "https://api.github.com";
    this.uploads = o.uploads ?? "https://uploads.github.com";
    this.f = o.fetchFn ?? fetch;
  }
  api;
  uploads;
  f;
  async req(method, url, init = {}) {
    let res;
    try {
      res = await this.f(url.startsWith("http") ? url : `${this.api}${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.o.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "StreamClips",
          ...init.json !== void 0 ? { "Content-Type": "application/json" } : {},
          ...init.headers ?? {}
        },
        body: init.json !== void 0 ? JSON.stringify(init.json) : init.body,
        signal: AbortSignal.timeout(init.timeout ?? 6e4),
        ...init.duplex ? { duplex: "half" } : {}
      });
    } catch {
      throw new GithubError("No se pudo conectar con GitHub. Comprueba tu conexi\xF3n a internet.", 0);
    }
    return res;
  }
  async fail(res, what) {
    const j = await res.json().catch(() => ({}));
    const m = j.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new GithubError("GitHub rechaz\xF3 el token. Revisa que no haya caducado.", 401);
    if (res.status === 403 && /rate limit/i.test(m)) throw new GithubError("GitHub limit\xF3 las peticiones. Se reintentar\xE1 m\xE1s tarde.", 403);
    if (res.status === 403) throw new GithubError(`GitHub no permite ${what} con este token (${m}). Revisa los permisos del token.`, 403);
    if (res.status === 404) throw new GithubError(`GitHub no encuentra ${what}. Comprueba el nombre del repositorio y los permisos del token.`, 404);
    throw new GithubError(`GitHub: ${what}: ${m}`, res.status);
  }
  async repoInfo() {
    const r = await this.req("GET", `/repos/${this.o.repo}`);
    if (!r.ok) await this.fail(r, "el repositorio");
    const j = await r.json();
    return { private: j.private, fullName: j.full_name, defaultBranch: j.default_branch };
  }
  async getContent(path2) {
    const r = await this.req("GET", `/repos/${this.o.repo}/contents/${encodePath(path2)}`);
    if (r.status === 404) return null;
    if (!r.ok) await this.fail(r, `el archivo ${path2}`);
    const j = await r.json();
    return { sha: j.sha, text: Buffer.from(j.content ?? "", "base64").toString("utf8") };
  }
  /** Crea o actualiza. Con `sha`, solo si nadie lo ha cambiado desde (así dos procesos no pisan el mismo trabajo). Devuelve el nuevo sha, o null si el archivo cambió. */
  async putContent(path2, text, message, sha) {
    const r = await this.req("PUT", `/repos/${this.o.repo}/contents/${encodePath(path2)}`, {
      json: { message, content: Buffer.from(text, "utf8").toString("base64"), ...sha ? { sha } : {} }
    });
    if (r.status === 409 || r.status === 422) return null;
    if (!r.ok) await this.fail(r, `guardar ${path2}`);
    return (await r.json()).content.sha;
  }
  async deleteContent(path2, sha, message) {
    const r = await this.req("DELETE", `/repos/${this.o.repo}/contents/${encodePath(path2)}`, { json: { message, sha } });
    if (!r.ok && r.status !== 404 && r.status !== 409) await this.fail(r, `borrar ${path2}`);
  }
  async listDir(path2) {
    const r = await this.req("GET", `/repos/${this.o.repo}/contents/${encodePath(path2)}`);
    if (r.status === 404) return [];
    if (!r.ok) await this.fail(r, `la carpeta ${path2}`);
    const j = await r.json();
    return Array.isArray(j) ? j.filter((x) => x.type === "file").map((x) => ({ name: x.name, sha: x.sha })) : [];
  }
  async createRelease(tag, name) {
    const r = await this.req("POST", `/repos/${this.o.repo}/releases`, { json: { tag_name: tag, name, draft: false, prerelease: true, body: "V\xEDdeo en cola de StreamClips. Se borra solo al publicarse." } });
    if (!r.ok) await this.fail(r, "crear la versi\xF3n de subida");
    return { id: (await r.json()).id };
  }
  async uploadAsset(releaseId, name, file, contentType) {
    const size = import_node_fs5.default.statSync(file).size;
    const r = await this.req("POST", `${this.uploads}/repos/${this.o.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
      headers: { "Content-Type": contentType, "Content-Length": String(size) },
      body: import_node_fs5.default.createReadStream(file),
      duplex: true,
      timeout: 60 * 6e4
    });
    if (r.status === 422) throw new GithubError(`GitHub no admite este archivo (${name}); el m\xE1ximo por archivo son 2 GB.`, 422);
    if (!r.ok) await this.fail(r, "subir el v\xEDdeo");
    const j = await r.json();
    if (j.size !== size) throw new GithubError("La subida a GitHub qued\xF3 incompleta. Se reintentar\xE1.", 0);
    return { id: j.id, size: j.size };
  }
  async downloadAsset(assetId, dest) {
    const r = await this.req("GET", `/repos/${this.o.repo}/releases/assets/${assetId}`, { headers: { Accept: "application/octet-stream" }, timeout: 60 * 6e4 });
    if (!r.ok || !r.body) await this.fail(r, "descargar el v\xEDdeo");
    const { Readable } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    await pipeline(Readable.fromWeb(r.body), import_node_fs5.default.createWriteStream(dest));
  }
  /** Borra la versión y su etiqueta (y con ella los archivos). */
  async deleteRelease(releaseId, tag) {
    const r = await this.req("DELETE", `/repos/${this.o.repo}/releases/${releaseId}`);
    if (!r.ok && r.status !== 404) await this.fail(r, "borrar la versi\xF3n");
    const t = await this.req("DELETE", `/repos/${this.o.repo}/git/refs/tags/${encodeURIComponent(tag)}`);
    if (!t.ok && t.status !== 404 && t.status !== 422) await this.fail(t, "borrar la etiqueta");
  }
  async publicKey() {
    const r = await this.req("GET", `/repos/${this.o.repo}/actions/secrets/public-key`);
    if (!r.ok) await this.fail(r, "la clave p\xFAblica de secretos");
    const j = await r.json();
    return { keyId: j.key_id, key: j.key };
  }
  async putSecret(name, encryptedBase64, keyId) {
    const r = await this.req("PUT", `/repos/${this.o.repo}/actions/secrets/${name}`, { json: { encrypted_value: encryptedBase64, key_id: keyId } });
    if (!r.ok) await this.fail(r, `guardar el secreto ${name}`);
  }
  async dispatch(workflowFile, ref) {
    const r = await this.req("POST", `/repos/${this.o.repo}/actions/workflows/${workflowFile}/dispatches`, { json: { ref } });
    if (!r.ok) await this.fail(r, "lanzar el flujo de publicaci\xF3n");
  }
};
var encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

// electron/services/cloud/jobs.ts
function parseJob(text) {
  try {
    const j = JSON.parse(text);
    if (j.v !== 1 || typeof j.key !== "string" || typeof j.platform !== "string" || typeof j.scheduledAt !== "string" || !j.file) return null;
    if (!["queued", "publishing", "published", "failed"].includes(String(j.status))) return null;
    return j;
  } catch {
    return null;
  }
}
var serializeJob = (j) => `${JSON.stringify(j, null, 2)}
`;

// electron/services/cloud/runner.ts
var log = (m) => console.log(`[streamclips] ${m}`);
async function tokenFor(platform, c, env) {
  const prov = env.providers ?? PROVIDERS;
  const d = { fetchFn: env.fetchFn };
  if (platform === "youtube" || platform === "tiktok") {
    const cred2 = c[platform];
    if (!cred2) throw new Error(`Falta la conexi\xF3n de ${platform} en la nube. Sincron\xEDzala desde el programa.`);
    const t2 = await refreshToken(platform === "youtube" ? prov.google : prov.tiktok, { clientId: cred2.clientId, clientSecret: cred2.clientSecret }, { accessToken: "", refreshToken: cred2.refreshToken, expiresAt: 0 }, d);
    return { accessToken: t2.accessToken };
  }
  const cred = c.instagram;
  if (!cred) throw new Error("Falta la conexi\xF3n de Instagram en la nube. Sincron\xEDzala desde el programa.");
  const t = await refreshToken(prov.meta, { clientId: cred.clientId, clientSecret: cred.clientSecret }, { accessToken: cred.accessToken, expiresAt: 0 }, d);
  return { accessToken: t.accessToken, igUserId: cred.igUserId };
}
async function publishJob(job, gh, creds, env, tmp) {
  const file = import_node_path.default.join(tmp, job.file.name);
  await gh.downloadAsset(job.file.assetId, file);
  if (import_node_fs6.default.statSync(file).size !== job.file.size) throw new Error("El v\xEDdeo descargado de la nube est\xE1 incompleto.");
  let thumbnail;
  if (job.thumb) {
    thumbnail = import_node_path.default.join(tmp, job.thumb.name);
    await gh.downloadAsset(job.thumb.assetId, thumbnail).catch(() => thumbnail = void 0);
  }
  const out = {
    id: job.key,
    kind: job.kind,
    title: job.title,
    description: job.description,
    playlist: job.playlist,
    visibility: job.visibility,
    files: job.kind === "long" ? { long: file } : { vertical: file },
    durationSec: 0,
    createdAt: job.updatedAt,
    ...thumbnail ? { thumbnail } : {}
  };
  const base = { fetchFn: env.fetchFn, sleep: env.sleep, warn: (m) => log(m) };
  if (job.platform === "youtube") {
    await publishYoutube({ ...base, token: async () => (await tokenFor("youtube", creds, env)).accessToken, endpoints: env.youtube, chunkSize: env.chunkSize }, out);
  } else if (job.platform === "tiktok") {
    await publishTiktok({ ...base, token: async () => (await tokenFor("tiktok", creds, env)).accessToken, api: env.tiktokApi, chunkSize: env.chunkSize, pollMs: env.pollMs }, out);
  } else {
    await publishInstagram({ ...base, graph: env.graph, pollMs: env.pollMs, token: async () => {
      const t = await tokenFor("instagram", creds, env);
      return { accessToken: t.accessToken, igUserId: t.igUserId ?? "" };
    } }, out);
  }
}
async function runQueue(gh, creds, env = {}, now = Date.now) {
  const res = { published: [], failed: [], skipped: [] };
  const files = await gh.listDir("queue");
  for (const f of files.filter((x) => x.name.endsWith(".json"))) {
    const p = `queue/${f.name}`;
    const c = await gh.getContent(p);
    const job = c && parseJob(c.text);
    if (!c || !job) continue;
    const stamp = () => new Date(now()).toISOString();
    if (job.status === "publishing") {
      job.status = "failed";
      job.note = "Se interrumpi\xF3 a mitad de publicar: comprueba en la red si sali\xF3 antes de reprogramarlo.";
      job.updatedAt = stamp();
      await gh.putContent(p, serializeJob(job), `Interrumpido: ${job.key}`, c.sha);
      res.failed.push(job.key);
      continue;
    }
    if (job.status !== "queued" || Date.parse(job.scheduledAt) > now()) {
      res.skipped.push(job.key);
      continue;
    }
    job.status = "publishing";
    job.updatedAt = stamp();
    const sha = await gh.putContent(p, serializeJob(job), `Publicando: ${job.key}`, c.sha);
    if (!sha) {
      res.skipped.push(job.key);
      continue;
    }
    const tmp = import_node_fs6.default.mkdtempSync(import_node_path.default.join(import_node_os.default.tmpdir(), "streamclips-cloud-"));
    try {
      await publishJob(job, gh, creds, env, tmp);
      job.status = "published";
      job.note = void 0;
      log(`Publicado: ${job.key}`);
      res.published.push(job.key);
    } catch (e) {
      job.status = "failed";
      job.note = e.message.slice(0, 400);
      log(`Fallo en ${job.key}: ${job.note}`);
      res.failed.push(job.key);
    } finally {
      import_node_fs6.default.rmSync(tmp, { recursive: true, force: true });
    }
    job.updatedAt = stamp();
    const latest = await gh.getContent(p);
    await gh.putContent(p, serializeJob(job), `${job.status === "published" ? "Publicado" : "Fallido"}: ${job.key}`, latest?.sha);
    if (job.status === "published") await gh.deleteRelease(job.releaseId, job.releaseTag).catch((e) => log(`No se pudo borrar la copia de la nube: ${e.message}`));
  }
  return res;
}
async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("Faltan GITHUB_REPOSITORY o GITHUB_TOKEN.");
  const creds = JSON.parse(process.env.STREAMCLIPS_CREDS || "{}");
  const gh = new Github({ token, repo, api: process.env.STREAMCLIPS_GITHUB_API || void 0, uploads: process.env.STREAMCLIPS_GITHUB_UPLOADS || void 0 });
  const r = await runQueue(gh, creds);
  log(`Publicados: ${r.published.length}, fallidos: ${r.failed.length}, en espera: ${r.skipped.length}`);
}

// electron/services/cloud/runnerMain.ts
main().catch((e) => {
  console.error(`[streamclips] ${e.message}`);
  process.exit(1);
});
