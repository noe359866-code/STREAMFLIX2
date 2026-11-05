'use strict';

const net = require('node:net');
const { normalizeProxyUrl, sanitizeToken } = require('./config.cjs');

/**
 * Impide SSRF hacia redes internas, loopback, link-local o metadatos cloud.
 * Estas mismas reglas están replicadas en `nginx/streamflix2.conf.template`.
 */
function isPrivateOrReservedHost(rawHost) {
  const host = String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return true;

  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host === 'metadata.google.internal'
    || host === 'instance-data'
  ) {
    return true;
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  // Notaciones IPv4 abreviadas o hexadecimales/octales (p. ej. 0x7f000001, 2130706433, 127.1).
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host) || /^\d+(?:\.\d+){1,2}$/.test(host)) {
    return true;
  }

  if (net.isIPv6(host) || host.includes(':')) {
    const normalized = host.toLowerCase();
    if (
      normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fe80:')
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.')
      || normalized.startsWith('::ffff:169.254.')
      || /^::ffff:172\.(?:1[6-9]|2\d|3[01])\./.test(normalized)
      || normalized.startsWith('::ffff:0.')
    ) {
      return true;
    }
  }

  return false;
}

function cleanRequestHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const cleanVal = String(value).replace(/[\r\n]+/g, ' ').trim();
    if (!cleanVal) continue;
    output[key] = cleanVal;
  }
  return output;
}

/**
 * Determina si el stream exige cabeceras especiales (`Referer`, `Origin`, `Cookie`, etc.)
 * que un navegador / Smart TV en Stremio Web no puede inyectar por su cuenta.
 */
function needsHeaderProxy(stream) {
  const headers = cleanRequestHeaders(stream && stream.headers);
  const keys = Object.keys(headers).map((key) => key.toLowerCase());
  return keys.some((key) => key === 'referer' || key === 'origin' || key === 'cookie' || key === 'authorization');
}

function extractRefererParts(headers = {}) {
  const entries = Object.entries(headers);
  const refererValue = entries.find(([k]) => k.toLowerCase() === 'referer')?.[1]
    || entries.find(([k]) => k.toLowerCase() === 'origin')?.[1]
    || '';
  if (!refererValue) return { refScheme: 'https', refHost: '_' };
  try {
    const parsed = new URL(refererValue);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
      return { refScheme: 'https', refHost: '_' };
    }
    return {
      refScheme: parsed.protocol.slice(0, -1).toLowerCase(),
      refHost: parsed.host.toLowerCase(),
    };
  } catch (_) {
    return { refScheme: 'https', refHost: '_' };
  }
}

/**
 * Extrae exactamente la ruta y query codificadas tal como venían en la URL original
 * para no invalidar firmas HMAC de CDNs como Voe, StreamWish o Cloudflare.
 */
function extractRawPathAndQuery(rawUrl) {
  const match = String(rawUrl || '').trim().match(/^https?:\/\/[^/?#]+((?:\/[^#]*)?(?:\?[^#]*)?)/i);
  if (!match) return '/';
  const tail = match[1] || '/';
  return tail.startsWith('/') ? tail : `/${tail}`;
}

/**
 * Construye una URL hacia el Nginx externo con estructura jerárquica:
 *   {proxyBase}/hlsp/[t/{token}/]{refScheme}/{refHost}/{targetScheme}/{targetHost}/{rawPath}?{rawQuery}
 *
 * Esta estructura permite que los reproductores HLS resuelvan rutas relativas de `.m3u8`
 * automáticamente dentro de `/hlsp/...` y que `sub_filter` en Nginx reescriba URLs absolutas
 * sin pasar bytes de vídeo por Beamup.
 */
function buildNginxProxyUrl(streamUrl, headers = {}, options = {}) {
  const proxyBase = normalizeProxyUrl(options.proxyUrl);
  if (!proxyBase) return null;

  let target;
  try {
    target = new URL(String(streamUrl || '').trim());
  } catch (_) {
    return null;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (target.username || target.password) return null;
  if (isPrivateOrReservedHost(target.hostname)) return null;
  if (target.port && !['80', '443', '8080', '8443'].includes(target.port)) return null;

  const { refScheme, refHost } = extractRefererParts(headers);
  if (refHost !== '_' && isPrivateOrReservedHost(refHost.split(':')[0])) return null;

  const targetScheme = target.protocol.slice(0, -1).toLowerCase();
  const targetHost = target.host.toLowerCase();
  const rawTail = extractRawPathAndQuery(streamUrl);
  const token = sanitizeToken(options.proxyToken);
  const tokenSegment = token ? `t/${encodeURIComponent(token)}/` : '';

  return `${proxyBase}/hlsp/${tokenSegment}${refScheme}/${refHost}/${targetScheme}/${targetHost}${rawTail}`;
}

module.exports = {
  isPrivateOrReservedHost,
  cleanRequestHeaders,
  needsHeaderProxy,
  extractRefererParts,
  extractRawPathAndQuery,
  buildNginxProxyUrl,
};
