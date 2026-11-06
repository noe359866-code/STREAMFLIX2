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
