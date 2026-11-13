/** Música de fondo: qué ambiente pide cada vídeo según lo que se dice. */
export const MUSIC_MOODS = ['cafe', 'viaje', 'noche', 'charla', 'juego'] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
export const isMusicMood = (x: unknown): x is MusicMood => typeof x === 'string' && (MUSIC_MOODS as readonly string[]).includes(x);

export const MOOD_LABELS: Record<MusicMood, string> = {
  cafe: 'Café y calma (acordes cálidos, tempo lento)',
  viaje: 'Viaje y vlog (luminoso, más ritmo)',
  noche: 'Noche y relax (suave, melancólico)',
  charla: 'Charla tranquila (neutro, agradable)',
  juego: 'Juego (animado pero sin robar atención)',
};

const MOOD_WORDS: Record<MusicMood, RegExp> = {
  cafe: /\b(caf[eé]|desayun|t[eé]\b|croissant|tostada|merienda|cafeter[ií]a|capuccino|cappuccino)/gi,
  viaje: /\b(viaj|avi[oó]n|aeropuerto|hotel|playa|tren|ciudad|vacaciones|maleta|excursi[oó]n|paseo|carretera|monta[nñ]a|vlog)/gi,
  noche: /\b(noche|dormir|cama|luna|sue[nñ]o|madrugada|tranquil|relaj|descans)/gi,
  juego: /\b(partida|boss|nivel|ranked|pok[eé]mon|minecraft|ronda|combate|equipo|speedrun|misi[oó]n|jefe)/gi,
  charla: /\b(opini|pienso|creo que|cuenta|historia|la verdad|hablando|tema|a ver)/gi,
};

/** Ambiente por palabras clave (sin modelo de lenguaje). Si nada destaca, «charla». */
export function guessMood(text: string): MusicMood {
  let best: MusicMood = 'charla';
  let top = 1;
  for (const m of MUSIC_MOODS) {
    if (m === 'charla') continue;
    const n = (text.match(MOOD_WORDS[m]) ?? []).length;
    if (n > top) {
      top = n;
      best = m;
    }
  }
  return best;
}

export const MOOD_SYSTEM = `Eres editor de vídeo. Lees la transcripción de un vídeo de un streamer y eliges la música lofi sin letra que mejor acompaña a lo que se ve y se cuenta.
Ambientes posibles: ${MUSIC_MOODS.map((m) => `"${m}" (${MOOD_LABELS[m]})`).join('; ')}.
Responde SOLO un JSON: {"mood": "<ambiente>", "reason": "<una frase>"}.`;

export function moodPrompt(title: string, text: string): string {
  return `Título del vídeo: ${title}\nTranscripción (recortada):\n${text.slice(0, 2500)}`;
}

export function parseMood(raw: unknown): MusicMood | null {
  const m = (raw as { mood?: unknown } | null)?.mood;
  return isMusicMood(m) ? m : null;
}
