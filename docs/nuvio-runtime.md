# Compatibilidad investigada con Nuvio

La implementación se contrastó con `MMUU6699/nuvio`, commit `1cd5ad42ed9e2addbf1d9d9fe771efd1479fbfb7` (2 de noviembre de 2026), y con la documentación de integraciones de Nuvio. Las plantillas antiguas basadas solo en Hermes o manifiestos-array no se tomaron como referencia actual.

## Manifiesto

El repositorio publica un objeto JSON de nivel superior con `name`, `version` y una lista `scrapers`. Cada scraper necesita `id`, `name`, `version` y `filename`. Este pack también utiliza campos reconocidos por el parser actual:

- `supportedTypes`: `movie`, `tv` o ambos.
- `enabled`: permite conservar AnimeBum sin activarlo.
- `contentLanguage`: idiomas declarados/observados según conector; TuDorama incluye `es`/`en`, VixSrc `it`/`en` y WarezCDN inactivo declara idioma no verificado (`und`). No se infiere español de `lang=es` en la URL.
- `supportedFormats`: formatos que el código puede entregar.
- `description`: alcance y limitaciones visibles.

Las rutas `providers/<id>.js` se resuelven relativas a la URL del manifiesto.

## Distribución por jsDelivr

El mismo `manifest.json` y los bundles versionados pueden servirse desde:

```text
https://cdn.jsdelivr.net/gh/noe359866-code/STREAMFLIX2@main/manifest.json
```

No se necesitan rutas absolutas ni un manifiesto distinto: al resolver `providers/<id>.js` contra esa URL, Nuvio descarga los bundles del mismo repositorio y referencia del CDN. El repositorio debe ser público y la referencia debe estar publicada. `npm run nuvio:cdn` valida el paquete local y genera la URL; `npm run nuvio:cdn -- --ref HEAD --check` comprueba las descargas sin ejecutar el código remoto. Las pruebas offline no consultan jsDelivr.

Consulta [caché, versiones inmutables y diagnóstico](nuvio-jsdelivr.md). Esta distribución no cambia el runtime QuickJS ni sustituye el servidor HTTP del addon de Stremio.

## Entrada y salida

El runtime invoca la función asíncrona:

```js
getStreams(tmdbId, mediaType, season, episode)
```

Nuvio normaliza IDs `tmdb:`/`tmdb/` y los sufijos de episodio antes de llamar al scraper. Los adaptadores también toleran IDs prefijados y validan los números para evitar episodios por defecto incorrectos.

El runtime ejecuta `globalThis.TMDB_API_KEY = __get_tmdb_api_key()`, y ese binding devuelve `TmdbSettingsRepository.effectiveApiKey()`: la clave personal si existe o la predeterminada de Nuvio si el ajuste está vacío. Por tanto, los conectores usan automáticamente la misma clave efectiva que la app. **No reciben el objeto del catálogo ya cargado ni su título/año**: la firma solo contiene ID, tipo, temporada y episodio. Por eso los proveedores basados en búsqueda necesitan hacer sus propias consultas TMDB, aunque aprovechen la misma clave inyectada. VideoAPI y VixSrc trabajan directamente con el ID; WarezCDN (inactivo) utiliza los IDs documentados.

Los resultados siguen `PluginRuntimeResult`: `title`, `name`, `url`, `quality`, `language`, `provider`, `type`, `headers` y, cuando existen, `subtitles`. No se implementa catálogo ni metadata: ese no es el contrato de un plugin local de streams.

## Runtime

- Motor QuickJS y módulos CommonJS.
- `module.exports.getStreams` disponible en cada bundle.
- Timeout global del runtime de aproximadamente 60 segundos; las peticiones individuales tienen límites menores.
- `fetch`, URL, temporizadores, DOM/Cheerio, Base64 y utilidades criptográficas son proporcionados por bindings del host.
- `require()` solo admite las variantes Cheerio y `crypto-js`; cualquier otra dependencia debe quedar incluida en el bundle.
- Los bundles se compilan con esbuild en formato CJS, sin módulos `node:*`. `crypto-js` queda externo deliberadamente para AES/PoW.
- El bridge `fetch` expone status, URL final, cuerpo y cabeceras, pero no es un navegador completo ni proporciona por sí solo la sesión de cookies que necesitan ciertos flujos CSRF. El core implementa una cookie jar pequeña por dominio.

## Consecuencias para el porte

1. Kotlin/Retrofit/Jsoup no se copia literalmente: cada flujo se convierte a `fetch` y parsers JavaScript.
2. No se usa `eval` para JavaScript empaquetado.
3. No se devuelven embeds HTML como streams.
4. Las dependencias comunes se repiten dentro de cada bundle para que Nuvio no tenga que resolver imports relativos.
5. Los retos WebView/CAPTCHA/Cloudflare y DRM no se presentan como resueltos: requieren validación o quedan como limitación explícita.
