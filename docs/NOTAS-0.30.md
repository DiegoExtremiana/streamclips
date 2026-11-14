# Notas para la 0.30 (revisión del 14/11/2026)

## 1. Reorganizar el menú (cambio mayor → versión menor, `npm run check` completo)
- Separar «Clips y publicación» en **Twitch** (clips de tu canal + directos y actividad) y **Crear** (VOD, clip manual, JSON, recién creados). Quitar «y publicación».
- «Inicio» (id interno `programacion`) → **Calendario**; portada real aparte: qué se publica hoy, qué analiza la IA, cuota restante, clips con nota alta sin revisar.
- **Portadas** dentro de Biblioteca (Clips · Vídeos · Portadas). Unificar con `CoversStyleCard` de Piloto automático.
- Unir Conexiones + clave de IA en **Cuentas y claves** (Twitch, redes, IA). Ajustes se queda con lo que cambia el comportamiento.
- Ajustes: separar Almacenamiento de Actualizaciones; juntar subtítulos y estilo de títulos; «PC apagado» + motor en una sección **Avanzado**.
- Orden por uso: Calendario, Biblioteca, Twitch, Crear, Cuentas y claves, Ajustes.

## 2. Cosas que quedaron a medias
- Panel de temas: renombrar, unir, separar, reproducir apariciones (fases 7–9).
- Memoria de temas entre directos; aprendizaje de qué temas aceptas/descartas.
- Shorts de YouTube (sin definir).
- Diarización (el juez no distingue hablantes).

## 3. Mejoras
- Re-evaluación visible: contador («412 de 1.080, sigue mañana»), pausar, priorizar recientes.
- Vista «IA vs mi criterio»: correcciones y sesgo medio por estadística.
- Criterio propio por serie/juego (Nuzlocke, Trilocke) con etiqueta.
- Búsqueda y filtros globales (texto, nota, fecha, juego, estado de publicación).
- Tira de salud: clave caducada, Twitch desconectado, poco disco.
- Vistas previas de publicación por red (título, descripción, formato).
- Revisar las guías de claves con capturas reales (escritas de memoria).

## 4. Sin comprobar en el PC real
- Notas de Gemini con el criterio 0.29.3 (mirar `clip-scores.json` y `logs/app.log`).
- Animaciones en movimiento, audio repetido al saltar, visión con Groq.
- Pendiente de Diego: ejemplos de clips que sean un 9 y un 2; qué es «relleno».
