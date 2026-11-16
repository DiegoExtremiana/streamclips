/**
 * Manual de edición del equipo (desde la v0.39.0): los trucos de un equipo profesional de editores de YouTube y de vídeo
 * corto, por puesto. Cada editor de IA recibe la parte común y la de su puesto en su encargo, para que no edite «a ojo»
 * sino con criterio de oficio. Es conocimiento general de edición (estructura, ritmo, retención), escrito para el canal de
 * un streamer de Twitch en español; si se quiere añadir un truco, se añade aquí y lo aprenden todos.
 */
export type PlaybookRole = 'comun' | 'historia' | 'ritmo' | 'humor' | 'temas' | 'jefe' | 'titulos' | 'cronista';

export const PLAYBOOK: Record<PlaybookRole, string[]> = {
  comun: [
    'Primero entender y luego cortar: quién habla, con quién, de qué, qué pasa en pantalla y cuál es el chiste o la idea. Si algo necesita contexto, el contexto entra o el momento sale.',
    'El espectador no estuvo en el directo: cada corte tiene que tener lógica (causa y consecuencia, cambio de tema o salto de tiempo evidente).',
    'Los primeros segundos deciden si se quedan: se abre con algo que enganche (lo más fuerte, una pregunta, una frase que intriga), no con un saludo ni con una carga.',
    'Se corta en la acción o en la reacción, nunca a mitad de frase. Antes del remate se deja respirar medio segundo; después, uno o dos segundos de reacción (la risa también es contenido).',
    'Variedad de ritmo: alternar picos y momentos de calma; tres escenas iguales seguidas cansan.',
    'Callbacks: si algo de la primera hora vuelve en la tercera, las dos partes juntas valen más que cada una por separado.',
    'Nada de relleno ni de efectos porque sí: si dudas, fuera. Un efecto (zoom, sonido) solo subraya algo que ya está pasando.',
  ],
  historia: [
    'Estructura del resumen: gancho (5-15 s con lo mejor o con algo que abra una pregunta) → contexto mínimo → escalada → momento cumbre → cierre que remate (un chiste final, una reacción o una frase redonda).',
    'Cada capítulo cuenta UNA cosa con principio y final; su título dice qué pasa («El robo del Pichu», no «Parte 2»).',
    'Orden cronológico salvo el gancho: el espectador tiene que poder seguir lo que pasó.',
    'Que no parezca un recopilatorio: une las escenas por lo que provocan (esto lleva a aquello) o por tema; si dos escenas no se hablan entre sí, mejor un capítulo nuevo.',
    'Mejor pocas escenas largas que se entienden que muchas cortas sin contexto. Un resumen de un directo de horas debe durar de 10 a 17 minutos: llénalo con escenas que se sostengan.',
  ],
  ritmo: [
    'Fuera: silencios largos, «eeeh», repeticiones, esperas de carga o de menú, leer el chat en silencio, frases que se corrigen a sí mismas.',
    'Dentro: la pausa antes del remate, la reacción después y cualquier silencio que sea tensión (esperar el resultado de algo).',
    'La escena empieza en la frase que plantea lo que va a pasar, no en el saludo de antes; acaba cuando baja la reacción.',
    'Si dos frases dicen lo mismo, quédate con la mejor dicha.',
  ],
  humor: [
    'Objetivo prioritario de cada clip: hacerse viral en redes. Se mide en cuatro cosas: que no se pase de largo en el primer segundo, que se vea entero, que se repita y que se comparta o se comente.',
    'Estructura del clip: gancho → planteamiento mínimo → remate → reacción. Entra lo más tarde posible y sal lo antes posible tras el remate.',
    'El primer segundo engancha o se pierde: empieza con la frase más rara, la cara, el grito o el instante en que algo va a salir mal; nunca con un saludo, una carga o un «a ver».',
    'Emoción fuerte y clara: risa, sorpresa, vergüenza ajena, rabia, ternura o «no me lo creo». Si no provoca nada, no es clip.',
    'Funciona: fails, reacciones exageradas, frases absurdas o memorables, piques con amigos, suerte o mala suerte extrema, jugadas increíbles, opiniones con fuerza que invitan a comentar, situaciones con las que cualquiera se identifica.',
    'Un clip = una idea, de 15 a 35 segundos (60 como mucho). Si el final enlaza con el principio (bucle), mejor: se ve dos veces y el algoritmo lo premia.',
    'Que se entienda sin conocer al streamer ni haber visto el directo: si solo hace gracia a quien lleva tres horas viéndolo, no es clip.',
    'Piensa en a quién se lo mandaría alguien («mira esto»): si no se le ocurre a nadie, no es viral.',
  ],
  temas: [
    'Un vídeo = un tema con arco: planteamiento (de qué se habla y por qué importa) → desarrollo (opiniones, anécdotas, giros, discusión) → conclusión (postura final, chiste o reflexión).',
    'Junta tramos separados en el tiempo si son el mismo tema, y ordénalos para que la idea avance, no para que se repita.',
    'El título es el tema tal como lo buscaría alguien en YouTube («Mi opinión sobre…», «Cómo…», «El mejor…»).',
    'Si un tema no tiene planteamiento ni cierre, no da para vídeo: déjalo para los clips.',
    'Cuantos más temas distintos con sentido salgan de un directo, mejor: cada uno es un vídeo más para el canal.',
  ],
  jefe: [
    'Revisa como espectador exigente: ¿engancha el arranque? ¿algo no se entiende sin contexto? ¿se repite algo? ¿hay tiempos muertos? ¿el final remata? ¿el título promete lo que hay?',
    'Quita lo flojo aunque el vídeo quede más corto, pero no lo dejes en un vídeo sin historia.',
    'Comprueba que se nota la personalidad del streamer: si podría ser el vídeo de cualquiera, falta lo suyo.',
  ],
  titulos: [
    'Título concreto de 40 a 60 caracteres, con lo más llamativo al principio, sin mentir ni exagerar lo que no pasa.',
    'Palabras que alguien buscaría (el juego, el tema, el nombre de la serie); nada de mayúsculas enteras ni emojis.',
    'Descripción: dos o tres frases que cuenten qué pasa y por qué verlo, en el tono del canal.',
    'En los clips para redes el título es un gancho: que dé ganas de verlo en un segundo (curiosidad, sorpresa o identificación), corto y sin mentir.',
  ],
  cronista: [
    'Resume lo que pasa de verdad, con nombres y hechos concretos, no impresiones vagas («hablan de cosas», «se ríen»).',
    'Señala solo los momentos que un editor querría ver: gracia, tensión, una historia, una opinión con fuerza, un giro, una reacción.',
    'Anota los temas tal como se hablan (por ejemplo «la nueva gráfica de NVIDIA», «James Gunn y el universo DC»), para poder juntarlos con otros tramos.',
  ],
};

/** El texto del manual para un puesto: lo común más lo suyo, listo para añadir al encargo del editor. */
export function playbookFor(role: Exclude<PlaybookRole, 'comun'>): string {
  const lines = [...PLAYBOOK.comun, ...PLAYBOOK[role]];
  return ` MANUAL DEL EQUIPO (trucos de edición profesional que aplicas siempre): ${lines.map((l, i) => `(${i + 1}) ${l}`).join(' ')}`;
}
