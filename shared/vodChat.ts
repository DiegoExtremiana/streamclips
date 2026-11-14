/** Mensaje del chat de un directo ya emitido (lo que Twitch guarda como «chat del VOD»). */
export interface VodChatMessage {
  /** Segundo del directo en que se escribió. */
  t: number;
  user: string;
  text: string;
  color?: string;
}

export interface VodChatPage {
  ok: boolean;
  messages: VodChatMessage[];
  /** Hasta qué segundo llega lo leído (la siguiente página empieza ahí). */
  to: number;
  /** Ya no hay más mensajes después. */
  end?: boolean;
  /** Por qué no hay chat (el VOD ya no está en Twitch, no tiene chat guardado, sin conexión…). */
  error?: string;
}

/** Identificador del vídeo en Twitch a partir de lo guardado del VOD. */
export function twitchVideoId(job: { twitchId?: string; url?: string }): string | null {
  if (job.twitchId && /^\d+$/.test(job.twitchId)) return job.twitchId;
  const m = /twitch\.tv\/videos\/(\d+)/i.exec(job.url ?? '');
  return m ? m[1] : null;
}

/** Lee la respuesta de Twitch (lista de comentarios) y la deja como mensajes simples. */
export function parseChatResponse(json: unknown): { messages: VodChatMessage[]; hasNext: boolean } | null {
  const root = (Array.isArray(json) ? json[0] : json) as { data?: { video?: { comments?: { edges?: unknown[]; pageInfo?: { hasNextPage?: boolean } } | null } | null } } | undefined;
  const comments = root?.data?.video?.comments;
  if (!comments || !Array.isArray(comments.edges)) return null;
  const messages: VodChatMessage[] = [];
  for (const e of comments.edges) {
    const n = (e as { node?: { contentOffsetSeconds?: unknown; commenter?: { displayName?: unknown } | null; message?: { fragments?: { text?: unknown }[]; userColor?: unknown } } })?.node;
    if (!n || typeof n.contentOffsetSeconds !== 'number') continue;
    const text = (n.message?.fragments ?? []).map((f) => (typeof f?.text === 'string' ? f.text : '')).join('').trim();
    if (!text) continue;
    const user = typeof n.commenter?.displayName === 'string' && n.commenter.displayName ? n.commenter.displayName : 'anónimo';
    const color = typeof n.message?.userColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(n.message.userColor) ? n.message.userColor : undefined;
    messages.push({ t: n.contentOffsetSeconds, user, text: text.slice(0, 500), ...(color ? { color } : {}) });
  }
  return { messages, hasNext: comments.pageInfo?.hasNextPage !== false };
}
