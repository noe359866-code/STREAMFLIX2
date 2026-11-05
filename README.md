# STREAMFLIX2 — proveedores español/latino para Nuvio

Porte a JavaScript de los proveedores VOD en español de **Streamflix Reborn 2**, empaquetados para el runtime **QuickJS/CommonJS de Nuvio**. Incluye **19 conectores activos** y **AnimeBum deshabilitado**, porque también está inactivo en el proyecto de origen.

> **Estado:** listo para instalación y pruebas en una compilación sideloaded de Nuvio. La compilación y **33 pruebas offline** pasan. Los dominios reales y la reproducción en dispositivos **no han sido verificados desde este entorno**. Un proveedor puede dejar de responder, cambiar su HTML o exigir Cloudflare sin previo aviso.

## Instalación

No hace falta instalar Node.js para usar los bundles ya generados.

1. Usa una compilación de Nuvio con soporte para plugins locales/sideloaded. Los plugins de Nuvio devuelven streams; **no son addons de Stremio, catálogos, listas IPTV ni proveedores de metadatos**.
2. Añade este manifiesto como repositorio de plugins:

   ```text
   https://raw.githubusercontent.com/noe359866-code/STREAMFLIX2/arena/cdfd952a-streamflix2/manifest.json
   ```

   Si el repositorio se publica en otra rama, cambia el segmento de rama en la URL. Nuvio descarga cada `filename` de forma relativa al manifiesto.
3. Configura `TMDB_API_KEY` en los ajustes de Nuvio. No hay ninguna clave TMDB incrustada en este repositorio. CineHax puede usar directamente el ID recibido, pero el resto necesita resolver título, año, títulos alternativos e IMDb mediante TMDB.
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
| Películas y series | CineCalidad, Cine24H, CineHax/MovieMaster, Cuevana 3, Fanpelis, FlixLatam, PelisflixHD, PoseidonHD2, SoloLatino y TioPlus/Pelisplusto |
| Doramas | Doramasflix |
| Series solamente | SeriesFlix, Series Turcas y LaCartoons |
| Anime | AnimeAV1 (solo TV), Anime Online Ninja, JKAnime, Latanime y TioAnime |
| Conservado inactivo | AnimeBum |

La fuente, el tipo admitido, el dominio y las limitaciones de cada uno están en [`docs/providers.md`](docs/providers.md).

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
npm run check       # compila 20 bundles + ejecuta todas las pruebas offline
npm run build       # solo compila src/providers/*/index.js y manifest.json
npm test            # no hace peticiones externas
```

- `src/core/`: HTTP con timeouts, cookies por dominio, TMDB, comparación de títulos, HTML, Base64, AES/PoW y extractores.
- `src/providers/`: código fuente mantenible por proveedor.
- `providers/`: bundles CommonJS autocontenidos que carga Nuvio; no editarlos a mano.
- `src/manifest.json`: fuente del manifiesto.
- `manifest.json`: manifiesto generado para instalar.
- `tests/fixtures/`: respuestas sintéticas; no son capturas de las webs reales.

Las pruebas validan el recorrido TMDB → búsqueda → episodio → reproductor → medio para los 20 conectores, el formato del manifiesto, la ausencia de builtins de Node y utilidades como Base64URL, `__NEXT_DATA__`, datos Svelte, `dataLink`, AES-CBC/PoW y JavaScript empaquetado sin `eval`.

### Descubrimiento y reproducción reales

Son pruebas separadas y opcionales:

```bash
TMDB_API_KEY=... npm run test:live -- \
  --provider cuevana --tmdb 550 --type movie

TMDB_API_KEY=... npm run test:playback -- \
  --provider animeav1 --tmdb 37854 --type tv --season 1 --episode 1
```

- `test:live` ejecuta el conector contra las webs reales y cuenta los streams descubiertos.
- `test:playback` además solicita como máximo 4 KiB de hasta cinco resultados y comprueba la firma HLS/MP4/MKV/WebM.
- Ninguna de las dos sustituye abrir el episodio en Nuvio y comprobar imagen, audio, idioma, subtítulos y duración.
- Una lista vacía se informa como **sin resultados**, no como prueba concluyente de que el proveedor esté roto: también puede ser un título ausente, un bloqueo de red o anti-bot.

## Limitaciones conocidas

- Cloudflare/WebView, CAPTCHA y retos que exijan un navegador completo no se pueden resolver de forma fiable en QuickJS. Anime Online Ninja es especialmente dependiente de Cloudflare.
- Las variantes modernas de Filemoon con attestation, hosters con JavaScript cambiante y enlaces DRM pueden no producir streams.
- Los desempaquetadores y selectores cubren las estructuras portadas de Streamflix, no cualquier variante futura de Voe, StreamWish, VidHide, MixDrop o Doodstream.
- Las cookies implementadas son una sesión HTTP mínima por dominio, no un navegador; algunos flujos Laravel/CSRF pueden seguir exigiendo WebView.
- Los sitios cambian de dominio con frecuencia. Actualiza la constante `BASE`/`API` del proveedor correspondiente y vuelve a ejecutar `npm run check`.

## Atribución y licencia

La lógica se adaptó de [Streamflix Reborn 2](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers) y de su snapshot Apache-2.0 accesible `theonlyhausofai-design/streamflix-reborn` (`ff970d39374acc6cbd5b482a50f5ff2867e60bf4`). La compatibilidad se contrastó con el runtime actual de Nuvio, no con plantillas Hermes antiguas.

Código bajo [Apache-2.0](LICENSE). Consulta [NOTICE](NOTICE). Los nombres y sitios de terceros pertenecen a sus respectivos titulares; este repositorio no aloja vídeos ni evita controles de acceso de pago o DRM.
