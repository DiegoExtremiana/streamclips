# StreamClips

Programa de escritorio (Windows) para convertir tus VODs de Twitch en clips verticales, clips horizontales y vídeos largos 1920×1080, y programar su publicación.

## Novedades de la v0.6

- **Panel automático**: vigila tu canal de Twitch cada minuto. Al terminar un directo recoge su VOD, lo transcribe con Whisper, busca los mejores momentos (volumen, chat, palabras clave) y prepara un **resumen** (10–15 min, publicación 07:00) , un **vídeo principal** (publicación 16:00) y clips. Por defecto todo espera tu visto bueno.
- **Clips de tu canal de Twitch** en la pestaña Clips: listados y los eliges tú para importarlos.
- **Redes reales**: YouTube, TikTok e Instagram con inicio de sesión OAuth (Conexiones).
- **Whisper integrado** (whisper.cpp, local y gratis), troceado en tramos de 20 min para directos de 3–4 h.
- **Publicar con el PC apagado** vía GitHub Actions (`docs/NUBE.md`), borrando de la nube lo ya publicado.
- **Actualización automática** cada hora desde GitHub Releases; se instala cuando el programa está libre.
- Títulos con IA opcionales y gratuitos (Groq o Gemini, con tu propia clave); sin clave se usan títulos locales.

## Qué hace (base v0.5)

- Conecta con tu canal de Twitch (API Helix, gratuita) y lista tus VODs recientes.
- Descarga VODs por URL con yt-dlp (o cualquier URL que yt-dlp admita).
- Renderiza con ffmpeg, **y valida cada render** (se abre, resolución correcta, duración correcta) antes de darlo por listo: vertical 1080×1920, horizontal 1920×1080 y vídeo largo 1920×1080 a partir de varios tramos.
- Acepta un **plan de edición en JSON** (clips + vídeo largo de una vez), el formato en el que Claude devolverá sus decisiones.
- **Biblioteca**: cuadrícula de fichas del mismo tamaño con las secciones Clips y Vídeos. Al pulsar una se abre una ventana con reproductor (iconos de reproducir, pausa, reinicio, posición y sonido) y:
  - Clips: cada clip es una sola ficha con sus dos versiones, vertical 1080×1920 y horizontal 1920×1080, que se ven a la vez en la ventana. Clic derecho sobre la ficha: «Descargar en horizontal» o «Descargar en vertical» (también hay un botón en cada versión). Nombre, recorte (inicio y fin), encuadre vertical arrastrando un recuadro sobre el fotograma del VOD (vuelve a renderizar las dos versiones y valida antes de sustituir los archivos) y programación por red con su propia hora. Si falta una versión se puede generar.
  - Vídeos largos: nombre, descripción, lista de reproducción, público o privado (privado por defecto), miniatura (fotograma del reproductor o imagen propia, 1280×720) y programación.
  - **Carpetas** por tema o por serie, anidables hasta 5 niveles, con arrastrar y soltar o clic derecho. Borrar una carpeta nunca borra vídeos.
- **Edición con criterio de editor**: el plan puede quitar partes de un clip (`cuts`, cortes secos para silencios y tiempos muertos) y añadir animaciones (`punch`: acercamiento breve a un momento clave; `fadeIn` y `fadeOut`). Todo se valida (tiempos dentro del clip, tramos mínimos, sin solapes) y el render se comprueba como siempre.
- **Subtítulos opcionales, desactivados por defecto**, para cualquier clip o vídeo largo. Al activarlos en la ventana de la Biblioteca eliges entre 4 estilos (Clásico, Karaoke, Impacto, Discreto) y ves el resultado en directo sobre el reproductor (las dos versiones a la vez) con el mismo reparto de frases y las mismas medidas que el render final. «Aplicar» graba el texto en el vídeo con ffmpeg/libass, sincronizado aunque el clip tenga cortes, y «Quitar» lo vuelve a dejar limpio.
- **Transcripción por VOD**: se importa (JSON propio o de Whisper, SRT o VTT) o se genera con Whisper integrado (whisper.cpp, gratis y local; el modelo se descarga desde Ajustes). «Copiar petición para Claude» deja en el portapapeles las instrucciones de edición y la transcripción con tiempos; pegas a Claude y su respuesta (JSON) en «Aplicar plan».
- Cola de publicaciones. Regla clave: **nunca se publica dos veces lo mismo en la misma red** (clave única, estado guardado antes de enviar, lo interrumpido nunca se reintenta solo).
- Carpeta de salida configurable. La interfaz no usa emoticonos; solo iconos SVG.

## Límites y lo que no se ha podido probar

- **Nada de esto se ha probado contra los servicios reales** (Twitch, Google, TikTok, Meta, GitHub, Hugging Face): solo contra servidores simulados que reproducen su protocolo. Tampoco el instalador ni la actualización automática en Windows, ni la ejecución real del flujo de Actions, ni Whisper con voz real (solo con un `whisper-cli` simulado).
- YouTube: mientras tu app de Google no esté verificada, los vídeos subidos quedan **privados** y la cuota es baja; en modo «Testing» el acceso caduca a los 7 días. TikTok: sin auditoría, los vídeos se publican privados. Instagram: necesita cuenta profesional y la app en modo desarrollo. TikTok puede rechazar la redirección `http://127.0.0.1`.
- Directos de 3–4 h: el análisis es por flujo (memoria constante) y se probó con vídeos sintéticos de 4 h, pero un VOD ocupa 6–15 GB en disco y Whisper en CPU puede tardar 1–3 h por directo.
- Los vídeos largos solo se reeditan para cambiar subtítulos; los subtítulos quedan grabados en el vídeo.
- El instalador no está firmado (SmartScreen avisará).

## Qué se ha probado y cómo

`npm run check` ejecuta tipos, ESLint y 377 pruebas (ffmpeg real, yt-dlp, Twitch, redes, GitHub y Whisper simulados). `npm run test:e2e` abre la aplicación Electron real y maneja la interfaz (47 comprobaciones: reproductor con salto de posición, las dos versiones de un clip, descargas, arrastrar y soltar, programación, reinicio de la app…). En Linux: `xvfb-run -a npm run test:e2e`. `E2E_PACKAGED=<ejecutable>` prueba el paquete final.

**No se ha probado**: en Windows, ni contra Twitch real (yt-dlp real sí se ha probado con una URL local: acepta los parámetros que usa la app y devuelve el MP4), ni el instalador final `.exe` (aquí solo se pudo generar la carpeta de la aplicación para Windows; el instalador se genera en GitHub Actions).

## Instalar en Windows (sin terminal)

El instalador `StreamClips-Setup-x.y.z.exe` incluye ffmpeg, ffprobe y yt-dlp: no hay que instalar nada más. Se genera gratis con GitHub Actions: sube el proyecto a un repositorio de GitHub y ejecuta el flujo **Instalador de Windows** (pestaña Actions → Run workflow; o sube una etiqueta `v0.6.0`). Con una etiqueta `v*` el flujo publica además la versión en GitHub Releases, de donde los programas instalados se actualizan solos. También se puede generar en un Windows con `npm install` y `npm run dist` (el resultado queda en `release/`).

Aviso: el instalador no está firmado digitalmente, así que Windows SmartScreen mostrará «Windows protegió tu PC»; pulsa «Más información» y «Ejecutar de todas formas». Firmarlo requiere un certificado de pago, así que no se hace. ffmpeg (paquete ffmpeg-static) se distribuye con licencia GPL; es de uso libre y gratuito.

## Instalación para desarrollar

1. Instala [Node.js](https://nodejs.org) (LTS).
2. Instala ffmpeg y yt-dlp, por ejemplo con winget (si no los encuentra, comprueba el nombre del paquete):
   ```
   winget install Gyan.FFmpeg
   winget install yt-dlp.yt-dlp
   ```
   Cierra y abre la terminal para que se actualice el PATH. Si no usas el PATH, indica las rutas en Ajustes.
3. En la carpeta del proyecto:
   ```
   npm install
   npm start
   ```
   Para desarrollo con recarga: `npm run dev`. Para generar el instalador: `npm run dist`.
4. En la pestaña **Ajustes**, pulsa "Guardar y comprobar" para verificar ffmpeg, ffprobe y yt-dlp.
5. En **Conexiones**, crea una aplicación gratuita en la consola de desarrollador de Twitch y pega su Client ID y Client Secret (el secreto se guarda cifrado con el sistema cuando está disponible).

## Estructura

```
shared/     tipos, plan JSON, tiempos, árbol de carpetas, límites de YouTube (sin dependencias de Electron)
electron/   services (ffmpeg, yt-dlp, twitch, almacén…), domain (clips, biblioteca, carpetas, programador…),
            ipc, app (ventana, contexto, medios); main.ts y preload.ts
src/        interfaz React: tabs/ y library/
tests/      pruebas unitarias, de integración y e2e de la interfaz real
```
Los vídeos locales llegan al reproductor por un protocolo propio (`sc-media://o/<id>/video`) que solo sirve archivos registrados y admite rangos (necesario para saltar en el vídeo).

## Formato del plan de edición

```json
{
  "clips": [
    {
      "start": 125, "end": 168, "title": "Momento épico",
      "cuts": [ { "start": 140, "end": 144.5 } ],
      "effects": [ { "type": "punch", "at": 152, "duration": 1.2, "zoom": 1.2 }, { "type": "fadeOut", "duration": 0.5 } ],
      "subtitles": "karaoke"
    },
    { "kind": "horizontal", "start": 300, "end": 340, "title": "Reacción" }
  ],
  "long": {
    "title": "Resumen del directo",
    "segments": [ { "start": 60, "end": 400 }, { "start": 900, "end": 1500 } ],
    "effects": [ { "type": "fadeIn" }, { "type": "fadeOut" } ]
  }
}
```
Los tiempos van en segundos del VOD. `kind` es opcional (por defecto se generan vertical y horizontal), igual que `cropX`, `cuts`, `effects` y `subtitles` (`clasico`, `karaoke`, `pop` o `minimal`; sin el campo, no hay subtítulos; si se piden, el VOD debe tener transcripción). `cuts` deben caer dentro del clip, no solaparse y dejar tramos de al menos 0,3 s; `punch` admite `duration` de 0,3 a 3 s y `zoom` de 1,05 a 1,5; solo puede haber un `fadeIn` y un `fadeOut` (0,1 a 2 s). Los clips no pueden pasar de 3 minutos ni acabar después del final del VOD; lo que no cumple se descarta y se avisa.

## Siguientes fases
1. Conexión directa con Claude para generar el plan sin copiar y pegar.
2. Shorts de YouTube (pendiente de definir).
3. Solicitar las verificaciones de YouTube, TikTok e Instagram para publicar en público.
