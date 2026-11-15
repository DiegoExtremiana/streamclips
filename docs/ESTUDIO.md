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

## Pendiente (por orden de valor)

1. **Tests**: no hay ninguno de `shared/studio.ts` ni de `studioPhase`. Casos mínimos: `parseTrims` (límites), `rebasePlan` (gancho y frases tras recortar), `parseFunny` (clip corto/largo), `applyChief` (protecciones), y la fase con `llmFetch` falso (un agente falla, caché). Revisar los tests que nombren la fase «director» en `PHASES` y el e2e de Ajustes (hay una casilla nueva). Solo pasaron `tsc` y `eslint`.
2. **El título del clip de humor no se usa**: `titlesPhase` (`render.ts`) vuelve a titular los clips con `host.titles`. Habría que pasar `FunnyClip.title` (p. ej. un mapa en el contexto) y respetarlo.
3. **Temas dentro del estudio**: un «editor de temas» en paralelo que revise/ordene cada propuesta de `findThemes` (gancho, recortes de ritmo, título) en vez de montarlas tal cual. `decideFormat` manda muchas a «preguntar».
4. **Editor visual**: `StudioProject` está pensado para una pestaña con línea de tiempo (pistas de vídeo y rótulos) donde Diego pueda mover y recortar piezas antes de montar. No hay interfaz ni IPC todavía; hoy solo se ve en las notas del análisis.
5. **Más pistas en el proyecto**: zooms, música, efectos de sonido y transiciones las decide hoy `shared/autoEdit.ts` al montar; lo suyo es que un «editor de acabado» las deje en el proyecto.
6. **Límites del modelo gratis**: son 3 llamadas a la vez + 1; con Groq/Gemini gratis puede saltar el límite por minuto (`askJson` ya reintenta). Si molesta, lanzar ritmo y humor escalonados.
7. Sin probar con directos reales de Diego: calibrar `FUNNY.minFun` (6.5) y `TRIM_MAX_CUT` (0.5).
