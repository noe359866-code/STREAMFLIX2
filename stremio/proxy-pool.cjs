'use strict';

/**
 * Pool de proxies HTTP(S) para el raspado del lado del servidor.
 *
 * Problema que resuelve: los 31 proveedores se ejecutan en el contenedor de
 * Beamup (IP de datacenter), y muchos de los sitios los rechazan con 403/Cloudflare.
 * Nuvio no lo sufre porque ejecuta los proveedores en el dispositivo del usuario.
 *
 * Este módulo descarga una lista pública de proxies (por defecto ProxyScrape v4),
 * verifica cada uno con un túnel `CONNECT` real y expone:
 *   - `proxyFetch(url, init, proxy)`  petición HTTP/1.1 tunelizada (sin dependencias)
 *   - `runWithProxy(proxy, fn)`       ejecuta código con ese proxy activo
 *   - `installProxyFetchHook()`       hace que `globalThis.fetch` use el proxy
 *                                     activo del contexto asíncrono actual
 *
 * Sin paquetes externos: se usa `http`/`tls` de Node y la `Response` nativa.
 */

const http = require('node:http');
const tls = require('node:tls');
const zlib = require('node:zlib');
const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_LIST_URL = 'https://api.proxyscrape.com/v4/free-proxy-list/get'
  + '?request=display_proxies&protocol=http&ssl=yes&anonymity=elite'
  + '&timeout=5000&format=json&limit=150';

const DEFAULT_CANARY_HOST = 'v3-cinemeta.strem.io';
const DEFAULT_CANARY_PORT = 443;

// `fetch` sin proxy. Se resuelve en tiempo de llamada (no al cargar el módulo)
// para no romper a quien reemplace `globalThis.fetch` después (pruebas, mocks).
let previousFetch = typeof globalThis.fetch === 'function'
  ? globalThis.fetch.bind(globalThis)
  : null;

let proxyAwareFetch = null;

function unproxiedFetch(input, init) {
  const current = globalThis.fetch;
  if (typeof current === 'function' && current !== proxyAwareFetch) {
    return current(input, init);
  }
  if (typeof previousFetch === 'function') return previousFetch(input, init);
  throw new Error('fetch no disponible en este runtime');
}

const proxyContext = new AsyncLocalStorage();

const state = {
  enabled: false,
  healthy: [],
  lastRefreshAt: 0,
  lastError: '',
  candidates: 0,
  canary: `${DEFAULT_CANARY_HOST}:${DEFAULT_CANARY_PORT}`,
  refreshing: null,
  cursor: 0,
};

let hookInstalled = false;

function intFrom(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function resolveOptions(env = process.env) {
  return {
    listUrl: String(env.PROXY_LIST_URL || DEFAULT_LIST_URL),
    poolSize: intFrom(env.PROXY_POOL_SIZE, 8, 1, 40),
    candidates: intFrom(env.PROXY_CANDIDATES, 40, 2, 400),
    probeTimeoutMs: intFrom(env.PROXY_PROBE_TIMEOUT_MS, 4000, 800, 15000),
    refreshMs: intFrom(env.PROXY_REFRESH_MS, 10 * 60 * 1000, 60 * 1000, 6 * 60 * 60 * 1000),
    canaryHost: String(env.PROXY_CANARY_HOST || DEFAULT_CANARY_HOST),
    canaryPort: intFrom(env.PROXY_CANARY_PORT, DEFAULT_CANARY_PORT, 1, 65535),
    canaryTls: String(env.PROXY_CANARY_TLS || '1').trim().toLowerCase() !== '0',
  };
}

function normalizeEntry(raw) {
  if (!raw) return null;
  let host = '';
  let port = 0;
  let meta = {};

  if (typeof raw === 'string') {
    const match = raw.trim().match(/^([^\s:]+):(\d{1,5})$/);
    if (!match) return null;
    host = match[1];
    port = Number(match[2]);
  } else if (typeof raw === 'object') {
    meta = raw;
    const composed = String(raw.proxy || raw.proxy_address || '').trim();
    if (composed && composed.includes(':')) {
      const [h, p] = composed.split(':');
      host = h;
      port = Number(p);
    } else if (raw.ip) {
      host = String(raw.ip).trim();
      port = Number(raw.port);
    }
  }

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;

  const protocol = String(meta.protocol || 'http').toLowerCase();
  if (protocol !== 'http' && protocol !== 'https') return null;
  if (meta.ssl === false) return null;

  return {
    id: `${host}:${port}`,
    host,
    port,
    protocol,
    uptime: Number(meta.uptime) || 0,
    avgTimeoutMs: Number(meta.average_timeout) || 9999,
    country: (meta.ip_data && (meta.ip_data.countryCode || meta.ip_data.country)) || '',
  };
}

/**
 * Acepta el JSON de ProxyScrape v4 (`{ proxies: [...] }`), un array de objetos
 * o el formato de texto clásico (`ip:puerto` por línea).
 */
function parseProxyList(payload) {
  const entries = [];

  if (typeof payload === 'string') {
    for (const line of payload.split(/\r?\n/)) {
      entries.push(line.trim());
    }
  } else if (Array.isArray(payload)) {
    entries.push(...payload);
  } else if (payload && Array.isArray(payload.proxies)) {
    entries.push(...payload.proxies);
  } else if (payload && Array.isArray(payload.data)) {
    entries.push(...payload.data);
  }

  const seen = new Set();
  const parsed = [];
  for (const raw of entries) {
    const entry = normalizeEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    parsed.push(entry);
  }

  // Prioriza los que declaran más tiempo activo y menor latencia media.
  parsed.sort((a, b) => (b.uptime - a.uptime) || (a.avgTimeoutMs - b.avgTimeoutMs));
  return parsed;
}

/**
 * Comprueba un proxy abriendo un túnel CONNECT y completando el handshake TLS
 * contra el canario. Devuelve el tiempo total en ms o `null` si no sirve.
 */
function probeProxy(proxy, options = {}) {
  const canaryHost = options.canaryHost || DEFAULT_CANARY_HOST;
  const canaryPort = options.canaryPort || DEFAULT_CANARY_PORT;
  const timeoutMs = options.timeoutMs || 4000;
  const useTls = options.canaryTls !== false;
  const target = `${canaryHost}:${canaryPort}`;

  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: target,
      headers: { Host: target, 'Proxy-Connection': 'keep-alive' },
      timeout: timeoutMs,
    });

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        finish(null);
        return;
      }
      if (!useTls) {
        // Canario sin TLS (solo pruebas locales): basta con el túnel abierto.
        const elapsed = Date.now() - startedAt;
        socket.destroy();
        finish(elapsed);
        return;
      }
      const secure = tls.connect({ socket, servername: canaryHost }, () => {
        const elapsed = Date.now() - startedAt;
        secure.destroy();
        socket.destroy();
        finish(elapsed);
      });
      secure.on('error', () => {
        socket.destroy();
        finish(null);
      });
      secure.setTimeout(timeoutMs, () => {
        secure.destroy();
        socket.destroy();
        finish(null);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
    req.end();
  });
}

async function probeBatch(candidates, options, wanted, sink) {
  const batchSize = 10;
  for (let i = 0; i < candidates.length && sink.length < wanted; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (proxy) => ({
      proxy,
      latency: await probeProxy(proxy, {
        canaryHost: options.canaryHost,
        canaryPort: options.canaryPort,
        canaryTls: options.canaryTls,
        timeoutMs: options.probeTimeoutMs,
      }),
    })));
    for (const item of results) {
      if (item.latency == null) continue;
      sink.push({ ...item.proxy, latencyMs: item.latency });
      if (sink.length >= wanted) break;
    }
  }
  return sink;
}

async function refreshPool(env = process.env) {
  const options = resolveOptions(env);
  state.canary = `${options.canaryHost}:${options.canaryPort}`;

  try {
    const res = await unproxiedFetch(options.listUrl, {
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined,
    });
    if (!res.ok) throw new Error(`lista de proxies HTTP ${res.status}`);
    const text = await res.text();
    let payload = text;
    try {
      payload = JSON.parse(text);
    } catch (_) { /* formato texto */ }

    const parsed = parseProxyList(payload);
    state.candidates = parsed.length;
    const candidates = parsed.slice(0, options.candidates);
    const healthy = await probeBatch(candidates, options, options.poolSize, []);

    state.healthy = healthy;
    state.lastRefreshAt = Date.now();
    state.lastError = healthy.length ? '' : 'ningún proxy del listado superó la prueba';
    state.cursor = 0;
  } catch (error) {
    state.lastError = error && error.message ? error.message : 'error desconocido';
    state.lastRefreshAt = Date.now();
  }

  return state;
}

/**
 * Garantiza que el pool esté construido y fresco. Devuelve la lista de proxies
 * sanos (puede ser vacía). Nunca lanza.
 */
async function ensurePool(env = process.env, options = {}) {
  state.enabled = true;
  const { refreshMs } = resolveOptions(env);
  const age = Date.now() - state.lastRefreshAt;

  if (!options.force && age < refreshMs && (state.healthy.length > 0 || state.lastRefreshAt > 0)) {
    return state.healthy;
  }

  if (state.refreshing) return state.refreshing;

  state.refreshing = refreshPool(env)
    .then((snapshot) => snapshot.healthy)
    .catch(() => [])
    .finally(() => {
      state.refreshing = null;
    });

  return state.refreshing;
}

function getHealthyProxy() {
  if (!state.healthy.length) return null;
  const proxy = state.healthy[state.cursor % state.healthy.length];
  state.cursor += 1;
  return proxy;
}

function proxyStatus() {
  return {
    enabled: state.enabled,
    healthy: state.healthy.length,
    candidates: state.candidates,
    lastRefreshAt: state.lastRefreshAt ? new Date(state.lastRefreshAt).toISOString() : null,
    lastError: state.lastError,
    canary: state.canary,
  };
}

function resetProxyPool() {
  state.healthy = [];
  state.lastRefreshAt = 0;
  state.lastError = '';
  state.candidates = 0;
  state.cursor = 0;
  state.refreshing = null;
}

/* ------------------------------------------------------------------------- */
/* Cliente HTTP/1.1 tunelizado (sin dependencias)                            */
/* ------------------------------------------------------------------------- */

function headerObjectToEntries(headers) {
  if (!headers) return [];
  if (typeof headers.entries === 'function') return [...headers.entries()];
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers).filter(([, value]) => value !== undefined && value !== null);
}

function headerValue(entries, name) {
  const lower = name.toLowerCase();
  const found = entries.find(([key]) => String(key).toLowerCase() === lower);
  return found ? String(found[1]) : '';
}

function decodeBody(buffer, encoding) {
  const kind = String(encoding || '').toLowerCase().trim();
  try {
    if (kind === 'gzip' || kind === 'x-gzip') return zlib.gunzipSync(buffer);
    if (kind === 'deflate') return zlib.inflateSync(buffer);
    if (kind === 'br') return zlib.brotliDecompressSync(buffer);
  } catch (_) { /* devolver tal cual si no se puede descomprimir */ }
  return buffer;
}

function parseHeaders(rawHeaders) {
  const headers = {};
  for (const line of rawHeaders) {
    const index = line.indexOf(':');
    if (index < 1) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!name) continue;
    if (headers[name]) headers[name] = `${headers[name]}, ${value}`;
    else headers[name] = value;
  }
  return headers;
}

function readResponseFromSocket(socket, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let headerEnd = -1;
    let status = 0;
    let headers = {};
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`Timeout de respuesta vía proxy (${timeoutMs} ms)`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    const evaluate = () => {
      if (headerEnd < 0) {
        const idx = buffer.indexOf('\r\n\r\n');
        if (idx < 0) return false;
        headerEnd = idx;
        const head = buffer.subarray(0, idx).toString('latin1');
        const lines = head.split('\r\n');
        const statusMatch = lines.shift().match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
        if (!statusMatch) {
          finish(new Error('Respuesta HTTP inválida vía proxy'));
          return true;
        }
        status = Number(statusMatch[1]);
        headers = parseHeaders(lines);
        buffer = buffer.subarray(idx + 4);
      }

      const transferEncoding = String(headers['Transfer-Encoding'] || headers['transfer-encoding'] || '').toLowerCase();
      let body = null;

      if (status === 204 || status === 304) {
        body = Buffer.alloc(0);
      } else if (transferEncoding.includes('chunked')) {
        const parsed = parseChunked(buffer);
        if (!parsed.complete) return false;
        body = parsed.body;
      } else {
        const lengthHeader = headers['Content-Length'] || headers['content-length'];
        if (lengthHeader !== undefined) {
          const length = Number(lengthHeader);
          if (!Number.isFinite(length)) return false;
          if (buffer.length < length) return false;
          body = buffer.subarray(0, length);
        } else {
          // Sin longitud: el cuerpo termina al cerrar la conexión.
          return false;
        }
      }

      finish(null, { status, headers, body: decodeBody(body, headers['Content-Encoding'] || headers['content-encoding']) });
      return true;
    };

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      evaluate();
    });

    socket.on('close', () => {
      if (settled) return;
      // Conexión cerrada: sirve como fin de cuerpo si no había longitud.
      if (headerEnd >= 0) {
        const transferEncoding = String(headers['Transfer-Encoding'] || headers['transfer-encoding'] || '').toLowerCase();
        let body = null;
        if (transferEncoding.includes('chunked')) {
          const parsed = parseChunked(buffer);
          body = parsed.body;
        } else {
          body = buffer;
        }
        finish(null, { status, headers, body: decodeBody(body, headers['Content-Encoding'] || headers['content-encoding']) });
        return;
      }
      finish(new Error('Conexión cerrada por el proxy antes de responder'));
    });

    socket.on('error', (error) => finish(error));
    socket.on('timeout', () => finish(new Error('Timeout del socket vía proxy')));

    evaluate();
  });
}

function parseChunked(buffer) {
  const parts = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) return { complete: false, body: null };
    const sizeLine = buffer.subarray(offset, lineEnd).toString('latin1').split(';')[0].trim();
    const size = parseInt(sizeLine, 16);
    if (!Number.isFinite(size)) return { complete: false, body: null };
    if (size === 0) {
      const trailerEnd = buffer.indexOf('\r\n', lineEnd);
      if (trailerEnd < 0) return { complete: false, body: null };
      return { complete: true, body: Buffer.concat(parts) };
    }
    const start = lineEnd + 2;
    const end = start + size;
    if (buffer.length < end + 2) return { complete: false, body: null };
    parts.push(buffer.subarray(start, end));
    offset = end + 2;
  }
  return { complete: false, body: null };
}

function buildRawRequest({ method, url, headers, body }) {
  const target = new URL(url);
  const entries = [['Host', target.host]];
  const skip = new Set(['connection', 'proxy-connection', 'content-length', 'host', 'keep-alive', 'transfer-encoding']);
  for (const [key, value] of headers) {
    if (skip.has(String(key).toLowerCase())) continue;
    entries.push([key, value]);
  }
  if (!headerValue(entries, 'accept-encoding')) entries.push(['Accept-Encoding', 'gzip, deflate']);
  if (body && body.length) entries.push(['Content-Length', String(body.length)]);
  entries.push(['Connection', 'close']);

  const lines = [`${method} ${target.pathname}${target.search || ''} HTTP/1.1`];
  for (const [key, value] of entries) lines.push(`${key}: ${value}`);
  return { head: `${lines.join('\r\n')}\r\n\r\n`, target };
}

function openTunnel(proxy, target, timeoutMs) {
  const host = target.hostname;
  const port = target.port ? Number(target.port) : (target.protocol === 'https:' ? 443 : 80);
  const authority = `${host}:${port}`;

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority, 'Proxy-Connection': 'keep-alive' },
      timeout: timeoutMs,
    });

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy rechazó CONNECT (${res.statusCode})`));
        return;
      }
      socket.setTimeout(timeoutMs);
      if (target.protocol === 'https:') {
        const secure = tls.connect({ socket, servername: host, ALPNProtocols: ['http/1.1'] });
        secure.on('error', (error) => reject(error));
        secure.setTimeout(timeoutMs, () => secure.destroy(new Error('Timeout TLS vía proxy')));
        resolve(secure);
      } else {
        resolve(socket);
      }
    });

    req.on('timeout', () => req.destroy(new Error('Timeout abriendo túnel CONNECT')));
    req.on('error', (error) => reject(error));
    req.end();
  });
}

/**
 * Equivalente mínimo de `fetch` enviando la petición por el proxy indicado.
 * Sigue redirecciones y devuelve una `Response` nativa de Node.
 */
async function proxyFetch(input, init = {}, proxy, options = {}) {
  if (!proxy || !proxy.host) throw new Error('Proxy no válido');

  let url = typeof input === 'string'
    ? input
    : (input instanceof URL ? input.href : (input && input.url));
  if (!url) throw new Error('URL no válida para proxyFetch');

  const timeoutMs = intFrom(options.timeoutMs || init.proxyTimeoutMs, 15000, 1000, 60000);
  const maxRedirects = intFrom(options.maxRedirects, 5, 0, 10);
  const method = String(init.method || 'GET').toUpperCase();
  const headers = headerObjectToEntries(init.headers);

  let body = null;
  if (init.body != null) {
    if (Buffer.isBuffer(init.body)) body = init.body;
    else if (typeof init.body === 'string') body = Buffer.from(init.body, 'utf8');
    else if (init.body instanceof URLSearchParams) body = Buffer.from(init.body.toString(), 'utf8');
    else if (typeof init.body === 'object' && typeof init.body.byteLength === 'number') body = Buffer.from(init.body);
    else body = Buffer.from(String(init.body), 'utf8');
  }

  let currentMethod = method;
  let currentBody = body;
  let redirects = 0;

  for (;;) {
    if (init.signal && init.signal.aborted) throw new Error('Petición abortada');

    const target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error(`Protocolo no soportado: ${target.protocol}`);
    }

    const socket = await openTunnel(proxy, target, timeoutMs);
    let result;
    try {
      const { head } = buildRawRequest({ method: currentMethod, url, headers, body: currentBody });
      socket.write(head);
      if (currentBody && currentBody.length) socket.write(currentBody);
      result = await readResponseFromSocket(socket, { timeoutMs });
    } catch (error) {
      socket.destroy();
      throw error;
    }

    const location = result.headers.Location || result.headers.location;
    const redirectable = [301, 302, 303, 307, 308].includes(result.status) && location && redirects < maxRedirects;
    if (!redirectable) {
      const responseBody = (result.status === 204 || result.status === 304) ? null : result.body;
      return new Response(responseBody, {
        status: result.status,
        headers: Object.entries(result.headers),
      });
    }

    url = new URL(location, url).href;
    redirects += 1;
    if (result.status === 303 || ((result.status === 301 || result.status === 302) && currentMethod === 'POST')) {
      currentMethod = 'GET';
      currentBody = null;
    }
  }
}

/** Ejecuta `fn` con `proxy` como proxy activo para `globalThis.fetch`. */
function runWithProxy(proxy, fn) {
  if (!proxy) return fn();
  return proxyContext.run(proxy, fn);
}

function installProxyFetchHook() {
  if (hookInstalled) return;
  if (typeof globalThis.fetch !== 'function') return;
  previousFetch = globalThis.fetch.bind(globalThis);
  proxyAwareFetch = function (input, init) {
    const proxy = proxyContext.getStore();
    if (!proxy || (typeof input !== 'string' && !(input instanceof URL))) {
      return unproxiedFetch(input, init);
    }
    return proxyFetch(input, init || {}, proxy);
  };
  hookInstalled = true;
  globalThis.fetch = proxyAwareFetch;
}

/** Restaura el `fetch` previo (usado por las pruebas). */
function uninstallProxyFetchHook() {
  if (!hookInstalled) return;
  if (proxyAwareFetch && globalThis.fetch === proxyAwareFetch && typeof previousFetch === 'function') {
    globalThis.fetch = previousFetch;
  }
  proxyAwareFetch = null;
  hookInstalled = false;
}

module.exports = {
  proxyContext,
  parseProxyList,
  probeProxy,
  ensurePool,
  refreshPool,
  getHealthyProxy,
  proxyStatus,
  resetProxyPool,
  proxyFetch,
  runWithProxy,
  installProxyFetchHook,
  uninstallProxyFetchHook,
  resolveOptions,
};
