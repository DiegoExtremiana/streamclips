import { parseChatResponse, type VodChatPage } from '../../shared/vodChat';

const GQL = 'https://gql.twitch.tv/gql';
/** Identificador público de la web de Twitch (el mismo que usan las herramientas de descarga de chat). */
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const QUERY_HASH = 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Lee el chat guardado de un directo de Twitch (solo lectura, sin cuenta) para verlo junto al vídeo.
 * Si Twitch ya no lo tiene o no hay conexión, devuelve un aviso en vez de fallar.
 */
export class VodChatService {
  private cache = new Map<string, VodChatPage>();
  constructor(private o: { fetch?: FetchLike } = {}) {}

  async page(videoId: string, fromSec: number): Promise<VodChatPage> {
    const from = Math.max(0, Math.floor(fromSec));
    const key = `${videoId}:${from}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const f = this.o.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await f(GQL, {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ operationName: 'VideoCommentsByOffsetOrCursor', variables: { videoID: videoId, contentOffsetSeconds: from }, extensions: { persistedQuery: { version: 1, sha256Hash: QUERY_HASH } } }]),
        signal: ctl.signal,
      });
      if (!res.ok) return { ok: false, messages: [], to: from, error: `Twitch respondió ${res.status}.` };
      const parsed = parseChatResponse(await res.json());
      if (!parsed) return { ok: false, messages: [], to: from, error: 'Twitch no guarda el chat de este directo (o ya no está disponible).' };
      const last = parsed.messages[parsed.messages.length - 1];
      const page: VodChatPage = { ok: true, messages: parsed.messages, to: last ? Math.max(from + 1, last.t) : from + 60, ...(parsed.hasNext && last ? {} : { end: true }) };
      if (this.cache.size > 400) this.cache.clear();
      this.cache.set(key, page);
      return page;
    } catch (e) {
      return { ok: false, messages: [], to: from, error: e instanceof Error && e.name === 'AbortError' ? 'Twitch tardó demasiado en responder.' : 'No se pudo leer el chat (¿sin conexión?).' };
    } finally {
      clearTimeout(timer);
    }
  }
}
