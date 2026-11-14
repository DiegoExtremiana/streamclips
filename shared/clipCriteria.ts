import type { Word } from './subtitles';
import { HYPE } from './highlights';
import { peakRise, type ClipSignals } from './clipScore';

/**
 * La nota de un clip sale de cuatro criterios, cada uno de 0 a 10, y siempre va acompañada de un motivo en una frase:
 * si se cuenta algo (planteamiento y desarrollo), si es un momento interesante, humor y si puede ser viral (en ese orden).
 * Nada de esto mira visualizaciones ni popularidad.
 */
export const CLIP_CRITERIA = ['historia', 'interes', 'humor', 'viral'] as const;
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
    { key: 'gancho', label: 'Gancho: en los primeros 3 segundos ya pasa algo llamativo que haría no pasar al siguiente vídeo' },
    { key: 'citable', label: 'Hay una frase o un momento concreto que un desconocido repetiría o convertiría en meme' },
    { key: 'emocion', label: 'Emoción intensa y visible (risa, rabia, miedo, asombro)' },
    { key: 'universal', label: 'Lo entiende y le hace gracia o impacto a cualquiera, sin conocer al streamer ni su lore ni el juego' },
    { key: 'cierre', label: 'Termina justo en el punto fuerte, sin diluirse ni cortarse a medias' },
    { key: 'compartible', label: 'Un desconocido se lo mandaría a un amigo con un «mira esto» (compartible por sí solo)' },
    { key: 'retencion', label: 'Simulación de scroll: nadie pasaría al siguiente vídeo ni al principio, ni a mitad, ni antes del final (se vería entero e incluso dos veces)' },
    { key: 'sinDefectos', label: 'Ningún defecto que mate un clip corto: arranque lento, relleno, final cortado, depende del lore, mala calidad o música con derechos (2 = ninguno; 0 = alguno grave)' },
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

/** Preguntas de viralidad que son puertas: si una falla, el clip no puede pasar de un tope, por buenas que sean las demás. */
export const VIRAL_GATES = ['gancho', 'universal', 'cierre', 'retencion', 'sinDefectos'] as const;
/** Tope de «Puede ser viral» según las puertas: alguna a 0 → 6; alguna a «algo» → 8,9 (nunca dorado); todas a «sí» → sin tope. */
export function viralCap(items: RubricItems): number {
  let cap = 10;
  for (const g of VIRAL_GATES) {
    const v = items[`viral.${g}`];
    if (v === undefined || v <= 0) return 6;
    if (v < 2) cap = Math.min(cap, 8.9);
  }
  return cap;
}

/** Espectadores simulados en la comprobación final: cada uno se queda hasta el final y lo comparte, o no. */
export const VIRAL_VIEWERS = 6;
/** Resultado del segundo examen (abogado del diablo + espectadores simulados), solo para clips que pasan de 9. */
export interface ViralCheck {
  /** Respuestas de la rúbrica de viralidad en el segundo examen, por «viral.pregunta». */
  items: RubricItems;
  /** Cuántos de los espectadores simulados se quedarían hasta el final y lo compartirían. */
  stay: number;
  total: number;
  /** Por qué NO se viralizaría, según el examinador escéptico. */
  refutation: string;
}

/** Tope según los espectadores simulados: todos se quedan → sin tope; uno falla → 9,4 (no dorado); la mitad o menos → 8. */
export const stayCap = (stay: number, total: number): number => (stay >= total ? 10 : stay * 2 > total ? 9.4 : 8);

/** Une el examen principal y el escéptico: en cada pregunta vale la respuesta más baja; y se aplican las puertas y los espectadores. */
export function combineViral(first: RubricItems, check: ViralCheck | null): { items: RubricItems; viral: number; cap: number } {
  const items: RubricItems = { ...first };
  if (check) for (const it of RUBRIC.viral) {
    const k = `viral.${it.key}`;
    if (check.items[k] !== undefined) items[k] = Math.min(items[k] ?? 2, check.items[k]);
  }
  const sum = RUBRIC.viral.reduce((a, it) => a + (items[`viral.${it.key}`] ?? 0), 0);
  const cap = Math.min(viralCap(items), check ? stayCap(check.stay, check.total) : 9.4);
  return { items, viral: r1(Math.min(cap, (sum * 10) / (2 * RUBRIC.viral.length))), cap };
}
export type Evidence = Partial<Record<ClipCriterion, string>>;

/** Peso de lo medido (duración, arranque rápido, pico de volumen) dentro de «Puede ser viral»; el resto es la rúbrica. */
export const VIRAL_MEASURED_WEIGHT = 0.25;

/** Lo medible de un clip para la viralidad, de 0 a 10: que se hable pronto (gancho) y el pico de volumen. La duración no cuenta: al creador le da igual si funciona. */
export function viralMeasured(s: ClipSignals): number {
  const first = s.words.length ? Math.min(...s.words.map((w) => w.start)) : 99;
  // sin palabras no se sabe si «arranca rápido»: se queda neutro
  const quick = !s.words.length ? 0.6 : first <= 1.5 ? 1 : first <= 3 ? 0.6 : 0.2;
  return r1(10 * (0.6 * quick + 0.4 * clamp(peakRise(s.energyDb) / 14, 0, 1)));
}

/** La nota de viralidad final: rúbrica del modelo más lo medido en el clip. El resto de criterios es la rúbrica tal cual. */
export function withMeasuredViral(c: ClipCriteria, s: ClipSignals, cap = 10): ClipCriteria {
  return { ...c, viral: r1(Math.min(cap, (1 - VIRAL_MEASURED_WEIGHT) * c.viral + VIRAL_MEASURED_WEIGHT * viralMeasured(s))) };
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

/** El criterio del creador, sacado de sus respuestas: es lo que hace que la nota sea la suya y no una genérica. */
export const CREATOR_PROFILE =
  'CRITERIO DEL CREADOR (obligatorio, manda sobre cualquier otra idea): ' +
  'a) Su humor es el ABSURDO y la ESTUPIDEZ FINGIDA: hacerse el tonto, exagerar, contraste entre lo que dice y la situación. Un 8 o más en humor solo si le haría reír a alguien que ve el clip sin conocerlo. ' +
  'b) Los gritos o el ruido solo suben la nota si responden a algo inesperado; gritar sin motivo no es humor ni interés. ' +
  'c) «Se cuenta algo» e «interesante» son independientes del humor: una anécdota o un momento épico bien contados pueden tener historia e interés altos y humor bajo. ' +
  'd) En «interesante» pesa MÁS lo raro o nuevo (algo que no se ve a menudo), después lo inesperado, la reacción fuerte y lo memorable. ' +
  'e) Las risas del chat o de los amigos en directo son una pista fiable y suman al humor; también cuenta lo que se ve (caras o gestos exagerados, filtros, fails visuales), aunque casi no se hable. ' +
  'f) Los chistes internos y el lore del canal NO suman ni restan: se juzga solo lo que se entiende dentro del clip; si el chiste depende de ese contexto, el humor se valora por lo que sí se entienda y el viral baja. ' +
  'g) Los tacos y el lenguaje fuerte no afectan a la nota. La duración del clip tampoco. ' +
  'h) BAJAN claramente la nota: empezar lento o con relleno, acabar cortado o sin remate, repetir el mismo chiste varias veces y charlar con el chat de cosas sin interés. ' +
  'i) Los clips son para TikTok, Reels y Shorts: pesa que enganchen en los primeros segundos y rematen rápido. El creador no sabe qué hace viral un clip, así que «viral» lo decides tú con criterio general de contenido corto (frase de meme, reacción enorme, fail clarísimo, absurdo que entiende cualquiera) y con la severidad indicada. ' +
  'j) Muy exigente: la mayoría de clips entre 0 y 4; un 7 es raro y un 8 o más solo si él se reiría al verlo. ';

export const CLIP_JUDGE_SYSTEM =
  'Eres editor de contenido de un streamer de Twitch que habla en español de España y evalúas un clip corto a partir de su transcripción. ' +
  'No sabes quién habla (las voces llegan mezcladas) ni ves la imagen: deduce el contexto de lo que se dice y no inventes lo que no se pueda saber. ' +
  'Contesta una lista fija de preguntas con 0 (no), 1 (algo) o 2 (sí claro). REGLAS: ' +
  '1) Solo das 2 si puedes señalar una cita literal de la transcripción que lo demuestre; si no hay cita, como mucho 1; si no hay nada, 0. ' +
  '2) Valora cada pregunta por separado, sin dejarte llevar por una impresión general ni por la cantidad de palabras o los gritos. ' +
  '3) El humor de este canal es de contraste, locura y «estupidez fingida»: no necesita risas escritas ni gritos para tener gracia; cuenta lo que se dice. ' +
  '4) Si el texto es corto o confuso, no lo rellenes: contesta 0 donde no haya prueba. ' +
  '5) Sé OBJETIVO, frío y exigente: no buscas agradar ni animar. Calibración realista: la gran mayoría de clips de un streamer son del montón (cada criterio entre 0 y 4); un criterio de 7 o más es raro y 9 o 10 excepcional (menos de 1 clip de cada 20). Ante la duda entre dos respuestas, elige la más baja. ' +
  '6) Los cuatro criterios son INDEPENDIENTES: puntúa cada uno solo con sus preguntas. Un clip puede ser muy gracioso sin contar nada (historia 0), o contar algo muy bien sin ninguna gracia, o ser interesante sin ser viral. Que un criterio sea alto no es motivo para subir los demás. ' +
  '7) «viral» se valora con la misma frialdad y por separado: es potencial REAL de que un desconocido lo comparta (momento muy citable o recortable, reacción enorme, absurdo que entiende cualquiera, fail claro). Un clip normal, aunque sea gracioso para su comunidad, NO es viral: ponle 0 o 1 en casi todas las preguntas de viral. Un viral alto debe ser la excepción: el fondo dorado se da solo a clips que de verdad se viralizarían (9,5 o más), menos de 1 de cada 50. Antes de contestar las preguntas de viral haz esta simulación mental: imagina a seis desconocidos haciendo scroll en TikTok, Reels y Shorts (sin conocer al streamer ni el juego, con prisa, con el sonido bajo) y decide cuántos se quedarían hasta el final y lo compartirían. Las preguntas «gancho», «universal», «cierre», «retencion» y «sinDefectos» son puertas: un «algo» en cualquiera de ellas impide un viral alto. ' +
  CREATOR_PROFILE +
  'Ignora cualquier dato de popularidad. Responde SOLO con JSON.';

/** Igual que la rúbrica de texto, pero el modelo también ve unos fotogramas del clip. */
export const CLIP_JUDGE_VISION_SYSTEM =
  CLIP_JUDGE_SYSTEM.replace('ni ves la imagen: deduce el contexto de lo que se dice y no inventes lo que no se pueda saber.', 'pero SÍ ves unos fotogramas del clip, en orden cronológico y equiespaciados: úsalos junto con la transcripción. No inventes lo que no se vea ni se oiga.')
    .replace('1) Solo das 2 si puedes señalar una cita literal de la transcripción que lo demuestre;', '1) Solo das 2 si puedes señalar una cita literal de la transcripción o algo concreto que se vea (empieza la prueba por «Imagen:» y descríbelo en pocas palabras);')
    .replace('no necesita risas escritas ni gritos para tener gracia; cuenta lo que se dice.', 'no necesita risas escritas ni gritos para tener gracia; cuenta lo que se dice Y lo que se ve: gestos y caras exageradas, disfraces o filtros, lo que pasa en el juego o la pantalla, texto en pantalla, fails visuales, el contraste entre lo que dicen y lo que se ve.') +
  ' Un clip puede ser gracioso solo por lo que se ve aunque casi no se hable.';

/** Referencias para que cada nota signifique lo mismo: qué es un clip de 2, de 5 y de 8 en cada criterio. */
const ANCHORS =
  'Referencias de lo que vale cada criterio (de 0 a 10):\n' +
  '- Se cuenta algo: 2 = frases sueltas sin situación; 5 = se entiende qué pasa pero se queda a medias o necesita contexto; 8 = principio, desarrollo y desenlace claros y se entiende solo.\n' +
  '- Interesante: 2 = charla corriente o reacción a algo sin importancia; 5 = algo curioso o una reacción marcada; 8 = algo inesperado o raro que importa y se recordaría.\n' +
  '- Humor: 2 = alguna sonrisa o broma floja; 5 = un chiste o reacción graciosa con remate claro; 8 = varios golpes seguidos, absurdo o actuación que haría reír a quien lo ve sin contexto.\n' +
  '- Viral: 2 = solo le interesa a la comunidad; 5 = un momento citable pero que depende del contexto; 8 = podría compartirse, pero algo falla (arranque, final, contexto); 10 = apostarías a que se viraliza: gancho inmediato, frase de meme o reacción enorme, lo entiende cualquiera, termina en el punto justo y no tiene ningún defecto.\n';

export function clipJudgePrompt(title: string, words: Word[], durationSec: number, frames = 0, guide = ''): string {
  const text = words.map((w) => w.text).join(' ').slice(0, 1800);
  const qs = CLIP_CRITERIA.map((k) => `${k}:\n${RUBRIC[k].map((it) => `  - ${it.key}: ${it.label}`).join('\n')}`).join('\n');
  const shape = `{"resumen":"",${CLIP_CRITERIA.map((k) => `"${k}":{${RUBRIC[k].map((it) => `"${it.key}":0`).join(',')}}`).join(',')},"pruebas":{${CLIP_CRITERIA.map((k) => `"${k}":""`).join(',')}},"motivo":""}`;
  return (
    `Evalúa este clip con estas preguntas (0, 1 o 2 cada una):\n${qs}\n` +
    `${ANCHORS}\nDevuelve exactamente este JSON: ${shape}. "resumen" va PRIMERO: en una o dos frases, qué pasa en el clip (quién, qué y cómo acaba), solo con lo que se oye o se ve; pensar eso antes evita puntuar por impresión. En "pruebas" pon, por criterio, la cita literal más reveladora de la transcripción (vacía si no hay). ` +
    '"motivo" es una frase corta en español que resume por qué el clip vale lo que vale.\n' +
    `Título que le puso quien lo creó: ${JSON.stringify(title)}. Duración: ${Math.round(durationSec)} s.` +
    guide +
    (frames ? `\nSe adjuntan ${frames} fotogramas del clip, en orden, repartidos de principio a fin.` : '') +
    `\nTranscripción:\n${text || (frames ? '(no se oye hablar: valora por lo que se ve y se oye: muecas, gestos y caras, lo que pasa en pantalla, gritos o ruidos; en las pruebas empieza por «Imagen:»)' : '(casi no se habla)')}`
  );
}

export interface ClipJudgement {
  criteria: ClipCriteria;
  reason: string;
  /** Qué pasa en el clip, en una o dos frases (lo escribe el modelo antes de puntuar). */
  summary?: string;
  /** Respuesta de cada pregunta de la rúbrica (0, 1 o 2), por «criterio.pregunta». */
  items: RubricItems;
  evidence: Evidence;
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(Boolean);

/** ¿La cita que da el modelo sale de verdad en la transcripción (o describe la imagen, si hay fotogramas)? Basta con que casi todas sus palabras estén. */
export function quoteIsReal(quote: string | undefined, transcript: string, vision = false): boolean {
  if (!quote) return false;
  if (vision && /^imagen:/i.test(quote.trim())) return true;
  const q = norm(quote.replace(/^imagen:/i, ''));
  if (q.length < 2) return false;
  const have = new Set(norm(transcript));
  return q.filter((w) => have.has(w)).length / q.length >= 0.7;
}

/** Valida la respuesta del modelo: cada criterio necesita al menos tres respuestas válidas; la nota del criterio es la suma de sus cinco (0 a 10). Nunca se inventa una nota. */
export function parseClipJudgement(raw: unknown, ctx?: { transcript: string; vision?: boolean }): ClipJudgement | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const items: RubricItems = {};
  const criteria = {} as ClipCriteria;
  const ev = (r.pruebas ?? {}) as Record<string, unknown>;
  const evidence: Evidence = {};
  for (const k of CLIP_CRITERIA) if (typeof ev[k] === 'string' && ev[k].trim()) evidence[k] = (ev[k] as string).trim().slice(0, 160);
  for (const k of CLIP_CRITERIA) {
    // un «sí» sin prueba comprobable no vale: si la cita no sale en la transcripción, el criterio no puede pasar de «algo» en cada pregunta
    const proved = !ctx || quoteIsReal(evidence[k], ctx.transcript, ctx.vision);
    if (!proved) delete evidence[k];
    const block = r[k] as Record<string, unknown> | null;
    if (!block || typeof block !== 'object') return null;
    let sum = 0;
    let valid = 0;
    for (const it of RUBRIC[k]) {
      const v = block[it.key];
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.min(proved ? 2 : 1, Math.max(0, Math.round(v))) : null;
      if (n === null) continue;
      valid++;
      sum += n;
      items[`${k}.${it.key}`] = n;
    }
    if (valid < 3) return null;
    // cada criterio vale de 0 a 10 aunque tenga más o menos preguntas (la viralidad tiene más)
    criteria[k] = r1((sum * 10) / (2 * RUBRIC[k].length));
  }
  const reason = typeof r.motivo === 'string' ? r.motivo.trim().slice(0, 200) : '';
  const summary = typeof r.resumen === 'string' && r.resumen.trim() ? r.resumen.trim().slice(0, 300) : undefined;
  return { criteria, reason, ...(summary ? { summary } : {}), items, evidence };
}


/** Segundo examen de viralidad: un escéptico intenta demostrar que el clip NO se viralizaría. Solo se hace con clips que ya pasan de 9. */
export const VIRAL_VERIFY_SYSTEM =
  'Eres un analista muy escéptico de contenido corto (TikTok, Instagram Reels y YouTube Shorts) y tu trabajo es DEMOSTRAR QUE ESTE CLIP NO SE VIRALIZARÍA. ' +
  'Otro evaluador ya le dio una nota muy alta de viralidad; tú buscas lo que se le pasó: arranque que no engancha a un desconocido, necesidad de contexto o de lore, frase que no es tan citable, final que se diluye, un tipo de clip ya muy visto, mala calidad o algo que lo haría pasar de largo. ' +
  'Si tras buscarlos de verdad no encuentras defectos, lo reconoces; pero no lo regalas: ante la duda, contesta la opción más baja. ' +
  'No ves quién habla ni conoces al streamer. Cada «2» necesita una cita literal de la transcripción (o «Imagen:» y lo que se ve, si hay fotogramas). ' +
  'Haz una simulación con seis espectadores distintos y di, uno por uno, si se queda hasta el final y lo comparte. Responde SOLO con JSON.';

export function viralVerifyPrompt(title: string, words: Word[], durationSec: number, frames: number, first: { summary?: string; evidence?: string; viral: number }): string {
  const text = words.map((w) => w.text).join(' ').slice(0, 1800);
  const qs = RUBRIC.viral.map((it) => `  - ${it.key}: ${it.label}`).join('\n');
  const viewers = ['no conoce al streamer ni el juego y hace scroll muy rápido', 'tiene el sonido apagado', 'solo mira el primer segundo y medio', 'es fan de otros streamers y compara con clips que ya ha visto', 'se aburre con facilidad y busca el momento fuerte', 'comparte vídeos con amigos solo si le sorprenden mucho'];
  const shape = `{"escepticismo":"por qué NO se viralizaría (o «nada relevante»)","espectadores":[${viewers.map(() => '{"se_queda":false,"motivo":""}').join(',')}],"viral":{${RUBRIC.viral.map((it) => `"${it.key}":0`).join(',')}},"prueba":""}`;
  return (
    `El primer evaluador dio a este clip ${first.viral}/10 de viralidad.${first.summary ? ` Lo resumió así: «${first.summary}».` : ''}\n` +
    `Ahora tú: intenta refutarlo y puntúa de 0 a 2 estas preguntas:\n${qs}\n` +
    `Espectadores simulados, en este orden: ${viewers.map((v, i) => `${i + 1}) ${v}`).join('; ')}. «se_queda» es true solo si ve el clip entero Y lo compartiría.\n` +
    `Devuelve exactamente este JSON: ${shape}. En "prueba" va la cita literal más reveladora (o «Imagen: …»).\n` +
    `Título: ${JSON.stringify(title)}. Duración: ${Math.round(durationSec)} s.` +
    (frames ? `\nSe adjuntan ${frames} fotogramas del clip, en orden.` : '') +
    `\nTranscripción:\n${text || '(casi no se habla)'}`
  );
}

/** Valida el segundo examen. Sin las respuestas completas (todas las preguntas y los seis espectadores) no se da por bueno: devuelve null. */
export function parseViralCheck(raw: unknown, ctx?: { transcript: string; vision?: boolean }): ViralCheck | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const block = r.viral as Record<string, unknown> | null;
  const viewers = r.espectadores;
  if (!block || typeof block !== 'object' || !Array.isArray(viewers) || viewers.length < VIRAL_VIEWERS) return null;
  const proved = !ctx || quoteIsReal(typeof r.prueba === 'string' ? r.prueba : undefined, ctx.transcript, ctx.vision);
  const items: RubricItems = {};
  for (const it of RUBRIC.viral) {
    const v = block[it.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    items[`viral.${it.key}`] = Math.min(proved ? 2 : 1, Math.max(0, Math.round(v)));
  }
  const stay = viewers.slice(0, VIRAL_VIEWERS).filter((v) => (v as Record<string, unknown> | null)?.se_queda === true).length;
  const refutation = typeof r.escepticismo === 'string' ? r.escepticismo.trim().slice(0, 240) : '';
  return { items, stay, total: VIRAL_VIEWERS, refutation };
}
