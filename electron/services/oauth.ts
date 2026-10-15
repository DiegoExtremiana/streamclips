import crypto from 'node:crypto';
import http from 'node:http';

export interface OAuthProvider {
  id: string;
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator: string;
  /** TikTok llama «client_key» a lo que los demás llaman «client_id». */
  clientIdParam: 'client_id' | 'client_key';
  pkce: boolean;
  extraAuthParams?: Record<string, string>;
  port: number;
}

export const PROVIDERS = {
  google: {
    id: 'google',
    label: 'Google (YouTube)',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.readonly'],
    scopeSeparator: ' ',
    clientIdParam: 'client_id',
    pkce: true,
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    port: 53682,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    scopeSeparator: ',',
    clientIdParam: 'client_key',
    pkce: true,
    port: 53683,
  },
  meta: {
    id: 'meta',
    label: 'Instagram (Meta)',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management'],
    scopeSeparator: ',',
    clientIdParam: 'client_id',
    pkce: false,
    port: 53684,
  },
} satisfies Record<string, OAuthProvider>;

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ms desde 1970; 0 = no caduca. */
  expiresAt: number;
  scope?: string;
  /** Datos propios de cada red (id de usuario, etc.). */
  extra?: Record<string, string>;
}

export interface OAuthCreds {
  clientId: string;
  clientSecret: string;
}

export interface OAuthDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

export const redirectUri = (p: OAuthProvider): string => `http://127.0.0.1:${p.port}/callback`;

export function buildAuthUrl(p: OAuthProvider, c: OAuthCreds, state: string, challenge?: string): string {
  const q = new URLSearchParams({
    [p.clientIdParam]: c.clientId,
    redirect_uri: redirectUri(p),
    response_type: 'code',
    scope: p.scopes.join(p.scopeSeparator),
    state,
    ...(p.extraAuthParams ?? {}),
  });
  if (p.pkce && challenge) {
    q.set('code_challenge', challenge);
    q.set('code_challenge_method', 'S256');
  }
  return `${p.authUrl}${p.authUrl.includes('?') ? '&' : '?'}${q}`;
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>StreamClips</title><body style="font-family:system-ui;background:#0e0f14;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${title}</h1><p>${body}</p></div>`;

/** Abre un servidor local que espera la vuelta del navegador con el código de autorización. */
export function waitForCode(p: OAuthProvider, state: string, timeoutMs = 5 * 60_000): { ready: Promise<void>; code: Promise<string>; close: () => void } {
  let close = () => undefined as void;
  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => ((resolveReady = res), (rejectReady = rej)));
  const code = new Promise<string>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${p.port}`);
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get('error');
      const gotState = u.searchParams.get('state');
      const c = u.searchParams.get('code');
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (err) {
        res.writeHead(400).end(PAGE('No se pudo conectar', 'Puedes cerrar esta pestaña y volver a intentarlo desde el programa.'));
        done(new Error(`${p.label} no autorizó la conexión (${err}).`));
      } else if (gotState !== state || !c) {
        res.writeHead(400).end(PAGE('Respuesta no válida', 'Vuelve al programa y reinténtalo.'));
        // una petición ajena no cancela la conexión en curso
      } else {
        res.writeHead(200).end(PAGE('Conectado', 'Ya puedes cerrar esta pestaña y volver a StreamClips.'));
        done(undefined, c);
      }
    });
    const timer = setTimeout(() => done(new Error('Se agotó el tiempo esperando la autorización en el navegador.')), timeoutMs);
    let finished = false;
    function done(e?: Error, c?: string) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      srv.close();
      srv.closeAllConnections?.();
      if (e) reject(e);
      else resolve(c!);
    }
    close = () => done(new Error('Conexión cancelada.'));
    srv.once('error', (e: NodeJS.ErrnoException) => {
      const m = e.code === 'EADDRINUSE' ? `El puerto ${p.port} está ocupado. Cierra otra conexión en curso y reinténtalo.` : `No se pudo abrir el receptor local: ${e.message}`;
      rejectReady(new Error(m));
      done(new Error(m));
    });
    srv.listen(p.port, '127.0.0.1', resolveReady);
  });
  code.catch(() => undefined);
  return { ready, code, close };
}

async function tokenRequest(p: OAuthProvider, body: Record<string, string>, d: OAuthDeps): Promise<TokenSet> {
  const f = d.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await f(p.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`No se pudo conectar con ${p.label}. Comprueba tu conexión a internet.`);
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (typeof j.data === 'object' && j.data !== null ? j.data : j) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') {
    const why = String(j.error_description ?? (j.error as { message?: string } | undefined)?.message ?? j.error ?? res.status);
    throw new Error(`${p.label} rechazó la autorización: ${why}`);
  }
  const ttl = Number(data.expires_in ?? 0);
  return {
    accessToken: data.access_token,
    ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
    expiresAt: ttl > 0 ? (d.now ?? Date.now)() + ttl * 1000 : 0,
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  };
}

export function exchangeCode(p: OAuthProvider, c: OAuthCreds, code: string, verifier: string | undefined, d: OAuthDeps = {}): Promise<TokenSet> {
  return tokenRequest(
    p,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(p),
      [p.clientIdParam]: c.clientId,
      client_secret: c.clientSecret,
      ...(verifier ? { code_verifier: verifier } : {}),
    },
    d,
  );
}

export async function refreshToken(p: OAuthProvider, c: OAuthCreds, t: TokenSet, d: OAuthDeps = {}): Promise<TokenSet> {
  if (p.id === 'meta') {
    // Meta no usa refresh_token: el token largo se renueva con él mismo mientras siga vigente
    const n = await tokenRequest(p, { grant_type: 'fb_exchange_token', client_id: c.clientId, client_secret: c.clientSecret, fb_exchange_token: t.accessToken }, d);
    return { ...t, ...n };
  }
  if (!t.refreshToken) throw new Error(`La conexión con ${p.label} caducó. Vuelve a conectarla en la pestaña Conexiones.`);
  const n = await tokenRequest(p, { grant_type: 'refresh_token', refresh_token: t.refreshToken, [p.clientIdParam]: c.clientId, client_secret: c.clientSecret }, d);
  return { ...t, ...n, refreshToken: n.refreshToken ?? t.refreshToken };
}

/** Flujo completo: abre el navegador, espera el código y lo cambia por las claves de acceso. */
export async function authorize(
  p: OAuthProvider,
  c: OAuthCreds,
  openUrl: (url: string) => Promise<void> | void,
  d: OAuthDeps & { timeoutMs?: number; onCancel?: (cancel: () => void) => void } = {},
): Promise<TokenSet> {
  if (!c.clientId || !c.clientSecret) throw new Error(`Faltan el ID y el secreto de la app de ${p.label}.`);
  const state = crypto.randomBytes(16).toString('hex');
  const pk = p.pkce ? pkcePair() : undefined;
  const w = waitForCode(p, state, d.timeoutMs);
  d.onCancel?.(w.close);
  await w.ready;
  try {
    await openUrl(buildAuthUrl(p, c, state, pk?.challenge));
  } catch (e) {
    w.close();
    throw new Error(`No se pudo abrir el navegador: ${(e as Error).message}`);
  }
  const code = await w.code;
  return exchangeCode(p, c, code, pk?.verifier, d);
}
