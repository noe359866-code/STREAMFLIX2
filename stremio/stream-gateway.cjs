'use strict';

/**
 * Pasarela de reproducción (Fase 2 del transporte de vídeo).
 *
 * Problema: algunos CDN exigen `Referer`/`Origin`/`Cookie` y la mayoría de los
 * reproductores de Stremio (Web/Tizen/webOS/iOS) no pueden enviar cabeceras por
 * stream. La solución de coste cero es `behaviorHints.proxyHeaders`, que delega
 * el tráfico al *streaming server* local del usuario (Stremio Desktop/Android).
 * Cuando ese servidor no puede usarse, hace falta un salto HTTP propio.
 *
 * Esta pasarela NO es un proxy ciego: sólo reescribe HLS. El master y las
 * variantes `.m3u8` se reescriben para que cada URI (variantes, segmentos,
 * `EXT-X-KEY`, `EXT-X-MAP`) apunte aquí con un ticket firmado; los segmentos se
 * emiten en streaming con soporte de `Range` y sin búfer en memoria. Así:
 *
 *   - El ancho de banda sólo se gasta por lo que el reproductor pide de verdad
 *     (nada de "descargar la película entera por adelantado").
 *   - Un presupuesto diario de bytes y un límite de conexiones protegen al
 *     contenedor de Beamup (512 MB de RAM, sin cuotas de tráfico declaradas).
 *   - Hay *kill switch*: `STREAM_GATEWAY=off` restaura el comportamiento directo
 *     y `proxyHeaders` en el siguiente request.
 *
 * Los tickets son HMAC-SHA256 sobre la URL y las cabeceras necesarias: sin
 * secreto no se puede fabricar un ticket, así que el endpoint no es un proxy
 * abierto (no se puede usar para saltarse bloqueos de terceros).
 */

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const ROUTE_PREFIX = '/g/';
const LEGACY_ROUTE = '/proxy';

const PLAYLIST_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TICKET_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_REDIRECTS = 3;

/** Cabeceras que el reproductor necesita de vuelta para hacer seeking. */
const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  'Access-Control-Max-Age': '172800',
  'X-Content-Type-Options': 'nosniff',
};

const state = {
  fallbackSecret: '',
  dayKey: dayKeyOf(Date.now()),
  bytesToday: 0,
  requests: 0,
  playlistRewrites: 0,
  segments: 0,
  active: 0,
  blockedByBudget: 0,
  lastError: '',
  startedAt: Date.now(),
};

function dayKeyOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function intFrom(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

/**
 * Modos:
 *  - `off`  (predeterminado) nunca se retransmite vídeo: se usan URLs directas
 *           más `proxyHeaders` (tráfico del streaming server del usuario).
 *  - `auto` sólo se retransmiten los HLS que necesitan cabeceras.
 *  - `on`   se retransmiten todos los HLS (y los MP4 con cabeceras).
 */
function resolveGatewayOptions(env = process.env) {
  const raw = String(env.STREAM_GATEWAY || env.VIDEO_GATEWAY || 'off').trim().toLowerCase();
  let mode = 'off';
  if (['1', 'on', 'true', 'yes', 'always', 'all'].includes(raw)) mode = 'on';
  else if (['auto', 'headers', 'needed'].includes(raw)) mode = 'auto';

  const dailyMegabytes = intFrom(env.STREAM_GATEWAY_DAILY_MB, 4096, 0, 1024 * 1024);
  return {
    mode,
    enabled: mode !== 'off' && dailyMegabytes > 0,
    ticketTtlMs: intFrom(env.STREAM_GATEWAY_TICKET_TTL_SEC, DEFAULT_TICKET_TTL_MS / 1000, 60, 86400) * 1000,
    dailyBudgetBytes: dailyMegabytes * 1024 * 1024,
    maxConcurrent: intFrom(env.STREAM_GATEWAY_MAX_CONCURRENT, 6, 1, 64),
    connectTimeoutMs: intFrom(env.STREAM_GATEWAY_CONNECT_TIMEOUT_MS, 8000, 1000, 30000),
    idleTimeoutMs: intFrom(env.STREAM_GATEWAY_IDLE_TIMEOUT_MS, 25000, 3000, 120000),
    secret: String(env.STREAM_GATEWAY_SECRET || '').trim(),
    // El formato antiguo `?u=<base64>` equivale a un proxy abierto (cualquiera
    // puede codificar una URL), así que sólo se habilita a propósito.
    allowUnsigned: ['1', 'true', 'yes', 'on'].includes(
      String(env.STREAM_GATEWAY_ALLOW_UNSIGNED || '').trim().toLowerCase(),
    ),
    // Defensa SSRF: por defecto no se retransmiten destinos en loopback,
    // redes privadas, link-local ni metadatos de cloud. Las pruebas locales y
    // un despliegue 100 % de confianza pueden activarlo.
    allowPrivate: ['1', 'true', 'yes', 'on'].includes(
      String(env.STREAM_GATEWAY_ALLOW_PRIVATE || '').trim().toLowerCase(),
    ),
  };
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
  /^metadata\./i,
];

/** `true` si el host es interno (loopback, RFC1918, link-local, .internal). */
function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  if (/\.(?:internal|local|localhost|home\.arpa)$/.test(host)) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function gatewaySecret(env = process.env) {
  const configured = String((env && env.STREAM_GATEWAY_SECRET) || '').trim();
  if (configured) return configured;
  if (!state.fallbackSecret) state.fallbackSecret = crypto.randomBytes(24).toString('hex');
  return state.fallbackSecret;
}

function isPlaylistUrl(url) {
  try {
    const parsed = new URL(url);
    return /\.m3u8?$/i.test(parsed.pathname) || /\/m3u8\//i.test(parsed.pathname)
      || /\.m3u8$/i.test(parsed.search) || parsed.searchParams.has('playlist');
  } catch (_) {
    return /\.m3u8?(\?|$)/i.test(String(url || ''));
  }
}

function sanitizeHeaders(headers) {
  const output = {};
  if (!headers || typeof headers !== 'object') return output;
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const clean = String(value).replace(/[\r\n]+/g, ' ').trim();
    if (!clean) continue;
    output[String(key).toLowerCase()] = clean.slice(0, 2048);
  }
  return output;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);
}

/** Crea un ticket firmado que autoriza exactamente una URL (y sus cabeceras). */
function mintTicket(url, headers = {}, options = {}) {
  const secret = options.secret || gatewaySecret(options.env);
  const ttlMs = intFrom(options.ttlMs, DEFAULT_TICKET_TTL_MS, 1000, 24 * 60 * 60 * 1000);
  const body = {
    u: String(url),
    h: sanitizeHeaders(headers),
    e: Date.now() + ttlMs,
  };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifyTicket(token, options = {}) {
  const secret = options.secret || gatewaySecret(options.env);
  const text = String(token || '');
  const dot = text.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = text.slice(0, dot);
  const signature = text.slice(dot + 1);
  const expected = sign(payload, secret);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  let body;
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!body || typeof body.u !== 'string') return null;
  let target;
  try {
    target = new URL(body.u);
  } catch (_) {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  const now = options.now || Date.now();
  if (!Number.isFinite(body.e) || body.e < now) return null;
  return { url: target.href, headers: sanitizeHeaders(body.h) };
}

/**
 * Acepta el formato nuevo (ticket firmado) o el antiguo `?u=<base64url>`.
 * En el formato antiguo se exige que el valor sea base64url de una URL
 * absoluta: nunca se acepta `http://…` en claro, para que el endpoint no se
 * pueda confundir con un proxy abierto por simple inspección de la URL.
 */
function decodeTarget(token, legacyUrl, options = {}) {
  if (token) {
    const verified = verifyTicket(token, options);
    if (verified) return verified;
    return null;
  }
  if (!options.allowUnsigned) return null;
  const raw = String(legacyUrl || '').trim();
  if (!raw || /^[a-z]+:\/\//i.test(raw)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch (_) {
    return null;
  }
  try {
    const url = new URL(decoded);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { url: url.href, headers: {} };
  } catch (_) {
    return null;
  }
}

function routeForUrl(url) {
  return isPlaylistUrl(url) ? `${ROUTE_PREFIX}playlist.m3u8` : `${ROUTE_PREFIX}segment`;
}

/** URL pública de la pasarela para un recurso dado. */
function buildGatewayUrl(baseUrl, targetUrl, headers = {}, options = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  const token = mintTicket(targetUrl, headers, options);
  return `${base}${routeForUrl(targetUrl)}?t=${token}`;
}

/**
 * Reescribe un playlist HLS: variantes, segmentos, claves AES y `EXT-X-MAP`
 * pasan por la pasarela conservando las cabeceras del ticket original.
 * `mint(absoluteUrl)` debe devolver la URL pública equivalente.
 */
function rewritePlaylist(text, playlistUrl, mint) {
  const base = playlistUrl;
  const resolve = (uri) => {
    const clean = String(uri || '').trim();
    if (!clean || clean.startsWith('data:') || clean.startsWith('urn:')) return '';
    try {
      const absolute = new URL(clean, base);
      // `skd://` (FairPlay), `blob:` y similares no son recuperables por HTTP:
      // se dejan tal cual para no romper el playlist si el CDN los usa.
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return '';
      return absolute.href;
    } catch (_) {
      return '';
    }
  };

  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]*)"/gi, (match, uri) => {
          const absolute = resolve(uri);
          if (!absolute) return match;
          return `URI="${mint(absolute)}"`;
        });
      }
      const absolute = resolve(trimmed);
      if (!absolute) return line;
      return mint(absolute);
    })
    .join('\n');
}

function counterResetIfNeeded(now = Date.now()) {
  const key = dayKeyOf(now);
  if (key !== state.dayKey) {
    state.dayKey = key;
    state.bytesToday = 0;
    state.blockedByBudget = 0;
  }
}

function gatewayStatus(env = process.env) {
  const options = resolveGatewayOptions(env);
  counterResetIfNeeded();
  return {
    mode: options.mode,
    enabled: options.enabled,
    budgetBytes: options.dailyBudgetBytes,
    bytesToday: state.bytesToday,
    budgetUsedPct: options.dailyBudgetBytes
      ? Math.min(100, Math.round((state.bytesToday / options.dailyBudgetBytes) * 100))
      : 0,
    requests: state.requests,
    playlists: state.playlistRewrites,
    segments: state.segments,
    activeConnections: state.active,
    maxConcurrent: options.maxConcurrent,
    blockedByBudget: state.blockedByBudget,
    secret: options.secret || state.fallbackSecret ? 'configured' : 'missing',
    lastError: state.lastError,
  };
}

function resetGatewayState() {
  state.bytesToday = 0;
  state.requests = 0;
  state.playlistRewrites = 0;
  state.segments = 0;
  state.active = 0;
  state.blockedByBudget = 0;
  state.lastError = '';
  state.dayKey = dayKeyOf(Date.now());
  state.fallbackSecret = '';
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

/** Petición upstream que devuelve el `IncomingMessage` (stream) sin buffers. */
function requestUpstream(target, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      servername: url.hostname,
    }, (res) => {
      const status = res.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects < MAX_REDIRECTS) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        requestUpstream(next, options, redirects + 1).then(resolve, reject);
        return;
      }
      res.setTimeout(options.idleTimeoutMs || 25000, () => res.destroy(new Error('Timeout de datos upstream')));
      resolve({ res, finalUrl: url.href });
    });

    req.setTimeout(options.connectTimeoutMs || 8000, () => req.destroy(new Error('Timeout conectando upstream')));
    req.on('error', reject);
    if (options.signal && options.signal.aborted) {
      req.destroy(new Error('Petición cancelada'));
      return;
    }
    req.end();
  });
}

function readSmallBody(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        reject(new Error('Playlist demasiado grande'));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

function countBytes(bytes) {
  if (!bytes) return;
  state.bytesToday += bytes;
}

function overBudget(options) {
  counterResetIfNeeded();
  return options.dailyBudgetBytes > 0 && state.bytesToday >= options.dailyBudgetBytes;
}

/**
 * Maneja `GET|HEAD /g/...`. Devuelve `true` si la ruta pertenece a la
 * pasarela (aunque responda con error), para que el servidor no siga buscando.
 */
async function handleGatewayRequest(req, res, context = {}) {
  const env = context.env || process.env;
  const options = resolveGatewayOptions(env);
  const parsedUrl = context.url || new URL(req.url || '/', 'http://gateway.local');
  const pathname = parsedUrl.pathname;

  const isGatewayPath = pathname.startsWith(ROUTE_PREFIX) || pathname === LEGACY_ROUTE;
  if (!isGatewayPath) return false;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  if (!options.enabled) {
    sendJson(res, 404, {
      error: 'Pasarela desactivada',
      hint: 'Actívala con STREAM_GATEWAY=auto|on en los secretos de Beamup',
    });
    return true;
  }

  const target = decodeTarget(
    parsedUrl.searchParams.get('t'),
    parsedUrl.searchParams.get('u'),
    { secret: gatewaySecret(env), allowUnsigned: options.allowUnsigned },
  );
  if (!target) {
    sendJson(res, 403, { error: 'Ticket inválido, expirado o URL no permitida' });
    return true;
  }

  if (!options.allowPrivate) {
    let host = '';
    try {
      host = new URL(target.url).hostname;
    } catch (_) {
      host = '';
    }
    if (isPrivateHost(host)) {
      sendJson(res, 403, { error: 'Destino no permitido (red interna)', host });
      return true;
    }
  }

  if (overBudget(options)) {
    state.blockedByBudget += 1;
    sendJson(res, 503, {
      error: 'Presupuesto diario de retransmisión agotado',
      hint: 'Sube STREAM_GATEWAY_DAILY_MB o pon STREAM_GATEWAY=off; los streams directos siguen funcionando',
    }, { 'Retry-After': '3600' });
    return true;
  }

  if (state.active >= options.maxConcurrent) {
    sendJson(res, 503, {
      error: 'Demasiadas retransmisiones simultáneas',
      limit: options.maxConcurrent,
    }, { 'Retry-After': '5' });
    return true;
  }

  const wantsPlaylist = /playlist|\.m3u8$/i.test(pathname) || isPlaylistUrl(target.url);
  const clientRange = req.headers.range;
  const upstreamHeaders = {
    'Accept-Encoding': 'identity',
    'User-Agent': target.headers['user-agent'] || 'Mozilla/5.0 (Streamflix2 Gateway)',
    ...target.headers,
  };
  if (clientRange && !wantsPlaylist) upstreamHeaders.Range = clientRange;

  state.requests += 1;
  state.active += 1;
  const abort = new AbortController();

  const onClose = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on('close', onClose);

  try {
    const { res: upstream, finalUrl } = await requestUpstream(target.url, {
      method: req.method,
      headers: upstreamHeaders,
      connectTimeoutMs: options.connectTimeoutMs,
      idleTimeoutMs: options.idleTimeoutMs,
      signal: abort.signal,
    });

    if (upstream.statusCode >= 400) {
      state.lastError = `Upstream ${upstream.statusCode} en ${new URL(target.url).host}`;
      upstream.resume();
      sendJson(res, 502, {
        error: 'El origen rechazó la petición',
        status: upstream.statusCode,
        host: new URL(target.url).host,
        hint: 'Revisa Referer/cookies del proveedor o desactiva la pasarela',
      });
      return true;
    }

    const upstreamType = String(upstream.headers['content-type'] || '').toLowerCase();
    const isPlaylistResponse = wantsPlaylist
      || upstreamType.includes('mpegurl')
      || upstreamType.includes('application/x-mpegurl');

    if (isPlaylistResponse) {
      const text = await readSmallBody(upstream, PLAYLIST_MAX_BYTES);
      countBytes(Buffer.byteLength(text));
      state.playlistRewrites += 1;
      const base = finalUrl || target.url;
      const body = rewritePlaylist(text, base, (absolute) => buildGatewayUrl(
        context.baseUrl || '',
        absolute,
        target.headers,
        { secret: gatewaySecret(env), ttlMs: options.ticketTtlMs },
      ));
      res.writeHead(200, {
        ...CORS_HEADERS,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
      return true;
    }

    const headers = { ...CORS_HEADERS };
    for (const key of PASSTHROUGH_RESPONSE_HEADERS) {
      if (upstream.headers[key]) headers[key] = upstream.headers[key];
    }
    res.writeHead(upstream.statusCode || 200, headers);
    if (req.method === 'HEAD') {
      upstream.resume();
      res.end();
      return true;
    }
    state.segments += 1;
    // Retransmisión manual (no `pipe`) para poder cortar limpio a mitad de
    // segmento si el presupuesto se agota, y para respetar contrapresión.
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      upstream.unpipe(res);
      upstream.destroy();
      if (!res.writableEnded) res.end();
    };

    upstream.on('data', (chunk) => {
      if (stopped) return;
      countBytes(chunk.length);
      if (options.dailyBudgetBytes > 0 && state.bytesToday >= options.dailyBudgetBytes) {
        state.blockedByBudget += 1;
        state.lastError = 'Presupuesto diario agotado durante la retransmisión';
        stop();
        return;
      }
      if (!res.write(chunk)) {
        upstream.pause();
        res.once('drain', () => {
          if (!stopped) upstream.resume();
        });
      }
    });
    upstream.on('end', () => {
      if (stopped) return;
      stopped = true;
      res.end();
    });
    upstream.on('error', stop);
    res.on('close', () => {
      if (stopped) return;
      stopped = true;
      upstream.destroy();
    });
    return true;
  } catch (error) {
    state.lastError = error && error.message ? error.message : 'Error desconocido';
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: 'No se pudo contactar con el origen',
        detail: state.lastError,
      });
    } else {
      res.destroy();
    }
    return true;
  } finally {
    res.off('close', onClose);
    state.active = Math.max(0, state.active - 1);
  }
}

module.exports = {
  ROUTE_PREFIX,
  isPrivateHost,
  resolveGatewayOptions,
  gatewaySecret,
  gatewayStatus,
  resetGatewayState,
  mintTicket,
  verifyTicket,
  decodeTarget,
  rewritePlaylist,
  buildGatewayUrl,
  isPlaylistUrl,
  routeForUrl,
  handleGatewayRequest,
};
