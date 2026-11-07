# Revisión de `carlosfdezb/cuevana3` frente a STREAMFLIX2

**Fecha:** 2026-11-06. **Origen:** [`carlosfdezb/cuevana3`](https://github.com/carlosfdezb/cuevana3), commit [`64aa361f`](https://github.com/carlosfdezb/cuevana3/commit/64aa361f867e) de julio de 2022. **Decisión:** no portar el scraper HTML antiguo ni reemplazar el proveedor `cuevana` que ya tenemos. Sí se añadió un diagnóstico reproducible en GitHub Actions y se mejoró la muestra de su auditoría de medios. **No se cambió el comportamiento del proveedor de reproducción.**

## Comparación técnica

| Referencia de 2022 | Adaptador actual de STREAMFLIX2 | Decisión |
|---|---|---|
| `src/api.js` raspa `https://cuevana3.me/` con Cheerio/`cloudscraper`; el README todavía muestra URLs de `cuevana3.io`. Usa selectores `#aa-wp`, `.TPost` y `#top-single`. | `src/providers/cuevana/index.js` consulta `cuevana.gs/wp-api/v1/search`, `single/episodes/list` y `player`. La petición a `.gs` redirige actualmente a `cuevanas3.pro`, donde la API respondió con JSON. | No sustituir una API que funciona por selectores de otra web sin ficha/medio antiguo comprobable. El `fetch` actual sigue el 301; tampoco hace falta fijar otro dominio todavía. |
| `getLinks()` lee `iframe[data-src]` en `#OptL1..10`, `#OptE1..10`, `#OptS1..10` y los agrupa en latino, castellano y subtitulado. **Devuelve embeds, no HLS/MP4 directos.** | El API `player` trae idioma por embed; `resolveCandidates` resuelve hosters y `languageOf` conserva LAT/ESP/SUB. El filtro/auditoría comprueba los bytes del medio, no solo el iframe. | Idea reutilizable **solo si reaparece una ficha que emplee esos grupos**: mapear `L/E/S` a `es-LAT`/`es-ES`/`es-SUB`, resolver los iframes y auditar el HLS/MP4. No hay esa evidencia hoy. |
| `getDetail()` inspecciona temporadas `#season-N`; catálogo por género y actor. `src/api.js` importa `BASE_URL_EXTENSION`, pero `src/util/urls.js` **no lo exporta** (los IDs de tarjetas quedan vacíos). En episodios parte la URL por **`.io/` aunque el dominio configurado sea `.me`**, y algunos `.attr(...).replace(...)` no comprueban atributos ausentes. | Selección exacta de temporada/episodio mediante `single/episodes/list` y matching TMDB; el addon expone streams, no un catálogo de fichas/actores. | No copiar código frágil ni añadir endpoints de catálogo que el contrato de Nuvio/Stremio no utiliza. |
| Paquete MIT, con dependencias `request`, `cloudscraper` y `cheerio` de aquella época. | Bundles QuickJS/CommonJS de Nuvio y addon Node; extracción compartida sin navegador de terceros. | La licencia **MIT permitiría reutilización conservando copyright/licencia**, pero no se copió código del proyecto ni se añadieron esas dependencias. |

## Comprobación real desde GitHub Actions

En [Actions **42318391754**](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42318391754), `scripts/cuevana-reference-recon.cjs` consultó **tres veces por web** la portada, búsqueda y ficha antigua de `.me`/`.io`; y portada/API de `.gs` y del destino de su redirección `.pro`. No ejecutó JS ajeno, abrió iframes ni publicó cuerpos, tokens o URLs firmadas. Solo se siguieron redirecciones HTTPS entre estos cuatro dominios conocidos.

| Web | Tres intentos desde Actions | Qué permite concluir |
|---|---|---|
| `cuevana3.me` y `cuevana3.io` | En cada intento, `/`, `/page/1?s=Joker` y `/21711/joker` fallaron la verificación TLS de Node: `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. En la primera exploración de `.io` hubo además un timeout; la repetición final dio el mismo error TLS. | **No se pudo validar su HTML ni obtener un HLS/MP4 antiguo** desde el runner. No se desactiva TLS para simular acceso y no se declara que los medios den 403 ni que las webs estén caídas en todas las redes. |
| `cuevana.gs` | Portada y búsquedas redirigieron por 301 a `cuevanas3.pro` en los tres intentos. | El dominio configurado por el adaptador sigue su ruta de redirección HTTPS, distinta del HTML de 2022. |
| `cuevanas3.pro` | Portada HTML 200 sin los marcadores legacy observados en el código antiguo; API `search` 200 JSON **3/3**: `Joker` devolvió un resultado tipo `animes` (no la película) y `One Piece`, ocho resultados de tipos `movies`, `animes` y `tvshows`. | HTTP 200 de catálogo **no** prueba reproducción; la API actual sí es consultable para esta muestra. No se deduce que todo el catálogo o todos los títulos estén disponibles. |

La segunda fase del mismo [run 42318391754](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42318391754) usó el **proveedor que ya existía**, sin modificarlo, para *One Piece* T1E1. `scripts/media-audit.cjs --provider cuevana` resolvió **un HLS en cada uno de tres intentos** y verificó un **segmento MPEG-TS con HTTP 206 y firma válida en 3/3** (hosters de `vimeos.net`/`vimeos.zip`). Se auditaron segmentos, no solo playlist o página de búsqueda. **No se observó un 403 de HLS/MP4 que justifique retirar Cuevana**. Esto valida una muestra desde Actions, no la reproducción completa en Nuvio, Stremio ni el catálogo de películas. La muestra anterior (*Fight Club*) no encontraba medio y queda documentada como inconcluyente, no bloqueada.

## Cambios incorporados y límites

- Nuevo trabajo opcional `[audit-cuevana3]` en `.github/workflows/validate.yml`: tres intentos de estructura por web y tres intentos de HLS/MP4 del proveedor actual, con informes sanitizados y anotaciones consultables en Actions.
- `scripts/media-audit.cjs` selecciona *One Piece* para `cuevana` en lugar de la película *Fight Club*, dado el resultado observado y la cobertura anime del proveedor. **Es solo una muestra de diagnóstico; no altera el contenido que devuelve el plugin.**
- Tres pruebas offline del analizador de respuestas, incluida la separación explícita de un 403 HTML y un medio; suite actual: **109/109** y **34 bundles**. El analizador no comprueba HLS/MP4: ese trabajo corresponde a la auditoría de medios por separado.
- No se importó el scraper MIT, ni se cambiaron los 34 proveedores, ni se desactivó Cuevana. Para reconsiderar el parser antiguo se necesitarían TLS válido, fichas/episodios compatibles, match de título, hosters resolubles y **HLS/MP4 validados en tres intentos desde Actions**. Si hay 403 de una página, no basta: el criterio de retirada sigue siendo 403 **de todos los medios HLS/MP4 encontrados**, confirmado tres veces.

La [PR #10](https://github.com/noe359866-code/STREAMFLIX2/pull/10) permanece abierta y sin desplegar. Los resultados de esta revisión y de la auditoría anterior son muestras de red sujetas a cambios del sitio y de los hosters.
