import { transcriptForClaude } from './transcript';
import type { Word } from './subtitles';

/** Plan de ejemplo que se le enseña a Claude; los tests comprueban que es válido. */
export const PROMPT_EXAMPLE = {
  clips: [
    {
      start: 125,
      end: 168,
      title: 'Se rompe el juego en directo',
      cuts: [{ start: 140, end: 144.5 }],
      effects: [{ type: 'punch', at: 152, duration: 1.2, zoom: 1.2 }, { type: 'fadeOut', duration: 0.5 }],
    },
  ],
  long: {
    title: 'Resumen del directo',
    segments: [
      { start: 60, end: 400 },
      { start: 900, end: 1500 },
    ],
    effects: [{ type: 'fadeIn', duration: 1 }, { type: 'fadeOut', duration: 1 }],
  },
};

/** Texto para pegar en Claude: instrucciones de edición + transcripción con tiempos. */
export function buildClaudePrompt(vodTitle: string, durationSec: number | undefined, words: Word[]): string {
  const dur = durationSec ? ` Dura ${Math.round(durationSec)} segundos.` : '';
  return `Eres un editor de vídeo profesional especializado en directos de Twitch. Te paso la transcripción con tiempos (en segundos desde el inicio) del VOD "${vodTitle}".${dur}

Lee la transcripción entera y entiende de qué va: dónde hay humor, reacciones fuertes, historias, momentos épicos o fallos graciosos, y dónde el directo está muerto (silencios, dudas, charla sin interés). Decide como lo haría un editor de verdad:
- Clips de 15 a 60 segundos que empiecen justo antes del momento (con su contexto mínimo) y terminen cuando remata la gracia. Sin intro ni cola.
- "cuts": quita lo que sobra dentro de un clip (silencios, muletillas, tiempos muertos) con cortes secos; los tiempos de "cuts" son del VOD y deben caer dentro de [start, end].
- "effects": úsalos con criterio, pocos y solo donde aportan. "punch" es un acercamiento breve sobre un instante clave (at = instante del VOD, duration 0.3-3 s, zoom 1.05-1.5); "fadeIn" y "fadeOut" son fundidos al principio y al final (0.1-2 s, como mucho uno de cada).
- "long": si hay material para un resumen, un vídeo largo con los tramos buenos en orden.
- No pidas subtítulos: los activa el usuario desde el programa.
- Los títulos deben ser concretos y con gancho, sin emojis ni los símbolos < >.

Responde SOLO con un JSON válido con esta forma (todos los tiempos en segundos; "kind" es opcional y por defecto se generan vertical y horizontal; "cropX" es opcional, de 0 a 1):
${JSON.stringify(PROMPT_EXAMPLE, null, 2)}

Transcripción:
${transcriptForClaude(words)}
`;
}
