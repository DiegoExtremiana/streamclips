import type { TwitchClip, TwitchStream, TwitchVod } from '../../shared/types';

type FetchFn = typeof fetch;

export interface TwitchCreds {
  clientId: string;
  clientSecret: string;
  login: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** "3h12m5s" -> segundos (0 si el formato no se reconoce). */
export function parseTwitchDuration(d: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Acepta "don_diegons", "@Don_Diegons" o "https://twitch.tv/don_diegons"; null si no es un login válido. */
export function normalizeLogin(input: string): string | null {
  let s = input.trim().toLowerCase();
  const fromUrl = /^https?:\/\/(?:www\.)?twitch\.tv\/([^/?#]+)/.exec(s);
  if (fromUrl) s = fromUrl[1];
  s = s.replace(/^@/, '');
  return /^[a-z0-9_]{1,25}$/.test(s) ? s : null;
}

/** Cliente mínimo de la API Helix de Twitch con credenciales de aplicación (solo lectura pública). */
export class TwitchClient {
  private token: { clientId: string; value: string; expiresAt: number } | null = null;

  constructor(
    private fetchFn: FetchFn = (u, i) => fetch(u, i),
    private now: () => number = Date.now,
  ) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new Error('Twitch no responde (tiempo agotado). Inténtalo de nuevo.');
      throw new Error('No se pudo conectar con Twitch. Comprueba tu conexión a internet.');
    }
  }

  private async appToken(c: TwitchCreds, force = false): Promise<string> {
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
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('Twitch no devolvió un token válido.');
    this.token = { clientId: c.clientId, value: j.access_token, expiresAt: this.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  private async helix<T>(path: string, c: TwitchCreds): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.appToken(c, attempt > 0);
      const res = await this.request(`https://api.twitch.tv/helix/${path}`, {
        headers: { 'Client-Id': c.clientId, Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        if (attempt === 0) continue; // token caducado o revocado: se pide uno nuevo una vez
        break;
      }
      if (res.status === 429) throw new Error('Twitch limita las peticiones. Espera un minuto y vuelve a intentarlo.');
      if (!res.ok) throw new Error(`Error de la API de Twitch (${res.status}).`);
      return (await res.json()) as T;
    }
    throw new Error('Twitch rechazó la autorización. Revisa Client ID y Client Secret.');
  }

  private async userId(c: TwitchCreds): Promise<{ id: string; name: string }> {
    const login = normalizeLogin(c.login);
    if (!login) throw new Error('El nombre de canal no es válido (solo letras, números y guion bajo).');
    const u = await this.helix<{ data: { id: string; display_name: string }[] }>(`users?login=${encodeURIComponent(login)}`, c);
    if (!u.data.length) throw new Error(`No existe el canal "${login}".`);
    return { id: u.data[0].id, name: u.data[0].display_name };
  }

  async testConnection(c: TwitchCreds): Promise<{ ok: boolean; message: string }> {
    if (!c.clientId || !c.clientSecret || !c.login) {
      return { ok: false, message: 'Rellena Client ID, Client Secret y nombre de canal.' };
    }
    try {
      const u = await this.userId(c);
      return { ok: true, message: `Conectado al canal ${u.name}.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** VODs recientes del canal (type=archive = directos guardados). */
  async listVods(c: TwitchCreds): Promise<TwitchVod[]> {
    if (!c.clientId || !c.clientSecret) throw new Error('Faltan las credenciales de Twitch (pestaña Conexiones).');
    const u = await this.userId(c);
    const v = await this.helix<{
      data: { id: string; title: string; url: string; duration: string; created_at: string }[];
    }>(`videos?user_id=${u.id}&type=archive&first=50`, c);
    return v.data.map((x) => ({
      id: x.id,
      title: x.title,
      url: x.url,
      durationSec: parseTwitchDuration(x.duration),
      createdAt: x.created_at,
    }));
  }

  /** ¿Está en directo ahora mismo? */
  async streamStatus(c: TwitchCreds): Promise<TwitchStream> {
    this.needCreds(c);
    const login = normalizeLogin(c.login);
    if (!login) throw new Error('El nombre de canal no es válido (solo letras, números y guion bajo).');
    const r = await this.helix<{ data: { type: string; title: string; game_name: string; viewer_count: number; started_at: string }[] }>(
      `streams?user_login=${encodeURIComponent(login)}`,
      c,
    );
    const s = r.data.find((x) => x.type === 'live');
    if (!s) return { live: false };
    return { live: true, title: s.title, game: s.game_name, viewers: s.viewer_count, startedAt: s.started_at };
  }

  /** Clips del canal, los más recientes primero. */
  async listClips(c: TwitchCreds, limit = 100): Promise<TwitchClip[]> {
    this.needCreds(c);
    const u = await this.userId(c);
    const r = await this.helix<{
      data: { id: string; title: string; url: string; duration: number; created_at: string; creator_name: string; view_count: number; thumbnail_url: string }[];
    }>(`clips?broadcaster_id=${u.id}&first=${Math.max(1, Math.min(100, limit))}`, c);
    return r.data
      .map((x) => ({
        id: x.id,
        title: x.title,
        url: x.url,
        durationSec: x.duration,
        createdAt: x.created_at,
        creator: x.creator_name,
        views: x.view_count,
        thumbnail: x.thumbnail_url,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private needCreds(c: TwitchCreds): void {
    if (!c.clientId || !c.clientSecret) throw new Error('Faltan las credenciales de Twitch (pestaña Conexiones).');
  }
}
