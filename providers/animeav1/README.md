# AnimeAV1 — Nuvio provider

Proveedor de streams para Nuvio, escrito en JavaScript para el runtime de plugins. La lógica está adaptada del scraper Python compartido para AnimeAV1.

## Alcance

- Busca el título en el catálogo de AnimeAV1.
- Para series, consulta el JSON de la página y valida el número de episodio solicitado.
- Lee las referencias indexadas de `__data.json` de forma defensiva.
- Devuelve únicamente URLs HTTPS cuyo path termina en `.m3u8` o `.m3u`.
- Deduplica resultados y adjunta `Referer` y `User-Agent`.

## Limitaciones conocidas

1. Nuvio ejecuta plugins para obtener streams; no utiliza aquí `get_home`, `search` ni `get_tv_show` como APIs de catálogo.
2. La interfaz documentada de proveedores recibe un ID TMDB, tipo, temporada y episodio. El scraper original necesita un título. Este proveedor acepta título en `mediaInfo.title`/`mediaInfo.name` (quinto argumento) o un título textual en el primer argumento. Si Nuvio entrega únicamente un ID numérico, devuelve una lista vacía hasta conectar una resolución TMDB fiable.
3. `season` se recibe por compatibilidad, pero el sitio fuente identifica episodios por número y el scraper inicial no modela temporadas. No se inventa una conversión de temporada.
4. Los servidores que devuelven páginas de reproductor o enlaces de terceros no se convierten ni se resuelven. Solo se retornan HLS directos detectados en el JSON.
5. No se incluyen credenciales ni claves API.

## Prueba manual

En Nuvio, añade el manifest publicado y activa AnimeAV1. Para la prueba de desarrollo usa el Plugin Tester de una compilación compatible con plugins.
