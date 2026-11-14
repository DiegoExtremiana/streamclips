import type { ConnectionCheck, ConnectionProbe, Platform } from '../../../shared/types';
import type { TokenSet } from '../oauth';
import { IG_GRAPH } from './instagram';
import { TT_API } from './tiktok';
import { YT_ENDPOINTS } from './youtube';
import { PublishError, apiMessage, timedFetch } from './common';

export interface ProbeEnv {
  fetchFn?: typeof fetch;
  ytApi?: string;
  /** Dónde se consultan los permisos del token de Google (en las pruebas, un servidor local). */
  googleTokenInfo?: string;
  tiktokApi?: string;
  graph?: string;
}

const GOOGLE_TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';
const ok = (label: string, detail: string): ConnectionCheck => ({ label, ok: true, detail });
const bad = (label: string, detail: string): ConnectionCheck => ({ label, ok: false, detail });

/**
 * Prueba de verdad de una conexión ya autorizada, sin publicar nada: se habla con la red con la clave guardada y se
 * comprueba la cuenta, los permisos concedidos y lo que esa cuenta puede publicar (público o solo privado, cuota del día).
 */
export async function probeConnection(platform: Platform, t: TokenSet, env: ProbeEnv = {}): Promise<ConnectionProbe> {
  const f = env.fetchFn ?? fetch;
  const auth = { Authorization: `Bearer ${t.accessToken}` };
  const checks: ConnectionCheck[] = [];
  let account = '';
  let canPublishPublic: boolean | undefined;

  if (platform === 'youtube') {
    const api = env.ytApi ?? YT_ENDPOINTS.api;
    const r = await timedFetch(f, `${api}/channels?part=snippet,statistics&mine=true`, { headers: auth });
    if (!r.ok) throw new PublishError(`YouTube: ${await apiMessage(r)}`);
    const j = (await r.json()) as { items?: { snippet?: { title?: string }; statistics?: { videoCount?: string; subscriberCount?: string } }[] };
    const ch = j.items?.[0];
    if (!ch?.snippet?.title) throw new PublishError('La cuenta de Google no tiene un canal de YouTube. Crea uno en youtube.com y vuelve a conectar.');
    account = ch.snippet.title;
    checks.push(ok('Canal', `${account}${ch.statistics?.videoCount ? ` · ${ch.statistics.videoCount} vídeos` : ''}${ch.statistics?.subscriberCount ? ` · ${ch.statistics.subscriberCount} suscriptores` : ''}`));
    const info = await timedFetch(f, `${env.googleTokenInfo ?? GOOGLE_TOKENINFO}?access_token=${encodeURIComponent(t.accessToken)}`, {}).catch(() => null);
    const ti = info && info.ok ? ((await info.json().catch(() => ({}))) as { scope?: string }) : null;
    const scopes = (ti?.scope ?? t.scope ?? '').split(/[ ,]+/).filter(Boolean);
    if (scopes.length) {
      const upload = scopes.some((s) => /youtube\.upload$|\/auth\/youtube$/.test(s));
      checks.push(upload ? ok('Permiso para subir vídeos', 'Concedido') : bad('Permiso para subir vídeos', 'No concedido: vuelve a conectar y acepta todas las casillas que pide Google.'));
    }
    checks.push(ok('Permanencia', 'Si la pantalla de consentimiento de tu proyecto está «En producción», la conexión no caduca. Si está «En pruebas», Google la corta a los 7 días.'));
    checks.push(ok('Qué pasa al subir', 'Hasta que Google verifique tu proyecto, los vídeos subidos por la API quedan privados; la cuota gratuita da para unas 6 subidas al día.'));
    return { platform, account, checks, canPublishPublic };
  }

  if (platform === 'tiktok') {
    const api = env.tiktokApi ?? TT_API;
    const u = await timedFetch(f, `${api}/user/info/?fields=display_name,open_id,username`, { headers: auth });
    const uj = (await u.json().catch(() => ({}))) as { data?: { user?: { display_name?: string; username?: string } }; error?: { code?: string; message?: string } };
    if (!u.ok || (uj.error?.code && uj.error.code !== 'ok')) throw new PublishError(`TikTok: ${uj.error?.message ?? u.status}`);
    account = uj.data?.user?.username ? `@${uj.data.user.username}` : (uj.data?.user?.display_name ?? 'Cuenta de TikTok');
    checks.push(ok('Cuenta', account));
    const c = await timedFetch(f, `${api}/post/publish/creator_info/query/`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8' }, body: '{}' });
    const cj = (await c.json().catch(() => ({}))) as { data?: { privacy_level_options?: string[]; max_video_post_duration_sec?: number; comment_disabled?: boolean }; error?: { code?: string; message?: string } };
    if (!c.ok || (cj.error?.code && cj.error.code !== 'ok')) {
      const code = cj.error?.code ?? String(c.status);
      checks.push(bad('Permiso para publicar', /scope/i.test(code) ? 'La app no tiene concedido «video.publish»: añade el producto Content Posting API (Direct Post) y vuelve a conectar.' : `TikTok: ${cj.error?.message ?? code}`));
      return { platform, account, checks, canPublishPublic: false };
    }
    const opts = cj.data?.privacy_level_options ?? [];
    canPublishPublic = opts.includes('PUBLIC_TO_EVERYONE');
    checks.push(ok('Permiso para publicar', 'Concedido (Content Posting API)'));
    checks.push(canPublishPublic ? ok('Visibilidad', 'Puede publicar en público.') : bad('Visibilidad', 'Solo puede publicar en privado («solo yo»): la app no está auditada por TikTok. Para publicar en público hay que enviarla a revisión en developers.tiktok.com.'));
    if (cj.data?.max_video_post_duration_sec) checks.push(ok('Duración máxima', `${Math.round(cj.data.max_video_post_duration_sec / 60)} min por vídeo`));
    return { platform, account, checks, canPublishPublic };
  }

  const graph = env.graph ?? IG_GRAPH;
  const tok = `access_token=${encodeURIComponent(t.accessToken)}`;
  const r = await timedFetch(f, `${graph}/me/accounts?fields=name,instagram_business_account%7Bid,username%7D&${tok}`, {});
  const j = (await r.json().catch(() => ({}))) as { data?: { name?: string; instagram_business_account?: { id: string; username?: string } }[]; error?: { message?: string } };
  if (!r.ok) throw new PublishError(`Instagram: ${j.error?.message ?? r.status}`);
  const pages = j.data ?? [];
  const page = pages.find((p) => p.instagram_business_account?.id);
  if (!page?.instagram_business_account) {
    checks.push(bad('Cuenta profesional', pages.length ? `Tus páginas (${pages.map((p) => p.name).filter(Boolean).join(', ')}) no tienen ninguna cuenta de Instagram profesional enlazada.` : 'La cuenta de Facebook no administra ninguna página.'));
    return { platform, account: '', checks, canPublishPublic: false };
  }
  const ig = page.instagram_business_account;
  account = ig.username ? `@${ig.username}` : (page.name ?? 'Instagram');
  checks.push(ok('Cuenta profesional', `${account} (enlazada a la página «${page.name ?? ''}»)`));
  const perms = await timedFetch(f, `${graph}/me/permissions?${tok}`, {}).catch(() => null);
  const pj = perms && perms.ok ? ((await perms.json().catch(() => ({}))) as { data?: { permission: string; status: string }[] }) : null;
  if (pj?.data) {
    const granted = new Set(pj.data.filter((p) => p.status === 'granted').map((p) => p.permission));
    const need = ['instagram_basic', 'instagram_content_publish', 'pages_show_list'];
    const missing = need.filter((p) => !granted.has(p));
    checks.push(missing.length ? bad('Permisos', `Faltan: ${missing.join(', ')}. Vuelve a conectar y acepta todo lo que pide Meta.`) : ok('Permisos', 'Concedidos (leer la cuenta y publicar contenido)'));
  }
  const lim = await timedFetch(f, `${graph}/${encodeURIComponent(ig.id)}/content_publishing_limit?fields=quota_usage,config&${tok}`, {}).catch(() => null);
  const lj = lim && lim.ok ? ((await lim.json().catch(() => ({}))) as { data?: { quota_usage?: number; config?: { quota_total?: number } }[] }) : null;
  const usage = lj?.data?.[0];
  if (usage && typeof usage.quota_usage === 'number') {
    const total = usage.config?.quota_total ?? 100;
    checks.push(ok('Publicaciones por la API', `${usage.quota_usage} de ${total} usadas en las últimas 24 h`));
  }
  canPublishPublic = true;
  checks.push(ok('Qué pasa al subir', 'Los Reels salen públicos con tu cuenta (la app en modo desarrollo funciona con tus propias cuentas sin revisión de Meta).'));
  return { platform, account, checks, canPublishPublic };
}
