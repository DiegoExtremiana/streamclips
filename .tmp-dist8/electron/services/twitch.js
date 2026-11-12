"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwitchClient = void 0;
exports.parseTwitchDuration = parseTwitchDuration;
exports.normalizeLogin = normalizeLogin;
const REQUEST_TIMEOUT_MS = 15_000;
/** "3h12m5s" -> segundos (0 si el formato no se reconoce). */
function parseTwitchDuration(d) {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d);
    if (!m)
        return 0;
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
/** Acepta "don_diegons", "@Don_Diegons" o "https://twitch.tv/don_diegons"; null si no es un login válido. */
function normalizeLogin(input) {
    let s = input.trim().toLowerCase();
    const fromUrl = /^https?:\/\/(?:www\.)?twitch\.tv\/([^/?#]+)/.exec(s);
    if (fromUrl)
        s = fromUrl[1];
    s = s.replace(/^@/, '');
    return /^[a-z0-9_]{1,25}$/.test(s) ? s : null;
}
const CLIP_WINDOW_MS = 90 * 86_400_000;
const CLIP_MAX_WINDOWS = 32;
const CLIP_MAX_PAGES = 12;
/** Cliente mínimo de la API Helix de Twitch con credenciales de aplicación (solo lectura pública). */
class TwitchClient {
    fetchFn;
    now;
    token = null;
    constructor(fetchFn = (u, i) => fetch(u, i), now = Date.now) {
        this.fetchFn = fetchFn;
        this.now = now;
    }
    async request(url, init) {
        try {
            return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        }
        catch (e) {
            const name = e.name;
            if (name === 'TimeoutError' || name === 'AbortError')
                throw new Error('Twitch no responde (tiempo agotado). Inténtalo de nuevo.');
            throw new Error('No se pudo conectar con Twitch. Comprueba tu conexión a internet.');
        }
    }
    async appToken(c, force = false) {
        if (!force && this.token && this.token.clientId === c.clientId && this.token.expiresAt > this.now() + 60_000) {
            return this.token.value;
        }
        const res = await this.request('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials' }),
        });
        if (!res.ok) {
            this.token = null;
            throw new Error(`Twitch rechazó las credenciales (${res.status}). Revisa Client ID y Client Secret.`);
        }
        const j = (await res.json());
        if (!j.access_token)
            throw new Error('Twitch no devolvió un token válido.');
        this.token = { clientId: c.clientId, value: j.access_token, expiresAt: this.now() + (j.expires_in ?? 3600) * 1000 };
        return j.access_token;
    }
    async helix(path, c) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const token = await this.appToken(c, attempt > 0);
            const res = await this.request(`https://api.twitch.tv/helix/${path}`, {
                headers: { 'Client-Id': c.clientId, Authorization: `Bearer ${token}` },
            });
            if (res.status === 401) {
                if (attempt === 0)
                    continue; // token caducado o revocado: se pide uno nuevo una vez
                break;
            }
            if (res.status === 429)
                throw new Error('Twitch limita las peticiones. Espera un minuto y vuelve a intentarlo.');
            if (!res.ok)
                throw new Error(`Error de la API de Twitch (${res.status}).`);
            return (await res.json());
        }
        throw new Error('Twitch rechazó la autorización. Revisa Client ID y Client Secret.');
    }
    async userId(c) {
        const login = normalizeLogin(c.login);
        if (!login)
            throw new Error('El nombre de canal no es válido (solo letras, números y guion bajo).');
        const u = await this.helix(`users?login=${encodeURIComponent(login)}`, c);
        if (!u.data.length)
            throw new Error(`No existe el canal "${login}".`);
        return { id: u.data[0].id, name: u.data[0].display_name };
    }
    async testConnection(c) {
        if (!c.clientId || !c.clientSecret || !c.login) {
            return { ok: false, message: 'Rellena Client ID, Client Secret y nombre de canal.' };
        }
        try {
            const u = await this.userId(c);
            return { ok: true, message: `Conectado al canal ${u.name}.` };
        }
        catch (e) {
            return { ok: false, message: e.message };
        }
    }
    /** VODs recientes del canal (type=archive = directos guardados). */
    async listVods(c) {
        if (!c.clientId || !c.clientSecret)
            throw new Error('Faltan las credenciales de Twitch (pestaña Conexiones).');
        const u = await this.userId(c);
        const v = await this.helix(`videos?user_id=${u.id}&type=archive&first=50`, c);
        return v.data.map((x) => ({
            id: x.id,
            title: x.title,
            url: x.url,
            durationSec: parseTwitchDuration(x.duration),
            createdAt: x.created_at,
            ...(x.thumbnail_url ? { thumbnail: x.thumbnail_url.replace('%{width}', '320').replace('%{height}', '180') } : {}),
            ...(typeof x.view_count === 'number' ? { views: x.view_count } : {}),
        }));
    }
    /** ¿Está en directo ahora mismo? */
    async streamStatus(c) {
        this.needCreds(c);
        const login = normalizeLogin(c.login);
        if (!login)
            throw new Error('El nombre de canal no es válido (solo letras, números y guion bajo).');
        const r = await this.helix(`streams?user_login=${encodeURIComponent(login)}`, c);
        const s = r.data.find((x) => x.type === 'live');
        if (!s)
            return { live: false };
        return { live: true, title: s.title, game: s.game_name, viewers: s.viewer_count, startedAt: s.started_at };
    }
    /** Clips del canal, los más recientes primero. */
    /**
     * Clips del canal, del más reciente al más antiguo. Twitch los devuelve ordenados por visualizaciones, de 100 en 100 y
     * por ventanas de fechas, así que se piden por tramos de fechas y con paginación hasta tenerlos todos.
     * Con `sinceMs` solo se piden los de desde esa fecha (para refrescar lo reciente sin repasar todo el historial).
     */
    async listClips(c, o = {}) {
        this.needCreds(c);
        const u = await this.userId(c);
        const seen = new Map();
        const page = async (from, to) => {
            let cursor = '';
            let got = 0;
            for (let i = 0; i < CLIP_MAX_PAGES; i++) {
                const q = `clips?broadcaster_id=${u.id}&first=100&started_at=${encodeURIComponent(new Date(from).toISOString())}&ended_at=${encodeURIComponent(new Date(to).toISOString())}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
                const r = await this.helix(q, c);
                for (const x of r.data) {
                    got++;
                    seen.set(x.id, { id: x.id, title: x.title, url: x.url, durationSec: x.duration, createdAt: x.created_at, creator: x.creator_name, views: x.view_count, thumbnail: x.thumbnail_url });
                }
                cursor = r.pagination?.cursor ?? '';
                if (!cursor || r.data.length === 0)
                    break;
            }
            return got;
        };
        const end = this.now();
        if (o.sinceMs !== undefined) {
            await page(o.sinceMs, end);
        }
        else {
            // por tramos de 90 días hacia atrás; se para tras un año entero sin ningún clip (y nunca más allá de 8 años)
            let to = end;
            let emptyDays = 0;
            for (let w = 0; w < CLIP_MAX_WINDOWS; w++) {
                const from = to - CLIP_WINDOW_MS;
                let n;
                try {
                    n = await page(from, to);
                }
                catch (e) {
                    if (w === 0)
                        throw e; // sin lo reciente no hay nada que enseñar
                    o.onWarning?.(`Solo se han podido leer los clips hasta ${new Date(to).toLocaleDateString('es-ES')}: ${e.message}`);
                    break;
                }
                o.onProgress?.([...seen.values()]);
                emptyDays = n === 0 ? emptyDays + CLIP_WINDOW_MS : 0;
                if (emptyDays >= 365 * 86_400_000)
                    break;
                to = from;
            }
        }
        return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    needCreds(c) {
        if (!c.clientId || !c.clientSecret)
            throw new Error('Faltan las credenciales de Twitch (pestaña Conexiones).');
    }
}
exports.TwitchClient = TwitchClient;
