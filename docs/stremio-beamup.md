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
