# Matriz de proveedores

Estado al **5 de noviembre de 2026**. “Fixture” significa que el recorrido completo se validó con respuestas sintéticas offline; no certifica que el dominio real responda hoy ni que el vídeo reproduzca. CineHax superó posteriormente una prueba real de descubrimiento y firma de medio en GitHub Actions; ningún conector ha sido probado todavía dentro del reproductor de la app Nuvio.

| ID | Nombre y dominio portado | Tipos | Manifiesto | Fixture | Implementación / limitación principal |
|---|---|---|---|---|---|
| `animeav1` | AnimeAV1 — `animeav1.com` | TV | Activo | ✅ | Índices Svelte `__data.json`, SUB/DUB; solo se declara TV en este pack. |
| `animeonlineninja` | Anime Online Ninja — `ww3.animeonline.ninja` | Película/TV | Activo | ✅ | DooPlayer `/wp-json/dooplayer/v1/post`; Cloudflare puede impedir la lectura. |
| `cine24h` | Cine24H — `cine24h.online` | Película/TV | Activo | ✅ | Episodios por par temporada/episodio y servidores Base64. |
| `cinecalidad` | CineCalidad — `www.cinecalidad.am` | Película/TV | Activo | ✅ | `data-option`; filtra trailers y páginas no reproducibles. |
| `cinehax` | CineHax/MovieMaster — `api.moviemaster.lat` | Película/TV | Activo | ✅ | ID TMDB directo, `PM_UI`, `/servers`, `/video`; conserva Referer HLS. |
| `cuevana` | Cuevana 3 — `cuevana.gs` | Película/TV | Activo | ✅ | `wp-api/v1`, lista de episodios y player por ID. |
| `doramasflix` | Doramasflix — `doramasflix.in` + Fluxcedene | Película/TV | Activo | ✅ | GraphQL, `links_online` y token opcional de FKPlayer. |
| `fanpelis` | Fanpelis — `fanpelis.to` | Película/TV | Activo | ✅ | REST `search`, `episodes`, `player`; compara números de episodio. |
| `flixlatam` | FlixLatam — `flixlatam.com` | Película/TV | Activo | ✅ | `dataLink`, JWT/Base64, AES/PoW y `go_to_playerVast`; omite descargas. |
| `jkanime` | JKAnime — `jkanime.net` | Película/TV | Activo | ✅ | AJAX con CSRF/cookies y `var servers`; hosters dependen del extractor. |
| `lacartoons` | LaCartoons — `www.lacartoons.com` | TV | Activo | ✅ | Selección por panel de temporada y “Capitulo/Capítulo N”. |
| `latanime` | Latanime — `latanime.org` | Película/TV | Activo | ✅ | `data-player` Base64 y episodio comprobado en la ficha. |
| `pelisflixhd` | PelisflixHD — `pelisflixhd.win` | Película/TV | Activo | ✅ | Reproductores `data-server` Base64. |
| `poseidonhd2` | PoseidonHD2 — `www.poseidonhd2.co` | Película/TV | Activo | ✅ | `__NEXT_DATA__`, latino/castellano/subtitulado y bridges de player. |
| `seriesflix` | SeriesFlix — `seriesflixhd.lol` | TV | Activo | ✅ | Solo series; `data-url` Base64. |
| `seriesturcas` | Series Turcas — `tbg.seriesturcastv.to` | TV | Activo | ✅ | Solo series; Vidmoly/Voe/Esprinahy y otros hosters conocidos. |
| `sololatino` | SoloLatino — `sololatino.net` + Embed69 | Película/TV | Activo | ✅ | `player-url`, XSRF, `dataLink`, AES/PoW y fallback IMDb Embed69. |
| `tioanime` | TioAnime — `tioanime.com` | Película/TV | Activo | ✅ | Verifica `var episodes`; usa únicamente Voe/YourUpload como el origen. |
| `tioplus` | TioPlus/Pelisplusto — `tioplus.app` | Película/TV | Activo | ✅ | URLs `season/{s}/episode/{e}` y `.bg-tabs` Base64. |
| `animebum` | AnimeBum — `www.animebum.net` | Película/TV | **Inactivo** | ✅ | Presente pero deshabilitado en Streamflix; `video[]` y pCloud. No activar esperando disponibilidad. |

## Resultado de validación

- Compilación esbuild/CommonJS: **20/20**.
- Export `getStreams`: **20/20**.
- Recorrido offline con fixtures: **20/20**.
- Suite completa: **33/33** pruebas.
- GitHub Actions, [run 41983509530](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/41983509530): **offline correcto; CineHax descubrió al menos un stream real y al menos un medio superó la comprobación de firma HLS/MP4/MKV/WebM**.
- Descubrimiento en los otros dominios reales: **no verificado**.
- Reproducción dentro de Nuvio/dispositivo: **no verificada**.

## Formatos y hosters

La capa común sigue iframes hasta dos niveles, interpreta declaraciones directas HLS/MP4, JavaScript Dean Edwards empaquetado sin `eval`, Streamtape, MixDrop, variantes directas de Voe, Zilla, pCloud y MovieMaster. Un nombre de hoster en esta lista no garantiza compatibilidad con todas sus variantes.

Se rechazan páginas HTML, DASH/MPD y URLs sin una extensión o patrón de medio reconocido. Filemoon con attestation moderno, CAPTCHA, WebView/Cloudflare, DRM y reproductores que exijan ejecución arbitraria de JavaScript quedan fuera del soporte garantizado.
