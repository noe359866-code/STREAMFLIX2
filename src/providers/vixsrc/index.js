import { createDirectProvider } from '../../core/site.js';
import { fetchJson, fetchText, withQuery, USER_AGENT } from '../../core/http.js';
import { absoluteUrl, decodeHtml } from '../../core/text.js';
import { makeStream } from '../../core/streams.js';

const BASE = 'https://vixsrc.to';
const PLAYLIST = /^https:\/\/(?:[a-z0-9-]+\.)*(?:vixsrc\.to|vixcloud\.(?:co|cc))\/playlist\/[-\w]+(?:\.m3u8)?(?:\?[^#]*)?$/i;
const EMBED = /^https:\/\/vixsrc\.to\/embed\/\d+(?:[/?#]|$)/i;
const HEADERS = { 'User-Agent': USER_AGENT, Origin: BASE,
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7' };

function mediaDeclarations(html) {
  const text = String(html || '');
  const token = /["']token["']\s*:\s*["']([\w-]{8,200})["']/i.exec(text)?.[1] || '';
  const expires = /["']expires["']\s*:\s*["'](\d{9,13})["']/i.exec(text)?.[1] || '';
  const playlist = [...text.matchAll(/["']url["']\s*:\s*["']([^"']+)["']/gi)]
    .map((match) => absoluteUrl(decodeHtml(match[1].replace(/\\u0026/gi, '&')), BASE))
    .find((url) => PLAYLIST.test(url)) || '';
  const fhd = /["']canPlayFHD["']\s*:\s*true|canPlayFHD\s*=\s*true/i.test(text);
  return { token, expires, playlist, fhd };
}

function audioLanguage(master) {
  const rows = String(master || '').split(/\r?\n/)
    .filter((line) => /^#EXT-X-MEDIA:/i.test(line) && /\bTYPE=AUDIO(?:,|$)/i.test(line));
  const preferred = rows.find((line) => /\bDEFAULT=YES(?:,|$)/i.test(line)) || rows[0] || '';
  const raw = /\bLANGUAGE=["']?([a-z-]+)["']?/i.exec(preferred)?.[1]?.toLowerCase() || '';
  if (/^(?:spa|es(?:-|$))/.test(raw)) return 'es';
  if (/^(?:eng|en(?:-|$))/.test(raw)) return 'en';
  if (/^(?:ita|it(?:-|$))/.test(raw)) return 'it';
  if (/^(?:por|pt(?:-|$))/.test(raw)) return 'pt-BR';
  return 'und';
}

function subtitlesFrom(master, playlistUrl) {
  const tracks = [];
  for (const row of String(master || '').split(/\r?\n/)) {
    if (!/^#EXT-X-MEDIA:/i.test(row) || !/\bTYPE=SUBTITLES(?:,|$)/i.test(row)) continue;
    const raw = /\bURI="([^"]+)"/i.exec(row)?.[1];
    const language = /\bLANGUAGE="?([a-z-]+)"?/i.exec(row)?.[1]?.toLowerCase() || '';
    const url = absoluteUrl(raw || '', playlistUrl);
    if (!/^https:\/\//i.test(url)) continue;
    const code = /^(?:spa|es(?:-|$))/.test(language) ? 'es'
      : /^(?:eng|en(?:-|$))/.test(language) ? 'en'
        : /^(?:ita|it(?:-|$))/.test(language) ? 'it' : '';
    if (code && !tracks.some((track) => track.url === url)) {
      tracks.push({ url, language: code, name: code === 'es' ? 'Español' : code === 'en' ? 'English' : 'Italiano' });
    }
    if (tracks.length >= 8) break;
  }
  return tracks;
}

async function streams(id, media) {
  if (!/^\d{1,12}$/.test(id)) return [];
  const path = media.mediaType === 'movie' ? `/api/movie/${id}`
    : `/api/tv/${id}/${media.season}/${media.episode}`;
  const api = await fetchJson(withQuery(`${BASE}${path}`, { lang: 'es' }), { referer: `${BASE}/` });
  const src = api.data?.src;
  const embedUrl = absoluteUrl(typeof src === 'string' ? src : '', BASE);
  if (!EMBED.test(embedUrl)) return [];
  const page = await fetchText(embedUrl, { referer: `${BASE}/`, timeoutMs: 9500 });
  const declared = mediaDeclarations(page.text);
  const expiry = Number(declared.expires) * (declared.expires.length > 10 ? 1 : 1000);
  if (!declared.playlist || !declared.token || !Number.isFinite(expiry) || expiry < Date.now() + 10000) return [];
  // Solo se completa la URL /playlist/<id> que declara el embed. El parámetro
  // lang=es del API NO demuestra que haya audio o subtítulos españoles.
  const pathUrl = declared.playlist.split('?')[0].replace(/(\/playlist\/[-\w]+)(?:\.m3u8)?$/, '$1.m3u8');
  const url = withQuery(pathUrl, { token: declared.token, expires: declared.expires,
    ...(declared.fhd ? { h: 1 } : {}), lang: 'es' });
  const headers = { ...HEADERS, Referer: page.url };
  // Rechazar HTML/403 de playlist antes de publicar un HLS de etiqueta falsa.
  const sample = await fetchText(url, { headers, timeoutMs: 9000, allowError: true });
  if (!sample.ok || !sample.text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) return [];
  const language = audioLanguage(sample.text);
  const subtitles = subtitlesFrom(sample.text, url);
  const stream = makeStream('VixSrc', url, {
    providerId: 'vixsrc', type: 'hls', language, subtitles, headers,
    title: `VixSrc · ${language === 'und' ? 'audio no verificado' : language.toUpperCase()} · HLS`,
  });
  return stream ? [stream] : [];
}

module.exports = { getStreams: createDirectProvider({ name: 'VixSrc', streams }) };
