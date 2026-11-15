# Próximos pasos de StreamClips (escrito el 15/11/2026, tras la v0.37.0)

Instrucciones para cualquier modelo que continúe, también uno pequeño. Lee esto entero antes de tocar nada. El detalle técnico del estudio de edición está en `docs/ESTUDIO.md` y el del editor en `docs/EDITOR.md`.

## Qué quiere Diego (no lo pierdas de vista)

De cada directo de Twitch (3:30-4 h) el programa tiene que sacar, solo:

1. Un vídeo **«Resumen <fecha>»** de 10 a 17 minutos como máximo.
2. Vídeos de **5 a 15 minutos por tema** (pueden juntar tramos separados en el tiempo si son del mismo tema).
3. **Clips verticales** graciosos.
4. Títulos y descripciones que digan de qué se habla.
5. Comprobaciones de que cada vídeo terminado está bien.

Lo crucial: **vídeos con sentido**, que entienda quien no vio el directo. Nada de momentos sueltos pegados. Cuenta lo que se dice y lo que se ve (gestos, muecas). Todo gratis (modelos gratuitos de Groq/Gemini).

## Reglas de trabajo

- Responde a Diego siempre en castellano de España.
- Al terminar cambios: subir versión (`package.json` línea 3, `package-lock.json` líneas 3 y 9, sección «Novedades de la vX» en `README.md`), `npm run cloud:build`, push a `main` y a la rama `vX`, y crear la release en GitHub desde Chrome (la API da 403). El instalador lo construye GitHub Actions en ~5 min. Avisar al móvil.
- Parche (x.y.Z): solo los tests de lo tocado. Menor (x.Y.0): `npm run check` completo + e2e. Nunca una hora de tests por un cambio pequeño.
- Tests sueltos: `npx tsc -p tsconfig.test.json` y luego `node --test --test-concurrency=1 --test-force-exit dist-test/tests/NOMBRE.test.js`. Los `autopilot*.test.js` montan vídeo de verdad: ~1 min por caso, lánzalos de uno en uno y en segundo plano.
- En `src/` no se permiten emojis ni flechas (lo vigila `tests/ui-rules.test.ts`); iconos desde `src/icons.tsx`.
- No inventes: si algo no se ha probado con un directo real, dilo.

## Paso 0 (antes de programar): mirar un análisis real

Diego va a usar la v0.37.0 con un directo suyo. Pídele (o lee) las **notas del análisis** del directo: dicen qué hizo cada editor, cuántas escenas salieron y cuánto tardó cada fase («Tiempos: …»). Con eso:

- Si el resumen sigue pareciendo trozos sueltos → ajustar `SCENE` en `shared/studio.ts` (`joinGap`, `lead`, `tail`, `maxSec`) y el texto `HISTORIA_EXTRA`.
- Si no salen vídeos por tema → mirar la nota «Edición temática» y `THEME_VIDEO` en `electron/domain/pipeline/studio.ts` (mínimo 300 s puede ser mucho).
- Si un agente pone «(sin respuesta)» → límite del modelo gratis: lanzar los agentes escalonados en vez de a la vez.
- Si un vídeo se rechaza por silencio/negro/imagen parada → ver `qualityCheck` en `electron/services/ffmpeg.ts`; comprobar si el directo de Twitch tiene tramos silenciados.

## Lo que se vio en el ordenador de Diego (15/11, v0.37.1)

Análisis real de un directo de 183 min («Trilocke Día 1»): salieron solo 3 vídeos «Parte N» de 10 min y **ningún resumen, tema ni clip**. Causas, leídas en `%APPDATA%/streamclips/data.json` (nota del directo), `logs/app.log` y `analysis-times.json`:

- **El modelo de lenguaje (Gemini gratis, modelo por defecto) devolvía 503** y `askJson` no reintentaba: «modelo de lenguaje 1,5 s», «estudio de edición 3 s». Solo se valoraron 3 candidatos. Arreglado en la 0.37.2 (reintentos 5xx, respaldo por señales, sin «Parte N» si hay resumen o temas). **Sin comprobar todavía con un directo real.**
- **Tiempos**: total 54 min; transcripción de lo elegido 35 min para 20 min de audio (Whisper «medium» en CPU: es el cuello de botella), montaje 13 min, hablantes 4 min («External buffers are not allowed»: la identificación de voces falla siempre en su equipo, revisar).
- 46 min del directo salieron como «sin sonido»: comprobar si el umbral `MUTED_DB` (-60 dB) es demasiado alto para su audio o si de verdad Twitch lo silenció.
- En octubre Whisper no cargaba el modelo «small» (archivo corrupto); ahora usa «medium» y funciona.

Para acelerar de verdad: probar Whisper «small» o una compilación con GPU; es más ganancia que todo lo demás junto.

## Hecho en la 0.37.3 (sin comprobar en el equipo de Diego)

- Mejora 1 (pantalla de espera): se resolvió de otra forma a la descrita abajo, porque esa pantalla suele llevar música y no se detecta por silencio. `judgeVisual` tiene la opción `always` y `judge.ts` le pasa los candidatos que empiezan antes de `START_SCREEN_SEC` (600 s); el modelo de visión ya marca «muerta» una pantalla de espera. Límite: sin modelo de visión (o si falla) no hay protección. Comprobar en un análisis real que la nota «Vista del directo» ya no dice «0 momentos mirados».
- Voces: `ex.compute(st, false)` en `electron/services/diarize.ts` (sin búfer externo). Si el error sigue, mirar si `sd.process` también devuelve búferes externos.
- Descartado por ahora: montar en paralelo (ffmpeg ya usa todos los núcleos; la ganancia es pequeña y el riesgo, medio). El tiempo se va en Whisper.

## Hecho en la 0.37.4 (sin comprobar en el equipo de Diego)

- Mejora 2, parte «transcribir solo lo elegido»: `SCENE_BUDGET` en `pipeline/studio.ts`. Las escenas que quedan fuera vuelven como momentos sueltos a las unidades del editor de temas (`spare`).
- Mejora 3: el jefe de edición recibe hasta `JEFE_FRAMES` (5) fotogramas, uno por escena desde el principio del montaje (`JEFE_VE`). Si la petición con imágenes falla, revisa solo con texto. Pendiente: repartir los fotogramas por todo el vídeo cuando el proveedor admita más de 5 (Gemini).
- Siguientes: mejora 4 (vista previa del plan), temas en todas las categorías de Twitch, y decidir con Diego si Whisper pasa a «small».

## Varias IAs (v0.38.0)

Diego solo podía elegir una IA. Ahora: `autopilot.llmExtra` (hasta `MAX_LLM_SLOTS` = 3 huecos, `shared/model/settings.ts`), validado y cifrado en `electron/domain/settings.ts`, y `llmConf()` (`autopilot.ts`) devuelve la principal con `fallbacks`. `askJson` (`electron/services/llm.ts`) prueba la cadena en orden; `prefer(cfg, 'groq')` pone Groq delante para valorar (`pipeline/judge.ts`) y `visionConfig` deja solo las que ven imágenes con Gemini delante. Proveedores nuevos: `openrouter` (modelo `openrouter/free`) y `mistral` (`mistral-small-latest`); **sus modelos por defecto no se han probado con una clave real**. Tests: `tests/llmFallback.test.ts`.

Pendiente aquí: que la valoración de clips de Twitch (`electron/app/wiring/clipScores.ts`) y el motor de la nube (`engine.ts`) usen también los relevos; repartir a los editores del estudio entre IAs distintas a la vez (hoy van todos a la principal y solo cambian si falla); un panel con la cuota gastada de cada IA.

Claude dentro del programa: la API de Claude es de pago (no hay plan gratuito), así que choca con la regla de «todo gratis». No se ha añadido. Si Diego decide pagar créditos de API, es un proveedor más con otro formato de petición (no es compatible con `/chat/completions` tal cual).

## Mejoras, por orden

### 1. Descartar la pantalla de «Empezamos pronto» y las pausas (pequeño, hacer primero)

Problema visto en un vídeo real: abría con la pantalla de espera y 4 s de silencio.
Cómo: en `electron/domain/pipeline/signals.ts`, calcular el primer segundo «vivo» del directo (primera palabra transcrita, o primer tramo de 20 s con volumen por encima de `MUTED_DB`) y descartar de `moments`, `summary`, `mains` y `pool` lo que empiece antes. Añadir una nota. Además, en `studio.ts`, que el contexto de una escena (`lead`) no pueda empezar antes de ese segundo. Test: función pura en `shared/highlights.ts` + caso en `tests/highlights.test.ts`.

### 2. Menos tiempo de análisis

Primero medir (paso 0). Luego, por este orden:

- **Montar en paralelo**: en `renderPhase` (`electron/domain/pipeline/render.ts`) los vídeos se hacen uno tras otro. Hacer 2 a la vez (ajustable). Cuidado con el progreso de la tarea y con cancelar.
- **Una pasada menos**: `renderTimeline` (`electron/services/ffmpeg.ts`) codifica por tramos, luego mezcla música y luego recodifica todo para grabar rótulos/subtítulos. Grabar los rótulos por tramo o unir música + rótulos en una sola pasada.
- **Transcribir solo lo elegido**: `studio.ts` transcribe el contexto de todas las escenas; se puede transcribir solo el de las que superen cierta nota.

### 3. Que el jefe de edición vea el montaje

Hoy `JEFE_SYSTEM` solo lee texto. Pasarle 1 fotograma por escena (usar `vodFrame` de `electron/services/visualJudge.ts` y `visionConfig`) para que detecte escenas sin nada en pantalla o cortes raros. Respetar el límite de imágenes de Groq (5 por petición).

### 4. Vista previa del plan antes de montar

El plan ya se guarda en `<judgeDir>/<vod>.studio.json` (`StudioProject` en `shared/studio.ts`). Falta: IPC para leerlo y una ventana con la lista de escenas de cada vídeo (orden, duración, título) donde Diego pueda quitar o reordenar antes de montar. Es el primer paso del «CapCut interno».

### 5. Aprender de lo que Diego aprueba y rechaza

Ya existe para momentos (`shared/preferences.ts`). Extenderlo a vídeos completos: temas que aprueba, duración preferida.

### 6. Deuda conocida

- No hay test de `studioPhase` entera con modelo falso (solo de las funciones puras, `tests/studio.test.ts`).
- Con varias categorías de Twitch, los temas solo se buscan en la dominante.
- La visión mira 2-3 fotogramas de los 14 mejores momentos: un gesto breve se puede escapar.
- El vídeo mudo de Diego: la causa (¿Twitch silenció el directo?) no se confirmó; si reaparece con el sonido del directo bien, revisar concat + `mixMusic`.
- La batería completa (`npm run check`) y las pruebas e2e no se pasan desde la v0.34.0: pasarlas antes de la próxima versión menor.
- Pendiente antiguo: estadísticas reales de YouTube/TikTok/Instagram (necesita las cuentas de Diego conectadas), reorganización en 4 pestañas, modos Manual/Asistido/Automático.
