# Revisión integral de los 34 scrapers — 6 de noviembre de 2026

> Esta tabla conserva los resultados de la auditoría `42295795690`. La comparación posterior con el proyecto Android, los cambios portados y la nueva auditoría `42298326175` se documentan en [porte-streamflix-reborn2.md](porte-streamflix-reborn2.md); no interpretar los resultados históricos de Zilla/CineHax como el estado actual de esas fuentes.

## Alcance y criterio

Se revisaron los **34 adaptadores** de `src/providers/` frente a los manifiestos Nuvio y Stremio, la capa compartida (`src/core/`) y las pruebas offline. Hay **32 activos**; `animebum` y `tukiplay` siguen inactivos. Los 34 compilan y tienen pruebas offline de sus rutas principales, pero los fixtures no demuestran disponibilidad real ni reproducción en un dispositivo.

La comprobación externa se ejecutó **desde GitHub Actions**, con **tres intentos por cada uno de los 32 activos**, un título de muestra por proveedor, límites de descarga y sin publicar URL firmadas ni cookies. Se distingue búsqueda/ficha/player de la petición al **HLS o MP4**. Un 403 del catálogo, una página 200 o una playlist 200 **no** demuestran ni bloqueo del vídeo ni reproducción. `medio-accesible` significa que al menos una muestra de un segmento/MP4 tuvo firma reconocible; no que la película completa funcione en Nuvio/Stremio, desde otra IP o para todos los títulos. Solo se propone retirar un proveedor cuando **todos** sus medios encontrados dan 403 en los tres intentos y no existen fuentes alternativas sin verificar.

## Mejoras implementadas

1. **Menos falsos positivos en los medios:** el extractor ya no recorta dominios como `a4.mp4upload.com` en falsas URL `https://a4.mp4`. Antes la auditoría de AnimeAV1 incluía dos falsos MP4 de este tipo en **cada** intento.
2. **HLS largo, sin descargas completas:** si una playlist supera 128 KiB, se pueden inspeccionar las primeras líneas completas y sondear sus fragmentos. Un 403 de una **selección parcial** de variantes o segmentos no justifica retirada. El 200 de un JSON o HTML deja de contar como vídeo; se exige firma de segmento MPEG-TS/MP4 o cabecera de audio AAC/ID3, y `ftyp` para MP4.
3. **Diagnóstico sin datos sensibles:** la auditoría registra host, estado y etapa del descubrimiento (`busqueda`, `ficha`, `player-api`, `posible-medio`), sin ruta, query, token ni cuerpo. Se amplió la detección de `/catalogo`, `/busqueda` y la puerta temporal de Nupload; no se confunde el 403 de una búsqueda con el de la media.
4. **Tarjetas y enlaces:** se prioriza el título real cuando dos tarjetas apuntan a la misma ficha pero la primera solo dice «Película». La resolución relativa conserva el path ante `?opcion=`, resuelve rutas `../` y no inventa un host cuando la base solo contiene `https://dominio`.
5. **Compatibilidad del bundle HDFull:** se eliminó el uso de `new URL` en su filtro de medios (no garantizado en QuickJS), manteniendo coincidencia estricta con el host y el path declarados para esa película.

Se regeneraron los **34 bundles**. Las pruebas incluyen regresiones para estas situaciones; no se añadió evasión de Cloudflare, reproducción inventada ni activación automática de proveedores.

## Inventario y observaciones desde Actions

La [auditoría final 42295795690](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42295795690), sobre `5eabaf1`, terminó correctamente: **32 proveedores × 3 = 96 intentos**. Cuatro tuvieron al menos un fragmento/MP4 de firma válida; **28 quedaron no concluyentes**. No hubo propuestas de retirada por 403 de medio. El conteo `a/b/c` indica cuántas URL HLS/MP4 se hallaron en cada intento; **0 no significa que el sitio esté caído**. La [auditoría diagnóstica previa 42295079665](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42295079665) sirvió para detectar playlists largas y falsos MP4 de nombres de host.

| Scraper | HLS/MP4 por intento | Resultado y mejora/seguimiento específico |
|---|---:|---|
| `animeav1` | 3/3/3 | **Medio accesible:** HLS MPEG-TS y MP4 `ftyp` 206; un HLS alternativo dio 404. Corregidos dos MP4 falsos por intento derivados de `mp4upload.com`. |
| `animeonlineninja` | 0/0/0 | Búsqueda y ficha 200; revisar la selección del episodio/DooPlayer para la muestra, sin asumir que el iframe sea medio. |
| `cine24h` | 0/0/0 | Búsqueda 200, sin ficha seleccionada para la muestra; verificar título y estructura de tarjetas antes del player. |
| `cinecalidad` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; verificar coincidencia y opciones DooPlayer actuales. |
| `cinehax` | 5/5/5 | **Medio accesible:** un HLS MPEG-TS 206 por intento. Otras variantes retornaron PNG de un CDN de anuncios (206) o 504: **no** contarlas como vídeo; priorizar la fuente válida sin fijar IDs efímeros. |
| `cuevana` | 0/0/0 | API de búsqueda 200, sin ficha seleccionada; revisar respuesta y filtro título/año/tipo con otra muestra. |
| `danimados` | 0/0/0 | Búsqueda, episodio y cuatro AJAX 200; se descubrió **un formato distinto de HLS/MP4** no auditado aquí. Revisar el hoster antes de afirmar reproducción. |
| `doramasflix` | 0/0/0 | GraphQL de búsqueda 403; bloqueo previo al vídeo, no criterio de retirada. |
| `embed69` | 2/2/2 | **Medio accesible:** segmento MPEG-TS 206 al sondear la playlist larga; segunda opción HLS dio 502. Mantener alternativas separadas. |
| `fanpelis` | 0/0/0 | REST de búsqueda 200, sin ficha seleccionada; contrastar el esquema y el título de muestra. |
| `flixlatam` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; contrastar tarjetas y título antes de modificar `dataLink`. |
| `gnulaone` | 0/0/0 | Búsqueda/ficha 200 y opciones de player consultadas, pero sin medio validado; no aceptar portada, publicidad ni enlaces de terceros como película. |
| `hdfull` | 0/0/0 | `search-route` 403 antes de llegar a `contentUrl`; conserva el filtro estricto que excluye el clip publicitario. No retirarlo por este 403. |
| `jkanime` | 0/0/0 | Inicio y búsqueda de respaldo 403; no se alcanzaron CSRF/episodio/medio. |
| `lacartoons` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; revisar catálogo y orden de paneles de temporada solo con una ficha confirmada. |
| `latanime` | 0/0/0 | Búsqueda 403 antes del episodio; no se probó el HLS/MP4. |
| `pelispedia` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; mantener excluidas las descargas aunque el player no responda. |
| `pelisjuanita` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; verificar título y episodios antes de resolver iframes. |
| `pelisflixhd` | 1/1/1 | Playlist Nupload 200 tras redirección `.win` → `.love`, pero **segmento HTML 200 de 63 bytes** en 3/3. No es reproducción ni 403 del medio. |
| `pelisforte` | 0/0/0 | Búsqueda 403; la puerta Byse/n1mwq tampoco tiene extractor verificado. No inventar una fuente. |
| `pelisgo` | 0/0/0 | Búsqueda 403/Cloudflare antes de llegar al player; no clasificarlo como medio bloqueado. |
| `playlatinsrc` | 0/0/0 | Embed personalizado 200, sin URL directa HLS/MP4; no entregar el iframe como vídeo. |
| `poseidonhd2` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; contrastar tarjetas y `__NEXT_DATA__` de una ficha real. |
| `repelis24` | 2/2/2 | Playlist Nupload 200 con **segmentos HTML 200 de 63 bytes**; Waaw agotó timeout. Se descubrieron dos candidatos por intento (antes tres); no se validó reproducción ni 403 de medio. |
| `repelisplus` | 0/0/0 | Ambas búsquedas dieron 403; bloqueo de descubrimiento, no de HLS/MP4. |
| `seriesflix` | 0/0/0 | Búsqueda y ficha 200 con redirección `.lol` → `.boats`; sin medio. Revisar selector de temporada/episodio/hoster en esa ficha. |
| `seriesturcas` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; contrastar títulos y episodios del catálogo actual. |
| `sololatino` | 0/0/0 | Búsqueda 403, sin player ni medio. No confundir con fallo de `dataLink`. |
| `tioanime` | 0/0/0 | Búsqueda 200, sin ficha seleccionada; comprobar el título de muestra y los episodios publicados. |
| `tioplus` | 0/0/0 | Búsqueda agotó tiempo de espera, sin ficha ni medio. No atribuirlo a un 403. |
| `tukiplay` | — | **Inactivo.** HLS 403/403/403 en [auditoría anterior 42168396452](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42168396452); no se reactivó ni se incluyó en los 32 activos. |
| `verpeliculasonline` | 0/0/0 | Búsqueda 403 en esta ejecución; firma histórica de Voe no garantiza acceso actual. No retirar por 403 de búsqueda. |
| `videoapi` | 1/1/1 | **Medio accesible:** HLS de Vimeos con segmento MPEG-TS 206 en 3/3 tras sondear la variante larga; conservar validación de ruta interna. |
| `animebum` | — | **Inactivo** como en el origen; el parseo `video[]` tiene prueba offline, sin auditoría en vivo ni motivo nuevo para activarlo. |

Los nueve casos con 403 de descubrimiento son `doramasflix`, `hdfull`, `jkanime`, `latanime`, `pelisforte`, `pelisgo`, `repelisplus`, `sololatino` y `verpeliculasonline`. **Ninguno acredita 403 persistente de HLS/MP4.**

## Próximos pasos priorizados

- **No desactivar por búsqueda/ficha 403.** Los proveedores bloqueados antes de llegar al medio necesitan rutas públicas confirmadas por cada sitio o una verificación posterior; probar con otra muestra puede ayudar. No interpretar la ausencia de streams como HTTP 403 del vídeo.
- **No afirmar reproducción de Repelis24/Gnula One.** En Repelis24 el HLS con segmentos HTML 200 y la alternativa Waaw con timeout siguen sin validar; Gnula no produjo HLS/MP4 para la muestra. No reemplazar por portada, publicidad, descarga o URL de iframe como si fueran vídeo.
- **Examinar por etapas los casos 200 sin fuente.** Comprobar título/año/tipo en la búsqueda, luego temporada y episodio exactos, después las opciones del player. Añadir fixtures de respuestas reales *sanitizadas* únicamente cuando se confirme un cambio de estructura, sin fabricar rutas o ejecutar JavaScript de terceros.
- **Evitar resultados de otro título:** el ranking común todavía puede aceptar un título homónimo con año diferente si no hay alternativa mejor. Añadir fixtures de remakes y años de estreno regionales antes de endurecer esa regla; no cambiarla a ciegas para los 34 adaptadores.
- **Aislamiento del servidor Stremio:** la cookie HTTP compartida en `src/core/http.js` vive a nivel de módulo; revisar el aislamiento entre solicitudes concurrentes y restringir de forma compatible los destinos de iframes/redirecciones antes de seguir enlaces de terceros. Son riesgos de diseño observados en el código, no incidentes confirmados por esta auditoría.
- **Ampliar muestras y pruebas en el runtime real** con autorización y red adecuada. Una sola muestra por proveedor, tres veces, no certifica catálogo completo; la compilación Node y el manifiesto HTTP tampoco prueban reproducción QuickJS/Nuvio.

Detalles del procedimiento: [`auditoria-medios.md`](auditoria-medios.md). Registro de interfaces de cada proveedor: [`providers.md`](providers.md).
