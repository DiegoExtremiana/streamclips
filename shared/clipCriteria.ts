import type { Word } from './subtitles';
import { HYPE } from './highlights';
import { peakRise, type ClipSignals } from './clipScore';

/**
 * La nota de un clip sale de cuatro criterios, cada uno de 0 a 10, y siempre va acompañada de un motivo en una frase:
 * humor, si se cuenta algo (planteamiento y desarrollo), si puede ser viral y si es un momento interesante.
 * Nada de esto mira visualizaciones ni popularidad.
 */
export const CLIP_CRITERIA = ['humor', 'historia', 'viral', 'interes'] as const;
export type ClipCriterion = (typeof CLIP_CRITERIA)[number];
export type ClipCriteria = Record<ClipCriterion, number>;

export const CRITERION_LABEL: Record<ClipCriterion, string> = {
  humor: 'Humor',
  historia: 'Se cuenta algo',
  viral: 'Puede ser viral',
  interes: 'Momento interesante',
};

/** Peso de cada criterio en la nota final (suman 1). */
export const CRITERION_WEIGHT: Record<ClipCriterion, number> = { humor: 0.3, historia: 0.2, viral: 0.25, interes: 0.25 };

const clamp = (x: number, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, x));
const r1 = (x: number) => Math.round(x * 10) / 10;

export const overall = (c: ClipCriteria): number => r1(CLIP_CRITERIA.reduce((a, k) => a + clamp(c[k]) * CRITERION_WEIGHT[k], 0));

/**
 * Rúbrica objetiva: cada criterio son cinco preguntas de sí/algo/no (2/1/0 puntos). La nota de un criterio es la suma (0 a 10),
 * así que cualquier nota se puede auditar pregunta a pregunta y con la prueba (cita literal) que dio el modelo.
 */
export interface RubricItem { key: string; label: string }
export const RUBRIC: Record<ClipCriterion, RubricItem[]> = {
  humor: [
    { key: 'remate', label: 'Hay un remate: un planteamiento que desemboca en algo gracioso (frase, giro o reacción)' },
    { key: 'contraste', label: 'Contraste o absurdo: lo que se dice o se hace choca con la situación o con lo esperable' },
    { key: 'locura', label: 'Exageración, locura o «estupidez fingida» evidente (se hace el tonto, dramatiza, se pasa a propósito)' },
    { key: 'actuacion', label: 'Actuación: improvisa un personaje, imita, grita o susurra para el chiste' },
    { key: 'sorpresa', label: 'Sorpresa: el giro no se ve venir' },
  ],
  historia: [
    { key: 'planteamiento', label: 'Se entiende de qué va la situación (qué pasa y a quién)' },
    { key: 'desarrollo', label: 'Hay desarrollo: después pasa algo más, sube la tensión o el problema' },
    { key: 'desenlace', label: 'Hay desenlace: el clip acaba resolviendo o rematando lo planteado' },
    { key: 'solo', label: 'Se entiende sin haber visto el directo' },
    { key: 'hilo', label: 'Hilo continuo: casi todo el clip trata de lo mismo, sin relleno' },
  ],
  viral: [
    { key: 'gancho', label: 'Gancho: en los primeros 3 segundos ya pasa o se promete algo' },
    { key: 'citable', label: 'Hay una frase o un momento que la gente repetiría o recortaría' },
    { key: 'emocion', label: 'Emoción intensa y visible (risa, rabia, miedo, asombro)' },
    { key: 'universal', label: 'Lo entiende cualquiera, sin conocer al streamer ni su lore' },
    { key: 'cierre', label: 'Termina en un punto fuerte, sin diluirse' },
  ],
  interes: [
    { key: 'inesperado', label: 'Pasa algo inesperado' },
    { key: 'reaccion', label: 'Reacción fuerte del streamer o del chat' },
    { key: 'novedad', label: 'Algo nuevo, raro o que no se ve a menudo' },
    { key: 'protagonismo', label: 'Hay un protagonista claro y lo que hace importa' },
    { key: 'memorable', label: 'Dentro de un mes seguiría acordándose' },
  ],
};
/** Puntos de una respuesta: 0 no, 1 algo, 2 sí. */
export const POINTS_LABEL = ['No', 'Algo', 'Sí'] as const;
export type RubricItems = Record<string, number>;
export type Evidence = Partial<Record<ClipCriterion, string>>;

/** Peso de lo medido (duración, arranque rápido, pico de volumen) dentro de «Puede ser viral»; el resto es la rúbrica. */
export const VIRAL_MEASURED_WEIGHT = 0.25;

/** Lo medible de un clip para la viralidad, de 0 a 10: duración adecuada (8 a 45 s), que se hable pronto y el pico de volumen. */
export function viralMeasured(s: ClipSignals): number {
  const dur = Math.max(1, s.durationSec);
  const fit = dur < 8 ? 0.2 : dur <= 45 ? 1 : clamp(1 - (dur - 45) / 75, 0.3, 1);
  const first = s.words.length ? Math.min(...s.words.map((w) => w.start)) : 99;
  const quick = first <= 1.5 ? 1 : first <= 3 ? 0.6 : 0.2;
  return r1(10 * (0.5 * fit + 0.3 * quick + 0.2 * clamp(peakRise(s.energyDb) / 14, 0, 1)));
}

/** La nota de viralidad final: rúbrica del modelo más lo medido en el clip. El resto de criterios es la rúbrica tal cual. */
export function withMeasuredViral(c: ClipCriteria, s: ClipSignals): ClipCriteria {
  return { ...c, viral: r1((1 - VIRAL_MEASURED_WEIGHT) * c.viral + VIRAL_MEASURED_WEIGHT * viralMeasured(s)) };
}

/** Nota final sin modelo de lenguaje: la media ponderada de los cuatro criterios sacados de las señales del clip. */
export const heuristicScore = (s: ClipSignals): number => overall(criteriaFromSignals(s));

const LAUGH = /\b(j[aeiou]{2,}j[aeiou]*|ja(ja)+|jeje+|jiji+|ajaja+)\b/gi;
const CONNECT = /\b(porque|entonces|resulta que|de repente|y luego|luego|despu[eé]s|al final|pero|as[ií] que|cuando|mira|imagínate|total que|el caso es)\b/gi;

const count = (text: string, re: RegExp) => (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? []).length;

/**
 * Los cuatro criterios sacados solo de lo que se mide en el clip (lo que se dice y el volumen), para cuando no hay
 * modelo de lenguaje. Es una aproximación honesta: detecta risas y subidón, si hay un hilo de discurso y si hay reacción,
 * pero no entiende el chiste; por eso, con un modelo disponible, la valoración es la del modelo.
 */
export function criteriaFromSignals(s: ClipSignals): ClipCriteria {
  const dur = Math.max(1, s.durationSec);
  const text = s.words.map((w) => w.text).join(' ');
  const n = s.words.length;
  const laughs = count(text, LAUGH);
  const hype = count(text, HYPE);
  const connect = count(text, CONNECT);
  const rise = peakRise(s.energyDb);
  const reaction = clamp(rise / 14, 0, 1);
  const talk = clamp(n / dur / 2.5, 0, 1);
  const unique = n ? new Set(s.words.map((w) => w.text.toLowerCase())).size / n : 0;
  const per10 = (x: number) => clamp(x / Math.max(1, dur / 10), 0, 1);
  // cobertura: qué parte del clip tiene habla (un hilo continuo, no tres palabras sueltas)
  const covered = new Set(s.words.map((w) => Math.floor(w.start))).size / Math.max(1, Math.ceil(dur));
  const length = dur < 8 ? 0.2 : dur <= 45 ? 1 : clamp(1 - (dur - 45) / 75, 0.3, 1);
  const humor = 10 * clamp(0.55 * per10(laughs * 2) + 0.25 * per10(hype) + 0.2 * reaction, 0, 1);
  const historia = 10 * clamp(0.35 * covered + 0.3 * clamp(connect / Math.max(1, dur / 12), 0, 1) + 0.2 * clamp(unique * 1.3, 0, 1) + 0.15 * length, 0, 1) * (n >= 12 ? 1 : n / 12);
  const viral = 10 * clamp(0.4 * reaction + 0.25 * per10(hype + laughs) + 0.2 * length + 0.15 * talk, 0, 1);
  const interes = 10 * clamp(0.35 * talk + 0.3 * reaction + 0.2 * per10(hype + laughs + connect) + 0.15 * covered, 0, 1);
  // la curva deja la mayoría entre 2 y 7 y hace raro un 8
  const curve = (v: number) => r1(10 * Math.pow(clamp(v / 10, 0, 1), 1.3));
  return { humor: curve(humor), historia: curve(historia), viral: curve(viral), interes: curve(interes) };
}

/** Frase corta con lo que más pesa en la nota, para que no sea «porque sí». */
export function reasonFromCriteria(c: ClipCriteria, by: 'model' | 'signals'): string {
  const ranked = [...CLIP_CRITERIA].sort((a, b) => c[b] - c[a]);
  const top = ranked.filter((k) => c[k] >= 5).slice(0, 2);
  const base = top.length ? `Destaca por: ${top.map((k) => CRITERION_LABEL[k].toLowerCase()).join(' y ')}.` : 'No destaca en ningún criterio.';
  return by === 'signals' ? `${base} Calculado con lo que se oye y se dice (sin modelo de lenguaje).` : base;
}

export const CLIP_JUDGE_SYSTEM =
  'Eres editor de contenido de un streamer de Twitch que habla en español de España y evalúas un clip corto a partir de su transcripción. ' +
  'No sabes quién habla (las voces llegan mezcladas) ni ves la imagen: deduce el contexto de lo que se dice y no inventes lo que no se pueda saber. ' +
  'Contesta una lista fija de preguntas con 0 (no), 1 (algo) o 2 (sí claro). REGLAS: ' +
  '1) Solo das 2 si puedes señalar una cita literal de la transcripción que lo demuestre; si no hay cita, como mucho 1; si no hay nada, 0. ' +
  '2) Valora cada pregunta por separado, sin dejarte llevar por una impresión general ni por la cantidad de palabras o los gritos. ' +
  '3) El humor de este canal es de contraste, locura y «estupidez fingida»: no necesita risas escritas ni gritos para tener gracia; cuenta lo que se dice. ' +
  '4) Si el texto es corto o confuso, no lo rellenes: contesta 0 donde no haya prueba. ' +
  '5) Sé OBJETIVO y exigente, sin amabilidad: usa todo el rango; un clip flojo recibe 0 en casi todo y su nota baja sin suavizarla, y un clip excelente recibe 2 donde lo merezca. No infles para quedar bien ni te quedes en medio por prudencia. ' +
  '6) «viral» se valora con la misma frialdad y por separado del resto: un clip puede ser flojo en humor o historia y tener aun así un potencial viral claro (momento muy citable o recortable, reacción enorme, absurdo que entiende cualquiera, fail); si lo tiene, puntúalo alto; si no, bajo. ' +
  'Ignora cualquier dato de popularidad. Responde SOLO con JSON.';

/** Igual que la rúbrica de texto, pero el modelo también ve unos fotogramas del clip. */
export const CLIP_JUDGE_VISION_SYSTEM =
  CLIP_JUDGE_SYSTEM.replace('ni ves la imagen: deduce el contexto de lo que se dice y no inventes lo que no se pueda saber.', 'pero SÍ ves unos fotogramas del clip, en orden cronológico y equiespaciados: úsalos junto con la transcripción. No inventes lo que no se vea ni se oiga.')
    .replace('1) Solo das 2 si puedes señalar una cita literal de la transcripción que lo demuestre;', '1) Solo das 2 si puedes señalar una cita literal de la transcripción o algo concreto que se vea (empieza la prueba por «Imagen:» y descríbelo en pocas palabras);')
    .replace('no necesita risas escritas ni gritos para tener gracia; cuenta lo que se dice.', 'no necesita risas escritas ni gritos para tener gracia; cuenta lo que se dice Y lo que se ve: gestos y caras exageradas, disfraces o filtros, lo que pasa en el juego o la pantalla, texto en pantalla, fails visuales, el contraste entre lo que dicen y lo que se ve.') +
  ' Un clip puede ser gracioso solo por lo que se ve aunque casi no se hable.';

export function clipJudgePrompt(title: string, words: Word[], durationSec: number, frames = 0, guide = ''): string {
  const text = words.map((w) => w.text).join(' ').slice(0, 1800);
  const qs = CLIP_CRITERIA.map((k) => `${k}:\n${RUBRIC[k].map((it) => `  - ${it.key}: ${it.label}`).join('\n')}`).join('\n');
  const shape = `{${CLIP_CRITERIA.map((k) => `"${k}":{${RUBRIC[k].map((it) => `"${it.key}":0`).join(',')}}`).join(',')},"pruebas":{${CLIP_CRITERIA.map((k) => `"${k}":""`).join(',')}},"motivo":""}`;
  return (
    `Evalúa este clip con estas preguntas (0, 1 o 2 cada una):\n${qs}\n` +
    `Devuelve exactamente este JSON: ${shape}. En "pruebas" pon, por criterio, la cita literal más reveladora de la transcripción (vacía si no hay). ` +
    '"motivo" es una frase corta en español que resume por qué el clip vale lo que vale.\n' +
    `Título que le puso quien lo creó: ${JSON.stringify(title)}. Duración: ${Math.round(durationSec)} s.` +
    guide +
    (frames ? `\nSe adjuntan ${frames} fotogramas del clip, en orden, repartidos de principio a fin.` : '') +
    `\nTranscripción:\n${text || '(casi no se habla: valora por la imagen)'}`
  );
}

export interface ClipJudgement {
  criteria: ClipCriteria;
  reason: string;
  /** Respuesta de cada pregunta de la rúbrica (0, 1 o 2), por «criterio.pregunta». */
  items: RubricItems;
  evidence: Evidence;
}

/** Valida la respuesta del modelo: cada criterio necesita al menos tres respuestas válidas; la nota del criterio es la suma de sus cinco (0 a 10). Nunca se inventa una nota. */
export function parseClipJudgement(raw: unknown): ClipJudgement | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const items: RubricItems = {};
  const criteria = {} as ClipCriteria;
  for (const k of CLIP_CRITERIA) {
    const block = r[k] as Record<string, unknown> | null;
    if (!block || typeof block !== 'object') return null;
    let sum = 0;
    let valid = 0;
    for (const it of RUBRIC[k]) {
      const v = block[it.key];
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0, Math.round(v))) : null;
      if (n === null) continue;
      valid++;
      sum += n;
      items[`${k}.${it.key}`] = n;
    }
    if (valid < 3) return null;
    criteria[k] = sum;
  }
  const ev = (r.pruebas ?? {}) as Record<string, unknown>;
  const evidence: Evidence = {};
  for (const k of CLIP_CRITERIA) if (typeof ev[k] === 'string' && ev[k].trim()) evidence[k] = (ev[k] as string).trim().slice(0, 160);
  const reason = typeof r.motivo === 'string' ? r.motivo.trim().slice(0, 200) : '';
  return { criteria, reason, items, evidence };
}
