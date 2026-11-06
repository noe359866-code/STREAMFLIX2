import { decodeBase64Binary } from './base64.js';
import { absoluteUrl } from './text.js';
import { isPlayableUrl } from './streams.js';
import { requestHeaders } from './http.js';

/**
 * Nupload codifica el origen del player como una matriz de números Base64 y
 * concatena un token efímero `sesz`. Solo se interpreta esa expresión literal;
 * no se ejecuta JavaScript de terceros ni se reutiliza el token para otro título.
 * El resultado aún es una puerta (?s=), NO una URL de vídeo.
 */
export function nuploadEndpointFromHtml(html) {
  const source = String(html || '');
  if (source.length > 400000) return '';
  const loop = /\b([a-z_$][\w$]*)\.forEach\(function\s+[a-z_$][\w$]*\(value\)\s*\{\s*([a-z_$][\w$]*)\s*\+=\s*String\.fromCharCode\(parseInt\(atob\(value\)\.replace\(\/\\D\/g\s*,\s*["']["']\)\)\s*-\s*(\d+)\)/i.exec(source);
  if (!loop) return '';
  const [, arrayName, outputName, offset] = loop;
  const quoted = (name) => name.replace(/[$]/g, '\\$&');
  const array = new RegExp(`\\b${quoted(arrayName)}\\s*=\\s*(\\[[^\\]]{1,120000}\\])`, 'i').exec(source)?.[1];
  if (!array) return '';
  const inner = array.slice(1, -1);
  const values = [...inner.matchAll(/(["'])([a-zA-Z0-9+/=_-]{8,100})\1/g)];
  if (values.length < 8 || values.length > 200 || inner.replace(/(["'])[a-zA-Z0-9+/=_-]{8,100}\1/g, '').replace(/[\s,]/g, '')) return '';
  let base = '';
  try {
    for (const match of values) {
      const decoded = decodeBase64Binary(match[2]).replace(/\D/g, '');
      const code = Number(decoded) - Number(offset);
      if (!decoded || !Number.isInteger(code) || code < 32 || code > 126) return '';
      base += String.fromCharCode(code);
    }
  } catch (_) { return ''; }
  // La puerta observada pertenece exclusivamente a svN.ibra.lat.
  if (!/^https:\/\/sv\d+\.ibra\.lat\/$/i.test(base)) return '';
  const file = /\bfile\s*:\s*([a-z_$][\w$]*)\s*\+\s*(["'])([^"']*)\2\s*\+\s*([a-z_$][\w$]*)\s*\+\s*(["'])([^"']*)\5/i.exec(source);
  if (!file || file[1] !== outputName || file[3] !== '?s=' || file[6] !== '') return '';
  const token = new RegExp(`\\b${quoted(file[4])}\\s*=\\s*(["'])([^"']{20,300})\\1`, 'i').exec(source)?.[2] || '';
  if (!/^[a-zA-Z0-9%+/_=-]{20,300}$/.test(token)) return '';
  return base + '?s=' + token;
}

/** Obtiene solamente Location, sin descargar el vídeo al inspeccionar la puerta. */
export async function nuploadMediaRedirect(endpoint, referer, timeoutMs = 9000) {
  if (!/^https:\/\/sv\d+\.ibra\.lat\/\?s=[a-zA-Z0-9%+/_=-]{20,300}$/i.test(endpoint)) return '';
  let timer;
  try {
    const response = await Promise.race([
      fetch(endpoint, { method: 'GET', redirect: 'manual',
        headers: requestHeaders(referer, { Accept: '*/*', Range: 'bytes=0-4095' }) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tiempo agotado')), timeoutMs); }),
    ]);
    // Si el bridge no honra redirect:manual, aceptar únicamente un URL final
    // de vídeo explícito. El body se cancela sin leer playlists ni ficheros.
    const location = [301, 302, 303, 307, 308].includes(response.status)
      ? response.headers?.get('location') || ''
      : response.status >= 200 && response.status < 300 ? response.url || '' : '';
    if (response.body?.cancel) await response.body.cancel().catch(() => {});
    const url = absoluteUrl(location, endpoint);
    const sourceHost = endpoint.match(/^https:\/\/([^/]+)/i)?.[1];
    const mediaHost = url.match(/^https:\/\/([^/]+)/i)?.[1];
    return mediaHost === sourceHost && isPlayableUrl(url) ? url : '';
  } catch (_) { return ''; }
  finally { if (timer) clearTimeout(timer); }
}
