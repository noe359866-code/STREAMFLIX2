# Proxy de vídeo sin abusar de Beamup

Este documento responde a una pregunta concreta: **cómo hacer que los enlaces de
vídeo se reproduzcan cuando el CDN exige `Referer`/`Origin`/`Cookie`, sin usar
Beamup como CDN de películas**. Incluye la investigación, la decisión de diseño,
lo que ya está implementado en este repositorio (opt-in) y las alternativas si
algún día Beamup deja de ser suficiente.

---

## 1. Lo primero: ¿quién transfiere los bytes?

Antes de hablar de proxies hay que tener claro que el coste de un stream **no
está en el JSON del addon** (unos pocos KB), sino en el vídeo: 1080p ≈ 5 Mbps ≈
**2,2 GB por hora y por espectador**; 720p ≈ 1,1 GB/h; 480p ≈ 0,45 GB/h. Un solo
usuario viendo una película puede mover más tráfico que miles de peticiones a
`/stream`.

Con el protocolo de Stremio hay cuatro caminos posibles para ese tráfico:

| Vía | Quién envía el vídeo | Coste para Beamup | Compatibilidad |
| --- | --- | --- | --- |
| **A. URL directa** | El CDN al reproductor del usuario | 0 bytes | Stremio Web/Desktop/Móvil/TV, Nuvio |
| **B. `behaviorHints.proxyHeaders`** (`notWebReady: true`) | El *streaming server* local de Stremio en el dispositivo | 0 bytes | Desktop y Android/TV. Stremio Web e iOS lo ignoran |
| **C. Pasarela propia (este repo, opt-in)** | El contenedor del addon → reenvía al reproductor | Todo el vídeo | Universal (también Stremio Web) |
| **C2. MediaFlow Proxy (instancia aparte)** | Tu VPS/NAS/casa → reenvía al reproductor | 0 bytes en Beamup (paga tu VPS) | Universal, y además DASH/ClearKey |
| **D. Reproductor externo (`externalUrl`)** | El navegador/embed del proveedor | 0 bytes | Sale de Stremio; peor experiencia |

La conclusión es la misma que la de la comunidad (ver el hilo de r/StremioAddons
sobre *bandwidth nightmare*): **el 95 % de los casos se resuelve con B**, que es
gratis y no consume ancho de banda del anfitrión. C sólo debe existir para el
residuo donde B no es posible (Stremio Web, iOS, algún TV) y **con frenos**.

---

## 2. Qué es Beamup realmente (y qué no promete)

Investigado en el repositorio oficial [Stremio/stremio-beamup](https://github.com/Stremio/stremio-beamup):

- Es **Dokku + Docker Swarm** ("sin las restricciones de Heroku"), pensado para
  addons: *"it only supports Stremio addons and it's optimized for them (by using
  specific caching policies)"*.
- El build es **Herokuish + Node buildpack** (por eso este repo usa `Procfile` y
  `npm start`, sin `Dockerfile`; un `Dockerfile` sólo se usa si el nombre del
  proyecto contiene `docker`).
- El sistema de ficheros **es efímero** (se borra en cada despliegue/reinicio):
  nada de caché de vídeo en disco.
- **No publica una cuota de tráfico**, pero el contenedor tiene RAM/CPU
  modestas y comparte salida a Internet con otros addons. La experiencia de la
  comunidad documenta **timeouts de respuesta** (≈10–20 s) y caídas puntuales
  cuando hay carga, y hay addons que han tenido que limitarse por ello.
- La política de uso es "hosting para addons". **Servir vídeo de terceros a
  escala choca con esa finalidad** y expone a (a) que el operador te pida parar,
  (b) saturar el nodo y afectar a otros addons, (c) que la IP compartida quede
  marcada por los CDN.

**Conclusión honesta:** Beamup es excelente para *resolver enlaces* (JSON +
raspado). No es un CDN, no está dimensionado para vídeo y no es ético tratarlo
como si lo fuera.

---

## 3. Política de "sin abusar" aplicada en el código

Reglas que se cumplen por diseño:

1. **Apagado por defecto.** `STREAM_GATEWAY=off` es el valor predeterminado: el
   addon entrega URLs directas + `proxyHeaders` (vía B). No se retransmite ni un
   byte sin que el operador lo pida.
2. **Sólo cuando la vía B no sirve.** En `auto` sólo pasan por la pasarela los
   **HLS que traen cabeceras** que el cliente no puede imponer. Todo lo demás
   sigue siendo directo.
3. **Es una pasarela HLS, no un proxy ciego.** Se reescriben playlist y
   variantes; los segmentos se emiten **en streaming** con `Range`/206 y **sin
   búfer en memoria**. Nada de descargar la película entera por adelantado.
4. **Presupuesto diario de bytes** (`STREAM_GATEWAY_DAILY_MB`, 4 GB por
   defecto): al llegar al límite se **corta el stream a mitad de segmento** y las
   peticiones siguientes reciben `503` sin abrir conexión al origen.
5. **Límite de conexiones simultáneas** (`STREAM_GATEWAY_MAX_CONCURRENT`, 6):
   protege RAM del contenedor y evita convertirlo en "descargador" paralelo.
6. **Tickets firmados (HMAC-SHA256)**, caducidad 6 h y cabeceras dentro del
   ticket: sin el secreto no se puede fabricar una URL, así que **no es un proxy
   abierto** ni sirve para saltarse bloqueos de terceros.
7. **Anti-SSRF**: por defecto se rechazan destinos loopback, RFC1918,
   link-local, `*.internal`/`*.local` y metadatos de cloud
   (`169.254.169.254`). Sólo se permite con `STREAM_GATEWAY_ALLOW_PRIVATE=1`
   (pruebas locales).
8. **Kill switch inmediato**: `STREAM_GATEWAY=off` + reinicio. Los enlaces ya
   entregados caducan solos y el addon vuelve a la vía B.
9. **Nada de caché de vídeo** en disco o memoria: el FS de Beamup es efímero y
   cachear segmentos multiplicaría el tráfico.
10. **Sin DRM ni descifrado**: si un proveedor usa Widevine/FairPlay, la pasarela
    no lo toca (no es su función).

Fórmula rápida para dimensionar el presupuesto:

```
GB/día = espectadores_activos × horas_por_día × GB_por_hora_de_la_calidad
```

Ejemplo conservador: 5 usuarios × 1,5 h × 1,1 GB/h (720p) ≈ **8,3 GB/día**. Con
4 GB de tope, la pasarela cubre los 2 primeros usuarios y el resto cae a
`proxyHeaders`/directo sin romper nada.

---

## 4. Lo implementado en este repo

Archivo nuevo: [`stremio/stream-gateway.cjs`](../stremio/stream-gateway.cjs)
(sin dependencias: `node:http`, `node:https`, `node:crypto`).

### Decisión de transporte por enlace

`resolveTransport()` en [`stremio/addon.cjs`](../stremio/addon.cjs) elige, en
este orden: `direct` → `direct-hls` → `proxy-headers` → `gateway`. Cada stream
lleva el resultado en `behaviorHints.streamflix2Transport`, y el diagnóstico lo
agrega en `transports`, de modo que se puede auditar qué vía se usó.

### Cómo funciona la pasarela

```
Stremio ──▶ /stream/movie/tt.json        ──▶ {"url":"https://addon/g/playlist.m3u8?t=<ticket>"}
Stremio ──▶ /g/playlist.m3u8?t=…           reescribe variantes, segmentos, EXT-X-KEY y EXT-X-MAP
Stremio ──▶ /g/segment?t=…   (Range)       streaming bidireccional, sin búfer, con presupuesto
                 │
                 └── upstream con Referer/Origin/User-Agent firmados en el ticket
```

- El ticket es `base64url(payload) + "." + HMAC-SHA256`, con `payload = {u, h, e}`
  (URL, cabeceras normalizadas, caducidad). Comparación con
  `crypto.timingSafeEqual`.
- Un `EXT-X-KEY` con `skd://` (FairPlay) o `data:` se deja intacto; sólo se
  reescriben URIs `http(s)`.
- Los errores del origen se traducen a `502` con `status` y `hint` para saber si
  es un `403` de CDN (Referer/cookies) o un problema de red.

### Activación en Beamup

```bash
# 1. Secreto de firma (obligatorio si activas la pasarela: sin él se genera uno
#    aleatorio por proceso y los tickets dejan de valer tras un reinicio).
beamup secrets STREAM_GATEWAY_SECRET "$(openssl rand -hex 24)"

# 2. Modo: off (defecto) | auto (sólo HLS con cabeceras) | on (todo HLS y MP4 con cabeceras)
beamup secrets STREAM_GATEWAY auto

# 3. Frenos (valores por defecto entre paréntesis)
beamup secrets STREAM_GATEWAY_DAILY_MB 4096        # (4096)
beamup secrets STREAM_GATEWAY_MAX_CONCURRENT 6     # (6)
beamup secrets STREAM_GATEWAY_TICKET_TTL_SEC 21600 # (21600, 6 h)
beamup secrets PUBLIC_BASE_URL https://7e2a912be9c9-streamflix2.baby-beamup.club
```

> `PUBLIC_BASE_URL` es importante: sin dominio público válido la pasarela no
> puede construir URLs absolutas y **se degrada sola** a `proxyHeaders`.

### Verificación

```text
GET /health                 → gateway: { mode, enabled, bytesToday, budgetUsedPct,
                              requests, playlists, segments, activeConnections,
                              blockedByBudget, lastError }
GET /diagnostico/stream/movie/tt1375666.json
                            → streamGateway: { mode, enabled, baseUrl }
                              transports: { "gateway": 3, "proxy-headers": 12, "direct-hls": 8 }
```

Prueba manual de un ticket (sustituye `<TOKEN>`):

```bash
curl -sI "https://7e2a912be9c9-streamflix2.baby-beamup.club/g/playlist.m3u8?t=<TOKEN>"
# 200 + Content-Type: application/vnd.apple.mpegurl + Access-Control-Allow-Origin: *
```

### Rollback

```bash
beamup secrets STREAM_GATEWAY off
```

Los enlaces que ya estén en la lista del usuario caducan con el ticket (6 h) y
Stremio vuelve a pedir la lista, que ahora saldrá con `proxyHeaders`.

---

## 5. MediaFlow Proxy: ¿mejor que la pasarela de este repo?

Instalé/investigué [mhdzumair/mediaflow-proxy](https://github.com/mhdzumair/mediaflow-proxy) (MIT, Python/FastAPI)
y su reescritura en Rust [mediaflow-proxy-light](https://github.com/mhdzumair/mediaflow-proxy-light).
**Respuesta corta: sí, es mejor motor — pero no puede vivir en Beamup.** Por eso lo correcto no es
"reemplazar", sino **delegar en MediaFlow cuando exista y dejar la pasarela interna como respaldo sin
infraestructura**. Eso es lo que quedó implementado (`stremio/mediaflow.cjs`).

### Comparación

| | **MediaFlow Proxy** | **Pasarela de este repo** |
| --- | --- | --- |
| Lenguaje / despliegue | Python 3.10 + FastAPI (Docker) o Rust ("Light") | Node, dentro del proceso del addon |
| RAM mínima real | ~2 GB (Python) · ~512 MB (Rust) | Unos pocos MB |
| Cabe en Beamup | **No** | Sí |
| HLS (reescritura, claves, prebuffer) | Sí, con prebuffer configurable | Sí (reescritura, sin prebuffer) |
| DASH / MPD | Sí, y **DASH→HLS** con ClearKey (cenc/cens/cbc1/cbcs) | No |
| Selección de resolución, skip de intro, `start_offset` | Sí | No |
| Proxy upstream HTTP/SOCKS5, reglas por dominio | Sí | No |
| URLs protegidas | Cifradas con `token`, caducidad y **binding por IP**; `api_password`; rate limit con Redis | HMAC con caducidad (sin binding de IP) |
| Presupuesto de bytes / cortes | No de serie (sí Redis rate-limit) | Sí, con corte a mitad de segmento |
| Anti-SSRF | No de serie (`no_proxy`/rutas se configuran) | Sí por defecto |
| Mantenimiento | Proyecto activo, mucha comunidad (AIOStreams, StreamAsia, MediaFusion) | Código propio, ~500 líneas |
| Coste | VPS (~4–5 €/mes, 512 MB basta con Light) o ElfHosted **9 $/mes** (2×4K) / 18 $ / 36 $ | 0 € |
| Riesgo | Otro servicio que mantener/parchear; el `api_password` viaja en las URLs | Superficie pequeña, pero código propio |

### Lo que MediaFlow hace y esta pasarela no

- **DASH/ClearKey**: convierte MPD cifrado con ClearKey a HLS al vuelo. Es la razón por la que
  MediaFusion y AIOStreams lo usan. Este repo **descarta MPD** (`isPlayableUrl` rechaza `.mpd`), así que
  si algún proveedor sirve DASH, MediaFlow abre una puerta que hoy está cerrada.
- **Prebuffer** (5 segmentos por defecto) y `start_offset` para directos: menos cortes, especialmente en TV.
- **`max_res`/`resolution`**: fuerza 1080p o 720p aunque el master ofrezca varias calidades.
- **URLs con binding de IP y caducidad**: si alguien copia el enlace, no le sirve desde otra IP.
- **Rust Light**: 7–8× menos RAM, 1.7–3.4× menos CPU y hasta 4× más throughput. Mismo API.

### Lo que esta pasarela hace mejor (para *nuestro* caso)

- **Cabe en Beamup**: cero infraestructura, cero coste.
- **Presupuesto diario de bytes con corte a mitad de segmento** y límite de conexiones: freno explícito
  contra el abuso, que es justo lo que pedías.
- **Anti-SSRF por defecto** y tickets firmados con `timingSafeEqual` (MediaFlow confía en `api_password`
  en la URL y en sus reglas de rutas).
- **Kill switch por usuario** (`/configure` → transporte `off`) y por operador (`STREAM_GATEWAY=off`).
- **Un solo proceso**: no hay otro contenedor que actualizar ni otra contraseña que rotar.

### Decisión práctica

```
1. ¿El CDN no pide cabeceras?            → URL directa            (coste 0)
2. ¿Pide Referer y el cliente es desktop/Android? → proxyHeaders   (coste 0)
3. ¿Tienes VPS/NAS/casa con 512 MB?      → MediaFlow (Light)      (mejor motor)
4. ¿No quieres infraestructura y es poco volumen? → pasarela interna (opt-in, con presupuesto)
```

### Cómo se activa la delegación (ya implementada)

```bash
beamup secrets MEDIAFLOW_URL https://mediaflow.midominio.com   # instancia propia
beamup secrets MEDIAFLOW_PASSWORD "contraseña_larga"
beamup secrets MEDIAFLOW_INCLUDE_MP4 0                         # 1 = delegar también MP4 con cabeceras
```

Con eso, cada enlace HLS con cabeceras se entrega como
`https://mediaflow.midominio.com/proxy/hls/manifest.m3u8?d=<cdn>&h_referer=…&api_password=…`
y MediaFlow reescribe el playlist, inyecta las cabeceras y sirve los segmentos. En `/health` →
`mediaflow` y en `/mediaflow?probe=1` se comprueba la instancia (IP pública y latencia vía `/proxy/ip`).
El diagnóstico por título muestra `transports: { "mediaflow": N }`.

Notas de seguridad:
- `api_password` viaja en la URL (formato `encoded`). Si eso te incomoda, usa `/generate_url` con
  `expiration` + `ip` (URL cifrada) y pon MediaFlow detrás de un dominio con TLS.
- No publiques la instancia sin `API_PASSWORD`: es un proxy con salida a Internet.
- MediaFlow **no filtra SSRF**; si lo expones, restringe `PROXY_URL`/rutas y el firewall de salida.

### Código para levantarlo (fuera de Beamup)

```yaml
# docker-compose.yml en tu VPS/NAS
services:
  mediaflow-proxy:
    image: mhdzumair/mediaflow-proxy:latest   # o ghcr.io/mhdzumair/mediaflow-proxy-light:latest
    restart: unless-stopped
    ports: ["8888:8888"]
    environment:
      - API_PASSWORD=${MEDIAFLOW_PASSWORD}
      - ENABLE_HLS_PREBUFFER=true
      - FORWARDED_ALLOW_IPS=*        # detrás de Nginx/Cloudflare
```

---

## 6. Alternativas (y cuándo conviene cada una)

| Opción | Coste | Cuota / límite real | Veredicto |
| --- | --- | --- | --- |
| **`proxyHeaders` (vía B)** | 0 | Ninguna: usa el servidor local del usuario | **Primera opción siempre** |
| **Pasarela en Beamup (vía C, este repo)** | 0 | RAM/CPU del contenedor; IP compartida; sin cuota publicada | Sólo residuo, con presupuesto |
| **VPS propio** (Hetzner CX22, ~4 €/mes) | ~4 € | 20 TB de tráfico | La opción "de verdad" si hay usuarios |
| **Cloudflare Workers** | 0 hasta 100 k req/día | 100 k req/día, 10 ms CPU; el plan gratuito **prohíbe** servir vídeo de forma no-HTML (TOS §2.8) | No usar para vídeo |
| **Deno Deploy / Vercel / Netlify Functions** | 0–20 $ | Límites de duración y ancho de banda; pensados para funciones cortas | No para streaming largo |
| **Fly.io / Railway / Render** | 0–7 $ | Suele dormir o cobrar por egress | Aceptable con presupuesto |
| **Mini-PC en casa + Cloudflare Tunnel** | 0 | Tu IP residencial y tu subida (~10–50 Mbps) | **Muy buena**: mismo truco que Nuvio (IP doméstica), sin abrir puertos |
| **MediaFlow / ElfHosted** | pago | Proxy de streaming especializado | Si el proyecto crece, externalizar |
| **`externalUrl` al embed** | 0 | Ninguna | Último recurso: peor UX |

### La idea que casi siempre gana: mover el residuo a casa

Los CDN bloquean **IPs de datacenter** (Beamup), no residenciales. Por eso Nuvio
funciona desde el móvil y el addon no. Si necesitas el camino C para tus propios
usuarios, monta el proxy en un equipo de casa con `cloudflared` (túnel saliente,
sin abrir puertos) y apunta ahí las URLs:

```bash
# En casa, con el addon clonado:
PUBLIC_BASE_URL=https://mi-tunel.ejemplo.com STREAM_GATEWAY=auto \
  STREAM_GATEWAY_DAILY_MB=20480 npm start
```

Ventajas: IP residencial (menos bloqueos), sin cuotas de Beamup, y el tráfico
sale de tu conexión — asumiendo sus límites de subida.

---

## 7. Límites conocidos y riesgos

- **Stremio Web** con `notWebReady: true`: el reproductor web espera a que su
  servidor local convierta el stream. La pasarela sirve las URIs ya reescritas,
  pero si el servidor local no está activo esa vía no arranca. Es un límite de
  Stremio, no del addon; para Web conviene probar `STREAM_GATEWAY=on`.
- **HLS en vivo** con ventanas cortas: los tickets caducan en 6 h por defecto;
  una sesión más larga obliga a recargar la lista.
- **Segmentos cifrados AES-128**: se reescribe la URI de la clave, pero la clave
  del proveedor debe ser accesible con las mismas cabeceras.
- **No se arregla lo que no es red**: DRM, geobloqueo distinto del de la IP del
  proveedor, o tokens que caducan a los pocos segundos.
- **Coste oculto**: cada stream que pasa por la pasarela compite por la CPU del
  contenedor con el raspado. Si `activeConnections` se pega al máximo, baja
  `STREAM_GATEWAY_MAX_CONCURRENT` antes de subir el presupuesto.
- **Legal**: el addon indexa enlaces públicos de terceros; retransmitir el vídeo
  añade responsabilidad y carga. Mantener el modo `off` por defecto es también
  una decisión de prudencia, no sólo técnica.

---

## 8. Resumen ejecutivo

1. **No necesitas proxy propio para la mayoría de reproducciones.** `notWebReady`
   + `proxyHeaders` hace que el servidor local de Stremio ponga el `Referer` y el
   vídeo no toca Beamup.
2. **Si hace falta el camino propio, que sea HLS reescrito, con tickets firmados,
   presupuesto de bytes, límite de conexiones y apagado por defecto** — es lo
   que implementa `stremio/stream-gateway.cjs`.
3. **Beamup no es un CDN**: úsalo para resolver, no para servir. Para volumen,
   VPS barato o túnel a casa con IP residencial.
4. **MediaFlow es mejor motor, pero no cabe en Beamup** (2 GB de RAM en Python, 512 MB en Rust):
   si tienes VPS/NAS, delégalo con `MEDIAFLOW_URL` + `MEDIAFLOW_PASSWORD` y gana DASH/ClearKey,
   prebuffer, selección de resolución y URLs con caducidad/IP. La pasarela interna queda como
   respaldo de coste cero.
5. **Mide antes de escalar**: `/health` (`bytesToday`, `budgetUsedPct`, `mediaflow`), `/mediaflow?probe=1`
   y `/diagnostico` (`transports`) dicen exactamente qué vía se está usando.
