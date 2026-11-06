# Auditoría de medios HLS/MP4 desde GitHub Actions

Para ejecutar la auditoría en la rama que contiene el workflow, ve a **Actions → Validate Nuvio plugins → Run workflow** y escribe `audit-media` en el campo **provider**. Desde la CLI:

```bash
gh workflow run validate.yml --ref <rama> -f provider=audit-media
```

La acción compila los proveedores activos y ejecuta **tres intentos por proveedor**. Cada intento resuelve un título de prueba (sin necesitar clave de TMDB) y, **solo si obtiene URLs de HLS/MP4**, solicita una pequeña muestra de la playlist, sus variantes/segmentos (y clave AES-128 si la hubiera) o los primeros 4 KiB del MP4. Prueba GET con y sin `Range` si el host rechaza `Range` con 403; no descarga películas completas ni sigue controles de acceso o DRM. Los ejemplos de título por proveedor están en `scripts/media-audit.cjs`.

El artefacto `media-audit-3-attempts` contiene `media-audit.json` con los tres intentos, los estados HTTP del **medio** y un resumen. No expone URLs firmadas, cookies ni claves. `discovery403` indica bloqueos *durante el descubrimiento* y **no** es criterio de retirada.

Solo se propone `retirar-403` cuando **cada** intento encontró al menos un HLS/MP4, **todos** los medios encontrados fueron comprobados (máximo 6 por intento) y **todos** dieron 403 en la petición indispensable del vídeo. Si hay una fuente utilizable, otros formatos, 404, respuestas inciertas, demasiadas variantes, timeout o no se resuelve un título, se conserva el proveedor. El informe es una muestra de un título y de la IP de GitHub Actions, no una garantía para todos los títulos, regiones o dispositivos; la retirada de un proveedor debe revisarse antes de aplicarla.
