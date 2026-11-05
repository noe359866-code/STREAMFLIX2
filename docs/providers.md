# Matriz de proveedores

Estado al **5 de noviembre de 2026**. “Fixture” significa que el recorrido se validó offline con respuestas sintéticas o, en la regresión Voe, una captura real minimizada; no certifica por sí solo que el dominio responda hoy ni que el vídeo reproduzca. CineHax superó una prueba real de descubrimiento y firma de medio. Para VerPeliculasOnline se comprobaron por separado las páginas/AJAX reales y la firma HLS del hoster Voe. Ningún conector ha sido probado dentro del reproductor de la app Nuvio.

| ID | Nombre y dominio portado | Tipos | Manifiesto | Fixture | Implementación / limitación principal |
|---|---|---|---|---|---|
| `animeav1` | AnimeAV1 — `animeav1.com` | TV | Activo | ✅ | Índices Svelte `__data.json`, SUB/DUB; solo se declara TV en este pack. |
| `animeonlineninja` | Anime Online Ninja — `ww3.animeonline.ninja` | Película/TV | Activo | ✅ | DooPlayer `/wp-json/dooplayer/v1/post`; Cloudflare puede impedir la lectura. |
| `cine24h` | Cine24H — `cine24h.online` | Película/TV | Activo | ✅ | Episodios por par temporada/episodio y servidores Base64. |
| `cinecalidad` | CineCalidad — `www.cinecalidad.am` | Película/TV | Activo | ✅ | `data-option`; filtra trailers y páginas no reproducibles. |
| `cinehax` | CineHax/MovieMaster — `api.moviemaster.lat` | Película/TV | Activo | ✅ | ID TMDB directo, `PM_UI`, `/servers`, `/video`; conserva Referer HLS. |
| `cuevana` | Cuevana 3 — `cuevana.gs` | Película/TV | Activo | ✅ | `wp-api/v1`, lista de episodios y player por ID. |
| `danimados` | Danimados — `danimados.cc` | **TV** | Activo | ✅ | Solo series animadas; episodio exacto y cuatro opciones `doo_player_ajax` reales. Colección `movies` vacía; extracción final depende de VidHide/Filemoon/Voe/StreamWish. |
| `doramasflix` | Doramasflix — `doramasflix.in` + Fluxcedene | Película/TV | Activo | ✅ | GraphQL, `links_online` y token opcional de FKPlayer. |
| `fanpelis` | Fanpelis — `fanpelis.to` | Película/TV | Activo | ✅ | REST `search`, `episodes`, `player`; compara números de episodio. |
| `flixlatam` | FlixLatam — `flixlatam.com` | Película/TV | Activo | ✅ | `dataLink`, JWT/Base64, AES/PoW y `go_to_playerVast`; omite descargas. |
| `hdfull` | HDFull — `hdfull.company` | **Película** | Activo | ✅ | `search-route` + `VideoObject.contentUrl`/`video` cuyo path coincide con el slug. Clip genérico/publicitario rechazado; TV no declarada. Firma del título sin validar por HTTP 403. |
| `jkanime` | JKAnime — `jkanime.net` | Película/TV | Activo | ✅ | AJAX con CSRF/cookies y `var servers`; hosters dependen del extractor. |
| `lacartoons` | LaCartoons — `www.lacartoons.com` | TV | Activo | ✅ | Selección por panel de temporada y “Capitulo/Capítulo N”. |
| `latanime` | Latanime — `latanime.org` | Película/TV | Activo | ✅ | `data-player` Base64 y episodio comprobado en la ficha. |
| `pelisforte` | PelisForte — `www2.pelisforte.se` | Película/TV | Activo | ✅ | ToroFilm, temporadas AJAX, episodio exacto y `r.php`. La cadena real Byse/n1mwq observada requiere attestation/fingerprint/PoW y no tiene extractor compatible; sin medio real validado. |
| `pelisgo` | PelisGo — `pelisgo.online` | Película/TV | Activo | ✅ | `/search?q=…`, slug devuelto, episodio exacto y servidores HTML/RSC con idioma/calidad. Descargas/Pixeldrain excluidos. Cloudflare impidió validar el player actual en vivo. |
| `pelisflixhd` | PelisflixHD — `pelisflixhd.win` | Película/TV | Activo | ✅ | Reproductores `data-server` Base64. |
| `poseidonhd2` | PoseidonHD2 — `www.poseidonhd2.co` | Película/TV | Activo | ✅ | `__NEXT_DATA__`, latino/castellano/subtitulado y bridges de player. |
| `seriesflix` | SeriesFlix — `seriesflixhd.lol` | TV | Activo | ✅ | Solo series; carga temporadas, desenvuelve `data-url`/`url=` y conserva el idioma. |
| `seriesturcas` | Series Turcas — `tbg.seriesturcastv.to` | TV | Activo | ✅ | Solo series; Vidmoly/Voe/Esprinahy y otros hosters conocidos. |
| `sololatino` | SoloLatino — `sololatino.net` + Embed69 | Película/TV | Activo | ✅ | `player-url`, XSRF, `dataLink`, AES/PoW y fallback IMDb Embed69. |
| `tioanime` | TioAnime — `tioanime.com` | Película/TV | Activo | ✅ | Verifica `var episodes`; usa únicamente Voe/YourUpload como el origen. |
| `tioplus` | TioPlus/Pelisplusto — `tioplus.app` | Película/TV | Activo | ✅ | Valida `seasonsJson`; URLs `season/{s}/episode/{e}` y `.bg-tabs` Base64. |
| `verpeliculasonline` | VerPeliculasOnline — `verpeliculasonline.net` | **Película** | Activo | ✅ | DooPlayer `admin-ajax.php`, ESP/LAT/SUB, sin tráiler/descargas. Decodifica Voe F7 y rechaza el señuelo Big Buck Bunny; HLS real validado a nivel de playlist, no de reproducción. |
| `animebum` | AnimeBum — `www.animebum.net` | Película/TV | **Inactivo** | ✅ | Presente pero deshabilitado en Streamflix; `video[]` y pCloud. No activar esperando disponibilidad. |

## Resultado de validación

- Compilación esbuild/CommonJS: **25/25**.
- Export `getStreams`: **25/25**.
- Recorrido offline con fixtures: **25/25**.
- Suite completa: **43/43** pruebas.
- GitHub Actions, [run 42093101146](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42093101146): **25 bundles y 43 pruebas offline correctos** con los tres nuevos conectores registrados.
- GitHub Actions, [run 42081217613](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42081217613): el Voe real de Van Helsing decodificó el título correcto; su `master.m3u8` respondió **HTTP 200**, `application/vnd.apple.mpegurl`, 690 bytes y `#EXTM3U`. No se comprobaron segmentos ni reproducción en Nuvio.
- GitHub Actions, [run 41983509530](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/41983509530): **CineHax descubrió al menos un stream real y un medio superó la comprobación de firma**.
- PelisForte: las páginas reales confirmaron búsqueda, ficha, temporada/episodio y puerta hasta Byse/n1mwq; **no se validó un stream real** y el player sintético del fixture no certifica compatibilidad con Byse.
- Danimados, [run 42085123168](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42085123168): búsqueda y episodio S02E03 reales, más cuatro respuestas `doo_player_ajax` reales. Esto valida la puerta del player, no por sí solo cada extracción de hoster ni reproducción.
- PelisGo: `/search?q=weapons` fue observable, pero el player posterior quedó en verificación interactiva de Cloudflare; no se resolvió el reto ni se afirma compatibilidad en vivo. `/api/source` devolvió 404 y no se usa.
- HDFull, [run 42088287982](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42088287982): DOM Astro completo de película/episodio y JavaScript público de búsqueda/player. La película declara un `contentUrl` específico; el episodio no declara fuente equivalente y el player usa un clip genérico/publicitario.
- HDFull, [run 42089237281](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42089237281): búsqueda y `contentUrl` respondieron **403** desde Actions, sin reintentos ni proxy de evasión. El clip genérico sí respondió como MP4 de **3.442.103 bytes** y queda explícitamente rechazado; su firma no valida el contenido de la película.
- Prueba end-to-end externa de Danimados/PelisGo/HDFull, [run 42093805057](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42093805057): **no ejecutada** porque `TMDB_API_KEY` no está configurada como secreto del repositorio; se comprobó antes de cualquier solicitud. Nuvio inyecta la clave efectiva de la app, pero no se afirma descubrimiento ni reproducción real para estos tres conectores.
- Salvo los casos enlazados, descubrimiento en los demás dominios reales: **no verificado**.
- Reproducción dentro de Nuvio/dispositivo: **no verificada**.

## Formatos y hosters

La capa común sigue iframes hasta dos niveles, interpreta declaraciones directas HLS/MP4, JavaScript Dean Edwards empaquetado sin `eval`, Streamtape, MixDrop, Voe, Zilla, pCloud y MovieMaster. Un nombre de hoster en esta lista no garantiza compatibilidad con todas sus variantes.

Para el payload Voe F7 observado se aplican transformaciones deterministas (ROT13, marcadores, Base64, desplazamiento e inversión) sin ejecutar el loader del hoster. Se prioriza `source`; `fallback` solo se usa si falta una fuente válida. `direct_access_url` se excluye por ser una descarga y cualquier medio de `test-videos.co.uk` se rechaza como señuelo. Las URLs firmadas caducan y pueden depender de la red que las generó.

Se rechazan páginas HTML entregadas como streams, incluidas rutas Byse `/e/….mp4`, DASH/MPD, el clip genérico/publicitario `cdn.zss90.pl/vod-video.mp4` y URLs sin una extensión o patrón de medio reconocido. Byse/n1mwq con attestation de dispositivo, huella de navegador, challenge/PoW y configuración cifrada queda fuera del soporte actual. Filemoon con attestation moderno, CAPTCHA, WebView/Cloudflare, DRM y reproductores que exijan ejecución arbitraria de JavaScript tampoco tienen compatibilidad garantizada.
