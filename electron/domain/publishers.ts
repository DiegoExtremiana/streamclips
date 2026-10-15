import type { OutputItem, Platform } from '../../shared/types';
import type { ConnectionService } from './connections';
import type { Logger } from '../services/logger';
import { listPlaylists, publishYoutube, type YoutubeEndpoints } from '../services/social/youtube';
import { publishTiktok } from '../services/social/tiktok';
import { publishInstagram } from '../services/social/instagram';
import { PublishError } from '../services/social/common';

/** La red todavía no está conectada: nada se ha enviado, así que es seguro volver a intentarlo más tarde. */
export class NotConnectedError extends Error {}

export interface Publisher {
  publish(output: OutputItem): Promise<void>;
}

export type Publishers = Record<Platform, Publisher>;

function pending(label: string): Publisher {
  return {
    async publish() {
      throw new NotConnectedError(`${label} aún no está conectado (pestaña Conexiones).`);
    },
  };
}

/** Sin conexiones configuradas (pruebas antiguas y arranque sin servicios). */
export const defaultPublishers: Publishers = {
  youtube: pending('YouTube'),
  tiktok: pending('TikTok'),
  instagram: pending('Instagram'),
};

export interface PublisherEnv {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  youtube?: YoutubeEndpoints;
  chunkSize?: number;
  tiktokApi?: string;
  graph?: string;
  pollMs?: number;
}

/** Conectores reales: usan las claves guardadas en Conexiones y las renuevan cuando caducan. */
export function realPublishers(conn: ConnectionService, log: Logger, env: PublisherEnv = {}): Publishers {
  const warn = (m: string) => log.warn(m);
  const base = { fetchFn: env.fetchFn, sleep: env.sleep, warn };
  const need = async (p: Platform, label: string) => {
    const t = await conn.accessToken(p);
    if (!t) throw new NotConnectedError(`${label} aún no está conectado (pestaña Conexiones).`);
    return t;
  };
  return {
    youtube: {
      async publish(o) {
        await need('youtube', 'YouTube');
        const r = await publishYoutube({ ...base, token: async () => (await need('youtube', 'YouTube')).accessToken, endpoints: env.youtube, chunkSize: env.chunkSize }, o);
        log.info(`YouTube: subido ${r.videoId} ("${o.title}")`);
      },
    },
    tiktok: {
      async publish(o) {
        await need('tiktok', 'TikTok');
        const r = await publishTiktok({ ...base, token: async () => (await need('tiktok', 'TikTok')).accessToken, api: env.tiktokApi, chunkSize: env.chunkSize, pollMs: env.pollMs }, o);
        log.info(`TikTok: publicado ${r.publishId} ("${o.title}")`);
      },
    },
    instagram: {
      async publish(o) {
        await need('instagram', 'Instagram');
        const r = await publishInstagram(
          {
            ...base,
            graph: env.graph,
            pollMs: env.pollMs,
            token: async () => {
              const t = await need('instagram', 'Instagram');
              return { accessToken: t.accessToken, igUserId: t.extra?.igUserId ?? '' };
            },
          },
          o,
        );
        log.info(`Instagram: publicado ${r.mediaId} ("${o.title}")`);
      },
    },
  };
}

export async function youtubePlaylists(conn: ConnectionService, env: PublisherEnv = {}) {
  const t = await conn.accessToken('youtube');
  if (!t) throw new PublishError('Conecta YouTube en la pestaña Conexiones.');
  return listPlaylists({ fetchFn: env.fetchFn, token: async () => (await conn.accessToken('youtube'))?.accessToken ?? t.accessToken, endpoints: env.youtube });
}
