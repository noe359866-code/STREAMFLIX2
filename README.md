# STREAMFLIX2 — Nuvio Plugins

Repositorio de proveedores JavaScript para Nuvio. Los plugins devuelven fuentes de reproducción; no son addons Stremio ni implementan catálogos independientes.

## Proveedores
- **AnimeAV1** — anime en español.
- **AnimeBum** — anime en español.
- **FlixLatam** — películas y series en español.

Los tres proveedores solo devuelven URLs HTTPS HLS directas (.m3u/.m3u8) detectadas en páginas o datos accesibles. No convierten páginas de reproductor/iframe en streams.

## Desarrollo
- Node.js 20+
- `npm install`
- `npm test`
- `npm run test:syntax`
- `npm run build`

El build genera `dist/manifest.json` y `dist/providers/`.

## Limitaciones
- La integración de búsqueda requiere que Nuvio entregue el título en `mediaInfo` o como primer argumento textual. Un ID TMDB numérico por sí solo no permite buscar títulos en estas fuentes sin una capa de resolución de metadatos.
- AnimeBum y FlixLatam están marcados como limitados: sus páginas pueden ofrecer solo reproductores externos y no HLS directo.
- FlixLatam no ejecuta desafíos PoW ni descifra payloads protegidos. Se aceptan únicamente enlaces HLS directos disponibles sin eludir controles de acceso.
- La temporada/episodio se utiliza solo cuando la estructura HTML permite identificarlo de forma explícita.
