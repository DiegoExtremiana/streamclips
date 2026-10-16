# Editar de noche con el PC apagado (motor nocturno, v0.9)

Todo gratis. Cuando termina tu directo (normalmente sobre las 21:30), un flujo de **GitHub Actions** descarga el VOD, lo transcribe en castellano, lo analiza, monta los vídeos y los clips y los deja **programados** en tu repositorio privado de la nube (ver `NUBE.md`), que los publica a sus horas. Tu ordenador y el programa pueden estar apagados toda la noche.

## Cómo funciona

```
GitHub Actions (repositorio PÚBLICO tuyo, p. ej. streamclips-motor)
  cron cada 20 min de 20:00 a 04:59 (hora local) ──► engine.js --check
     «¿hay un directo terminado sin editar?»  (solo habla con Twitch y GitHub; si no hay nada, termina en segundos)
        sí ──► libera disco, instala ffmpeg + yt-dlp, compila Whisper (con caché) ──► engine.js
                 descarga el VOD ► Whisper (es) ► análisis de audio/voz ► resumen + vídeos + clips (ffmpeg)
                 ► elige hueco libre de las horas configuradas ► sube todo a la cola del repositorio PRIVADO
PC (cuando lo abres): trae lo que dejó el motor al calendario; lo puedes cambiar (nombre, descripción, hora, redes)
```

- **Repositorio público**: solo contiene código (`engine/engine.js`, el flujo `.github/workflows/motor.yml` y un `README`). Se usa público porque los minutos de Actions son **gratis e ilimitados** en repositorios públicos; en los privados solo hay ~2.000 min al mes y una noche de edición gasta casi todos. Ahí **no** se guardan vídeos ni claves: la configuración (Twitch, token de la nube, clave de IA, horas) va en el secreto cifrado `STREAMCLIPS_ENGINE` (libsodium, igual que `STREAMCLIPS_CREDS`).
- **Estado**: `engine/state.json` en el repositorio **privado** (directos hechos, intentos). Un directo se intenta como mucho 3 veces.
- **Los directos anteriores a la activación no se tocan**; los de menos de 10 min tampoco; un directo no se empieza hasta 3 min después de acabar.
- **Huecos de publicación** (Ajustes > Piloto automático): por defecto, **4 vídeos al día en YouTube** a las 08:00, 12:00, 16:00 y 21:30, y **3 clips al día** (10:00, 14:00, 19:00) en YouTube Shorts, TikTok e Instagram. Cada vídeo o clip ocupa el primer hueco libre (los que ya hay en la cola cuentan), así que si una noche salen más de los que caben hoy, pasan a los días siguientes. Por directo se crean `Vídeos por directo` (resumen + tramos destacados distintos) y `Clips por directo`.
- **Visibilidad**: lo automático sale con la visibilidad de Ajustes (por defecto **público**); puedes elegir privado para repasarlo antes.
- **Castellano**: Whisper se ejecuta con idioma `es` (un ajuste «detectar» antiguo pasa a `es`) y los títulos con IA piden castellano de España. Whisper no distingue variantes regionales.

## Puesta en marcha

1. Activa antes «Publicar con el PC apagado» (la cola privada) y rellena Twitch (id, secreto, canal) en Ajustes.
2. En github.com crea un repositorio **público** vacío (p. ej. `streamclips-motor`) y asegúrate de que tu token tiene acceso (Contents, Workflows, Secrets y Actions en «Read and write»).
3. Ajustes > «Editar de noche con el PC apagado»: repositorio y token > Activar.

El programa vuelve a subir la configuración solo cuando cambias algo (y cuando cambia el huso horario, por el horario de verano).

## Qué se puede cambiar de lo que crea el motor

Aparece en Programación (calendario → día) y en la Biblioteca como vídeo «en la nube»: nombre, descripción, lista, visibilidad, hora y redes. **No** tiene vista previa ni edición de imagen en el PC (el archivo solo existe en la nube) y, si quitas una red, **no se puede volver a añadir** (el archivo ya no estaría). Borrarlo lo quita de la cola.

## Límites y lo que NO se ha podido probar

- **Nada se ha probado contra GitHub, Twitch ni Actions reales**: solo con servidores simulados, ffmpeg real y un `whisper-cli` simulado. La compilación de whisper.cpp (`v1.8.4`), la instalación de ffmpeg/yt-dlp en la máquina de Actions y el flujo YAML (validado solo como sintaxis) no se han ejecutado.
- Twitch puede **rechazar descargas desde servidores de GitHub** o limitar la velocidad; yt-dlp no funciona con VODs solo para suscriptores.
- Cada ejecución de Actions dura como máximo **6 h** (se deja un margen de 5,5 h). Con Whisper `small` en 4 núcleos se estima ~1,5× tiempo real; si el directo es tan largo que no cabe, **se edita sin transcripción** (solo audio) para llegar a tiempo. Esa velocidad es una estimación, no una medida.
- Sin PC no hay **chat del directo** como señal (solo audio y voz).
- GitHub puede retrasar unos minutos las ejecuciones programadas y **desactiva los flujos de repositorios públicos sin actividad en 60 días**: el motor deja una marca mensual, pero no se ha podido comprobar que cuente como actividad. Si dejara de ejecutarse, reactívalo en la pestaña Actions del repositorio.
- Publicar sin el PC depende de que las claves de tus redes sigan vigentes: con la app de Google en modo «Testing» el acceso caduca a los 7 días y el token de Instagram a los 60. Abre el programa de vez en cuando para renovarlas.
- Cuota de YouTube (~6 subidas al día): 4 vídeos + 3 clips = 7, la pasa. Reparte con las horas de Ajustes o quita YouTube de los clips.
- Disco del ejecutor: ~14 GB libres de serie (se liberan ~25 GB más borrando software que no se usa); un VOD de 4 h a 1080p puede ocupar 10–12 GB. Descarga como máximo 1080p.
