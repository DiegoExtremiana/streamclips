"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionService = exports.PLATFORM_PROVIDER = void 0;
const types_1 = require("../../shared/types");
const oauth_1 = require("../services/oauth");
exports.PLATFORM_PROVIDER = { youtube: 'google', tiktok: 'tiktok', instagram: 'meta' };
const CAVEAT = {
    youtube: 'Mientras tu proyecto de Google no pase la verificación, YouTube deja los vídeos subidos por la API como privados y limita ~6 subidas al día.',
    tiktok: 'Mientras tu app de TikTok no esté auditada, solo puede publicar vídeos privados (solo tú los ves).',
    instagram: 'Necesita una cuenta de Instagram profesional (Business o Creador) enlazada a una página de Facebook. Solo clips (Reels).',
};
/** Margen para renovar el token antes de que caduque. */
const RENEW_BEFORE_MS = 5 * 60_000;
class ConnectionService {
    d;
    cancel = null;
    renewing = new Map();
    constructor(d) {
        this.d = d;
    }
    provider(p) {
        return (this.d.providers ?? oauth_1.PROVIDERS)[exports.PLATFORM_PROVIDER[p]];
    }
    get conns() {
        return this.d.store.data.connections;
    }
    now() {
        return (this.d.now ?? Date.now)();
    }
    list() {
        return ['youtube', 'tiktok', 'instagram'].map((platform) => {
            const c = this.conns[platform];
            return {
                platform,
                hasCredentials: !!(c?.clientId && c.clientSecret),
                connected: !!c?.tokens,
                ...(c?.account ? { account: c.account } : {}),
                caveat: CAVEAT[platform],
            };
        });
    }
    setApp(platform, clientId, clientSecret) {
        const id = clientId.trim();
        if (id.length > 300 || /\s/.test(id))
            throw new Error('El ID de la app no es válido.');
        const cur = this.conns[platform] ?? { clientId: '', clientSecret: '', tokens: '' };
        const next = { ...cur, clientId: id };
        if (clientSecret !== types_1.MASKED_SECRET)
            next.clientSecret = this.d.secrets.encode(clientSecret.trim());
        // cambiar de app invalida la conexión anterior
        if (id !== cur.clientId) {
            next.tokens = '';
            delete next.account;
        }
        this.conns[platform] = next;
        this.d.store.save();
        this.d.notifier.changed();
        return this.list();
    }
    /** Abre el navegador y guarda las claves de acceso al volver. */
    async connect(platform) {
        const c = this.conns[platform];
        if (!c?.clientId || !c.clientSecret)
            throw new Error('Primero guarda el ID y el secreto de tu app.');
        if (this.cancel)
            throw new Error('Ya hay una conexión en curso.');
        const p = this.provider(platform);
        try {
            const tokens = await (0, oauth_1.authorize)(p, { clientId: c.clientId, clientSecret: this.d.secrets.decode(c.clientSecret) }, this.d.openUrl, {
                fetchFn: this.d.fetchFn,
                now: this.d.now,
                onCancel: (fn) => (this.cancel = fn),
            });
            // Meta entrega primero un token de pocas horas: se cambia por uno de 60 días
            if (p.id === 'meta') {
                const long = await (0, oauth_1.refreshToken)(p, { clientId: c.clientId, clientSecret: this.d.secrets.decode(c.clientSecret) }, tokens, { fetchFn: this.d.fetchFn, now: this.d.now });
                Object.assign(tokens, long);
            }
            const info = (await this.d.afterConnect?.(platform, tokens)) ?? {};
            c.tokens = this.d.secrets.encode(JSON.stringify({ ...tokens, extra: { ...tokens.extra, ...info.extra } }));
            if (info.account)
                c.account = info.account;
            this.d.store.save();
            this.d.notifier.changed();
            this.d.log.info(`Conectado: ${platform}${info.account ? ` (${info.account})` : ''}`);
        }
        finally {
            this.cancel = null;
        }
        return this.list();
    }
    cancelConnect() {
        this.cancel?.();
    }
    disconnect(platform) {
        const c = this.conns[platform];
        if (c) {
            c.tokens = '';
            delete c.account;
            this.d.store.save();
            this.d.notifier.changed();
        }
        return this.list();
    }
    /** Clave de acceso vigente; la renueva si va a caducar. null si no está conectada. */
    async accessToken(platform) {
        const c = this.conns[platform];
        if (!c?.tokens)
            return null;
        let t;
        try {
            t = JSON.parse(this.d.secrets.decode(c.tokens));
            if (typeof t.accessToken !== 'string')
                throw new Error('x');
        }
        catch {
            return null;
        }
        if (t.expiresAt && t.expiresAt - this.now() < RENEW_BEFORE_MS) {
            let pending = this.renewing.get(platform);
            if (!pending) {
                pending = (0, oauth_1.refreshToken)(this.provider(platform), { clientId: c.clientId, clientSecret: this.d.secrets.decode(c.clientSecret) }, t, { fetchFn: this.d.fetchFn, now: this.d.now })
                    .then((n) => {
                    c.tokens = this.d.secrets.encode(JSON.stringify(n));
                    this.d.store.save();
                    return n;
                })
                    .finally(() => this.renewing.delete(platform));
                this.renewing.set(platform, pending);
            }
            t = await pending;
        }
        return t;
    }
}
exports.ConnectionService = ConnectionService;
