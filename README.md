# STREAMFLIX2 — Nuvio Plugins

Repositorio de proveedores JavaScript para Nuvio. Los plugins de Nuvio se ejecutan localmente en el dispositivo y devuelven fuentes de reproducción; no son addons Stremio y no implementan catálogos ni metadatos.

## Desarrollo

- Node.js 20+
- `npm install`
- `npm test`

El primer proveedor es AnimeAV1. Solo se publicarán enlaces HLS directos (`.m3u8`) que el proveedor pueda entregar legítimamente; no se resolverán ni se extraerán reproductores de terceros.

Consulta `providers/animeav1/README.md` para configuración y limitaciones.
