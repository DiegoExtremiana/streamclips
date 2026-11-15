# Estudio de edición (v0.36.0) — notas para quien siga

Escrito por Claude Fable 5.2 con prisa y **sin tests** a petición de Diego: otro modelo debe probarlo y continuarlo.

## Qué pidió Diego

Un «CapCut/DaVinci interno» manejado por IA, con varios agentes a la vez que actúen como editores profesionales, y que de cada directo salgan:

1. Un vídeo resumen de 10-15 min de todo el VOD.
2. Vídeos de momentos del mismo tema, con sentido.
3. Clips graciosos.

## Qué hay hecho

- `shared/studio.ts` (puro): prompts, validación y aplicación de cada agente, y el tipo `StudioProject` (archivo de proyecto con líneas de tiempo).
- `electron/domain/pipeline/studio.ts`: la fase `studioPhase`, que sustituye a `directorPhase` en `PHASES` (`index.ts`). Con `cfg.studio === false` llama al director de siempre.
- Ajuste `studio` (`shared/model/settings.ts`, `electron/domain/settings.ts`, casilla en `src/tabs/AutopilotCards.tsx`).

Agentes (los tres primeros en paralelo con `Promise.allSettled`; el jefe después):

| Agente | Qué decide | Dónde acaba |
|---|---|---|
| Editor de historia | Estructura del resumen (es el prompt del director, `shared/director.ts`) | `ctx.directed` |
| Editor de ritmo | Recorte interno de cada momento (`Trim`, relativo al inicio) | `applyTrims` + `rebasePlan` antes de `directedCut` |
| Editor de humor | Clips graciosos con inicio, remate, título y gracia 0-10 | por delante en `ctx.moments` (kind `gracia`) |
| Jefe de edición | Quita momentos, mejora título y miniatura | `applyChief` (con protecciones) |

Los vídeos por tema NO son nuevos: los busca `host.findThemes` en `judgePhase` (`shared/themes.ts`) y el estudio solo los copia al proyecto. El proyecto y la caché se guardan en `<judgeDir>/<vod>.studio.json` (la caché solo vale si todos los agentes respondieron).

## v0.37.0: escenas con contexto (lo que más le importa a Diego)

Diego: «no quiero momentos sueltos, quiero vídeos con sentido, no 4 escenas con 4 cortes». El problema de fondo era que el pool del piloto son picos de 25-75 s separados ≥45 s (`signals.ts`), y el vídeo largo se montaba pegando 12-20 de ellos.

Ahora `studioPhase` convierte los picos en **escenas** antes de llamar a los editores (`sceneSpans`/`sceneCandidate` en `shared/studio.ts`, constantes en `SCENE`): picos a menos de 100 s se unen en un tramo continuo; cada escena empieza 25 s antes y acaba 10 s después, ajustada a frase completa, sin pasar de 4,5 min ni salirse de su categoría. Se transcribe el contexto añadido (`transcripts.ensure`). El editor de historia recibe escenas (ids `e1…`) con `HISTORIA_EXTRA` en el sistema; el de humor sigue con los picos (`all`). El ritmo ya solo puede quitar un tercio. El prompt de visión pide gestos y muecas.

También en la 0.37.0: los fotogramas de la visión se sacan alrededor del pico de volumen del momento (`gestureTimes` en `visualJudge.ts`, `peakAt` desde `judge.ts`) para pillar el gesto; los clips del editor de humor conservan su título (`ctx.clipTitles`, aplicado en `titlesPhase`); las piezas de un tema a menos de 12 s se montan seguidas (`THEME_JOIN_GAP`). Con menos de 4 escenas (directo corto) el estudio trabaja con los momentos sueltos, como el director.

**Editor de temas** (petición de Diego: «si hablo de algo de forma repartida en el directo, que el vídeo de ese tema junte los tramos»): con el estudio activo, `judgePhase` ya no llama a `findThemes`; lo hace `studioPhase` en paralelo con los demás, pasando las ESCENAS como unidades (ids `e…`, 900 caracteres de texto cada una) para que cada pieza del tema tenga contexto. Con `studio: false` sigue como antes. Ojo: con varias categorías de Twitch solo se buscan temas en la dominante (viene de `singleCategory`); ampliarlo a todas es una mejora pendiente.

**Vídeo mudo (caso real de Diego, vídeo de la ~0.34):** un vídeo de 10:35 con 19 cortes cuyo audio muere en 5:15 y sigue mudo hasta el final (los 8 últimos tramos). Causa más probable: tramos del directo guardado silenciados por Twitch (música con derechos; en pantalla salía una retransmisión). No confirmado: no se tuvo el VOD original. Protecciones añadidas: `silentShare`/`MUTED_SHARE` en `shared/highlights.ts` (signals.ts descarta candidatos mudos; studio.ts descarta escenas mudas) y `validateRender` rechaza un vídeo largo con ≥30 % en silencio (`silentSeconds`, silencedetect -45 dB, 8 s). Si vuelve a pasar con el sonido del directo bien, mirar `renderTimeline` (concat + `mixMusic`). Ese vídeo además abría con la pantalla «Empezamos pronto»: falta descartar las pantallas de espera del principio del directo.

Tests: `tests/studio.test.ts` (funciones puras). Falta el test de la fase entera con modelo falso.

Siguiente paso lógico para «vídeos con sentido»: que los vídeos por tema (`findThemes`) usen también escenas, y que el jefe de edición vea fotogramas del montaje final (hoy solo lee texto). La visión mira 2-3 fotogramas de los 14 mejores picos: para gestos haría falta sacar fotogramas alrededor del pico de volumen, no repartidos.

## Pendiente (por orden de valor)

1. **Tests**: no hay ninguno de `shared/studio.ts` ni de `studioPhase`. Casos mínimos: `parseTrims` (límites), `rebasePlan` (gancho y frases tras recortar), `parseFunny` (clip corto/largo), `applyChief` (protecciones), y la fase con `llmFetch` falso (un agente falla, caché). Revisar los tests que nombren la fase «director» en `PHASES` y el e2e de Ajustes (hay una casilla nueva). Solo pasaron `tsc` y `eslint`.
2. **El título del clip de humor no se usa**: `titlesPhase` (`render.ts`) vuelve a titular los clips con `host.titles`. Habría que pasar `FunnyClip.title` (p. ej. un mapa en el contexto) y respetarlo.
3. **Temas dentro del estudio**: un «editor de temas» en paralelo que revise/ordene cada propuesta de `findThemes` (gancho, recortes de ritmo, título) en vez de montarlas tal cual. `decideFormat` manda muchas a «preguntar».
4. **Editor visual**: `StudioProject` está pensado para una pestaña con línea de tiempo (pistas de vídeo y rótulos) donde Diego pueda mover y recortar piezas antes de montar. No hay interfaz ni IPC todavía; hoy solo se ve en las notas del análisis.
5. **Más pistas en el proyecto**: zooms, música, efectos de sonido y transiciones las decide hoy `shared/autoEdit.ts` al montar; lo suyo es que un «editor de acabado» las deje en el proyecto.
6. **Límites del modelo gratis**: son 3 llamadas a la vez + 1; con Groq/Gemini gratis puede saltar el límite por minuto (`askJson` ya reintenta). Si molesta, lanzar ritmo y humor escalonados.
7. Sin probar con directos reales de Diego: calibrar `FUNNY.minFun` (6.5) y `TRIM_MAX_CUT` (0.5).
