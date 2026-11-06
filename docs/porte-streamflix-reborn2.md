# Contraste con StreamFlix Reborn 2 (Android/Kotlin)

Revisión del [proyecto de origen](https://git.gay/streamflix-reborn2/streamflix) y de su [registro de proveedores](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers/Provider.kt), consultados el **6 de noviembre de 2026**. Se contrastaron los archivos actuales de proveedores/extractores con los 34 adaptadores de este repositorio; como inventario auxiliar se usó un [espejo Apache-2.0](https://github.com/sigmax711-collab/streamFlix) en el commit `5b1591a` (12 de octubre de 2026). **Ese espejo no sustituye el código actual**: el origen cambió después, especialmente en el commit `bd27baf` del 2 de noviembre.

## Alcance y decisión

STREAMFLIX2 es un paquete de plugins `getStreams(tmdbId, mediaType, season, episode)` para Nuvio/QuickJS y un addon Stremio; **no** implementa las pantallas de catálogo, almacenamiento ni reproducción Android del origen. Se compararon estas partes del árbol:

| Área del origen | Hallazgo para este proyecto | Decisión |
|---|---|---|
| `providers/Provider.kt` y proveedores VOD en español | Los 19 proveedores VOD españoles actualmente registrados en el origen ya tienen adaptador aquí: Fanpelis, PoseidonHD2, Cuevana, Latanime, Doramasflix, CineCalidad, SeriesFlix, SeriesTurcas, FlixLatam, LaCartoons, JKAnime, TioAnime, AnimeAV1, AnimeOnlineNinja, SoloLatino, Cine24h, Pelisplusto/TioPlus, PelisflixHD y CineHax. Este pack también conserva otros conectores propios. | Ajustar los contratos útiles, no duplicar proveedores con otro nombre ni activar backups retirados del registro. |
| `extractors/` y resolución de hosters | La capa común JS ya cubría Voe, MixDrop, StreamWish, JavaScript empaquetado **sin** `eval`, MovieMaster, Zilla, Nupload (con guardas) y otros. Faltaba el fallback público de Maxstream y reconocer varios alias de VidHide al descubrir enlaces. | Portar los casos verificables con fixtures y alcance limitado. |
| `CineHaxProvider.kt` | La web cambió de WordPress a rutas `/pelicula/{id}` y `/serie/{id}` con búsqueda AJAX. **La reproducción actual del origen sigue llamando a MovieMaster** con un ID TMDB. Nuestro adaptador ya usa ese ID directamente, sin pasar por un catálogo redundante. | No portar la UI/búsqueda HTML; sí mantener el contrato de MovieMaster. |
| `DoramasflixProvider.kt` | Se migró de `__NEXT_DATA__` a GraphQL (`searchAll`, `listEpisodes`, `links_online`, Fluxcedene). | **Ya implementado** en `src/providers/doramasflix/index.js` y cubierto por fixture. El 403 de su búsqueda visto en Actions es de descubrimiento, no del medio. |
| TV en vivo/IPTV (`CineCity`, `CableVisionHD`, `TvporinternetHD`, `IptvSpain`, `PlutoTV`, `Vavoo`, etc.) | Son listas de canales M3U/TV en vivo, aunque algunos se anuncien como `tvShows`. | No encajan con película/episodio TMDB y no se incorporan como si fueran series VOD. |
| Nuevos `FilmoProvider` y `euroStreamingProvider`, además de otros catálogos del registro | `Filmo` declara idioma **de**; `euroStreaming`, **it**. El resto de proveedores nuevos relevantes también es de otros idiomas o IPTV. | No añadir como VOD en español sin títulos, episodios y HLS/MP4 probados desde Actions. |
| `app/`, `navigation/`, `retrofit-jsoup-converter/`, `supabase/` y utilidades Android | WebView/Cronet, cookies de Android, navegación, Retrofit, interfaz y cuentas no se pueden copiar a un bundle QuickJS que solo expone `getStreams`. | Fuera de alcance; no ejecutar JS remoto ni convertir CAPTCHA/DRM en resultados de vídeo falsos. |

AnimeFLV, AnimeFenix y Sflix no aparecen en el **registro activo actual** del origen. No se añadieron como fuentes nuevas. La existencia de un archivo Kotlin o de un backup no constituye prueba de disponibilidad.

### Cruce de los 19 proveedores VOD españoles registrados en el origen

Los nombres Kotlin corresponden a archivos de [`providers/` del origen](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers); el ID JS remite al adaptador mantenido en `src/providers/<id>/index.js`. «Ya cubierto» significa contrato **offline** o estructura analizada, no vídeo comprobado para todos los sitios. Los resultados HTTP por sitio están en [la revisión de los 34 scrapers](revision-scrapers.md).

| Archivo Kotlin | ID JS | Contrato pertinente / decisión |
|---|---|---|
| `FanpelisProvider.kt` | `fanpelis` | REST `search`, `episodes`, `player` ya cubiertos; no ampliar la búsqueda estrecha sin evidencia de pérdida de títulos. |
| `PoseidonHD2Provider.kt` | `poseidonhd2` | `__NEXT_DATA__`, temporada/episodio y bridges ya cubiertos. |
| `CuevanaEuProvider.kt` | `cuevana` | FastAPI `/wp-api/v1/search`, `/single/episodes/list` y `/player` ya portados; preferencia Android de dominio dinámico no disponible en QuickJS. |
| `LatanimeProvider.kt` | `latanime` | `data-player` Base64 y episodio exacto ya cubiertos. |
| `DoramasflixProvider.kt` | `doramasflix` | GraphQL posterior a la migración, ya cubierto; la búsqueda ha dado 403 desde Actions. |
| `CineCalidadProvider.kt` | `cinecalidad` | Ficha/opciones DooPlayer ya cubiertas; muestra de búsqueda sin título coincidente. |
| `SeriesFlixProvider.kt` | `seriesflix` | Ficha/temporada/hosters ya cubiertos; redirección de dominio observada en Actions. |
| `SeriesTurcasProvider.kt` | `seriesturcas` | TV, elección de episodio y hosters conocidos ya cubiertos. |
| `FlixLatamProvider.kt` | `flixlatam` | Enlaces `dataLink` y resolución pública AES/PoW ya cubiertos; sin HLS de la muestra. |
| `LaCartoonsProvider.kt` | `lacartoons` | Panel de temporada/episodio exacto ya cubiertos. |
| `JKAnimeProvider.kt` | `jkanime` | AJAX, CSRF/cookies y hosters ya cubiertos; búsqueda bloqueada en Actions. |
| `TioAnimeProvider.kt` | `tioanime` | Lista de episodios y reproductores ya cubiertos. |
| `AnimeAv1Provider.kt` | `animeav1` | Índices Svelte SUB/DUB ya cubiertos; se ajustan las cabeceras de Zilla, sin afirmar solución del HLS 404. |
| `AnimeOnlineNinjaProvider.kt` | `animeonlineninja` | DooPlayer ya cubierto; WebView/Cronet de Android excluido. |
| `SoloLatinoProvider.kt` | `sololatino` | `dataLink`/Embed69 ya cubiertos; búsqueda bloqueada en la muestra de Actions. |
| `Cine24hProvider.kt` | `cine24h` | Episodio/Base64 ya cubiertos; resolver retos WebView Android no es portable. |
| `PelisplustoProvider.kt` | `tioplus` | Temporadas y episodio exacto ya cubiertos. |
| `PelisflixHdProvider.kt` | `pelisflixhd` | Ficha/servidor Base64 ya cubiertos; Nupload devuelve playlist, pero en Actions los segmentos fueron HTML. |
| `CineHaxProvider.kt` | `cinehax` | API MovieMaster por TMDB ya cubierta; no hace falta duplicar su nuevo catálogo HTML/AJAX. |

## Cambios trasladados

1. **Maxstream:** `src/core/extractors.js` acepta enlaces del host exacto `maxstream.video` y, si el embed responde **404** o no contiene una fuente, pide `/castv/{id}` y lee `script#m3u8`. Solo devuelve una URL **HTTPS** con extensión `.m3u8`; preserva el Referer de esa página. No reintenta una URL inventada a partir de un dominio parecido ni importa el mecanismo `UprotResolver` y su configuración cifrada. Adaptación independiente de [MaxstreamExtractor.kt](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/extractors/MaxstreamExtractor.kt).
2. **MovieMaster/CineHax:** las peticiones al embed, `/servers` y `/video` usan el mismo User-Agent Chrome 120 que los headers del HLS entregado al reproductor, como en [MovieMasterExtractor.kt](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/extractors/MovieMasterExtractor.kt). No se presupone que cambiar el UA convierta en vídeo una respuesta PNG/publicitaria.
3. **Zilla/AnimeAV1:** se conservan en el HLS el Referer del embed, Origin, Accept y User-Agent de [ZillaExtractor.kt](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/extractors/ZillaExtractor.kt); se omiten cabeceras de transporte/`Sec-Fetch-*` propias del navegador. Se toma el **último componente** del embed como ID (no el nombre de la ruta del player), y se corrige la conversión errónea de una URL ya `/m3u8/{id}` en `/m3u8/m3u8`. **La ruta de playlist sigue siendo `/m3u8/{id}`; esto por sí solo NO arregla un 404** y debe comprobarse desde Actions.
4. **VidHide:** se reconocen enlaces de hosters con dominios exactos usados como alias por [VidHideExtractor.kt](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/extractors/VidHideExtractor.kt), incluidos `minochinos.com` y `filelions.to`. La extracción final sigue sujeta a que la página declare un HLS/MP4 válido; reconocer un alias **no** significa que se reproduzca Danimados.

Los cambios se aplican a la capa común y se regeneran los **34 bundles**. Las pruebas offline de `tests/core.test.cjs`/`tests/providers.test.cjs` comprueban embeds válidos, fallback 404/200 sin fuente, no consultar dominios parecidos, descartar HTML/MP4 como HLS de `castv`, headers consistentes y URL Zilla ya directa. Se mantiene la convención de cabeceras/URLs de Stremio y la validación separada de bytes HLS/MP4 de `scripts/media-audit.cjs`.

## Lo que deliberadamente no se copió

- **Uprot y recursos cifrados:** el origen puede refrescar enlaces Maxstream con `UprotResolver`/`uprot.enc` o re-resolver archivos caducados. Un fallback público `castv` es distinto de descifrar secretos, suplantar sesión o fabricar una URL nueva; esa parte se omite.
- **Nupload permisivo:** el origen intenta extraer varias URLs de una página y seguir redirecciones. Nuestro extractor solo reconoce su puerta pública observada y acepta una redirección a HLS/MP4 del host observado. En la auditoría anterior los segmentos de PelisflixHD y Repelis24 fueron **HTML 200**, no vídeo. Ampliar el regex no corregiría eso.
- **WebView/Cloudflare:** AnimeOnlineNinja, Cine24h y otros usan WebView/Cronet de Android para retos. QuickJS no lo ofrece; no usar cookies/clearance ajenos ni afirmar que un HTTP 403 del catálogo demuestra un 403 del medio.
- **Otras lenguas, IPTV y DRMs:** no se añaden por cantidad de clases Kotlin. El contrato de este paquete está orientado a VOD en español con identificación TMDB/IMDb y medio verificable.
- **Falsos éxitos:** una playlist HLS 200 no basta; `scripts/media-audit-lib.cjs` comprueba variantes y firmas de segmentos (o firma MP4) sin descargar películas completas. Una ausencia de resultados queda **no concluyente**.

## Comprobación y atribución

`npm run check` compila los 34 bundles y ejecuta las pruebas offline. La comprobación real se hace exclusivamente desde **GitHub Actions**, con **tres intentos por cada proveedor activo** y distinción entre 403 de descubrimiento y 403 de HLS/MP4. Las pruebas con mocks no son prueba de reproducción en Nuvio ni de disponibilidad del hoster Maxstream.

[GitHub Actions 42298326175](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42298326175) auditó el código de `f1e0b32`: **32 proveedores × 3 = 96 intentos**, 34 bundles y **90/90 pruebas offline** entonces. Cuatro proveedores (`animeav1`, `cinehax`, `embed69`, `videoapi`) tuvieron **alguna** firma de medio válida; 28 fueron no concluyentes. **Cero proveedores cumplen el criterio de retirada por 403 de todos sus medios**. El test añadido después sobre el 403 de inicialización dejaba la suite entonces en **91 pruebas** (suite actual tras el [filtro de medios](filtro-medios-runtime.md): **106 pruebas**).

| Caso de interés | Resultado desde Actions | Consecuencia |
|---|---|---|
| AnimeAV1/Zilla | Se encontró la playlist, pero su **recurso HLS de inicialización dio 403/403/403** (Range y GET normal) para la muestra. Otros HLS y MP4 del mismo episodio devolvieron firma MPEG-TS/MP4 **206 en los tres intentos**. | No se considera reparado Zilla ni se elimina AnimeAV1 por un hoster fallido: conserva alternativas accesibles desde Actions. No equivale a reproducción completa en Nuvio. |
| CineHax/MovieMaster | Cinco URL HLS por intento. Hubo un segmento MPEG-TS **206 en uno de los tres intentos**; otras respuestas fueron PNG de publicidad, 504 o timeout. | UA coherente confirmado en el código; disponibilidad variable, sin afirmar mejora de reproducción por el cambio de UA. |
| Danimados/VidHide | Se consultó `minochinos.com` con HTTP 200, pero no se resolvió un HLS/MP4 de la muestra (un formato distinto no auditado). | Alias reconocido ≠ medio validado. |
| Repelis24/PelisflixHD | Playlists disponibles, pero segmentos **HTML 200 de 63 bytes**, no vídeo. | No ampliar falsamente los extractores Nupload. |
| Maxstream | Los títulos muestreados no expusieron ese hoster. | Fallback `/castv` probado con fixtures, **sin validación en vivo**. |

La auditoría sanitizada conserva hosts, firmas, estados y etapas, **sin publicar URL firmadas, tokens ni cuerpos**; ver también [procedimiento y criterio de retirada](auditoria-medios.md). No se retira un proveedor por 403 de su búsqueda o por un solo hoster cuando hay otros medios accesibles.

El origen está publicado bajo [Apache-2.0](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/LICENSE); este repositorio mantiene [LICENSE](../LICENSE) y [NOTICE](../NOTICE). Las reglas JS anteriores son adaptaciones de los archivos Kotlin enlazados, no una copia de código Android, activos cifrados o datos multimedia. Los nombres y servicios de terceros pertenecen a sus respectivos titulares.
