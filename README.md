# STREAMFLIX2 — proveedores español/latino para Nuvio

Porte a JavaScript de los proveedores VOD en español de **Streamflix Reborn 2**, empaquetados para el runtime **QuickJS/CommonJS de Nuvio**. Incluye **24 conectores activos** y **AnimeBum deshabilitado**, porque también está inactivo en el proyecto de origen.

> **Estado:** paquete instalable para pruebas en una compilación sideloaded de Nuvio. La compilación de **25 bundles** y **43 pruebas offline** pasa localmente y en GitHub Actions ([run 42093101146](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42093101146)). El [run 41983509530](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/41983509530) confirmó descubrimiento real en CineHax y una firma de medio válida. Para VerPeliculasOnline, el [run 42081217613](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42081217613) decodificó el Voe de Van Helsing y validó la firma de su playlist HLS. Estas sondas no comprueban segmentos, audio ni reproducción dentro de Nuvio. Los demás dominios y la reproducción en la app **siguen sin verificar**; un proveedor puede cambiar su HTML o exigir Cloudflare sin previo aviso.

## Instalación

No hace falta instalar Node.js para usar los bundles ya generados.

1. Usa una compilación de Nuvio con soporte para plugins locales/sideloaded. Los plugins de Nuvio devuelven streams; **no son addons de Stremio, catálogos, listas IPTV ni proveedores de metadatos**.
2. Añade este manifiesto como repositorio de plugins:

   ```text
   https://raw.githubusercontent.com/noe359866-code/STREAMFLIX2/arena/e6074aa1-streamflix2/manifest.json
   ```

   Si el repositorio se publica en otra rama, cambia el segmento de rama en la URL. Nuvio descarga cada `filename` de forma relativa al manifiesto. **Actualmente el repositorio es privado**: para que esta URL funcione directamente en Nuvio hay que hacerlo público o alojar `manifest.json` y `providers/` en un servidor accesible. No uses URLs con tokens temporales; como alternativa, utiliza el servidor local descrito abajo.
3. **No necesitas añadir otra clave TMDB dentro de Nuvio en condiciones normales.** El runtime inyecta automáticamente `TMDB_API_KEY` con la clave efectiva de Nuvio: la personal si la configuraste o la predeterminada de la app si dejaste el campo vacío. Este repositorio no incrusta ninguna clave. CineHax usa directamente el ID recibido; el resto hace consultas propias a TMDB para obtener título, año, títulos alternativos e IMDb. La clave secreta solo es necesaria al ejecutar pruebas externas en Node/GitHub Actions, donde no existe el runtime de Nuvio.
4. Activa individualmente los proveedores que quieras probar. AnimeBum aparece intencionadamente deshabilitado.

### Servidor local opcional

Para servir el mismo manifiesto y los bundles durante una prueba:

```bash
npm ci
npm start
```

El servidor escucha en `0.0.0.0:3000` y publica `/manifest.json` y `/providers/*.js`. Desde otro dispositivo usa la IP de la máquina, no `localhost`. Para cambiar el puerto: `PORT=8080 npm start`.

## Cobertura

| Grupo | Conectores |
|---|---|
| Películas y series | CineCalidad, Cine24H, CineHax/MovieMaster, Cuevana 3, Fanpelis, FlixLatam, PelisForte, PelisGo, PelisflixHD, PoseidonHD2, SoloLatino y TioPlus/Pelisplusto |
| Películas solamente | HDFull y VerPeliculasOnline |
| Doramas | Doramasflix |
| Series solamente | Danimados (animadas), SeriesFlix, Series Turcas y LaCartoons |
| Anime | AnimeAV1 (solo TV), Anime Online Ninja, JKAnime, Latanime y TioAnime |
| Conservado inactivo | AnimeBum |

La fuente, el tipo admitido, el dominio y las limitaciones de cada uno están en [`docs/providers.md`](docs/providers.md).

### Estado de los conectores añadidos

- **VerPeliculasOnline:** solo películas. Busca en DooPlay, consulta las opciones mediante `admin-ajax.php`, conserva ESP/LAT/SUB y omite el tráiler. El extractor estático Voe F7 recupera `source` HLS, no ejecuta JavaScript del hoster y rechaza el MP4 de Big Buck Bunny y `direct_access_url` (`/download/`). La respuesta real y la firma HLS se comprobaron por separado; las URLs firmadas caducan y la reproducción en Nuvio no está verificada.
- **PelisForte:** películas y TV con selección exacta de temporada/episodio, carga AJAX de temporadas y expansión de `r.php`. Las páginas reales observadas llevan a Byse/n1mwq, cuya attestation de dispositivo, huella de navegador, PoW y configuración cifrada **no están soportadas** por el runtime actual. El fixture valida el recorrido con un player sintético, no un stream real de Byse; no se ha validado descubrimiento de medio real ni reproducción para este proveedor.
- **Danimados:** solo series animadas. Busca la ficha, exige el episodio exacto y ejecuta `doo_player_ajax` con `post/type/nume` y el Referer del episodio. Las cuatro opciones reales observadas (VidHide, Filemoon, Voe y StreamWish) pasan al resolvedor común; su disponibilidad depende del hoster. No declara películas porque la colección REST `movies` está vacía.
- **PelisGo:** películas y TV. Usa `/search?q=…`, conserva el slug devuelto y valida la temporada/episodio antes de leer servidores HTML/RSC. Mantiene latino/castellano/subtitulado y calidad, y excluye `/download/`, Pixeldrain y páginas embed como streams. Cloudflare impidió validar el player actual de extremo a extremo; el fixture cubre el contrato público, no compatibilidad en vivo garantizada.
- **HDFull:** solo películas. El contrato Astro demuestra `POST /search-route` y una ficha con `VideoObject.contentUrl` y un `<video>` específicos del título. Solo se acepta `/vod-movie/v1/{slug-de-la-ficha}.mp4` del mismo host; se rechaza el MP4 genérico/publicitario `cdn.zss90.pl/vod-video.mp4`. No hay fuente de episodio demostrada, por lo que TV devuelve vacío. La búsqueda y el medio dieron 403 desde Actions: la firma del `contentUrl` del título no está validada.

### Exclusiones deliberadas

CineCity/MAGISTV, CableVisionHD, TvporinternetHD, IptvOrg, IptvSpain, TvLibrefutbol, PelotaLibreTvHd, PlutoTV, Vavoo y otros proveedores de canales en vivo **no se convirtieron**: su contrato M3U/IPTV no corresponde al contrato de Nuvio basado en una película o episodio TMDB. AnimeFLV y AnimeFenix aparecen en backups antiguos, pero no en las registraciones activas usadas como alcance.

## Qué devuelve cada plugin

Cada archivo de `providers/` exporta:

```js
async function getStreams(tmdbId, mediaType, season, episode)
```

y devuelve únicamente candidatos con URL de medio validada (`.m3u8`, `.mp4`, `.mkv` o `.webm`), título, calidad, idioma, tipo y cabeceras cuando son necesarias. No se devuelven páginas `iframe` como si fueran streams. Se descartan DASH/MPD sin gestión DRM, enlaces de descarga y resultados cuya temporada/episodio no coincida.

Ejemplo de resultado:

```json
{
  "name": "CineCalidad",
  "provider": "cinecalidad",
  "title": "StreamWish · es-LAT · 1080p",
  "url": "https://cdn.example/playlist.m3u8",
  "quality": "1080p",
  "language": "es-LAT",
  "type": "hls",
  "headers": { "User-Agent": "Mozilla/5.0", "Referer": "https://player.example/" }
}
```

## Desarrollo y validación

Requisito: **Node.js 20 o superior**.

```bash
npm ci
npm run check       # compila 25 bundles + ejecuta las 43 pruebas offline
npm run build       # solo compila src/providers/*/index.js y manifest.json
npm test            # no hace peticiones externas
```

- `src/core/`: HTTP con timeouts, cookies por dominio, TMDB, comparación de títulos, HTML, Base64, AES/PoW y extractores.
- `src/providers/`: código fuente mantenible por proveedor.
- `providers/`: bundles CommonJS autocontenidos que carga Nuvio; no editarlos a mano.
- `src/manifest.json`: fuente del manifiesto.
- `manifest.json`: manifiesto generado para instalar.
- `tests/fixtures/`: respuestas sintéticas y una captura Voe minimizada para regresión; ninguna prueba offline accede a la red.

Las pruebas validan el recorrido TMDB → búsqueda → episodio → reproductor → medio para los 25 conectores, el formato del manifiesto, la ausencia de builtins de Node y utilidades como Base64URL, Voe F7 y su defensa contra vídeos de muestra, `__NEXT_DATA__`, datos Svelte, `dataLink`, AES-CBC/PoW y JavaScript empaquetado sin `eval`.

### Descubrimiento y reproducción reales

Son pruebas separadas y opcionales:

```bash
TMDB_API_KEY=... npm run test:live -- \
  --provider cuevana --tmdb 550 --type movie

TMDB_API_KEY=... npm run test:playback -- \
  --provider animeav1 --tmdb 37854 --type tv --season 1 --episode 1
```

- `test:live` ejecuta el conector contra las webs reales y cuenta los streams descubiertos.
- `test:playback` además solicita como máximo 4 KiB de hasta cinco resultados y comprueba la firma HLS/MP4/MKV/WebM. En HLS valida la playlist inicial, no cada variante ni segmento.
- Ninguna de las dos sustituye abrir el episodio en Nuvio y comprobar imagen, audio, idioma, subtítulos y duración. Tampoco debe contarse como reproducción una página embed renderizada en un navegador.
- Una lista vacía se informa como **sin resultados**, no como prueba concluyente de que el proveedor esté roto: también puede ser un título ausente, un bloqueo de red o anti-bot.

### GitHub Actions

El workflow **Validate Nuvio plugins** ejecuta `npm ci`, `npm run check`, valida el servidor y publica un artifact con el paquete instalable. Puede lanzarse manualmente con proveedor, ID TMDB, tipo, temporada, episodio y opción de playback; para proveedores que resuelven metadatos necesita el secreto `TMDB_API_KEY` del repositorio.

También se puede activar la prueba predeterminada de CineHax con un commit cuyo mensaje contenga `[live]`. Resultados:

- [Run 41983314335](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/41983314335): validación offline inicial correcta.
- [Run 41983509530](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/41983509530): validación offline y prueba real de CineHax correctas; al menos un stream descubierto y un medio con firma válida.
- [Run 42093101146](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42093101146): 25 bundles y 43 pruebas offline correctos con Danimados, PelisGo y HDFull registrados.
- [Run 42093805057](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42093805057): diagnóstico operativo; `TMDB_API_KEY` no está configurada en el repositorio, por lo que las pruebas end-to-end de los tres nuevos conectores no se ejecutaron. No es un resultado de catálogo ni de reproducción.
- [Run 42081217116](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42081217116): 22 bundles y 38 pruebas offline correctos tras añadir la regresión Voe.
- [Run 42081217613](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42081217613): sonda independiente del hoster Voe; título Van Helsing correcto, HLS HTTP 200, tipo `application/vnd.apple.mpegurl` y firma `#EXTM3U`. No es una ejecución completa del proveedor ni una prueba en Nuvio.

## Limitaciones conocidas

- Cloudflare/WebView, CAPTCHA y retos que exijan un navegador completo no se pueden resolver de forma fiable en QuickJS. Anime Online Ninja es especialmente dependiente de Cloudflare. PelisGo mostró verificación interactiva durante esta validación y HDFull respondió 403 a búsqueda/medio desde Actions; no se intentó eludir ninguno de los dos controles.
- Danimados solo declara TV; PelisGo admite película/TV; HDFull solo declara películas. Ninguno de los tres cambia de temporada ni sustituye un episodio ausente por otro. Sus recorridos offline están cubiertos, pero el `live-check` end-to-end externo no se ejecutó porque falta el secreto `TMDB_API_KEY` del repositorio; Nuvio usa la clave efectiva de la app, no ese secreto de CI.
- Las variantes modernas de Filemoon con attestation, hosters con JavaScript cambiante y enlaces DRM pueden no producir streams. En particular, Byse/n1mwq requiere attestation, fingerprint, challenge/PoW y configuración cifrada que este runtime no resuelve.
- El extractor Voe cubre el payload F7 observado el 5 de noviembre de 2026 y variantes HLS directas/Base64 anteriores. No ejecuta su loader, no garantiza variantes futuras y sus URLs firmadas pueden caducar o quedar vinculadas a la red que las obtuvo.
- Los demás desempaquetadores y selectores cubren las estructuras portadas de Streamflix, no cualquier variante futura de StreamWish, VidHide, MixDrop o Doodstream.
- Las cookies implementadas son una sesión HTTP mínima por dominio, no un navegador; algunos flujos Laravel/CSRF pueden seguir exigiendo WebView.
- Los sitios cambian de dominio con frecuencia. Actualiza la constante `BASE`/`API` del proveedor correspondiente y vuelve a ejecutar `npm run check`.

## Atribución y licencia

La lógica se adaptó de [Streamflix Reborn 2](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers) y de su snapshot Apache-2.0 accesible `theonlyhausofai-design/streamflix-reborn` (`ff970d39374acc6cbd5b482a50f5ff2867e60bf4`). La variante Voe F7 se contrastó con el extractor Apache-2.0 de [Kohi-den/extensions-source](https://github.com/Kohi-den/extensions-source/tree/main/lib/voe-extractor). La compatibilidad se contrastó con el runtime actual de Nuvio, no con plantillas Hermes antiguas.

Código bajo [Apache-2.0](LICENSE). Consulta [NOTICE](NOTICE). Los nombres y sitios de terceros pertenecen a sus respectivos titulares; este repositorio no aloja vídeos ni evita controles de acceso de pago o DRM.
