# Auditoría de medios HLS/MP4 desde GitHub Actions

Para ejecutar la auditoría en la rama que contiene el workflow, ve a **Actions → Validate Nuvio plugins → Run workflow** y escribe `audit-media` en el campo **provider**. Desde la CLI:

```bash
gh workflow run validate.yml --ref <rama> -f provider=audit-media
```

Si tu integración de GitHub no permite `workflow_dispatch`, el mismo job también se ejecuta al hacer push de un commit cuyo mensaje contenga `[audit-media]` a una rama cubierta por el workflow (por ejemplo `arena/**`). No se activa en los push ordinarios.

La acción compila los proveedores activos y ejecuta **tres intentos por proveedor**. Cada intento resuelve un título de prueba (sin necesitar clave de TMDB) y, **solo si obtiene URLs de HLS/MP4**, solicita una pequeña muestra de la playlist, sus variantes/segmentos (y clave AES-128 si la hubiera) o los primeros 4 KiB del MP4. Prueba GET con y sin `Range` si el host rechaza `Range` con 403; no descarga películas completas ni sigue controles de acceso o DRM. Los ejemplos de título por proveedor están en `scripts/media-audit.cjs`.

El artefacto `media-audit-3-attempts` contiene `media-audit.json` con los tres intentos, los estados HTTP del **medio** y un resumen. El job también publica `media-resumen` y fragmentos `media-datos-N-de-T` (JSON comprimido en gzip+base64), consultables mediante la API de *check runs* de GitHub si no se puede descargar el artefacto. No expone URLs firmadas, cookies ni claves. `discovery403` indica bloqueos *durante el descubrimiento* y **no** es criterio de retirada.

## Dos webs nuevas: Repelis24 y Gnula One

El job `audit-new-sites` se activa con `[audit-new-sites]` en el mensaje de un commit (o se puede ejecutar localmente con `node scripts/media-audit.cjs --provider repelis24` y luego `--provider gnulaone`, aunque la evidencia aquí se obtuvo **desde Actions**). Selecciona *Bram Stoker's Van Helsing* para Repelis24 y *Money Fight* para Gnula One, con **tres intentos por cada web**. Publica los resultados sanitizados en anotaciones `audit-new-<id>` del check run y en dos artefactos; no guarda URLs firmadas.

[Run 42290547535](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42290547535): Repelis24 encontró tres candidatos de medio por intento; una playlist HLS de Nupload respondió 200, pero los segmentos devolvieron **HTML (63 bytes, HTTP 200)** en los tres intentos. Las fuentes HLS/MP4 de Waaw expiraron por timeout, sin estado HTTP. Gnula One no produjo HLS/MP4 en ninguno de los tres intentos; las opciones `?trembed=N` de las fichas observadas habían redirigido a la portada. **No se validó reproducción de ninguno**; tampoco hay 403 del medio que justifique retirar uno por el criterio solicitado. Un 403 del formulario de búsqueda de Gnula no es un 403 de HLS/MP4.

Solo se propone `retirar-403` cuando **cada** intento encontró al menos un HLS/MP4, **todos** los medios encontrados fueron comprobados (máximo 6 por intento) y **todos** dieron 403 en la petición indispensable del vídeo. Si hay una fuente utilizable, otros formatos, 404, respuestas inciertas, demasiadas variantes, timeout o no se resuelve un título, se conserva el proveedor. El informe es una muestra de un título y de la IP de GitHub Actions, no una garantía para todos los títulos, regiones o dispositivos; la retirada de un proveedor debe revisarse antes de aplicarla.
