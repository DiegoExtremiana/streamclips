# StreamClips

Programa de escritorio (Windows) para convertir tus VODs de Twitch en clips verticales, clips horizontales y vídeos largos 1920×1080, y programar su publicación.

## Novedades de la v0.19

- **Portadas con estilo** (Piloto automático › «Portadas con estilo…», activado por defecto): en vídeos y clips horizontales se elige, entre 6 fotogramas, el más vivo y contrastado, se le sube color y nitidez, y se escribe una frase corta (1 a 3 palabras, mayúsculas, contorno grueso, amarillo y blanco) a la izquierda dejando libre la derecha para la cara; en series, el número de día/episodio grande en la esquina. Sale en 1280×720. Si algo falla se usa el fotograma sencillo de siempre.
- **Ritmo de edición** algo más vivo: pausas a partir de 1 s, acercamientos de 1,15× más seguidos y más frases de énfasis.
- Referencias de estilo: Ibai, PokeAlexVGC, Sekiam, IlloJuan, Rubius (los dos canales) y ElXokas. Solo se han mirado las páginas públicas de sus canales (miniaturas, títulos, duraciones) para sacar rasgos generales; no se copia ninguna portada. Del montaje de sus vídeos no se ha analizado nada: el ritmo es un criterio, no una medición.
- El título de la portada sale del título del vídeo; la portada no detecta caras ni recorta al sujeto.

## Novedades de la v0.18

- **Varios directos a la vez** (Piloto automático › «Directos que se analizan a la vez», 1 a 4, por defecto 2): los núcleos se reparten, así que el total no acaba antes, pero ninguno espera a que termine otro. Cada directo de una serie recibe su «Día N» sin repetirse.
- **Tiempo estimado y barra de progreso** en cada análisis (por la velocidad real de avance y por la velocidad de Whisper medida en tu PC) y, al terminar, los tiempos por fase en la nota del directo.
- El volumen del audio se calcula a la vez que se transcribe.
- **Pausar y retomar**: un análisis en marcha se puede pausar («Pausar») y retomar cuando quieras («Reanudar»). La transcripción, que es lo que más tarda, se guarda por trozos de 20 minutos: al reanudar solo se hacen los que faltan. Si cierras el programa o se apaga el PC a mitad, el análisis queda «En pausa» (ya no «Error») y se retoma igual. Lo que no se aprovecha es el trozo que estaba a medias en ese momento (hasta 20 minutos de audio) y el montaje, que empieza de nuevo.

## Novedades de la v0.17

- **Volver a analizar siempre**: un análisis en marcha se puede cancelar («Cancelar») o reiniciar («Volver a analizar»), y si se cerró el programa a medias queda marcado como interrumpido y se puede repetir. Lo pendiente de revisión que sacó un análisis anterior se sustituye, no se duplica.
- **Limpieza al terminar**: cuando ya están los vídeos y los clips, el directo completo se borra del disco, junto con el chat y los datos que ya no sirven; se conservan los vídeos, los clips y sus transcripciones (solo los tramos que usan). Se desactiva en Piloto automático; «Liberar espacio» lo hace a mano. Si hace falta el directo más adelante, se vuelve a descargar solo.
- **Borrado tras publicar**: cuando un vídeo o clip ya está publicado en todas las redes en las que se programó (desde el PC o desde la nube), se borran sus archivos y el vídeo; queda el registro de lo publicado. Se desactiva en Piloto automático. Ojo: si lo programas solo a una red y luego quieres otra, ya no estará.
- **Acentos rotos** («D�A») en los títulos de directos descargados: yt-dlp se ejecuta ahora en UTF-8 y, si aun así llega un título roto, se conserva el de Twitch.
- **Transcripción más rápida**: decodificación voraz (en lugar de la búsqueda en haz de 5 de whisper.cpp) y varios trozos a la vez. La ganancia real depende del equipo.

## Novedades de la v0.16

(v0.16.2, **importante**: corregido el montaje con edición profesional, que con efectos de sonido seguía codificando todo el resto del directo en lugar de solo el vídeo pedido: por eso algunos análisis se quedaban «montando» durante horas sin crear nada. Ahora tarda lo que dura el vídeo.)

(v0.16.1: si compruebas actualizaciones justo al publicarse una versión, el programa explica que su instalador aún se está compilando en vez de decir que no hay versiones.)

- **Comprobador de directos** (Clips y publicación › Directos y actividad): tus emisiones de Twitch leídas en directo (se actualiza solo cada minuto y con «Comprobar ahora») en una cuadrícula con miniatura, fecha, duración y visualizaciones. Cada una muestra su estado en el programa (sin analizar, descargando, analizando, analizado…) y tiene un botón **Analizar**: descarga ese directo si hace falta y lanza el piloto automático **cuando tú quieras**, aunque lo tengas desactivado o no se recogiera solo. Un directo que aún está en curso se marca y se podrá analizar al terminar. *Probado con Twitch simulado; no contra tu canal real.*

## Novedades de la v0.15

- **Nuevo Inicio** (antes «Programación»): una sola pantalla, sin scroll general, con tres paneles alineados en horizontal: **cuadrícula de los últimos clips**, **cuadrícula de los últimos vídeos** (los que aún no tienen subida) y el **calendario**. Agarras una miniatura y la sueltas en un día —o en una hora exacta, con la vista «Línea de tiempo»— y se abre «Añadir subida» con ese día y esa hora para configurarla (redes, título, visibilidad…). Cada panel hace scroll por dentro si hay muchos.
- Aviso si ves «no se encontró ffmpeg.dll» al abrir el programa: es un fallo de la instalación local (instalación o actualización interrumpida, o un antivirus que movió el archivo), no del instalador, que sí lo incluye. Se arregla reinstalando con `StreamClips-Setup-X.exe` encima.

## Novedades de la v0.14

(v0.14.1: la transcripción bajo demanda es solo del tramo del clip o vídeo. v0.14.2: Whisper se compila con instrucciones de CPU fijas (AVX2) y con una versión básica de reserva, porque la anterior fallaba con «instrucción ilegal» en procesadores sin AVX-512; los errores de transcripción se muestran con su motivo real.)

- **Vista previa de los clips de Twitch**: ya no se queda cargando; la política de seguridad de la ventana no dejaba reproducir el vídeo que sirve Twitch desde su CDN (CloudFront).
- **Clips verticales con dos ventanas por defecto**: la cámara del streamer arriba y la pantalla debajo. Solo si mueves la barra «Recorte vertical» se usa una sola columna. Se retoca después en la Biblioteca.
- **Al abrir el programa** se revisa la Biblioteca: lo que sigue llamándose «Momento n», «Directo del…» o «Resumen del directo…» y no tiene nombre puesto por ti se transcribe (si hace falta) y se renombra según de qué se habla, incluidos los que ya existían.
- **Descripción de YouTube automática** (1 a 3 frases, unos 280 caracteres como máximo) para clips y vídeos, a partir de lo que pasa; con modelo de lenguaje la redacta él. No se pisa una descripción escrita por ti.
- **Modelos de Whisper a prueba de archivos dañados**: se comprueba la estructura del modelo al descargarlo y antes de usarlo; si está roto se borra y se baja de nuevo, y si aun así falla se usa el modelo «base» para esa transcripción.
- **Edición profesional automática** (Ajustes › Piloto automático, activada por defecto; también la usa el motor nocturno): corta pausas y tiempos muertos, acerca la imagen en las frases con énfasis con un golpe de sonido, pone un «whoosh» en cada salto de corte, fundidos y volumen parejo. Los sonidos se sintetizan con ffmpeg (sin archivos ni derechos de autor). Si algo falla, el vídeo se monta igualmente sin ella.
- **«Categoría: …» en cada clip y vídeo**: se guarda la categoría de Twitch del momento (Just Chatting, Pokémon Champions…), se ve en la Biblioteca y, en las descripciones que escribe el programa, va como última línea. También se rellena en lo que ya existía.
- **Se transcribe solo lo que hace falta**: al pedir subtítulos o un título sugerido, o al nombrar y describir lo que ya está en la Biblioteca, se transcribe únicamente el tramo de ese clip o vídeo (no el directo entero) y se guarda; lo ya transcrito no se repite.
- **Portafolio**: StreamClips y sus repositorios tampoco salen desde GitHub en vivo ni desde la caché del navegador.

## Novedades de la v0.13

- **Programación solo con lo esencial**: a la izquierda «Sin programar» (lo último, vídeos y clips, con «Aprobar» en lo que el piloto deja para tu visto bueno) y a la derecha el calendario; arrastras de uno a otro. El estado del canal y los primeros pasos pasan a **Conexiones**, y los directos recogidos y la actividad a **Clips y publicación › Directos y actividad**.
- **Los clips de tu canal cargan enseguida**: salen primero los de los últimos 90 días y el resto del historial sigue leyéndose en segundo plano; si Twitch falla a medias se conserva lo ya leído y se avisa, y si falla del todo se ve el motivo.
- **Nombres cortos también para lo que ya está en la Biblioteca**: botón «Nombres cortos» y, además, solo cuando llega una transcripción. No toca los nombres que escribes tú ni los que ya son cortos.
- **Publicar y editar con el PC apagado, preparados**: los repositorios ya vienen con el nombre puesto (`streamclips-nube`, privado, y `streamclips-motor`, público) y hay enlaces para crear el repositorio y el token ya con los permisos marcados. Solo falta que pegues el token.

## Novedades de la v0.12

- **Todos los clips de tu canal, en orden**: se piden a Twitch por tramos de 90 días con paginación (antes solo llegaban los más vistos de una semana) y se muestran del más reciente al más antiguo, con filtros «Todos / Sin añadir / En la Biblioteca» y búsqueda.
- **Clips y publicación reorganizada** en dos pestañas: «Clips de tu canal» y «Crear desde un VOD».
- **Panel inicial reordenado**: primero el estado de tu canal y los primeros pasos, después las próximas subidas y lo que está sin programar.
- **Nombres cortos automáticos** para clips y vídeos: de 2 a 5 palabras (máximo 40 caracteres) sacadas de lo que se dice en cada tramo, distintas entre sí dentro de una misma tanda; con un modelo de lenguaje configurado los redacta él con el mismo límite. Sin transcripción se queda en «Momento n».
- **Ajustes** dividido en subpestañas, **Biblioteca** con búsqueda y orden, e indicador de estado en **Conexiones**; la última subpestaña usada se recuerda.

## Novedades de la v0.11

- **Clips de tu canal de Twitch**: del más reciente al más antiguo, en cuadrícula con miniatura, con una **lupa** para buscar por nombre (sin distinguir mayúsculas ni tildes). Cada clip dice en tiempo real si está en la Biblioteca, preparándose o fuera (si lo borras de la Biblioteca vuelve a poder añadirse). **Pulsa un clip para verlo en el programa sin descargarlo ni añadirlo.**
- **Diseño vertical sobre el horizontal**: «Editar diseño» dibuja las ventanas encima de la versión horizontal (se arrastran y la esquina cambia su tamaño) y la versión vertical de la derecha se compone en directo mientras el vídeo se reproduce.
- **Línea de tiempo**: manteniendo el clic y moviendo, el tiempo del vídeo va con el ratón; al arrastrar un agarre se ve el fotograma de ese punto (hasta donde llega lo ya renderizado).
- **TikTok**: la guía de Conexiones explica el error «non_sandbox_target» (añadir tu cuenta en Sandbox > Target users del portal de TikTok).
- Los clips de Twitch se piden con la API (hasta 100) y la política de seguridad solo deja cargar imágenes y vídeo de los servidores de Twitch.

## Novedades de la v0.10.1

- **Subtítulos con el modelo de Whisper dañado** («Whisper terminó con código 3 … unknown tensor … failed to initialize whisper context»): el modelo ahora se descarga comprobando su huella SHA-256 (si llega corrupto se rechaza), y si Whisper no puede cargar el que ya tienes, el programa lo borra, lo descarga de nuevo y reintenta solo una vez. Si aun así falla, dice qué hacer (probar el modelo «base» en Ajustes).
- **Reproductor del editor de clips**: precarga completa, empuja el primer fotograma para que no se quede negro, muestra el motivo si el archivo no se puede reproducir (con «Reintentar») y la versión vertical del editor de diseño reutiliza el vídeo ya cargado en vez de abrir otro.
- Corregido un fallo intermitente en el avance de la transcripción cuando varias líneas de progreso llegaban juntas.

## Novedades de la v0.10

- **Editor de clips al estilo de Twitch**: la versión horizontal y la vertical se ven **a la vez**, con **sonido** y una sola barra de reproducción; debajo, la **línea de tiempo** con el recorte en morado y dos agarres que se arrastran (o se mueven con las flechas; Mayús = saltos grandes) y un margen del directo a cada lado para alargar el clip. «Aplicar recorte» vuelve a renderizar. «Editar diseño» abre la composición de 1–3 ventanas, que ya **se oye** al editar. *La vista previa de arriba solo contiene lo ya renderizado: lo que añadas fuera del clip se ve tras aplicar el recorte.*
- **Subtítulos en un paso**: si el directo no está transcrito, «Transcribir y poner subtítulos» lo transcribe aquí (descargando el modelo la primera vez) y graba los subtítulos. Dice con claridad qué falta (motor, modelo o transcripción).
- **Redes con su logotipo**: se iluminan con el color de la red si el vídeo se sube ahí y se apagan si no (ventana del vídeo, plan del día, «Añadir subida», calendario, línea de tiempo y Biblioteca).
- **Títulos automáticos**: los clips y vídeos creados a mano sin título reciben uno provisional según lo que se dice en el tramo (con IA si la configuras); botón «Sugerir título» en la ventana de cada clip. **Series**: en Ajustes > Piloto automático indicas «Minecraft extremo» y los vídeos de cada directo salen como «Minecraft extremo Día 1», «Día 2»… («- Resumen», «- Parte 2»…), y el tema va a la descripción. Si el título del directo ya dice «día 3», se usa ese número. El motor nocturno lleva la cuenta de los días.

## Novedades de la v0.9

- **Edición nocturna sin tu PC** (`docs/MOTOR.md`): al acabar tu directo, un flujo de GitHub Actions descarga el VOD, lo transcribe en **castellano de España**, lo edita durante la noche y deja vídeos y clips **programados**, aunque tu ordenador y el programa estén apagados. Por la mañana abres el programa y lo ves en Inicio. *No se ha probado contra GitHub/Twitch reales; límites en el documento.*
- **Programación automática por defecto**: 4 vídeos al día en YouTube (08:00, 12:00, 16:00, 21:30) y 3 clips al día (10:00, 14:00, 19:00) en YouTube Shorts, TikTok e Instagram; las horas y cuántos se crean por directo se cambian en Ajustes. Lo automático se programa solo (sin pedir visto bueno, configurable) y sale público (configurable).
- **Programación abre en calendario**: pulsa un día para ver su plan, con una sección de **Vídeos** y otra de **Clips**, con la hora y las redes de cada uno editables ahí mismo; pulsa un vídeo o clip para abrir todas sus características (nombre, descripción, lista, visibilidad, hora, redes…). Los clips ahora también tienen descripción y visibilidad.

## Novedades de la v0.8

- **Clip con pestañas Horizontal / Vertical**: la ventana de un clip separa sus dos versiones. Cada pestaña muestra su vídeo, su descarga y sus opciones; recorte, subtítulos y publicación siguen comunes.
- **Composición vertical de 1, 2 o 3 ventanas**: en la pestaña Vertical eliges cuántas ventanas quieres (cámara, juego, chat…) y arrastras cada recuadro sobre el vídeo del directo (la esquina cambia el tamaño; con el teclado, flechas y +/−). A la derecha ves **en tiempo real** cómo queda el vídeo 1080×1920 (puedes reproducir el vídeo para verlo en movimiento). Cada número de ventanas trae **disposiciones por defecto** (p. ej. «Cámara arriba», «Mitad y mitad», «Dos arriba y juego»…) que puedes elegir y luego mover. «Guardar composición» vuelve a renderizar el clip y la guarda con él; al reabrirlo la recuperas. Los clips anteriores se abren como una sola ventana equivalente a su encuadre de siempre.

## Novedades de la v0.7

- **Pestaña «Programación» (sustituye al Panel)**: una **línea de tiempo** con una franja por día y un **calendario** mensual con tus próximas subidas. Se arrastran con el ratón: horizontal = cambiar la hora (de 15 en 15 min), a otra franja o día = cambiar el día; Escape cancela. Los vídeos listos sin subida esperan en la bandeja «Sin programar»: arrástralos a un día y una hora. Clic en un bloque para editar la hora o quitarlo. Las subidas pasadas o en publicación no se pueden mover.
- **Vídeos y clips por separado**: los **vídeos largos solo se publican en YouTube** y los **clips en todas las redes** (lo exige también el back-end: pedir TikTok o Instagram para un vídeo se rechaza). En Programación se distinguen por color y etiqueta, se filtran (Todo · Vídeos · Clips) y la bandeja «Sin programar» los separa; el piloto automático ya programaba así.
- **Más intuitivo**: guía de «Primeros pasos» (se marca sola y lleva a cada ajuste), avisos breves tras cada acción, indicador en el menú, atajos Ctrl+1…5 y flechas en el menú, y la pestaña Clips ordenada.
- **Varias subidas al día, añadidas por ti**: «Añadir subida» (o arrastrando): eliges vídeo, redes y hora, tantas como quieras, también el mismo día. Avisa, sin impedirlo, si dos subidas a la misma red van a menos de 30 minutos o si pasas de ~6 subidas a YouTube en un día (cuota gratuita según la documentación). Cada vídeo se publica una sola vez por red.
- **Eliminar clips y vídeos** desde la Biblioteca: botón de papelera en la ficha, clic derecho, tecla Supr, desde la ventana del vídeo y selección múltiple. Siempre pide confirmación y explica qué pasa (borra todas las versiones y la miniatura, cancela lo programado, deja lo ya publicado en las redes y no toca el VOD de origen).
- **Back-end más robusto**: copia de seguridad automática de los datos (`data.json.bak`) con recuperación si se dañan; control de espacio en disco antes de descargar un VOD o montar un vídeo (con mensaje claro); borrado resistente a archivos abiertos en Windows; no se borra lo que la nube está publicando; errores no controlados al registro en vez de cuadros de error; el registro no se llena con el mismo fallo cada minuto sin internet.

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

- **Nada de esto se ha probado contra los servicios reales** (Twitch, Google, TikTok, Meta, GitHub, Hugging Face): solo contra servidores simulados que reproducen su protocolo. Tampoco el instalador ni la actualización automática en Windows, ni la ejecución real de los flujos de Actions (publicación y motor nocturno), ni Whisper con voz real (solo con un `whisper-cli` simulado).
- YouTube: mientras tu app de Google no esté verificada, los vídeos subidos quedan **privados** y la cuota es baja; en modo «Testing» el acceso caduca a los 7 días. TikTok: sin auditoría, los vídeos se publican privados. Instagram: necesita cuenta profesional y la app en modo desarrollo. TikTok puede rechazar la redirección `http://127.0.0.1`.
- Directos de 3–4 h: el análisis es por flujo (memoria constante) y se probó con vídeos sintéticos de 4 h, pero un VOD ocupa 6–15 GB en disco y Whisper en CPU puede tardar 1–3 h por directo.
- La cuota de YouTube (≈6 subidas/día) es la de la API gratuita estándar según su documentación; no se ha podido comprobar contra tu cuenta.
- Los vídeos largos solo se reeditan para cambiar subtítulos; los subtítulos quedan grabados en el vídeo.
- El instalador no está firmado (SmartScreen avisará).

## Qué se ha probado y cómo

`npm run check` ejecuta tipos, ESLint y 499 pruebas (ffmpeg real, yt-dlp, Twitch, redes, GitHub y Whisper simulados). `npm run test:e2e` abre la aplicación Electron real y maneja la interfaz (76 comprobaciones: reproductor con salto de posición, las dos versiones de un clip, descargas, arrastrar y soltar, programación, reinicio de la app…). En Linux: `xvfb-run -a npm run test:e2e`. `E2E_PACKAGED=<ejecutable>` prueba el paquete final.

**No se ha probado**: en Windows, ni contra Twitch real (yt-dlp real sí se ha probado con una URL local: acepta los parámetros que usa la app y devuelve el MP4), ni el instalador final `.exe` (aquí solo se pudo generar la carpeta de la aplicación para Windows; el instalador se genera en GitHub Actions).

## Instalar en Windows (sin terminal)

El instalador `StreamClips-Setup-x.y.z.exe` incluye ffmpeg, ffprobe y yt-dlp: no hay que instalar nada más. Se genera gratis con GitHub Actions: sube el proyecto a un repositorio de GitHub y ejecuta el flujo **Instalador de Windows** (pestaña Actions → Run workflow; o sube una etiqueta `v0.8.0`). Con una etiqueta `v*` el flujo publica además la versión en GitHub Releases, de donde los programas instalados se actualizan solos. También se puede generar en un Windows con `npm install` y `npm run dist` (el resultado queda en `release/`).

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
