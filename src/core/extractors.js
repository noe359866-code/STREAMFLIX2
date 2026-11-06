import { fetchJson, fetchText, mapLimit, origin, requestHeaders, USER_AGENT } from './http.js';
import { absoluteUrl, anchors, attributes, decodeHtml, extractBalanced, hostName, unique } from './text.js';
import { decodeBase64, decodeBase64Binary, decodeBase64Url, decodeTokenLink } from './base64.js';
import { isPlayableUrl, makeStream } from './streams.js';
import { nuploadEndpointFromHtml, nuploadMediaRedirect } from './nupload.js';

function decodeJsString(value) {
  return String(value || '').replace(/\\(u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, (_, escape) => {
    if (escape[0].toLowerCase() === 'u') return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (escape[0].toLowerCase() === 'x') return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' })[escape] ?? escape;
  });
}

function base62(value, alphabet) {
  let number = Number(value);
  if (number === 0) return alphabet[0];
  let output = '';
  while (number > 0) {
    output = alphabet[number % alphabet.length] + output;
    number = Math.floor(number / alphabet.length);
  }
  return output;
}

/** Desempaqueta eval(function(p,a,c,k,e,d)) sin usar eval. */
export function unpack(source) {
  const text = String(source || '');
  const pattern = /}\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/g;
  let output = text;
  let match;
  while ((match = pattern.exec(text))) {
    const payload = decodeJsString(match[1]);
    const radix = Number(match[2]);
    const dictionary = decodeJsString(match[4]).split('|');
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const tokens = new Map();
    for (let index = 0; index < dictionary.length; index += 1) {
      tokens.set(base62(index, alphabet.slice(0, Math.max(2, radix))), dictionary[index]);
    }
    const unpacked = payload.replace(/\b[a-zA-Z0-9]+\b/g, (token) => tokens.get(token) || token);
    output = output.replace(match[0], unpacked).replace(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/i, unpacked);
  }
  // Si había varios bloques, devolver también el original ayuda a los regex posteriores.
  return output === text ? text : `${output}\n${text}`;
}

export function unpackAll(html) {
  const scripts = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?(?:<\/script>|$)/gi) || [];
  return [String(html || ''), ...scripts.map(unpack)].join('\n');
}

function cleanMediaUrl(value, base) {
  const url = absoluteUrl(decodeHtml(value).replace(/\\u0026/gi, '&'), base);
  return isPlayableUrl(url) ? url : '';
}

export function directMediaInHtml(html, base) {
  const text = unpackAll(html);
  const output = [];
  const patterns = [
    // El sufijo debe terminar en un separador real: mp4upload.com no es
    // https://a4.mp4, ni m3u8host.com una playlist truncada.
    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?(?![\w.-])/gi,
    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?(?![\w.-])/gi,
    /(?:file|src|source|url|hls[1-4]?)\s*[:=]\s*["']([^"']+?\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi,
    /["']([^"']*?\/m3u8\/[a-zA-Z0-9_-]+[^"']*)["']/g,
    /\bwurl\b[\s\S]{0,80}?["']([^"']+)["']/gi,
    /file\s*:\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const raw = (match[1] || match[0]).replace(/\\\//g, '/');
      const url = cleanMediaUrl(raw.startsWith('//') ? `https:${raw}` : raw, base);
      if (url) output.push(url);
    }
  }
  return unique(output);
}

function subtitlesInHtml(html, base) {
  const subtitles = [];
  const regex = /(?:file|src)\s*:\s*["']([^"']+\.(?:vtt|srt)(?:\?[^"']*)?)["'][\s\S]{0,160}?(?:label|kind|language)\s*:\s*["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(unpackAll(html)))) {
    subtitles.push({ url: absoluteUrl(match[1], base), language: match[2], name: match[2] });
  }
  return subtitles;
}

function streamtapeUrl(html, base) {
  const match = String(html || '').match(/document\.getElementById\(['"](?:bot|robot)link['"]\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('([^']+)'\)\.substring\((\d+)\)/i);
  if (!match) return '';
  const path = `${match[1]}${match[2].substring(Number(match[3]))}`.replace(/&amp;/g, '&');
  return absoluteUrl(path.startsWith('http') ? path : `https:${path.startsWith('//') ? path : `//streamtape.com/${path.replace(/^\/+/, '')}`}`, base);
}

function mixdropUrl(html, base) {
  const match = unpackAll(html).match(/\bwurl\b[\s\S]{0,120}?=\s*["']([^"']+)["']/i);
  if (!match) return '';
  const value = match[1];
  return cleanMediaUrl(value.startsWith('//') ? `https:${value}` : value.startsWith('http') ? value : `https://${value}`, base);
}

function rot13(value) {
  return value.replace(/[a-z]/gi, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode((char.charCodeAt(0) - base + 13) % 26 + base);
  });
}

function decodeVoeConfig(encoded) {
  try {
    let value = rot13(encoded);
    // Marcadores del payload F7 actual de Voe; no se ejecuta ningún script del hoster.
    for (const pattern of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) value = value.split(pattern).join('_');
    value = value.replace(/_/g, '');
    const binary = decodeBase64Binary(value);
    const shifted = Array.from(binary, (char) => String.fromCharCode(char.charCodeAt(0) - 3)).reverse().join('');
    const config = JSON.parse(decodeBase64(shifted));
    return config && typeof config === 'object' ? config : null;
  } catch (_) {
    return null;
  }
}

export function voeUrls(html) {
  const text = String(html || '');
  const scripts = text.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    const raw = script[1].trim();
    let encoded = '';
    try {
      const wrapper = JSON.parse(raw);
      if (Array.isArray(wrapper) && typeof wrapper[0] === 'string') encoded = wrapper[0];
    } catch (_) { /* se prueba el envoltorio mínimo abajo */ }
    if (!encoded) encoded = raw.match(/^\[\s*"([^"]+)"\s*\]$/)?.[1] || '';
    const config = encoded ? decodeVoeConfig(encoded) : null;
    if (!config) continue;
    // direct_access_url es una descarga (/download/, d=1), no un stream del pack.
    if (isPlayableUrl(config.source)) return [config.source];
    const fallback = (Array.isArray(config.fallback) ? config.fallback : [])
      .map((item) => item?.file).filter((url) => isPlayableUrl(url));
    if (fallback.length) return unique(fallback);
  }

  const output = [];
  // Compatibilidad con despliegues antiguos de Voe con HLS directo o Base64.
  const candidates = [...text.matchAll(/(?:source|hls|file)\s*[:=]\s*["']([^"']+)["']/gi)];
  for (const match of candidates) {
    if (/\.m3u8/i.test(match[1]) && isPlayableUrl(match[1])) output.push(match[1]);
    else if (/^[a-zA-Z0-9+/=_-]{40,}$/.test(match[1])) {
      const decoded = decodeBase64Url(match[1]);
      if (decoded.includes('.m3u8') && isPlayableUrl(decoded)) output.push(decoded);
    }
  }
  return unique(output);
}

export function dataLinkCandidates(html, base) {
  const output = [];
  const raw = extractBalanced(html, 'dataLink', '[', ']');
  if (raw) {
    try {
      const items = JSON.parse(raw);
      for (const item of items) {
        const language = item.video_language || item.language || item.lang || 'es';
        const embeds = item.sortedEmbeds || item.sorted_embeds || item.embeds || [];
        for (const embed of embeds) {
          const label = embed.servername || embed.server || hostName(embed.link || '');
          if (/download|1fichier/i.test(label)) continue;
          const link = decodeTokenLink(embed.link) || (/^https?:\/\//i.test(embed.link || '') ? embed.link : '');
          if (link) output.push({ url: absoluteUrl(link, base), language, server: label });
        }
      }
    } catch (_) { /* puede no ser JSON estricto; los onclick siguen siendo útiles */ }
  }
  const onclick = /go_to_playerVast\(\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = onclick.exec(String(html || '')))) {
    const url = absoluteUrl(match[1], base);
    if (url) output.push({ url, language: 'es' });
  }
  return output;
}

/** Formato AES-CBC + prueba de trabajo usado por Embed69/FlixLatam/SoloLatino. */
export function protectedDataLinkCandidates(html, base) {
  const plain = dataLinkCandidates(html, base);
  const challenge = String(html || '').match(/(?:const|let|var)\s+POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  const difficulty = Number(String(html || '').match(/(?:const|let|var)\s+POW_DIFFICULTY\s*=\s*(\d+)/i)?.[1]);
  const salt = String(html || '').match(/(?:const|let|var)\s+POW_SALT\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (!challenge || !difficulty || difficulty > 6 || salt === undefined) return plain;
  try {
    const CryptoJS = require('crypto-js');
    const prefix = '0'.repeat(difficulty);
    let key;
    for (let nonce = 0; nonce < 2000000; nonce += 1) {
      if (CryptoJS.SHA256(challenge + nonce).toString().startsWith(prefix)) {
        key = CryptoJS.SHA256(challenge + nonce + salt);
        break;
      }
    }
    if (!key) return plain;
    const raw = extractBalanced(html, 'dataLink', '[', ']');
    const items = raw ? JSON.parse(raw) : [];
    const output = [...plain];
    for (const item of items) {
      for (const embed of item.sortedEmbeds || []) {
        if (/download|1fichier/i.test(embed.servername || '') || String(embed.link || '').split('.').length === 3) continue;
        const decoded = CryptoJS.enc.Base64.parse(embed.link);
        const iv = CryptoJS.lib.WordArray.create(decoded.words.slice(0, 4), 16);
        const ciphertext = CryptoJS.lib.WordArray.create(decoded.words.slice(4), Math.max(0, decoded.sigBytes - 16));
        const url = CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext }), key, { iv }).toString(CryptoJS.enc.Utf8);
        if (/^https?:\/\//i.test(url)) output.push({ url: absoluteUrl(url, base), language: item.video_language || 'es', server: embed.servername });
      }
    }
    return output;
  } catch (_) {
    return plain;
  }
}

async function resolveMovieMaster(candidate) {
  if (!/moviemaster\.[^/]+\/video\?/i.test(candidate.url)) return null;
  const response = await fetchJson(candidate.url, { referer: candidate.referer || 'https://api.moviemaster.lat/' });
  const url = response.data.url || response.data.source || '';
  return isPlayableUrl(url) ? [{ ...candidate, url }] : [];
}

function zilla(candidate) {
  const match = candidate.url.match(/player\.zilla-networks\.com\/(?:watch\/)?([a-zA-Z0-9_-]+)/i);
  if (!match) return null;
  return [{ ...candidate, url: `https://player.zilla-networks.com/m3u8/${match[1]}`, referer: candidate.url }];
}

async function resolveOne(candidate, context, depth) {
  if (/u\.pcloud\.link\/publink\/show/i.test(candidate.url)) {
    const code = candidate.url.match(/[?&]code=([^&]+)/i)?.[1];
    if (code) {
      const response = await fetchJson(`https://api.pcloud.com/getpublinkdownload?code=${encodeURIComponent(code)}`, { referer: candidate.url });
      const host = response.data.hosts?.[0];
      const path = response.data.path;
      if (host && path && isPlayableUrl(`https://${host}${path}`)) return [{ ...candidate, url: `https://${host}${path}` }];
    }
  }
  const directZilla = zilla(candidate);
  if (directZilla) return directZilla;
  if (isPlayableUrl(candidate.url)) return [candidate];
  const movieMaster = await resolveMovieMaster(candidate);
  if (movieMaster) return movieMaster;
  if (depth > 2) return [];

  const response = await fetchText(candidate.url, {
    referer: candidate.referer || context.referer,
    timeoutMs: context.timeoutMs || 10000,
  });
  const html = response.text;
  const pageUrl = response.url || candidate.url;
  const direct = unique([
    // El JSON autenticado de Voe tiene prioridad sobre MP4 de muestra incrustados en su página.
    ...voeUrls(html),
    ...directMediaInHtml(html, pageUrl),
    streamtapeUrl(html, pageUrl),
    mixdropUrl(html, pageUrl),
  ].filter(Boolean));
  if (direct.length) return direct.map((url) => ({ ...candidate, url, referer: pageUrl, subtitles: subtitlesInHtml(html, pageUrl) }));

  // Nupload: su URL /watch/ es HTML. La expresión numérica forma una puerta
  // temporal ?s=; solo la redirección a .m3u8/.mp4 del host observado es vídeo.
  if (/^https:\/\/nupload\.(?:my|me)\/watch\/[^/?#]+/i.test(pageUrl)) {
    const endpoint = nuploadEndpointFromHtml(html);
    if (endpoint) {
      const url = await nuploadMediaRedirect(endpoint, pageUrl);
      if (url) return [{ ...candidate, url, referer: pageUrl }];
    }
  }

  // Doodstream: la segunda petición conserva el token del reproductor.
  const pass = html.match(/(?:\$\.get|fetch)\(\s*["'](\/pass_md5\/[^"']+)["']/i);
  if (pass) {
    const token = await fetchText(absoluteUrl(pass[1], pageUrl), { referer: pageUrl });
    const tokenText = token.text.trim();
    const directUrl = html.match(/\/pass_md5\/[^"']+[\s\S]{0,500}?["'](https?:\/\/[^"']+)["']/i)?.[1];
    if (directUrl && tokenText) return [{ ...candidate, url: `${directUrl}${tokenText}`, referer: pageUrl }];
  }

  // Algunos portales anidan otro nivel de servidores en dataLink.
  const nestedServers = protectedDataLinkCandidates(html, pageUrl);
  if (nestedServers.length && depth < 2) {
    const nested = await resolveCandidates(nestedServers, { ...context, referer: pageUrl }, depth + 1);
    if (nested.length) return nested.map((item) => ({ ...item, language: item.language || candidate.language }));
  }

  // Sigue opciones públicas de iframe/hoster (incluidos data-src lazy) sin devolver el HTML como stream.
  // Se limita el fan-out para mantener rápidas las consultas concurrentes del addon.
  const nested = embedCandidatesFromHtml(html, pageUrl, { ...candidate, referer: pageUrl })
    .map((item) => ({ ...candidate, ...item, referer: pageUrl }))
    .filter((item) => item.url && item.url !== candidate.url);
  const redirect = html.match(/var\s+url\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]
    || html.match(/window\.location\.replace\(["'](https?:\/\/[^"']+)["']\)/i)?.[1]
    || html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]
    || (/window\.onload/i.test(html) ? html.match(/["'](https?:\/\/[^"']+)["']/i)?.[1] : '');
  const redirectUrl = absoluteUrl(redirect || '', pageUrl);
  if (redirectUrl && redirectUrl !== candidate.url) nested.push({ ...candidate, url: redirectUrl, referer: pageUrl });
  const nextCandidates = unique(nested, (item) => item.url).slice(0, context.maxNestedCandidates || 4);
  if (nextCandidates.length && depth < 2) {
    const resolved = await mapLimit(nextCandidates, context.parallel || 3, (item) => resolveOne(item, context, depth + 1));
    return resolved.flat();
  }
  return [];
}

export async function resolveCandidates(candidates, context = {}, depth = 0) {
  const list = (candidates || []).filter((candidate) => candidate && /^https?:\/\//i.test(candidate.url || ''))
    .slice(0, context.maxCandidates || 10);
  if (depth > 2) return [];
  const resolved = await mapLimit(list, context.parallel || 3, async (candidate) => {
    const items = await resolveOne({ ...candidate, referer: candidate.referer || context.referer }, context, depth);
    return (items || []).map((item) => makeStream(context.provider || 'Streamflix', item.url, {
      ...item,
      providerId: context.providerId,
      defaultLanguage: item.language || candidate.language || 'es',
      title: item.title || `${item.server || candidate.server || hostName(item.url)} · ${item.language || candidate.language || 'Español'}`,
      referer: item.referer || candidate.referer || context.referer,
      headers: item.headers || { 'User-Agent': USER_AGENT, Referer: item.referer || candidate.referer || context.referer || origin(item.url) + '/' },
    })).filter(Boolean);
  });
  return resolved.flat().filter(Boolean);
}

const SUPPORTED_EMBED_HOST = /streamwish|voe\.|filemoon|vidhide|mixdrop|mp4upload|streamtape|dood|yourupload|uqload|vidmoly|ok\.ru|vimeos?|goodstream|zilla|vk\.com|mail\.ru|dropload|unlimplay|earnvids|streamhg|videoapp/i;

function isSupportedEmbedUrl(url) {
  const host = String(url || '').match(/^https?:\/\/([^/:?#]+)/i)?.[1] || '';
  return SUPPORTED_EMBED_HOST.test(host);
}

export function embedCandidatesFromHtml(html, base, defaults = {}) {
  const source = String(html || '');
  const output = dataLinkCandidates(source, base);
  // Algunos catálogos cargan el player al seleccionar el servidor, usando data-src en lugar de src.
  for (const match of source.matchAll(/<iframe\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const raw = attrs.src || attrs['data-src'] || attrs['data-lazy-src'] || attrs['data-embed'] || attrs['data-url'];
    const url = absoluteUrl(raw || '', base);
    if (url) output.push({ ...defaults, url });
  }
  for (const anchor of anchors(source)) {
    const url = absoluteUrl(anchor.href, base);
    if (!url || !isSupportedEmbedUrl(url)) continue;
    output.push({ ...defaults, url, title: anchor.title || defaults.title });
  }
  // Los botones de idioma/servidor suelen guardar el embed en atributos de datos.
  for (const match of source.matchAll(/<(?:a|button|div|li)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const raw = attrs['data-server-url'] || attrs['data-embed'] || attrs['data-src'] || attrs['data-link'] || attrs['data-url'];
    const url = absoluteUrl(raw || '', base);
    if (!url || (!isPlayableUrl(url) && !isSupportedEmbedUrl(url))) continue;
    output.push({ ...defaults, url, title: attrs.title || attrs['data-server'] || defaults.title });
  }
  return unique(output, (item) => item.url);
}
