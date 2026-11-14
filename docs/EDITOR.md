# Editor profesional para YouTube (desde la v0.33.0)

Cómo convierte el programa un directo en un vídeo de YouTube de 10-15 minutos con estructura, y dónde está cada pieza.

## El piloto por fases (`electron/domain/pipeline/`)

| Fase | Archivo | Qué deja en el contexto |
|---|---|---|
| Transcripción | `transcribe.ts` | `words` (o `deferTranscribe` con análisis rápido) |
| Señales | `signals.ts` | volumen por segundo, chat, categorías, tramos por señales y `pool` de candidatos |
| Transcripción de lo elegido | `transcribe.ts` | `words` solo de los candidatos |
| Valoración | `judge.ts` | `judged` (texto + imagen + preferencias + correcciones), clips, resumen por mejores momentos, temas |
| **Director** | `director.ts` | `directed`: el vídeo largo con estructura (sustituye al resumen) |
| Nota mínima | `judge.ts` | para si nada vale |
| Hablantes | `judge.ts` | voces en lo elegido |
| Títulos | `render.ts` | títulos y descripciones; serie |
| Montaje | `render.ts` | los `OutputItem` creados |
| Cierre | `finish.ts` | visto bueno, borrado del directo, tiempos |

El contexto (`context.ts`) es un objeto plano que viaja de fase en fase; `Host` es lo poco que las fases piden a la clase `Autopilot` (nombres, música, temas, aprobar). Así cada fase se prueba sola y se puede cambiar sin tocar las demás.

## El director (`shared/director.ts`, puro)

Entrada: los momentos valorados (`directorCandidates`): id, segundos del directo, nota, tipo, nota de imagen con su frase, subida de volumen (dB sobre la media), chat por minuto y la transcripción con marcas `[Ns]`; más el título del directo, la categoría, el lore del perfil de estilo y la duración objetivo (`longMinSec`/`longMaxSec` del perfil; 10-15 min por defecto).

Salida del modelo (JSON) y lo que se comprueba (`parseDirectorPlan`):
- `gancho {id, desde, hasta, rotulo}`: 5-20 s de un momento real; se recorta si se pasa.
- `capitulos [{titulo, ids, ritmo}]`: 2-8 capítulos, ids reales y sin repetir, cronológicos dentro del capítulo. Con menos de 2 no hay plan.
- `frases [{id, en, texto}]`: solo de momentos usados; máximo 8; 40 caracteres.
- `titulo`, `descripcion`, `miniatura`, `motivo`: texto limpio y acotado.

`directedCut` convierte el plan en tramos: gancho primero, luego los capítulos; si se pasa de la duración quita lo más flojo (nunca el cierre ni el único de un capítulo); si no llega a la mitad del mínimo, no hay vídeo dirigido y se monta el resumen de siempre. Los rótulos salen en segundos del directo y el montaje los pasa al tiempo del vídeo.

## Montaje

- `planLong` respeta el orden recibido (no reordena por tiempo): el gancho del final puede ir el primero. Los saltos entre momentos, hacia delante o hacia atrás, llevan «whoosh» y fundido breve (`joints`).
- Los rótulos son efectos `title` (`shared/plan.ts` los valida: dentro de un tramo conservado, 1-60 caracteres, 1-8 s). `withTitles` deja sitio dentro del máximo de efectos (80) quitando antes acercamientos y sonidos.
- Se graban con `shared/overlays.ts` en un ASS aparte (cartela de capítulo abajo a la izquierda con fondo; frase arriba; gancho arriba en mayúsculas y amarillo), encadenado tras los subtítulos.
- Los capítulos de la descripción salen de `outputStarts`, que ahora recorre los trozos conservados con un puntero sobre los tramos: vale aunque el orden no sea cronológico o un trozo se repita.
- La frase de la miniatura (`coverText`) llega a la portada con estilo en vez del título.

## Qué falta para que sea «profesional» de verdad

1. **Calibrar con directos reales**: todo lo anterior está probado con vídeo sintético y un modelo simulado. Hacen falta 3-4 VODs de Diego para ajustar duración de gancho, número de capítulos y severidad.
2. **Imagen para todos los candidatos**: hoy el modelo con visión mira los 14 mejores; el resto llega al director sin nota de imagen. Pendiente una medida barata con ffmpeg (actividad de escena, imagen congelada) para todos.
3. **Verticales con gancho**: el mismo criterio (gancho en 3 s, frase en pantalla, recorte a 60 s) para los clips.
4. **Cierre y pantalla final**, cortinillas entre capítulos con más presencia y B-roll (repetir un plano en cámara lenta en el gancho).
