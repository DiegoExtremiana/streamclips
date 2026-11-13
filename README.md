# StreamClips

Programa de escritorio (Windows) para convertir tus VODs de Twitch en clips verticales, clips horizontales y vídeos largos 1920×1080, y programar su publicación.

## Novedades de la v0.28.0

Edición temática (fases 1 a 6 del plan de la v28):

- **Detector semántico de temas**: el piloto lee los mejores momentos y los tramos de charla con contenido y el modelo agrupa por significado (no por palabras repetidas) historias, bromas recurrentes y conversaciones que vuelven horas después. Cada tema trae categoría, participantes, confianza, motivo de la agrupación, si tiene desenlace y potencial (clip / largo / varios). Los de poca confianza se descartan.
- **Vídeos temáticos con fragmentos no consecutivos**: orden cronológico (como mucho un gancho al principio), contexto añadido a las piezas que lo necesitan, sin repeticiones, con transiciones (fundido en cada unión, efecto `joints`) y música/sonidos de la edición profesional. Si no hay material suficiente no se crea nada.
- **Ventana «¿largo o cortos?»**: solo cuando un tema sirve de verdad para las dos cosas. Muestra tema, contexto, motivo, fragmentos y sus horas, duraciones reales, número de cortos y la estructura. Si solo hay una forma buena, se hace sola. Las propuestas pendientes se guardan en `themes.json` y conservan sus transcripciones aunque el directo se borre (se vuelve a bajar al aceptar).
- **Sin duplicados**: las propuestas que se solapan con lo ya generado (más del 60 %) se descartan.
- Ajuste en Autopilot: «Vídeos por tema».

Pendiente para próximas versiones (fases 7 a 9): panel para revisar/corregir temas (renombrar, unir, separar, reproducir apariciones), memoria de temas entre directos y aprendizaje de tus decisiones.

## Novedades de la v0.27.0

- **Clips de tu canal por fin se valoran:** el fallo era que el programa intentaba medir el audio del clip como si fuera un vídeo y fallaba con «El archivo no contiene vídeo» en los 1.074 clips. Corregido y con prueba.
- **Los clips se valoran viéndolos y oyéndolos:** además de la transcripción, el modelo recibe 5 fotogramas del clip (gestos, pantalla, gags visuales). Un clip casi mudo pero gracioso ya puede tener nota. Si el modelo no admite imágenes, se valora solo con el texto.
- **El directo también se mira:** de los mejores momentos se sacan fotogramas del VOD y el modelo puntúa lo que se ve (gestos, pantalla, gags visuales); la nota visual sube o baja la nota del momento hasta 1,5 puntos y se descartan los momentos con la imagen muerta (pantalla de espera, menú). Se guarda para no repetirlo y se puede desactivar en Piloto automático.
- **El directo se borra solo después de usarse:** a la media hora del último vídeo o clip sacado de él, y solo si no hay nada en marcha (respeta «Borrar el directo completo al terminar»). Si hace falta de nuevo, se vuelve a bajar.
- **Vídeos por tema:** si hablas de lo mismo en varios momentos del directo, el modelo los agrupa y se monta un vídeo con esos momentos en orden (objetivo de unos 10 min, puede pasarse un 25 % o quedarse corto).
- **Efectos de sonido según lo que dices:** «ganamos» (fanfarria), «dinero» (moneda), «he muerto» (fallo), «explota» (explosión), «cuidado» (alerta), «shiny» (destello)… 11 sonidos generados con ffmpeg, sin derechos de autor. Puedes sustituir cualquiera dejando un archivo con su nombre (`tada.mp3`) en `%APPDATA%\StreamClips\Sonidos`.
- **Música lofi sin letra:** si el vídeo no tiene ya sonido de fondo (se mide en las pausas entre palabras), se añade una lofi generada según el tema (café, viaje, noche, charla, juego), siempre por debajo de las voces y agachándose cuando se habla. Tu propia música (`cafe.mp3`…) en `%APPDATA%\StreamClips\Música` manda sobre la generada.

## Novedades de la v0.26.0

- **Arreglo grave del audio:** en algunos vídeos, de repente un sonido se repetía en bucle hasta el final. Causa encontrada y reproducida: los tramos con efecto de sonido salían en **mono** y los demás en **estéreo**, y al unirlos sin recodificar el audio se corrompía. Ahora todo sale en estéreo y hay una prueba que lo vigila (audio con frecuencia creciente: si algo se repite, falla). Los vídeos ya montados con el fallo hay que volver a montarlos desde la Biblioteca.
- **Clips de tu canal:** la causa real del «0 valorados» de la 0.25.1 era que el aviso con el motivo se calculaba pero nunca llegaba a la pantalla. Ahora se ve qué clip y fase se está valorando, los segundos que tarda cada clip y cuánto falta. Se valoran **2 clips a la vez** (uno baja su audio mientras otro se transcribe) y las peticiones al modelo se espacian para no pasar el límite gratuito.
- **Documento de notas:** las notas de todos los clips se guardan en `Notas de clips.md` (nota, cada criterio, título, fecha y motivo), con botón «Abrir documento de notas». Las notas se conservan al actualizar el programa y al abrirlo no se vuelve a valorar nada ya valorado.
- **Editar clips sin el VOD:** en la Biblioteca se pueden reencuadrar (ventanas) y acortar usando el propio vídeo horizontal del clip, y **alargar o mover** el clip bajando de Twitch **solo el trozo necesario**, nunca el directo entero.
- **Análisis de directos:** cada análisis mide el tiempo de cada fase (lectura de audio y chat, transcripción, modelo, hablantes, títulos, montaje) y lo anota en el resultado y en `analysis-times.json` para ver qué conviene acelerar.
- **Espacio en disco:** nueva tarjeta en Ajustes, General: cuánto ocupa cada cosa y un botón «Liberar espacio» que borra los directos completos ya aprovechados y los temporales; vídeos, clips y transcripciones se conservan.
- **Código modularizado, sin cambiar el comportamiento:** los tipos compartidos pasan de un archivo de 770 líneas a `shared/model/*` (settings, jobs, library, channel, api, ipc, moments), los canales IPC a `electron/ipc/handlers/*` y la valoración de clips a `electron/app/wiring/`.

## Novedades de la v0.25.1

- **Los menús se parecen a los de Ajustes:** «Clips y publicación» (Clips de tu canal, Crear desde un VOD, Directos y actividad) y «Conexiones» (Estado y primeros pasos, Twitch, Redes sociales) pasan a un menú lateral con su explicación, y cada botón del menú principal lleva una línea que dice qué hay dentro. La Biblioteca y el calendario de Inicio mantienen sus interruptores de vista, que no son menús.
- **Clips: se ve por qué no se están valorando.** Aviso de lo que falta (Whisper), «En pausa: hay un directo en marcha…» y, si algún clip falla, cuántos y el último error.

## Novedades de la v0.25.0

- **Rúbrica objetiva para la nota.** Cada criterio (humor, se cuenta algo, puede ser viral, momento interesante) son **cinco preguntas** de sí / algo / no (2, 1 o 0 puntos); la nota del criterio es la suma (0 a 10) y la nota final, la media ponderada (humor 30 %, viral 25 %, interesante 25 %, se cuenta algo 20 %). El modelo solo puede dar un «sí» si cita una frase literal del clip; esa **prueba** y las 20 respuestas se ven en «Ver por qué, pregunta a pregunta». «Puede ser viral» mezcla su rúbrica (75 %) con tres cosas medidas en el clip (25 %): duración adecuada (8 a 45 s), que se hable pronto y el pico de volumen. La viralidad real no se puede medir de antemano: es una estimación con factores conocidos y nunca usa visualizaciones.
- **Arreglo importante:** si faltaba el modelo de Whisper, los clips llegaban sin texto y salían con «Se cuenta algo» en 0 sin consultar a la IA. Ahora, sin Whisper o sin su modelo, **no se valora y se avisa** en Clips con lo que falta; un clip casi mudo queda sin nota (con el motivo) en vez de con ceros.
- **Todos los clips se examinan de nuevo.** Las notas guardadas se descartan y se recalculan. Con una clave gratuita de Groq o Gemini, **el modelo lee todos los clips que tienen texto**, también los que no suben el volumen ni tienen risas (el humor de contraste y de «estupidez fingida» solo lo puede ver el modelo, no el volumen). Los clips que se valoraron sin clave se repiten con modelo en cuanto la hay.
- **Ajustes, por secciones y con menú lateral:** General (carpeta, herramientas, actualizaciones), **Inteligencia artificial** (la clave, con los pasos para conseguirla gratis), Piloto automático (qué prepara, cuánto, serie, horas y redes), Voz y subtítulos (Whisper, hablantes, vocabulario y subtítulos de lo automático), Mi estilo (tu perfil de edición, portadas automáticas y preferencias aprendidas) y PC apagado. Cada tarjeta guarda lo suyo sin pisar a las demás.
- **Perfil de estilo** (de la entrevista) integrado: silencios de 2 s como máximo, duraciones, música baja, titulares estéticos y el lore del canal.
- **Nueva sección Portadas en el menú izquierdo:** biblioteca de piezas (PNG, fondos, fotos y documentos) que se añaden arrastrando o eligiendo archivos, con el nombre que quieras (Diego_Sorprendido, Fondo_Ciudad), tipo editable, filtros y borrado con confirmación. Con ellas se **componen portadas de 1280x720**: fondo, pieza principal a la derecha, frase grande con contorno y número de episodio; la portada queda en la biblioteca.

Límites: la composición de portadas es manual; todavía no usa las piezas en las portadas automáticas ni busca material en internet.

## Novedades de la v0.24.2

- **La nota de cada clip sale de cuatro criterios**, cada uno de 0 a 10: **humor**, **se cuenta algo** (planteamiento y desarrollo), **puede ser viral** y **momento interesante**. La nota final es su media ponderada y va con una frase que explica por qué. No mira visualizaciones ni popularidad. Se ven en cada clip (barras) y, al abrirlo, con el desglose y el motivo.
- **Cómo se valora:** el programa baja el audio del clip, lo transcribe y mide la reacción en el volumen. Con una clave gratuita de Gemini o Groq (Ajustes, Piloto automático) **el modelo lee la transcripción y puntúa los cuatro criterios**; sin clave, o si el modelo falla, se calcula con lo que se oye y se dice (risas y subidón, hilo del discurso, reacción) y el clip lo indica. Sin modelo es una aproximación: detecta señales, no entiende el chiste.
- **Menú de clips rediseñado:** resumen (clips, valorados, destacados), barra de progreso de la valoración en segundo plano, barra de herramientas con búsqueda, orden y filtros (Todos, Sin añadir, En la Biblioteca, **Destacados**), y la búsqueda de otro canal integrada.
- **Orden ascendente o descendente** en cada caso: Fecha (más recientes o más antiguos primero), Nombre (A a Z o Z a A) y Nota (mejor o peor primero; los sin valorar quedan siempre al final).

Límites: las notas de la versión anterior se descartan y se recalculan poco a poco (cada clip se descarga y se transcribe, solo con el equipo libre); con el modelo gratuito hay límites diarios y, si se agotan, ese clip se valora por señales; los umbrales no están calibrados con tus clips reales.

## Novedades de la v0.24.1

- **Ordenar los clips** (pestaña Clips): por **Fecha** (por defecto, los más recientes arriba), por **Nombre** (de la A a la Z, sin importar tildes) o por **Nota** (de mayor a menor; los que aún no tienen nota quedan al final). La búsqueda por nombre sigue funcionando con cualquier orden.
- **La nota de cada clip se enseña** como dato individual (por ejemplo 8,4/10) en los clips de tu canal ya valorados; los de 8 o más siguen con el fondo dorado. Cambia lo dicho en la v0.24, donde la nota era interna. **La nota sigue sin depender de las visualizaciones.** En los clips de otros canales no hay nota, y por eso ordenar por Nota solo está disponible en tu canal.

Límites: la nota aparece cuando el programa ha analizado el clip, y el análisis en segundo plano va poco a poco (solo con el equipo libre), así que al principio muchos clips no tendrán nota; los umbrales siguen sin calibrar con tus clips reales.

## Novedades de la v0.24

- **Clips: buscar otros canales** (pestaña Clips): por defecto sale tu canal; escribe el nombre de otro canal de Twitch para ver sus clips de los últimos 12 meses y vuelve a tu canal cuando quieras.
- **Nota interna y fondo dorado**: el programa analiza los clips de tu canal en segundo plano (lo que se dice y la reacción en el audio, y con una clave gratuita de Gemini o Groq, la valoración del modelo) y les da una nota de 0 a 10 que **no se enseña**. Los que superan el 8 salen con el fondo dorado. **La nota no tiene en cuenta visualizaciones ni popularidad, solo el contenido.** Solo trabaja cuando no hay un directo en curso ni el Piloto está ocupado, y se puede apagar en Piloto automático.
- **Tamaño de cada ventana en la versión vertical** (editor de clips): arrastra la línea entre dos ventanas de la vista previa vertical (o usa las flechas del teclado, con Mayús para saltos grandes) y la otra ventana se adapta, como en el editor de clips de Twitch. También hay deslizadores de alto y ancho en el editor de diseño, además de las disposiciones predeterminadas.

Límites: los umbrales del dorado sin modelo de lenguaje **no están calibrados con tus clips reales** (se probó la lógica con datos sintéticos); el análisis en segundo plano transcribe cada clip y en tu equipo puede tardar, sin medir; la búsqueda de otros canales no analiza sus clips.

## Novedades de la v0.23

- **Revisar momentos** (Panel, en cada directo analizado): ves la nota de 0 a 10, el tipo, el motivo que dio el modelo y lo que se dice en cada candidato, también los que no entraron. Puedes **descartar**, **incluir** uno que se quedó fuera (aunque no llegue a la nota mínima), **ajustar dónde empieza y acaba** (minutos:segundos) y **añadir un tramo tuyo**. «Aplicar y regenerar» vuelve a montar los vídeos con tus cambios **sin volver a transcribir ni a preguntar al modelo** (usa lo guardado). Tus cambios se guardan aparte de la valoración del modelo y «Deshacer mis cambios» los quita.
- **Preferencias aprendidas** (Ajustes): cada vez que descartas un momento elegido o incluyes uno que no lo estaba, se anota por tipo (gracia, fail, reacción…). Con 3 decisiones o más de un tipo, su nota sube o baja un poco (0,25 por decisión, como mucho 1,5 puntos) en los siguientes análisis. Se ve, se apaga y se borra desde Ajustes, y la nota del análisis dice cuándo se ha aplicado.

Límites: lo aprendido solo viene de tus descartes e inclusiones (no de cuánto recortas ni de qué vídeos apruebas o borras); un momento añadido a mano dura entre 8 y 180 s; la ventana no tiene reproductor, se juzga por el texto, la nota y el motivo.

## Novedades de la v0.22

- **Hablantes (diarización local y gratuita)**: tras elegir los momentos, el Piloto automático identifica quién habla en lo elegido (modelo pyannote + embeddings 3D-Speaker con sherpa-onnx, todo en tu PC, ~0,2× tiempo real). Las voces se recuerdan **entre directos** en un «libro de voces»: puedes ponerles nombre, marcar cuál eres tú y unir dos voces que sean la misma, en Ajustes → Hablantes. Lo ya analizado no se repite.
- **Subtítulos por hablante**: cada voz tiene su color (la tuya, en blanco) y un cambio de hablante abre subtítulo nuevo. Con una sola voz en el vídeo no se colorea. La transcripción guardada no se modifica: los hablantes se aplican como capa aparte.
- **Nota mínima configurable** (3 a 9,5), nombres de momento usados como capítulos, transiciones con «whoosh» entre momentos separados, filtro de bucles de Whisper y modelo Gemini vigente (`gemini-3.5-flash-lite`).

Límites: los umbrales de voz **no están calibrados con audio en español de Discord** (solo se probó con una muestra de 4 voces, bien separada); si dos personas hablan a la vez, esas palabras quedan sin atribuir; el módulo nativo (opcional) y la descarga del modelo de ~40 MB (con comprobación sha256) no se han podido probar en Windows desde aquí. Si el módulo no está, el análisis sigue sin colores y lo avisa.

## Novedades de la v0.21

- **Selección inteligente de momentos** (Piloto automático, activada por defecto; necesita la clave gratuita de Groq o Gemini): en vez de fiarse solo del volumen, el chat y las palabras por segundo, se buscan más candidatos de los necesarios y un modelo de lenguaje lee la transcripción de cada uno y puntúa de 0 a 10 **humor, originalidad, interacción, reacción, contexto y si se entiende solo**, indica de qué tipo es (gracia, fail, reacción, discusión, historia, épico), dónde empieza y acaba de verdad la situación y por qué le pone esa nota. La nota final pesa los criterios y deja a las señales de audio y chat un 15 %.
- **Variedad, sin repetidos y sin relleno**: se resta nota al tipo de momento que ya se ha elegido, no entran dos tramos que hablan de lo mismo ni pegados, y **solo entra lo que llega a 6,5/10**. Si no hay suficientes momentos buenos el resumen sale más corto (por debajo de 2,5 min no se genera) y los clips son menos: «prefiero un vídeo de 7 minutos excelente a uno de 15 con relleno». Cada vídeo creado guarda su nota, su tipo y el motivo.
- Las valoraciones se guardan por contenido: al volver a analizar o regenerar un directo **no se vuelve a preguntar** por lo ya valorado. Si el modelo falla (clave, límite gratuito, red), se usa la selección por volumen y chat de siempre y se avisa en la nota. Sin clave todo funciona como antes.
- **Vocabulario de Pokémon y competitivo** incorporado (VGC, competitivo, locke, nuzlocke, speed tie, Trick Room, Archaludon, Pelipper, Torkoal…): no está en tu lista, así que no la pisa ni se desordena; corrige por sonido con un umbral más exigente y con correcciones exactas («be ge ce» → VGC), y se manda a Whisper solo cuando el título o el juego del directo parecen de Pokémon.

Límites: la calidad de la selección depende del modelo gratuito (no se ha medido con directos reales tuyos; las pruebas usan un modelo de mentira que comprueba la lógica, no el criterio); el juez solo ve texto, no imagen; no distingue hablantes (diarización pendiente); lo que más tarda sigue siendo transcribir, y ahora se transcriben más candidatos (hasta 2× lo necesario) para poder elegir entre ellos.

## Novedades de la v0.20

- **Análisis rápido** (Piloto automático, activado por defecto): el programa elige los momentos con el volumen del audio y el chat, y **solo transcribe lo elegido** (resumen, vídeos y clips) en vez de las horas del directo entero, que era casi todo el tiempo. Varios tramos se transcriben a la vez. La nota del directo indica cuántos minutos se transcribieron. Si lo desactivas, vuelve a transcribir todo antes de elegir (y los momentos también cuentan por lo que se dice). Límite: sin las palabras, la elección se basa solo en volumen y chat.
- **Mi vocabulario** (Ajustes › Piloto automático): lista de palabras propias (vienen Movidas, Marrshall, MovidasMarshall, Gorens y Reaptor) y correcciones «mal => bien». Whisper las recibe como pista al transcribir junto con de qué va el directo (título y juegos), y se corrigen las palabras que suenan casi igual (también en las transcripciones que ya tenías; lo guardado en disco no se toca).
- **Editar el texto de los subtítulos** (en cada vídeo o clip, sección Subtítulos): corriges las líneas y, si quieres, se vuelve a montar el vídeo. **El programa aprende**: cada cambio pequeño pasa a ser una corrección (y los nombres propios, vocabulario) que se aplica solo desde entonces.
- «Transcribir y poner subtítulos» ya no transcribe el directo entero: solo los tramos de ese vídeo.
- Capítulos con marca de tiempo en la descripción del vídeo resumen (YouTube los muestra si hay al menos 3 y duran 10 s o más).
- Arreglo: cancelar un análisis en Windows ya no falla al borrar el audio temporal (EBUSY).

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
