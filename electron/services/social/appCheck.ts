import type { Platform } from '../../../shared/types';
import { PROVIDERS, type OAuthProvider } from '../oauth';
import { PublishError, timedFetch } from './common';

export interface AppCheckEnv {
  fetchFn?: typeof fetch;
  providers?: Record<keyof typeof PROVIDERS, OAuthProvider>;
  /** Para Instagram: la raíz de la API de Meta (en las pruebas, un servidor local). */
  graph?: string;
}

const LABEL: Record<Platform, string> = { youtube: 'Google', tiktok: 'TikTok', instagram: 'Meta' };

/**
 * Comprueba que el ID y el secreto de la app son los de verdad ANTES de abrir el navegador, con una petición que cada
 * red responde de forma distinta según las claves sean buenas o no (sin tocar la cuenta del usuario):
 * - Google: pedir un token con un refresh_token inventado → «invalid_client» si las claves fallan, «invalid_grant» si son buenas.
 * - TikTok: lo mismo (TikTok responde siempre 200 y pone el error en el cuerpo).
 * - Meta: pedir el token de aplicación (client_credentials) → lo devuelve si las claves son buenas; error 101 si no.
 * Comprobado contra las tres APIs reales el 14/11/2026.
 */
export async function checkAppCredentials(platform: Platform, clientId: string, clientSecret: string, env: AppCheckEnv = {}): Promise<void> {
  const f = env.fetchFn ?? fetch;
  const prov = env.providers ?? PROVIDERS;
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) throw new PublishError(`Faltan el ID y el secreto de la app de ${LABEL[platform]}.`);
  const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(o) });

  if (platform === 'youtube') {
    if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new PublishError('El ID de cliente de Google termina en «.apps.googleusercontent.com». Cópialo entero desde Credenciales.');
    const r = await timedFetch(f, prov.google.tokenUrl, form({ grant_type: 'refresh_token', refresh_token: 'streamclips-comprobacion', client_id: id, client_secret: secret }), 20_000);
    const j = (await r.json().catch(() => ({}))) as { error?: string; error_description?: string };
    if (j.error === 'invalid_client') throw new PublishError('Google no reconoce ese ID de cliente, o el secreto no es el suyo. Copia los dos desde «Credenciales» del mismo cliente OAuth (tipo «Aplicación de escritorio»).');
    if (j.error === 'invalid_grant' || j.error === 'unauthorized_client' || !j.error) return;
    throw new PublishError(`Google respondió algo inesperado al comprobar las claves: ${j.error_description ?? j.error ?? `HTTP ${r.status}`}`);
  }

  if (platform === 'tiktok') {
    const r = await timedFetch(f, prov.tiktok.tokenUrl, form({ grant_type: 'refresh_token', refresh_token: 'rft.streamclips-comprobacion', client_key: id, client_secret: secret }), 20_000);
    const j = (await r.json().catch(() => ({}))) as { error?: string; error_description?: string };
    if (j.error === 'invalid_client') throw new PublishError('TikTok dice que la Client key o el Client secret no son correctos. Cópialos desde la página de tu app en developers.tiktok.com (si la app está en Sandbox, la Client key empieza por «sbaw»).');
    if (j.error === 'invalid_request') throw new PublishError('TikTok no acepta el formato de esa Client key. Copia la Client key tal cual (sin espacios) desde la página de tu app.');
    if (j.error === 'invalid_grant' || !j.error) return;
    throw new PublishError(`TikTok respondió algo inesperado al comprobar las claves: ${j.error_description ?? j.error}`);
  }

  const graph = env.graph ?? prov.meta.tokenUrl.replace(/\/oauth\/access_token$/, '');
  if (!/^\d{5,}$/.test(id)) throw new PublishError('El ID de la app de Meta es un número largo (sale arriba del panel de la app). Comprueba que no has pegado otra cosa.');
  const q = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
  const r = await timedFetch(f, `${graph}/oauth/access_token?${q}`, { headers: { Accept: 'application/json' } }, 20_000);
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string; code?: number } };
  if (typeof j.access_token === 'string' && j.access_token) return;
  if (j.error?.code === 101 || /Invalid Client ID|Error validating application|client secret/i.test(j.error?.message ?? '')) {
    throw new PublishError('Meta no reconoce ese ID de la app, o la clave secreta no es la suya. Cópialos desde «Configuración de la app › Básica» (pulsa «Mostrar» en la clave secreta).');
  }
  throw new PublishError(`Meta respondió algo inesperado al comprobar las claves: ${j.error?.message ?? `HTTP ${r.status}`}`);
}
