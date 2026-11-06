# Addon de Stremio · Beamup

Este repositorio incluye, junto al pack de plugins para Nuvio, un **addon completo de Stremio** (`org.streamflix2.es`) preparado para desplegarse directamente en **Beamup** desde la raíz del proyecto (`Procfile` + `npm start`), manteniendo intactos `manifest.json` y `providers/*.js` en la raíz para Nuvio.

---

## Características

- **Sin `TMDB_API_KEY` obligatoria:** cuando Stremio solicita un ID de IMDb (`tt0137523`, `tt0903747:2:3`), el addon resuelve automáticamente título, año, alias y `moviedb_id` mediante **Cinemeta** (`v3-cinemeta.strem.io`), alimentando tanto a `CineHax` como a los conectores basados en búsqueda.
- **Con `TMDB_API_KEY` opcional** (en secretos de Beamup o en `/configure`): añade títulos localizados en español (`es-MX`), títulos alternativos adicionales y soporte directo para IDs `tmdb:…`.
- **Cabeceras nativas de Stremio (`behaviorHints.proxyHeaders`):** los streams que requieren `Referer` o `User-Agent` se entregan directamente con `notWebReady: true` y `proxyHeaders`, sin pasar tráfico de vídeo por el servidor de Beamup.
- **Concurrencia aislada:** las peticiones simultáneas comparten caché LRU de metadatos y aíslan su configuración mediante `AsyncLocalStorage`, evitando colisiones en `globalThis.TMDB_API_KEY`.

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

El hash SHA-256 de Beamup para la cuenta `@noe359866-code` y proyecto `streamflix2` está precalculado en `scripts/deploy-beamup.sh` y `.github/workflows/beamup-deploy.yml`:

- **Dominio en Beamup:** `https://7e2a912be9c9-streamflix2.baby-beamup.club`
- **Manifiesto directo:** `https://7e2a912be9c9-streamflix2.baby-beamup.club/manifest.json`
- **Panel de configuración:** `https://7e2a912be9c9-streamflix2.baby-beamup.club/configure`

### Opción A: En un solo comando (sin instalar `beamup-cli`)

Desde una máquina que tenga cargada tu clave SSH registrada en GitHub:

```bash
npm run deploy:beamup
```

(`scripts/deploy-beamup.sh` sincroniza tus claves públicas de GitHub con `a.baby-beamup.club`, configura el remoto `dokku@a.baby-beamup.club:7e2a912be9c9/streamflix2`, hace `git push beamup HEAD:master --force` y, si exportaste `TMDB_API_KEY`, la guarda automáticamente en Dokku/Beamup).

### Opción B: Con `beamup-cli` clásico

```bash
npm install -g beamup-cli
beamup
# Opcionalmente añade tu clave TMDB:
beamup secrets TMDB_API_KEY tu_clave_tmdb_v3
# Ver logs:
beamup logs
```

### Opción C: Automático con GitHub Actions

El workflow [`.github/workflows/beamup-deploy.yml`](../.github/workflows/beamup-deploy.yml) utiliza `Stremio/beamup-deploy-action@v1.0.1`. Configura en tu repositorio de GitHub el secreto:

- `SSH_PRIVATE_KEY`: clave SSH privada correspondiente a una de las claves públicas registradas en tu cuenta `@noe359866-code`.

Al hacer merge a `main` o pulsar **Run workflow** en la pestaña **Actions → Deploy Stremio Addon to Beamup**, se desplegará automáticamente.

---

## 3. Diagnóstico: Nuvio sí devuelve streams y Stremio no

Nuvio ejecuta los proveedores **dentro de la app** (QuickJS, IP del móvil/TV), así que
no depende de nada más. El addon de Stremio, en cambio, los ejecuta **en el servidor de
Beamup** y Stremio descarta lo que tarda demasiado: si el addon tarda 20–40 s en
responder, el usuario ve la lista vacía aunque los proveedores sí hayan encontrado
enlaces.

Por eso la ruta de streams ahora:

1. **Contesta antes de un plazo duro** (`ADDON_DEADLINE_MS`, por defecto **7000 ms**,
   ajustable de 2500 a 25000) con lo que ya esté disponible.
2. **Sigue raspando en segundo plano** y guarda el resultado completo en una caché por
   proceso (10 minutos); al volver a abrir el título, Stremio recibe la lista completa al
   instante.
3. **Ordena los proveedores por latencia histórica** para que, dentro del plazo, entren
   primero los que suelen responder rápido.
4. **Nunca cachea respuestas vacías** (`Cache-Control: no-store`), ni en el CDN de Beamup
   ni en Stremio: un fallo puntual ya no deja la lista en blanco durante minutos.

### Comprobar qué proveedor falla o tarda (desde el navegador)

```text
https://7e2a912be9c9-streamflix2.baby-beamup.club/diagnostico/stream/movie/tt1375666.json
https://7e2a912be9c9-streamflix2.baby-beamup.club/diagnostico/stream/series/tt0903747:1:1.json
```

Devuelve, para cada proveedor, `ms` (tiempo real en el servidor Beamup) y `count`
(número de enlaces encontrados). Interpretación rápida:

- `count: 0` + `ms` cercano al timeout → el sitio tarda o bloquea la IP del servidor.
- `error` con `403`/`521`/`Cloudflare` → el proveedor rechaza peticiones de datacenter;
  en Nuvio funciona porque la petición sale desde tu IP residencial.
- `ms` muy alto en casi todos → sube `ADDON_CONCURRENCY` (por defecto 10, máx. 24) o baja
  el timeout por proveedor en `/configure`.

### Variables de entorno útiles en Beamup

```bash
beamup secrets ADDON_DEADLINE_MS 7000      # plazo duro de respuesta (2500–25000)
beamup secrets ADDON_CONCURRENCY 12        # proveedores en paralelo (1–24)
beamup secrets PROVIDER_TIMEOUT_MS 8000    # timeout por proveedor (4–25 s)
beamup secrets PUBLIC_BASE_URL https://7e2a912be9c9-streamflix2.baby-beamup.club
```

### Si el addon "no aparece" o muestra datos viejos

- El manifiesto se sirve con `Cache-Control: public, max-age=120`; antes eran 3600 s, así
  que Beamup/CDN podía entregar durante una hora un manifiesto de un despliegue anterior
  (síntoma típico: `logo` roto o un número de proveedores distinto al real). Si el
  despliegue no está al día, vuelve a desplegar y reinstala el addon en Stremio
  (`/configure` → **Instalar en Stremio**).
- Comprueba `/health`: `activeProviders` debe coincidir con los proveedores que ves en
  `/configure`.

---

## 4. Raspado por proxy (para los sitios que bloquean la IP de Beamup)

El diagnóstico del punto 3 demuestra el problema de fondo: desde el contenedor de Beamup
**26 proveedores responden, pero solo 2 devuelven enlaces** — el resto contesta 0 en
74–180 ms porque el sitio rechaza la IP del datacenter. Nuvio no lo sufre porque raspа
desde tu dispositivo.

Para eso está el **pool de proxies** (`stremio/proxy-pool.cjs`, sin dependencias nuevas):

1. Descarga un listado público de proxies (por defecto **ProxyScrape v4**,
   `api.proxyscrape.com/v4/free-proxy-list/get`, protocolo HTTP con `ssl=yes`).
2. **Verifica cada uno** abriendo un túnel `CONNECT` real y completando el handshake TLS
   contra un canario (`v3-cinemeta.strem.io:443`). Los que no sirven se descartan.
3. Guarda los sanos en memoria (8 por defecto, refresco cada 10 min).
4. `proxyFetch()` implementa un cliente HTTP/1.1 completo sobre el túnel
   (chunked, gzip/deflate/br, redirecciones y POST) y devuelve una `Response` nativa.
5. `installProxyFetchHook()` hace que `globalThis.fetch` de los 31 proveedores use el
   proxy **solo dentro del contexto asíncrono** en el que se pidió (`AsyncLocalStorage`),
   sin tocar ni un archivo de `providers/`.

### Cómo se usa por defecto (`PROXY_SCRAPING=auto`)

- Primera pasada **directa** (rápida) → se responde a Stremio dentro del plazo.
- Después, en segundo plano, se reintentan **por proxy solo los proveedores que
  devolvieron 0 enlaces** (`PROXY_MAX_RETRIES`, 8 por defecto).
- Cuando termina, el resultado completo queda en la caché de 10 min, así que la siguiente
  apertura del título en Stremio ya trae lo rescatado.

### Variables

```bash
beamup secrets PROXY_SCRAPING auto        # auto (defecto) | off | only
beamup secrets PROXY_MAX_RETRIES 8        # proveedores reintentados por proxy
beamup secrets PROXY_TIMEOUT_MS 8000      # timeout por intento vía proxy
beamup secrets PROXY_BUDGET_MS 20000      # presupuesto total de la 2ª pasada
beamup secrets PROXY_CONCURRENCY 2        # intentos simultáneos
beamup secrets PROXY_POOL_SIZE 8          # proxies sanos que se conservan
beamup secrets PROXY_LIST_URL "<otra lista compatible>"
```

Comprueba el estado en `/health` (campo `proxy`: `healthy`, `candidates`, `lastError`) y en
`/diagnostico/stream/...` (campo `proxyMode`, `proxy`, `providersRescuedByProxy` y, por
proveedor, `via: "direct" | "proxy"`).

### Avisos honestos

- Los proxies gratuitos son **inestables y lentos**: rescatan una parte, no todos. Si el
  pool queda en 0 (`lastError`), el addon sigue funcionando igual que antes.
- Todo el tráfico de raspado pasa por hosts de terceros: son páginas públicas sin
  credenciales, pero si no te convence, apágalo con `PROXY_SCRAPING=off`.
- La alternativa definitiva es raspа desde una IP residencial (un mini-servidor en casa con
  `PROXY_LIST_URL` propio o un VPS no bloqueado).

---

## 5. Transporte de vídeo: qué pasa cuando el CDN exige `Referer`

El addon **no retransmite vídeo por defecto**. El orden de preferencia está en
`resolveTransport()` (`stremio/addon.cjs`) y se ve en cada stream como
`behaviorHints.streamflix2Transport`:

| Vía | Cuándo | Coste en Beamup |
| --- | --- | --- |
| `direct` / `direct-hls` | El CDN no pide cabeceras | 0 |
| `proxy-headers` | Pide `Referer`/`Origin`/`Cookie` → se entrega `notWebReady` + `proxyHeaders` y el *streaming server* local de Stremio pone las cabeceras | 0 |
| `gateway` | Sólo si activas `STREAM_GATEWAY=auto\|on` y el cliente no puede mandar cabeceras (Stremio Web/iOS) | Consume tráfico, con presupuesto |

### Activar la pasarela (opcional)

```bash
beamup secrets STREAM_GATEWAY_SECRET "$(openssl rand -hex 24)"   # firma los tickets
beamup secrets STREAM_GATEWAY auto        # off (defecto) | auto | on
beamup secrets STREAM_GATEWAY_DAILY_MB 4096
beamup secrets STREAM_GATEWAY_MAX_CONCURRENT 6
beamup secrets PUBLIC_BASE_URL https://7e2a912be9c9-streamflix2.baby-beamup.club
```

La pasarela sólo sirve HLS a través de `/g/playlist.m3u8?t=…` y `/g/segment?t=…`
con tickets HMAC caducables, emite los segmentos en streaming con `Range`/206,
no cachea vídeo, corta el stream al agotar el presupuesto diario y rechaza
destinos internos (anti-SSRF). Estado en `/health` → `gateway`
(`bytesToday`, `budgetUsedPct`, `activeConnections`, `blockedByBudget`) y en
`/diagnostico` → `streamGateway` + `transports`.

**Desactivar:** `beamup secrets STREAM_GATEWAY off`. Los enlaces ya entregados
caducan solos con el ticket (6 h).

### Delegar en MediaFlow Proxy (opcional, recomendado si tienes VPS/NAS)

```bash
beamup secrets MEDIAFLOW_URL https://mediaflow.midominio.com
beamup secrets MEDIAFLOW_PASSWORD "contraseña_larga"
beamup secrets MEDIAFLOW_INCLUDE_MP4 0   # 1 = delegar también MP4 con cabeceras
```

Cuando está configurado, los HLS con cabeceras salen como
`<MEDIAFLOW_URL>/proxy/hls/manifest.m3u8?d=…&h_referer=…&api_password=…` y MediaFlow
hace el trabajo pesado (DASH/ClearKey, prebuffer, selección de resolución). Comprueba con
`/health` → `mediaflow` y `/mediaflow?probe=1` (IP pública y latencia). Sin esas variables el
addon no cambia nada.

Razonamiento completo, límites de Beamup, cuentas de ancho de banda y
alternativas (VPS, Cloudflare Workers, túnel a casa, MediaFlow):
[`docs/video-proxy.md`](video-proxy.md).

### Listados con respaldo

`PROXY_LIST_URL` acepta **varias fuentes separadas por coma**. Por defecto se prueban en
orden hasta reunir candidatos:

1. ProxyScrape v4 (JSON, con métricas de uptime y latencia).
2. `TheSpeedX/PROXY-List` → `http.txt` (texto plano, cientos de proxies).
3. `monosans/proxy-list` → `http.txt`.
4. ProxyScrape v2 (texto plano).

Si una fuente responde **429** (límite por IP, frecuente desde Beamup) o no entrega ningún
proxy utilizable, se pasa a la siguiente. Y si un refresco falla por completo **no se pierde
el pool que ya funcionaba**: se conserva y `lastError` lo indica.
