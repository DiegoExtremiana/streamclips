# Publicar con el PC apagado (Fase 2, implementada en la v0.6)

Todo gratis. Lo que programas se sube a un repositorio **privado** de tu GitHub y GitHub Actions lo publica a su hora aunque tu PC esté apagado. Cuando se publica, se borra la copia de la nube; la copia de tu PC se conserva siempre.

## Cómo funciona

```
PC: render validado + programado ──► sube el mp4 como «release» del repositorio privado
                                └──► escribe queue/<vídeo>__<red>.json (hora, título, estado)
GitHub Actions (cron a cada hora con publicaciones + repaso cada 3 h):
   lee la cola ──► publica lo vencido en YouTube/TikTok/Instagram ──► marca «published» ──► borra el mp4 de la nube
PC (al abrir y cada pocos minutos): sincroniza estados; lo publicado aparece como Publicado en la Biblioteca
```

- **Cola**: un archivo JSON por publicación en `queue/`. Cada cambio de estado usa el `sha` del archivo (escritura condicional), así que dos ejecuciones nunca pisan la misma publicación.
- **Vídeos**: se guardan como assets de un release por publicación (máximo 2 GB por archivo en GitHub).
- **Programador**: el flujo `.github/workflows/publish.yml` lo genera y lo reescribe el programa (no lo edites). Pide ejecución justo después de cada hora en que hay algo programado y hace un repaso cada 3 horas por si alguna se retrasa. Solo una ejecución a la vez (`concurrency`).
- **Claves de tus redes**: se cifran en tu PC con libsodium (sealed box) para la clave pública del repositorio y se guardan como secreto `STREAMCLIPS_CREDS`. El token de GitHub se guarda cifrado en tu PC.
- **Publicador**: `resources/cloud/runner.js` (generado con `npm run cloud:build`), el mismo código de subida que usa el programa en el PC.

## Reglas que se mantienen

- Nunca dos publicaciones de lo mismo en la misma red: clave única `vídeo:red`; el estado «publishing» se escribe **antes** de llamar a la red; lo interrumpido pasa a «failed» y no se reintenta solo.
- El `Scheduler` local ignora lo que está en modo nube, así nunca publican los dos.
- Tras publicar: se borra el release (vídeo y miniatura) de la nube. Tu copia local no se toca.

## Puesta en marcha

1. En github.com crea un repositorio **privado** vacío (p. ej. `streamclips-nube`).
2. Ajustes > Developer settings > Fine-grained tokens: un token solo para ese repositorio con permisos **Contents, Workflows, Secrets y Actions** en «Read and write».
3. En StreamClips, Ajustes > «Publicar con el PC apagado»: pega `usuario/repositorio` y el token y pulsa Activar.
4. Conecta tus redes en Conexiones (las claves viajan cifradas al repositorio).

## Límites reales

- Repositorios privados: unos 2.000 minutos de Actions al mes en el plan gratuito (una ejecución de publicación dura pocos minutos).
- `cron` de GitHub no es exacto: puede retrasarse unos minutos (a veces más en horas punta).
- Las aprobaciones de las APIs (YouTube auditada, TikTok auditada, Instagram) hacen falta igual; la nube no las evita. Los tokens de Google en modo «Testing» caducan a los 7 días.
- **No probado contra GitHub real**: está verificado con un servidor GitHub simulado y el publicador ejecutado como proceso real; la ejecución real del flujo en Actions hay que comprobarla la primera vez (usa «Run workflow» a mano).
