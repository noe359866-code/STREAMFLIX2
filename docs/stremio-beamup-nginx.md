# Addon de Stremio · Beamup + Nginx externo

Este repositorio incluye, junto al pack de plugins para Nuvio, un **addon completo de Stremio** (`org.streamflix2.es`) preparado para:

1. **Despliegue directo en Beamup desde la raíz** (`beamup` / `git push beamup master` / GitHub Actions) mediante `Procfile` y `npm start`, manteniendo intactos `manifest.json` y `providers/*.js` en la raíz para Nuvio.
2. **Servidor Nginx externo separado** (`nginx/`) que actúa simultáneamente como:
   - **Reverse-proxy y caché** delante de la instancia en Beamup (respetando SNI TLS `proxy_ssl_server_name on` y la cabecera `Host` requerida por los nodos Swarm de Beamup).
   - **Proxy dinámico de cabeceras y playlists HLS (`/hlsp/…`)** para reproductores como Stremio Web, iOS y Smart TV cuando un hoster exige `Referer`/`Origin`, sin consumir ancho de banda de vídeo dentro de Beamup.

---

## Arquitectura

```text
Stremio (PC / Android / Web / Smart TV)
   │
   ├── Modo directo (predeterminado):
   │     ├── /manifest.json y /stream/...  ──► Beamup (o Nginx externo ─► Beamup)
   │     └── Vídeo (.m3u8 / .mp4)          ──► CDN directo con behaviorHints.proxyHeaders
   │
   └── Modo Proxy Nginx o Dual (configurable en /configure):
         ├── /manifest.json y /stream/...  ──► Nginx externo (caché) ──► Beamup
         └── Vídeo con Referer/CORS        ──► Nginx externo (/hlsp/...) ──► CDN de vídeo
```

- **Sin `TMDB_API_KEY` obligatoria:** cuando Stremio solicita un ID de IMDb (`tt0137523`, `tt0903747:2:3`), el addon resuelve automáticamente título, año, alias y `moviedb_id` mediante **Cinemeta** (`v3-cinemeta.strem.io`), alimentando tanto a `CineHax` como a los proveedores basados en búsqueda.
- **Con `TMDB_API_KEY` opcional** (en secretos de Beamup o en `/configure`): añade títulos localizados en español (`es-MX`), títulos alternativos adicionales y soporte directo para IDs `tmdb:…`.
- **Concurrencia aislada:** las peticiones simultáneas de distintos usuarios comparten caché LRU de metadatos y aíslan su configuración mediante `AsyncLocalStorage`, evitando colisiones en `globalThis.TMDB_API_KEY`.

---

## 1. Prueba local del Addon de Stremio

```bash
npm ci
npm start
```

Por defecto escucha en `0.0.0.0:7000` (configurable con `PORT`):

- Panel de configuración e instalación: `http://127.0.0.1:7000/configure`
- Manifiesto Stremio: `http://127.0.0.1:7000/manifest.json`
- Estado de salud: `http://127.0.0.1:7000/health`
- Manifiesto Nuvio conviviente en el mismo servidor: `http://127.0.0.1:7000/nuvio/manifest.json`

Para iniciar el servidor estático clásico exclusivo de Nuvio en el puerto `3000`:

```bash
npm run start:nuvio
```

---

## 2. Despliegue en Beamup

El hash SHA-256 de Beamup para la cuenta `@noe359866-code` y proyecto `streamflix2` ya está precalculado en las configuraciones:

- **Dominio en Beamup:** `https://7e2a912be9c9-streamflix2.baby-beamup.club`
- **Manifiesto directo:** `https://7e2a912be9c9-streamflix2.baby-beamup.club/manifest.json`
- **Panel de configuración:** `https://7e2a912be9c9-streamflix2.baby-beamup.club/configure`

### Opción A: En un solo comando (sin instalar `beamup-cli`)

Desde una máquina que tenga cargada tu clave SSH registrada en GitHub:

```bash
npm run deploy:beamup
```

(`scripts/deploy-beamup.sh` sincroniza tus claves públicas de GitHub con `a.baby-beamup.club`, configura el remoto `dokku@a.baby-beamup.club:7e2a912be9c9/streamflix2`, hace `git push beamup HEAD:master --force` y, si exportaste `TMDB_API_KEY`, `NGINX_PROXY_URL` o `NGINX_PROXY_TOKEN`, los guarda automáticamente en Dokku/Beamup).

### Opción B: Con `beamup-cli` clásico

```bash
npm install -g beamup-cli
beamup
# Actualizaciones posteriores:
git push beamup HEAD:master
```

### Secretos opcionales en Beamup

Puedes configurar variables globales en Beamup sin exponerlas en el código ni en el HTML de `/configure`:

```bash
beamup secrets TMDB_API_KEY tu_clave_tmdb_v3
beamup secrets NGINX_PROXY_URL https://proxy.tudominio.com
beamup secrets NGINX_PROXY_TOKEN tu_token_seguro
# Opcional: 'direct' (por defecto), 'nginx' o 'both'
beamup secrets DEFAULT_PROXY_MODE direct
```

Para consultar logs en Beamup:

```bash
beamup logs
```

### Opción B: Con GitHub Actions

El workflow [`.github/workflows/beamup-deploy.yml`](../.github/workflows/beamup-deploy.yml) utiliza `Stremio/beamup-deploy-action@v1.0.1`. Configura en tu repositorio de GitHub los secretos:

- `SSH_PRIVATE_KEY`: clave SSH privada autorizada en tu cuenta de GitHub.
- `BEAMUP_HOST`: host de Beamup (por defecto `a.baby-beamup.club`).
- `PROJECT_NAME`: nombre del addon en minúsculas y guiones (por defecto `streamflix2`).
- `USERNAME_GITHUB`: tu usuario de GitHub.

Después lánzalo manualmente desde la pestaña **Actions → Deploy Stremio Addon to Beamup**.

---

## 3. Despliegue del servidor Nginx externo (`nginx/`)

El servidor Nginx externo es completamente independiente de Beamup y solo utiliza módulos estándar incluidos de serie en `nginx` (`ngx_http_proxy_module`, `ngx_http_sub_module`, `ngx_http_map_module`, `ngx_http_limit_req_module`).

### Opción A: Con Docker Compose (recomendada)

1. Copia el archivo de variables en tu VPS / servidor externo:

   ```bash
   cd nginx
   cp .env.example .env
   ```

2. Edita `nginx/.env` con el subdominio real que te devolvió Beamup:

   ```ini
   NGINX_PORT=8080
   SERVER_NAME=streamflix.tudominio.com
   BEAMUP_SCHEME=https
   BEAMUP_HOST=tu-hash-streamflix2.baby-beamup.club
   NGINX_PROXY_TOKEN=una_clave_larga_opcional
   DNS_RESOLVER=1.1.1.1 8.8.8.8
   ```

3. Levanta el contenedor:

   ```bash
   docker compose up -d
   curl -fsS http://127.0.0.1:8080/nginx-health
   curl -fsS http://127.0.0.1:8080/manifest.json
   ```

4. Expón el puerto con HTTPS (mediante Cloudflare Tunnel, proxy inverso con Certbot/Caddy o añadiendo `listen 443 ssl` en la plantilla). Stremio exige **HTTPS** para addons remotos.

### Opción B: Instalación nativa en un comando (Ubuntu / Debian)

El repositorio incluye ya pregenerado `nginx/streamflix2.conf` (apuntando a `7e2a912be9c9-streamflix2.baby-beamup.club`) y el instalador automático `nginx/install-nginx.sh`:

```bash
sudo SERVER_NAME=streamflix.tudominio.com \
  BEAMUP_HOST=7e2a912be9c9-streamflix2.baby-beamup.club \
  NGINX_PROXY_TOKEN=una_clave_larga_opcional \
  bash nginx/install-nginx.sh
```

---

## 4. Cómo funciona el proxy HLS/MP4 (`/hlsp/…`) y la protección SSRF

Cuando en `/configure` eliges **Proxy Nginx externo** o **Modo Dual**, el addon transforma las URLs que exigen `Referer` al esquema jerárquico:

```text
https://streamflix.tudominio.com/hlsp/[t/<token>/]<ref_scheme>/<ref_host>/<target_scheme>/<target_host>/<ruta>?<query_firmada>
```

Ventajas de este diseño:

1. **Firmas CDN intactas:** `nginx/streamflix2.conf.template` extrae la cola directamente de `$request_uri`, conservando caracteres codificados (`%2B`, `%3D`, `%2F`) sin invalidar tokens HMAC de Voe o StreamWish.
2. **Playlists `.m3u8` multinivel:**
   - Las rutas relativas (`720p/index.m3u8`, `seg-001.ts`) se resuelven de forma nativa por el reproductor HLS bajo el mismo prefijo `/hlsp/…` con el mismo `Referer`.
   - Las URLs absolutas (`https://otro-edge.cdn/...`), claves `#EXT-X-KEY` (`URI="/..."`) y redirecciones `301/302/307/308` se reescriben al vuelo con `sub_filter` y `proxy_redirect`.
3. **Búsqueda por rangos (`206 Partial Content`):** reenvía `Range` e `If-Range` con `proxy_buffering off` para avance rápido inmediato en `.mp4`/`.mkv`.
4. **Seguridad SSRF y control de acceso:** tanto `stremio/proxy.cjs` como el bloque `map` de Nginx bloquean `localhost`, redes privadas RFC1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), link-local/metadatos cloud (`169.254.0.0/16`) y puertos no estándar, además de admitir `NGINX_PROXY_TOKEN`.
