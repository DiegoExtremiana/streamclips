# Arquitectura propuesta del editor automático

Estado: propuesta para que Diego la revise antes de implementar. Los costes son órdenes de magnitud y hay que verificarlos antes de decidir.

## 1. Cómo funciona hoy
Descarga VOD, transcribe (whisper), mide audio (picos, risas, palabras de subidón), reúne candidatos, un modelo gratuito (Groq o Gemini) los puntúa y se eligen los mejores con variedad y sin relleno. Distingue voces (diarización), renderiza clips y vídeos con ffmpeg, subtítulos con color por voz, editor de ventanas verticales, revisión manual de momentos y preferencias aprendidas, y publicación programada.

## 2. Problemas y límites actuales
- El modelo solo ve texto: no ve la imagen (un fail del juego sin palabras pasa desapercibido).
- Una sola mezcla de audio: voz, juego y música juntos.
- Sin memoria del lore del canal ni del estilo (hasta ahora; el perfil de estilo es el primer paso).
- Montaje básico: cortes y subtítulos; sin transiciones, música ni efectos por momento.
- Calibración con VODs reales pendiente (umbrales, diarización en español con Discord).

## 3. Qué se conserva
Pipeline por fases con caché por contenido, selección sin relleno, revisión manual que no se pierde al regenerar, preferencias aprendidas, ffmpeg, diarización, editor de ventanas.

## 4. Arquitectura modular por fases
1. Perfil de estilo y lore (archivo editable; entrevista hecha).
2. Audio por pistas: voz principal, voces extra, fondo (separación por software, solo sobre momentos elegidos).
3. Análisis visual barato: cambios de escena y movimiento con ffmpeg; caras opcionales.
4. Selección (ya existe) alimentada por el perfil y el lore.
5. Plan de montaje: lista de decisiones (cortes de silencio a 2 s, planos de 3 s máx. en TikTok, transiciones, efectos, música baja) generada por reglas del perfil y, opcionalmente, por un modelo.
6. Ejecución determinista con ffmpeg a partir de ese plan; la vista previa es el mismo render.
7. Portadas: biblioteca de recursos nombrados, montaje de portada, búsqueda opcional de imágenes de licencia libre con su origen.
8. Revisión: el usuario corrige y eso actualiza perfil y lore.

## 5. Tecnologías (todas gratuitas salvo lo indicado)
- Transcripción: whisper local (gratis; lento en CPU).
- Separación de voz y música: Demucs o similar (gratis; varias veces la duración del audio en CPU, por eso solo en los momentos elegidos).
- Voces: sherpa-onnx (ya integrado).
- Visión: ffmpeg para escenas; modelos de caras en local si hace falta.
- Modelo de lenguaje: Gemini o Groq con cuota gratuita (límites por minuto y día; sirve para decenas de candidatos por directo).
- Música: bibliotecas libres (YouTube Audio Library, Pixabay Music) con su licencia anotada.

## 6. Claude como director creativo (solo evaluación)
- Idea: Claude lee el perfil, el lore y los candidatos y decide qué contar, en qué orden, con qué tono y qué efecto en cada momento; el programa ejecuta.
- Qué aporta frente a un modelo gratuito: mejor criterio de humor y de narrativa en español, y mejor seguimiento de un perfil largo.
- Límites: no ve vídeo directamente (se le dan texto, marcas de tiempo y descripciones de escena); no sustituye la calibración con tus VODs; la API es de pago.
- Coste aproximado (a verificar): un directo de 3 h son unos 40-50 mil tokens de transcripción; con candidatos filtrados y el perfil, unas decenas de miles de tokens de entrada y pocos miles de salida por directo. Con tarifas típicas de modelos de gama media sería del orden de céntimos a pocos euros por directo.
- Decisión pendiente de Diego: por tu norma de usar solo servicios gratuitos, la propuesta es construir todo con la interfaz de modelo intercambiable (Gemini/Groq ahora) y dejar Claude como opción que solo se activa si tú pones una clave y lo decides.
