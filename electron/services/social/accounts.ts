import type { Platform } from '../../../shared/types';
import type { TokenSet } from '../oauth';
import { PublishError, apiMessage, timedFetch } from './common';

export interface AccountEnv {
  fetchFn?: typeof fetch;
  ytApi?: string;
  tiktokApi?: string;
  graph?: string;
}

/** Nombre de la cuenta conectada (y, en Instagram, su id profesional). Si no se puede saber, la conexión no se da por buena. */
export async function lookupAccount(platform: Platform, t: TokenSet, env: AccountEnv = {}): Promise<{ account?: string; extra?: Record<string, string> }> {
  const f = env.fetchFn ?? fetch;
  const auth = { Authorization: `Bearer ${t.accessToken}` };
  if (platform === 'youtube') {
    const r = await timedFetch(f, `${env.ytApi ?? 'https://www.googleapis.com/youtube/v3'}/channels?part=snippet&mine=true`, { headers: auth });
    if (!r.ok) throw new PublishError(`YouTube: ${await apiMessage(r)}`);
    const j = (await r.json()) as { items?: { snippet?: { title?: string } }[] };
    const title = j.items?.[0]?.snippet?.title;
    if (!title) throw new PublishError('La cuenta de Google no tiene un canal de YouTube. Crea uno en youtube.com y vuelve a conectar.');
    return { account: title };
  }
  if (platform === 'tiktok') {
    const r = await timedFetch(f, `${env.tiktokApi ?? 'https://open.tiktokapis.com/v2'}/user/info/?fields=display_name,open_id`, { headers: auth });
    const j = (await r.json().catch(() => ({}))) as { data?: { user?: { display_name?: string } }; error?: { code?: string; message?: string } };
    if (!r.ok || (j.error?.code && j.error.code !== 'ok')) throw new PublishError(`TikTok: ${j.error?.message ?? r.status}`);
    return { account: j.data?.user?.display_name ?? 'Cuenta de TikTok' };
  }
  const r = await timedFetch(f, `${env.graph ?? 'https://graph.facebook.com/v21.0'}/me/accounts?fields=name,instagram_business_account%7Bid,username%7D&access_token=${encodeURIComponent(t.accessToken)}`, {});
  const j = (await r.json().catch(() => ({}))) as { data?: { name?: string; instagram_business_account?: { id: string; username?: string } }[]; error?: { message?: string } };
  if (!r.ok) throw new PublishError(`Instagram: ${j.error?.message ?? r.status}`);
  const page = j.data?.find((p) => p.instagram_business_account?.id);
  if (!page?.instagram_business_account) {
    throw new PublishError('No se encontró ninguna cuenta de Instagram profesional enlazada a tus páginas de Facebook. Pasa la cuenta a Business/Creador y enlázala a una página.');
  }
  const ig = page.instagram_business_account;
  return { account: ig.username ? `@${ig.username}` : (page.name ?? 'Instagram'), extra: { igUserId: ig.id } };
}
