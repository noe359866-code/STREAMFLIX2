'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  ADDON_ID,
  ADDON_VERSION,
  ACTIVE_SCRAPERS,
  decodeConfig,
} = require('./config.cjs');
const {
  buildManifest,
  getStremioStreams,
  diagnoseStremioStreams,
  normalizeBaseUrl,
} = require('./addon.cjs');
const { LOGO_SVG, renderConfigurePage } = require('./landing.cjs');
const { ensurePool, proxyStatus } = require('./proxy-pool.cjs');

const ROOT = path.resolve(__dirname, '..');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Range, X-Requested-With',
  'Access-Control-Max-Age': '172800',
  'X-Content-Type-Options': 'nosniff',
};

function resolveBaseUrl(req, env = process.env) {
  if (env.PUBLIC_BASE_URL) {
    const configured = normalizeBaseUrl(env.PUBLIC_BASE_URL);
    if (configured) return configured;
    console.warn('[stremio-server] PUBLIC_BASE_URL inválida, se ignora:', env.PUBLIC_BASE_URL);
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : 'http';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .replace(/[^A-Za-z0-9.:[\]-]/g, '');
  if (!rawHost) return '';


  if (!rawHost.includes('.') && !rawHost.startsWith('localhost')) return '';
  return `${proto}://${rawHost}`;
}

function sendJson(req, res, statusCode, payload, cacheControl = 'no-cache') {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'Content-Length': Buffer.byteLength(body),
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function sendText(req, res, statusCode, body, contentType, cacheControl = 'no-cache') {
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Content-Length': Buffer.byteLength(body),
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function serveNuvioAsset(req, res, subPath) {
  const clean = subPath.replace(/^\/+/, '');
  const allowed = clean === 'manifest.json' || /^providers\/[a-z0-9_-]+\.js$/i.test(clean);
  const fullPath = path.resolve(ROOT, clean);
  if (!allowed || !fullPath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    sendJson(req, res, 404, { error: 'Recurso Nuvio no encontrado', manifest: '/nuvio/manifest.json' });
    return;
  }
  const contentType = clean.endsWith('.json')
    ? 'application/json; charset=utf-8'
    : 'text/javascript; charset=utf-8';
  const stat = fs.statSync(fullPath);
  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300',
    'Content-Length': stat.size,
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(fullPath).pipe(res);
}

function createAddonServer(options = {}) {
  const env = options.env || process.env;
  const providerLoader = options.providerLoader;
  const useMetadataCache = options.useMetadataCache;

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(req, res, 405, { error: 'Método no permitido' });
        return;
      }

      const parsedUrl = new URL(req.url || '/', 'http://addon.local');
      const pathname = parsedUrl.pathname.replace(/\/{2,}/g, '/');
      const baseUrl = resolveBaseUrl(req, env);

      if (pathname === '/health' || pathname === '/healthz') {
        sendJson(req, res, 200, {
          status: 'ok',
          id: ADDON_ID,
          version: ADDON_VERSION,
          activeProviders: ACTIVE_SCRAPERS.length,
          proxy: proxyStatus(),
        }, 'no-store');
        return;
      }

      if (pathname === '/logo.svg') {
        sendText(req, res, 200, LOGO_SVG, 'image/svg+xml; charset=utf-8', 'public, max-age=86400');
        return;
      }

      if (pathname === '/hero.jpg') {
        const imagePath = path.join(__dirname, 'hero.jpg');
        const stat = fs.statSync(imagePath);
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'Content-Length': stat.size });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(imagePath).pipe(res);
        return;
      }

      if (pathname.startsWith('/nuvio/')) {
        serveNuvioAsset(req, res, pathname.slice('/nuvio/'.length));
        return;
      }


      if (pathname === '/' || pathname === '/configure' || pathname === '/configure/') {
        const html = renderConfigurePage({ env, userConfig: {}, baseUrl });
        sendText(req, res, 200, html, 'text/html; charset=utf-8', 'no-cache');
        return;
      }

      const configPageMatch = pathname.match(/^\/([^/]+)\/configure\/?$/);
      if (configPageMatch && configPageMatch[1] !== 'nuvio') {
        const userOnlyConfig = decodeConfig(configPageMatch[1], {});
        const html = renderConfigurePage({ env, userConfig: userOnlyConfig, baseUrl });
        sendText(req, res, 200, html, 'text/html; charset=utf-8', 'no-cache');
        return;
      }


      if (pathname === '/manifest.json') {
        const config = decodeConfig('', env);
        const manifest = buildManifest(config, { env, baseUrl });
        sendJson(req, res, 200, manifest, 'public, max-age=120, stale-while-revalidate=600');
        return;
      }

      const configManifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
      if (configManifestMatch && configManifestMatch[1] !== 'nuvio') {
        const config = decodeConfig(configManifestMatch[1], env);
        const manifest = buildManifest(config, { env, baseUrl });
        sendJson(req, res, 200, manifest, 'public, max-age=120, stale-while-revalidate=600');
        return;
      }



      const diagMatch = pathname.match(/^(?:\/([^/]+))?\/(?:diagnostico|diagnostics)\/stream\/([^/]+)\/([^/]+)\.json$/);
      if (diagMatch) {
        const [, configSeg, diagType, diagId] = diagMatch;
        const config = decodeConfig(configSeg || '', env);
        const result = await diagnoseStremioStreams({
          type: diagType,
          id: diagId,
          config,
          env,
          providerLoader,
          useMetadataCache: false,
        });
        sendJson(req, res, 200, result, 'no-store');
        return;
      }

      if (pathname === '/diagnostico' || pathname === '/diagnostics') {
        const diagType = parsedUrl.searchParams.get('type') || 'movie';
        const diagId = parsedUrl.searchParams.get('id') || '';
        if (diagId) {
          const result = await diagnoseStremioStreams({
            type: diagType,
            id: diagId,
            config: decodeConfig('', env),
            env,
            providerLoader,
            useMetadataCache: false,
          });
          sendJson(req, res, 200, result, 'no-store');
          return;
        }
        sendJson(req, res, 200, {
          uso: '/diagnostico/stream/<movie|series>/<imdb o tmdb:ID>.json',
          ejemploPelicula: '/diagnostico/stream/movie/tt1375666.json',
          ejemploSerie: '/diagnostico/stream/series/tt0903747:1:1.json',
          pista: 'Cada proveedor devuelve ms y cuántos streams encontró. Usa ?type= y ?id= si prefieres la raíz.',
        }, 'no-store');
        return;
      }


      const streamMatch = pathname.match(/^(?:\/([^/]+))?\/stream\/([^/]+)\/([^/]+)\.json$/);
      if (streamMatch) {
        const [, configSeg, rawType, rawId] = streamMatch;
        const config = decodeConfig(configSeg || '', env);
        const result = await getStremioStreams({
          type: rawType,
          id: rawId,
          config,
          env,
          providerLoader,
          useMetadataCache,
        });




        const isEmpty = !result.streams || result.streams.length === 0;
        let cacheControl = 'no-store, max-age=0';
        if (!isEmpty && !result.noStore) {
          const maxAge = Number(result.cacheMaxAge) || 60;
          const swr = Number(result.staleRevalidate) || 0;
          const sie = Number(result.staleError) || 0;
          const cacheParts = ['public', `max-age=${maxAge}`];
          if (swr > 0) cacheParts.push(`stale-while-revalidate=${swr}`);
          if (sie > 0) cacheParts.push(`stale-if-error=${sie}`);
          cacheControl = cacheParts.join(', ');
        }
        sendJson(req, res, 200, { streams: result.streams || [] }, cacheControl);
        return;
      }

      sendJson(req, res, 404, {
        error: 'No encontrado',
        manifest: '/manifest.json',
        configure: '/configure',
        nuvioManifest: '/nuvio/manifest.json',
      });
    } catch (error) {
      const message = error && error.message ? error.message : 'Error interno';
      try { console.error('[stremio-server]', message); } catch (_) {            }
      if (!res.headersSent) {
        sendJson(req, res, 500, { error: 'Error interno del addon', streams: [] }, 'no-store');
      } else {
        res.end();
      }
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 7000);
  const host = process.env.HOST || '0.0.0.0';

  ensurePool().catch(() => {});
  const server = createAddonServer();
  server.listen(port, host, () => {
    const addr = server.address();
    const effectivePort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(
      `STREAMFLIX2 Stremio Addon activo en http://${host}:${effectivePort}/manifest.json (configurar: /configure)`,
    );
  });
}

module.exports = {
  createAddonServer,
  resolveBaseUrl,
};
