# StreamClips: estado tras la v0.32.4 y plan (14/11/2026)

Resumen para Diego, escrito tras repasar el programa entero. Lo que está hecho, lo que no se ha podido comprobar con datos reales y por dónde seguir para llegar a «un editor a nivel profesional» a partir de tus directos.

## 1. Qué es hoy el programa (mapa en una página)

Electron + React + TypeScript, ~27.000 líneas (sin contar 11.000 de pruebas). Tres capas:

| Capa | Dónde | Qué hace |
|---|---|---|
| Núcleo puro (sin disco ni red) | `shared/` | Criterios de clips y viralidad, selección de momentos, planes de montaje, subtítulos, layouts verticales, portadas, temas, música, agenda. Es lo más probado. |
| Servicios y dominio (Electron) | `electron/domain/`, `electron/services/`, `electron/app/` | Twitch (VODs, clips, chat), Whisper, ffmpeg, hablantes, modelo de lenguaje (Gemini/Groq) con texto e imagen, piloto automático, biblioteca, programación, redes (YouTube, TikTok, Instagram), nube (GitHub Actions), motor nocturno, base de datos CSV. |
| Interfaz | `src/` | Pestañas: Clips, Biblioteca, Programación, Conexiones, Ajustes; editor de portadas; editor vertical; ventana de cortar clips con reproductor y chat. |

El flujo de un directo (`electron/domain/autopilot.ts`): descarga del VOD → transcripción (completa o solo de lo elegido) → volumen + chat → candidatos → nota del modelo (texto) → nota visual (fotogramas) → tus correcciones y preferencias → selección sin relleno → hablantes → títulos → montaje (cortes de silencio, zooms, efectos de sonido, música lofi, subtítulos por voz, capítulos) → visto bueno o programación → publicación desde el PC o desde la nube → borrado del directo.

## 2. Qué está sólido y qué no (honesto)

**Sólido y probado automáticamente** (772 pruebas + 86 de interfaz real): núcleo de selección y montaje, programación, nube y publicadores contra servidores simulados, interfaz completa (clics reales), base de datos, cortador de clips, portadas.

**Hecho pero sin verificar con datos reales** (es lo que más riesgo tiene):
- Las tres redes sociales: nunca se ha conectado una cuenta real. En la 0.32.4 las claves de la app se comprueban contra las APIs reales (eso sí lo probé yo contra Google, TikTok y Meta el 14/11) y hay «Probar la conexión» y «Probar la nube» para que el primer uso real sea un diagnóstico y no una sorpresa.
- La nube y el motor nocturno nunca han corrido en un GitHub Actions real (solo simulado). «Probar la nube» es la primera comprobación real; hay que hacerla cuando tengas las redes.
- El chat del directo en «Cortar un clip» usa una consulta no oficial de Twitch, probada solo con datos de prueba.
- La calidad editorial (qué momentos elige, cómo corta, música, zooms) no se ha calibrado con tus directos: hace falta pasar 3 o 4 VODs tuyos y mirar lo que sale.
- El examen estricto de viralidad es nuevo (0.32.2): la etiqueta debe ser rara. Si no lo es, se endurece.

## 3. Código: qué mejorar para que sea modular y de buena práctica

Está razonablemente ordenado por capas y el núcleo es puro y testeable, pero hay deuda clara:

1. `electron/domain/autopilot.ts` (1.084 líneas, `process()` tiene 450): partir en fases con una interfaz común (`Fase { nombre, ejecutar(ctx) }`): transcripción, señales, candidatos, juicio, selección, hablantes, títulos, montaje, publicación, limpieza. Misma lógica, archivos de 100-200 líneas, cada fase con su prueba.
2. `src/library/ItemModal.tsx` (673) y `src/tabs/LibraryTab.tsx` (447): un componente por pestaña del modal (ya están las pestañas; falta sacarlas a archivos) y separar la cuadrícula, los filtros y las acciones.
3. `electron/app/context.ts` (378): terminar el cableado por módulo (`app/wiring/*`), que empezó en la 0.26.
4. `tests/e2e/gui-smoke.mjs` (~1.300 líneas, 86 comprobaciones en un solo archivo): partir por pestaña, con utilidades comunes, para poder lanzar una sola.
5. Convenciones ya en marcha y que hay que mantener: núcleo puro en `shared/`, servicios con dependencias inyectadas (por eso todo se prueba con servidores falsos), sin emojis ni flechas en la interfaz (iconos SVG), español de España en todo, mensajes de error que dicen qué hacer.

Regla para el refactor: nunca mezclar refactor con funciones nuevas en el mismo commit, y `npm run check` + e2e en verde antes de seguir.

## 4. Plan de versiones

- **0.32.x** (parches, ya): redes y nube (hecho en 0.32.4), ajustes del examen de viralidad según lo que veas, chat del cortador (buscar palabras, saltar a un mensaje, atajos).
- **0.33.0 – Orden**: refactor del piloto por fases, del modal y de los e2e (sin cambiar comportamiento). Interfaz: Inicio con el calendario del mes y arrastrar vídeos aprobados; piloto en tres modos (Manual / Asistido / Automático) en vez de muchas casillas; Cuentas dentro de Ajustes; Portadas dentro de Biblioteca; un resumen de una línea por bloque de Ajustes.
- **0.34.0 – Editor profesional**: con tus directos reales medidos: (a) ritmo de montaje por formato (planos de 3 s máximo en vertical, cortes de silencio a 2 s, gancho en los 3 primeros segundos elegido por el modelo); (b) portadas automáticas con tus piezas con nombre y títulos «de miniatura»; (c) capítulos y descripción como los canales grandes; (d) música y efectos según el momento; (e) separación de voz y juego (stems) solo en lo elegido; (f) vídeos largos de 10-15 min con estructura (gancho, desarrollo, remate) y no solo «los mejores tramos pegados».
- **0.35.0 – Aprender de los resultados**: leer las visualizaciones de lo publicado (YouTube Analytics es gratis; TikTok e Instagram dan datos básicos con las mismas apps) y usarlas para calibrar la viralidad y la selección. Es la «repercusión en tus redes» que pediste y lo que convierte el dorado en algo de fiar con datos tuyos.

## 5. Claude en lugar de Gemini o Groq

Es posible técnicamente (la capa de modelo es intercambiable: `electron/services/llm.ts`), y Claude daría mejor criterio de humor, narrativa en español y seguimiento de tu perfil. El problema es tu norma de «todo gratis»: la API de Anthropic no tiene cuota gratuita; se paga por uso (del orden de céntimos a pocos euros por directo, según el modelo). Lo que propongo: dejar Claude como proveedor opcional que solo se activa si pones una clave tuya, y usarlo primero donde más rinde y menos cuesta: el segundo examen de viralidad (pocos clips) y la decisión de estructura de los vídeos largos. Gemini/Groq seguirían para todo lo masivo. Lo implemento cuando tú lo decidas.

## 6. Qué necesito de ti para la siguiente fase

1. Conectar las tres redes siguiendo los pasos de Conexiones (unos 40 min en total) y pulsar «Probar la conexión» en cada una y «Probar la nube». Lo que salga mal lo arreglo con el mensaje exacto.
2. Pasar 3 o 4 directos tuyos por el piloto y decirme, de lo que sale, qué cortarías distinto, qué momento falta y qué sobra. Con eso calibro el editor; sin eso solo puedo mejorar a ciegas.
