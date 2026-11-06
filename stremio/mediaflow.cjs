'use strict';

/**
 * Adaptador para MediaFlow Proxy (mhdzumair/mediaflow-proxy, MIT).
 *
 * Por qué existe: MediaFlow es un motor de proxy de medios mucho más maduro que
 * la pasarela incluida en este repo (DASH/ClearKey → HLS, prebuffer, selección
 * de resolución, URLs cifradas con caducidad y binding de IP, proxy upstream
 * HTTP/SOCKS). Pero **no puede correr dentro de Beamup**: es Python/FastAPI con
 * un mínimo real de 2 GB de RAM (512 MB en la reescritura Rust) y necesita un
 * servicio propio. Por eso aquí no se instala: se *delega* en una instancia que
 * el operador ya tenga (VPS, NAS, contenedor en casa, ElfHosted…).
 *
 * Orden de transporte resultante:
 *   directo → proxyHeaders (coste 0) → MediaFlow (si MEDIAFLOW_URL) → pasarela propia (si STREAM_GATEWAY)
 *
 * Sin dependencias: sólo `URL` y `fetch` de Node 20+.
 */

const state = {
  lastProbeAt: 0,
  lastProbe: null,
  probing: null,
};

const PROBE_TTL_MS = 5 * 60 * 1000;

/** Cabeceras de reproductor que MediaFlow acepta como `h_<nombre>`. */
const FORWARDABLE_HEADERS = new Set(['referer', 'origin', 'user-agent', 'cookie', 'authorization', 'x-forwarded-for']);

function intFrom(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

/** Distingue opciones ya resueltas (con `baseUrl` string) de un objeto env. */
function asOptions(source = {}) {
  if (source && typeof source.baseUrl === 'string') return source;
  return resolveMediaFlowOptions(source.env || source);
}

function normalizeBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return '';
  }
}

function resolveMediaFlowOptions(env = process.env) {
  const baseUrl = normalizeBase(env.MEDIAFLOW_URL || env.MEDIAFLOW_PROXY_URL);
  const password = String(env.MEDIAFLOW_PASSWORD || env.MEDIAFLOW_API_PASSWORD || '').trim();
  return {
    // Sin URL y contraseña no hay delegación: el addon sigue igual que antes.
    enabled: Boolean(baseUrl && password),
    baseUrl,
    password,
    probeTimeoutMs: intFrom(env.MEDIAFLOW_PROBE_TIMEOUT_MS, 6000, 1000, 30000),
    // `hls` (defecto) sirve HLS; `stream` también intenta MP4 con cabeceras.
    includeMp4: ['1', 'true', 'yes', 'on'].includes(String(env.MEDIAFLOW_INCLUDE_MP4 || '').trim().toLowerCase()),
  };
}

function isPlaylist(url) {
  return /\.m3u8?(?:$|[?#])|\/m3u8\//i.test(String(url || ''));
}

/**
 * Construye la URL de MediaFlow para un recurso.
 *
 * Se usa el formato documentado de parámetros "encoded":
 *   /proxy/hls/manifest.m3u8?d=<url>&h_referer=...&api_password=...
 * Frente a `/generate_url` (POST, URL cifrada con `token`), este formato:
 *   - no necesita una petición de red por cada stream al construir la lista,
 *   - es el que usan AIOStreams/StreamAsia y funciona en todos los clientes.
 * La contrapartida es que `api_password` viaja en la URL; si eso importa, pon
 * MediaFlow detrás de IP binding o usa `/generate_url` con `expiration`.
 */
function buildMediaFlowUrl(streamUrl, headers = {}, options = {}) {
  const opts = asOptions(options);
  if (!opts.baseUrl) return '';

  const hls = isPlaylist(streamUrl);
  const endpoint = hls ? '/proxy/hls/manifest.m3u8' : '/proxy/stream';
  const params = new URLSearchParams();
  params.set('d', String(streamUrl));

  for (const [key, value] of Object.entries(headers || {})) {
    if (!value) continue;
    const name = String(key).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!FORWARDABLE_HEADERS.has(name)) continue;
    const clean = String(value).replace(/[\r\n]+/g, ' ').trim();
    if (clean) params.set(`h_${name}`, clean);
  }

  if (!hls) {
    const filename = String(streamUrl).split('?')[0].split('/').filter(Boolean).pop() || '';
    if (filename) params.set('filename', filename);
  }

  if (opts.password) params.set('api_password', opts.password);
  return `${opts.baseUrl}${endpoint}?${params.toString()}`;
}

/** ¿Este stream puede delegarse en MediaFlow? */
function canDelegate(stream, options = {}) {
  const opts = asOptions(options);
  if (!opts.enabled) return false;
  if (!stream || !stream.url) return false;
  if (isPlaylist(stream.url) || stream.type === 'hls') return true;
  if (opts.includeMp4 && (stream.type === 'mp4' || /\.mp4(?:$|[?#])/i.test(stream.url))) return true;
  return false;
}

/**
 * Comprueba que MediaFlow responde y devuelve la IP pública del proxy
 * (`/proxy/ip`). Se cachea 5 min para que `/health` no dispare peticiones.
 */
async function probeMediaFlow(options = {}, opts = {}) {
  const resolved = asOptions(options);
  if (!resolved.enabled) return { configured: false, ok: false };
  const now = Date.now();
  if (!opts.force && state.lastProbe && now - state.lastProbeAt < PROBE_TTL_MS) {
    return { configured: true, cached: true, ...state.lastProbe };
  }
  if (state.probing) return state.probing;

  const startedAt = Date.now();
  state.probing = (async () => {
    try {
      const url = `${resolved.baseUrl}/proxy/ip?api_password=${encodeURIComponent(resolved.password)}`;
      const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(resolved.probeTimeoutMs) : undefined;
      const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
      const text = await res.text();
      let ip = '';
      try {
        const json = JSON.parse(text);
        ip = json.ip || json.public_ip || json.ip_address || '';
      } catch (_) {
        ip = text.trim().slice(0, 64);
      }
      const result = res.ok
        ? { ok: true, ip, ms: Date.now() - startedAt, error: '', at: new Date().toISOString() }
        : { ok: false, ip: '', ms: Date.now() - startedAt, error: `HTTP ${res.status}`, at: new Date().toISOString() };
      state.lastProbe = result;
      state.lastProbeAt = Date.now();
      return { configured: true, ...result };
    } catch (error) {
      const result = {
        ok: false,
        ip: '',
        ms: Date.now() - startedAt,
        error: error && error.message ? error.message : 'sin conexión',
        at: new Date().toISOString(),
      };
      state.lastProbe = result;
      state.lastProbeAt = Date.now();
      return { configured: true, ...result };
    } finally {
      state.probing = null;
    }
  })();
  return state.probing;
}

function mediaflowStatus(env = process.env) {
  const options = resolveMediaFlowOptions(env);
  return {
    configured: options.enabled,
    baseUrl: options.baseUrl,
    includeMp4: options.includeMp4,
    password: options.password ? 'configured' : 'missing',
    lastProbe: state.lastProbe,
    probedAt: state.lastProbeAt ? new Date(state.lastProbeAt).toISOString() : '',
  };
}

function resetMediaflowState() {
  state.lastProbe = null;
  state.lastProbeAt = 0;
  state.probing = null;
}

module.exports = {
  resolveMediaFlowOptions,
  asOptions,
  buildMediaFlowUrl,
  canDelegate,
  probeMediaFlow,
  mediaflowStatus,
  resetMediaflowState,
  isPlaylist,
};
