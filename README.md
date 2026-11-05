# STREAMFLIX2 — Nuvio Plugins

Repositorio de proveedores JavaScript para Nuvio. Los plugins se ejecutan localmente en el dispositivo y devuelven fuentes de reproducción; no son addons Stremio y no implementan catálogos ni metadatos.

## Desarrollo

- Node.js 20+
- `npm install`
- `npm test`
- `npm run build`

El build genera `dist/manifest.json` y `dist/providers/`, listos para publicar como repositorio de plugins estático (por ejemplo, GitHub Pages).

## Proveedores

- **AnimeAV1** — anime en español; busca por título y solo devuelve URLs HLS directas.

Consulta `providers/animeav1/README.md` para las limitaciones de identificación TMDB, temporadas y formatos.
