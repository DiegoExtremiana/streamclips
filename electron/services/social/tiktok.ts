import fs from 'node:fs';
import type { OutputItem } from '../../../shared/types';
import { PublishError, apiMessage, defaultSleep, readChunk, timedFetch, type SocialDeps } from './common';

export const TT_API = 'https://open.tiktokapis.com/v2';
const CHUNK = 10 * 1024 * 1024; // entre 5 y 64 MB; el último trozo absorbe el resto
const POLL_MS = 5000;
const POLL_MAX = 72; // 6 minutos

export interface TiktokDeps extends SocialDeps {
  token: () => Promise<string>;
  api?: string;
  chunkSize?: number;
  pollMs?: number;
}

export function tiktokFile(o: OutputItem): string {
  if (o.kind === 'long') throw new PublishError('TikTok solo admite clips. Este vídeo largo no se puede publicar ahí.');
  const f = o.files.vertical ?? o.files.horizontal;
  if (!f) throw new PublishError('El clip no tiene archivo.');
  return f;
}

async function call<T>(d: TiktokDeps, path: string, body: unknown): Promise<T> {
  const f = d.fetchFn ?? fetch;
  const r = await timedFetch(f, `${d.api ?? TT_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await d.token()}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  if (r.status === 401 || j.error?.code === 'access_token_invalid') throw new PublishError('TikTok rechazó la conexión. Vuelve a conectar la cuenta en Conexiones.');
  if (!r.ok || (j.error?.code && j.error.code !== 'ok')) {
    const code = j.error?.code ?? r.status;
    if (code === 'spam_risk_too_many_posts') throw new PublishError('TikTok limita las publicaciones diarias de tu cuenta. Inténtalo mañana.');
    throw new PublishError(`TikTok: ${j.error?.message || code}`);
  }
  return j.data as T;
}

export async function publishTiktok(d: TiktokDeps, o: OutputItem): Promise<{ publishId: string }> {
  const f = d.fetchFn ?? fetch;
  const sleep = d.sleep ?? defaultSleep;
  const file = tiktokFile(o);
  if (!fs.existsSync(file)) throw new PublishError('El archivo del vídeo ya no está en su sitio.');
  const size = fs.statSync(file).size;
  if (!size) throw new PublishError('El archivo del vídeo está vacío.');

  // privacidad: solo se publica abierto si lo has pedido Y la cuenta puede (apps sin auditar solo ofrecen «solo yo»)
  const info = await call<{ privacy_level_options?: string[] }>(d, '/post/publish/creator_info/query/', {});
  const options = info.privacy_level_options ?? [];
  const wantPublic = o.visibility === 'public' && options.includes('PUBLIC_TO_EVERYONE');
  const privacy = wantPublic ? 'PUBLIC_TO_EVERYONE' : options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
  if (!privacy) throw new PublishError('TikTok no ofrece ninguna opción de privacidad para esta cuenta.');

  const chunk = Math.max(d.chunkSize ?? CHUNK, 1);
  const total = Math.max(1, Math.floor(size / chunk));
  const init = await call<{ publish_id: string; upload_url: string }>(d, '/post/publish/video/init/', {
    post_info: { title: o.title.slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: total === 1 ? size : chunk, total_chunk_count: total },
  });
  if (!init.publish_id || !init.upload_url) throw new PublishError('TikTok no devolvió la dirección de subida.');

  const step = total === 1 ? size : chunk;
  for (let i = 0; i < total; i++) {
    const start = i * step;
    const end = i === total - 1 ? size : start + step; // el último trozo lleva el resto
    const body = await readChunk(file, start, end);
    const r = await timedFetch(
      f,
      init.upload_url,
      { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length), 'Content-Range': `bytes ${start}-${end - 1}/${size}` }, body: new Uint8Array(body) },
      10 * 60_000,
    );
    if (r.status !== 206 && r.status !== 201 && r.status !== 200) throw new PublishError(`TikTok rechazó un trozo del vídeo: ${await apiMessage(r)}`);
  }

  for (let i = 0; i < POLL_MAX; i++) {
    const st = await call<{ status?: string; fail_reason?: string }>(d, '/post/publish/status/fetch/', { publish_id: init.publish_id });
    if (st.status === 'PUBLISH_COMPLETE') return { publishId: init.publish_id };
    if (st.status === 'FAILED') throw new PublishError(`TikTok no pudo publicar el vídeo (${st.fail_reason ?? 'motivo desconocido'}).`);
    await sleep(d.pollMs ?? POLL_MS);
  }
  // se subió pero TikTok no ha terminado de procesarlo: no se reintenta (podría duplicarse)
  throw new PublishError('TikTok sigue procesando el vídeo. Comprueba en la app de TikTok antes de reprogramarlo.');
}
