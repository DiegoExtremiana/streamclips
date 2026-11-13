# Estado tras la v0.26.0 y notas para la v0.27

**Hecho en la 0.26.0:** arreglo del audio en bucle (mono/estéreo al unir tramos), diagnóstico real de la valoración de clips (2 a la vez, tiempos y estimación), documento `Notas de clips.md`, edición de clips sin el VOD (propio vídeo del clip o solo el trozo bajado de Twitch), cronómetro por fases en el análisis (`analysis-times.json`), tarjeta de espacio en disco y modularización de `shared/types.ts` (`shared/model/*`), IPC (`electron/ipc/handlers/*`) y valoración de clips (`electron/app/wiring/`).

**Pendiente de modularizar:** `electron/domain/autopilot.ts` (~880 líneas), el resto de `electron/app/context.ts` (cableado por servicio), `src/library/ItemModal.tsx`, `src/tabs/LibraryTab.tsx` y partir `tests/e2e/gui-smoke.mjs`.

**Pendiente de optimizar (con datos):** leer `analysis-times.json` tras unos directos reales y atacar la fase más lenta (caché de audio por VOD, Whisper cuantizado/VAD, cola por fases). Para clips: mirar los segundos por clip que enseña el panel y, si domina Whisper, probar un modelo más pequeño solo para clips.

**Nuevo y sin probar en su PC:** bajar un trozo con `yt-dlp --download-sections` (alargar/mover clips sin VOD) y la tarjeta de espacio.

---

# Notas originales de la v0.26 (histórico)

Petición de Diego (12/11/2026): **optimizar el programa y el tiempo de análisis de vídeos**, y **modularizar el código** (es lo más óptimo). Estas notas son el punto de partida; nada de esto está hecho todavía.

## 0. Antes de empezar
- Confirmar que 0.25.1 está publicada (instalador, `latest.yml`) y leer lo que Diego haya dicho de los clips: si salía «0 valorados» por falta de Whisper (aviso en Clips), por pausa o por fallos (ahora el panel lo dice).
- Pendiente de la 0.25.x: la valoración con Groq y clips reales **no se ha probado** (solo con simulaciones). Pedirle que revise 3 o 4 clips con «Ver por qué» y ajustar preguntas y pesos de la rúbrica (`shared/clipCriteria.ts`).
- Seguir las reglas fijas: castellano de España, todo gratis, nunca apagar su PC sin confirmación explícita, no escribir credenciales, versión nueva + push + release al terminar.

## 1. Medir antes de optimizar (primer paso obligatorio)
No hay mediciones reales del análisis en su PC. Hacer primero:
- Cronometrar por fase cada análisis (descarga del VOD, extracción de audio, volumen, candidatos, transcripción, juez LLM, diarización, render) y guardarlo en un registro (`userData`) para ver dónde se va el tiempo con sus directos reales.
- Mostrar ese desglose en Ajustes o en el detalle del directo («tardó 18 min: 11 transcribir…»).
- Sin estos datos no tocar nada a ciegas: la transcripción con Whisper (CPU) es casi seguro lo más lento.

## 2. Ideas de optimización del análisis (por orden de beneficio probable)
1. **Transcribir solo lo necesario.** Ya existe «análisis rápido» (momentos por volumen y chat y transcribir solo lo elegido): comprobar que es el camino por defecto en todos los flujos, incluido el de los clips del canal.
2. **Caché de lo ya pagado** (ver `docs/arquitectura-propuesta.md`): guardar por VOD el audio extraído, el volumen por segundo, las transcripciones por tramo y los juicios del LLM, con huella del contenido, para no repetir nada al reanalizar o cambiar de ajustes.
3. **Audio una sola vez:** extraer un WAV 16 kHz mono por VOD y reutilizarlo en volumen, Whisper y diarización (hoy cada paso puede leer el vídeo entero).
4. **Whisper:** probar modelo `base` o `small` cuantizado, hilos según núcleos, y detección de voz (VAD) para saltar silencios. Medir calidad vs velocidad con un directo suyo antes de cambiar el modelo recomendado.
5. **Paralelismo:** hoy `parallel` (1 a 4 directos a la vez) reparte núcleos. Estudiar una cola por fases (la transcripción de un directo mientras se renderiza otro) en vez de directos enteros en paralelo.
6. **Valoración de clips:** descargar solo el audio (`yt-dlp -f` de audio, o `-g` + ffmpeg `-vn`, ya se hace con `-t 180`), transcribir a la vez que se descarga el siguiente, y reutilizar el audio si el clip se añade a la Biblioteca.
7. **LLM:** agrupar candidatos en una sola petición cuando el texto sea corto; respetar los límites gratuitos de Groq (30 pet./min, ~14 s entre peticiones hoy) y de Gemini.
8. **Interfaz:** `SCORING_MS` y el sondeo del canal; listas largas de clips con virtualización; evitar renderizados completos al cambiar de pestaña.

## 3. Modularizar el código (sin cambiar el comportamiento)
Tamaños actuales (líneas): `electron/domain/autopilot.ts` 856, `shared/types.ts` 770, `src/library/ItemModal.tsx` 610, `electron/domain/transcripts.ts` 561, `electron/domain/cloud.ts` 467, `shared/highlights.ts` 457, `src/tabs/LibraryTab.tsx` 447, `electron/domain/library.ts` 432, `electron/domain/channel.ts` 422, `electron/app/context.ts` 377. El e2e (`tests/e2e/gui-smoke.mjs`) tiene ~1250 líneas.

Plan, en pasos pequeños, **cada uno con `npm run check` y e2e en verde antes del siguiente**:
1. **`shared/types.ts`** → un archivo por área (`types/settings.ts`, `types/library.ts`, `types/clips.ts`, `types/ipc.ts`…) con un `index.ts` que reexporta todo (así no se rompe ningún import).
2. **`electron/domain/autopilot.ts`** → separar: orquestación (cola y estados), selección de momentos, edición/montaje, publicación/programación y limpieza. Una clase fina que las coordina.
3. **`electron/app/context.ts`** (el «cableado»): un módulo por servicio (`wiring/clips.ts`, `wiring/style.ts`, `wiring/covers.ts`…) para que añadir un servicio no obligue a editar un archivo enorme.
4. **`electron/ipc/register.ts`** → un registrador por dominio (clips, biblioteca, ajustes, portadas, estilo…).
5. **Interfaz:** `ItemModal.tsx` y `LibraryTab.tsx` en componentes más pequeños; tarjetas de Ajustes ya separadas (`AutopilotCards.tsx`), seguir ese patrón.
6. **Tests:** partir `gui-smoke.mjs` en archivos por pestaña con utilidades comunes, y que cada uno pueda ejecutarse suelto (hoy el completo tarda mucho).
7. Reglas: no mezclar refactor con funciones nuevas en el mismo commit; `ui-rules.test` prohíbe emojis, pictogramas y flechas en `src`; ESLint ignora `.tmp-*`.

## 4. Funciones que siguen pendientes (pedidas por Diego)
- **Portadas:** que las portadas automáticas usen sus piezas con nombre (Diego_Sorprendido, Fondo_Ciudad); buscar material en internet **solo con licencia libre**, usarlo y borrarlo después. Títulos «estéticos».
- **Audio por canales (stems):** separar su voz, la música de fondo y cada voz extra (los VODs de Twitch vienen mezclados). Solo sobre los momentos elegidos. Comparar opciones ONNX gratuitas (MDX-Net, Spleeter, Demucs) midiendo tiempo y calidad.
- **Montaje con el perfil de estilo:** planos de 3 s como máximo en TikTok, transiciones, música lofi sin derechos a volumen bajo, silencios de 2 s como máximo (ya aplicado en el piloto).
- **Análisis visual**, **calibrar con sus VODs reales** (diarización, umbrales de dorado), **referentes** (ElXokas, Rubius, Folagor, KNekroGamer, KNekroShorts; requiere bajar sus vídeos desde su PC).
- **Valoración de clips:** calibrar la rúbrica con sus opiniones (valoración manual de 15 a 20 clips) y, solo para ajustar pesos, comparar con las visualizaciones reales (nunca entran en la nota).
- Pregunta sin respuesta: si en su cuenta de Claude aparece un fondo de uso programático (para usar su suscripción con respaldo automático).

## 5. Cómo trabajar y publicar (receta que funciona)
- Rama por versión, `npm run check` (tarda ~1 h; lanzarlo en segundo plano con `run_in_background`) y `xvfb-run -a npm run test:e2e`.
- Compilar pruebas a `.tmp-dN` con `npx tsc -p tsconfig.test.json --outDir`, y **borrarlas antes de `git add -A`** (ya están en `.gitignore` y fuera de ESLint).
- Subir a `main` y hacer `git push`; el push de etiquetas falla desde el sandbox: crear la release en Chrome (`releases/new?tag=vX&target=main&title=vX`), escribir las notas y publicar.
- Verificar con `gh api repos/DiegoExtremiana/streamclips/releases/tags/vX` y el flujo «Instalador de Windows» (`StreamClips-Setup-X.exe`, `.blockmap`, `latest.yml`).
- Regenerar el motor de la nube (`npm run cloud:build`) y commitear `resources/cloud/engine.js` si cambia.

## v0.27.0 (hecho)
- Valoración de clips: arreglado el error de probe sobre audio (`probe(..., {audioOnly})`); fotogramas al modelo (`clipFrames`, `visionConfig`).
- `StorageService.sweepUsed`: borrado automático de directos usados (30 min de gracia, sin trabajo en marcha).
- `shared/topics.ts` + paso «temas» del piloto: vídeos por tema.
- `shared/sounds.ts` + `electron/services/soundBank.ts`: 11 efectos sintetizados + sustitución por archivos del usuario.
- `shared/music.ts` + `electron/services/music.ts`: lofi generada por ambiente, mezcla con ducking y detección de sonido de fondo.

- `shared/visual.ts` + `electron/services/visualJudge.ts`: fotogramas del VOD a los mejores momentos y nota visual (±1,5) en la selección.

### Pendiente / sin verificar con datos reales
- Modelo de visión de Groq (`meta-llama/llama-4-scout-17b-16e-instruct`): nombre no comprobado contra su API; si falla, cae a solo texto (queda en el log).
- El pack de efectos de YouTube de la lista del usuario son vídeos largos sin nombres por sonido: no se importaron; la vía es dejar archivos en la carpeta Sonidos.
- Calidad musical de la lofi generada: probada en nivel, duración y ducking, no escuchada.
- Detección de «ya hay música» por nivel de las pausas (umbral -42 dB): calibrar con directos reales.

