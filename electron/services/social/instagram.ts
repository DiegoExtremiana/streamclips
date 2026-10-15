import fs from 'node:fs';
import type { OutputItem } from '../../../shared/types';
import { PublishError, defaultSleep, timedFetch, type SocialDeps } from './common';

export const IG_GRAPH = 'https://graph.facebook.com/v21.0';
const POLL_MS = 5000;
const POLL_MAX = 120; // 10 minutos

export interface InstagramDeps extends SocialDeps {
  token: () => Promise<{ accessToken: string; igUserId: string }>;
  graph?: string;
  pollMs?: number;
}

export function instagramFile(o: OutputItem): string {
  if (o.kind === 'long') throw new PublishError('Instagram solo admite clips (Reels). Este vídeo largo no se puede publicar ahí.');
  const f = o.files.vertical;
  if (!f) throw new PublishError('Instagram necesita la versión vertical del clip.');
  return f;
}

async function graphJson<T>(r: Response): Promise<T> {
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!r.ok || j.error) {
    const e = j.error;
    if (r.status === 401 || e?.code === 190) throw new PublishError('Instagram rechazó la conexión. Vuelve a conectar la cuenta en Conexiones.');
    throw new PublishError(`Instagram: ${e?.message ?? `HTTP ${r.status}`}`);
  }
  return j;
}

export async function publishInstagram(d: InstagramDeps, o: OutputItem): Promise<{ mediaId: string }> {
  const f = d.fetchFn ?? fetch;
  const sleep = d.sleep ?? defaultSleep;
  const graph = d.graph ?? IG_GRAPH;
  const file = instagramFile(o);
  if (!fs.existsSync(file)) throw new PublishError('El archivo del vídeo ya no está en su sitio.');
  const size = fs.statSync(file).size;
  if (!size) throw new PublishError('El archivo del vídeo está vacío.');
  const { accessToken, igUserId } = await d.token();
  if (!igUserId) throw new PublishError('No hay una cuenta de Instagram profesional enlazada. Vuelve a conectar la cuenta en Conexiones.');

  // 1) contenedor del Reel con subida directa (no hace falta alojar el vídeo en una URL pública)
  const create = await graphJson<{ id?: string; uri?: string }>(
    await timedFetch(f, `${graph}/${encodeURIComponent(igUserId)}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: o.title.slice(0, 2200), share_to_feed: 'true', access_token: accessToken }),
    }),
  );
  if (!create.id) throw new PublishError('Instagram no creó el contenedor del vídeo.');
  const uploadUri = create.uri ?? `https://rupload.facebook.com/ig-api-upload/v21.0/${create.id}`;

  // 2) subir el archivo (en flujo: no se carga entero en memoria)
  const up = await timedFetch(
    f,
    uploadUri,
    {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}`, offset: '0', file_size: String(size) },
      body: fs.createReadStream(file) as unknown as BodyInit,
      // @ts-expect-error opción de Node necesaria para enviar un flujo
      duplex: 'half',
    },
    30 * 60_000,
  );
  await graphJson<{ success?: boolean }>(up);

  // 3) esperar a que Instagram lo procese
  let status = '';
  for (let i = 0; i < POLL_MAX; i++) {
    const s = await graphJson<{ status_code?: string; status?: string }>(
      await timedFetch(f, `${graph}/${create.id}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`, {}),
    );
    status = s.status_code ?? '';
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new PublishError(`Instagram no pudo procesar el vídeo (${s.status ?? status}).`);
    await sleep(d.pollMs ?? POLL_MS);
  }
  if (status !== 'FINISHED') throw new PublishError('Instagram sigue procesando el vídeo. Comprueba en la app antes de reprogramarlo.');

  // 4) publicar
  const pub = await graphJson<{ id?: string }>(
    await timedFetch(f, `${graph}/${encodeURIComponent(igUserId)}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: create.id, access_token: accessToken }),
    }),
  );
  if (!pub.id) throw new PublishError('Instagram no confirmó la publicación.');
  return { mediaId: pub.id };
}
