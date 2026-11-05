import { hostName } from './text.js';

export function mediaKind(url, explicit) {
  if (explicit) return explicit;
  if (/\.m3u8(?:$|[?#])|\/m3u8\//i.test(url)) return 'hls';
  if (/\.mpd(?:$|[?#])/i.test(url)) return 'dash';
  if (/\.mkv(?:$|[?#])/i.test(url)) return 'mkv';
  if (/\.webm(?:$|[?#])/i.test(url)) return 'webm';
  return 'mp4';
}

export function isPlayableUrl(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  // Voe puede incrustar Big Buck Bunny de test-videos.co.uk como señuelo, nunca es el título pedido.
  if (/^https?:\/\/(?:[^/@]+\.)?test-videos\.co\.uk(?::\d+)?\//i.test(url)) return false;
  // Byse y algunos mirrors usan /e/<id>/<nombre>.mp4 para una página HTML, no para el medio.
  if (/\/e\/[^?#]+\.mp4(?:$|[?#])/i.test(url)) return false;
  if (/\.mpd(?:$|[?#])/i.test(url)) return false; // Se evita entregar DASH/DRM sin licencia.
  return /\.(?:m3u8|mp4|mkv|webm)(?:$|[?#])/i.test(url)
    || /\/m3u8\/|\/get_video\?|\/videoplayback(?:\?|$)|\/manifest\.m3u8/i.test(url);
}

export function qualityOf(...values) {
  const text = values.filter(Boolean).join(' ');
  const match = text.match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)\s*p?\b/i);
  if (match) return `${match[1]}p`;
  if (/\b(?:4k|uhd)\b/i.test(text)) return '2160p';
  if (/\b(?:full\s*hd|fhd)\b/i.test(text)) return '1080p';
  if (/\bhd\b/i.test(text)) return '720p';
  if (/\bcam\b/i.test(text)) return 'CAM';
  return 'Auto';
}

export function languageOf(value, fallback = 'es') {
  const text = String(value || '').toLowerCase();
  if (/\b(lat|latino|dub|doblaje|es-mx|es-la)\b/.test(text)) return 'es-LAT';
  if (/\b(cast|castellano|esp|spanish|es-es)\b/.test(text)) return 'es-ES';
  if (/\b(sub|subtitulado|vose|sub espanol)\b/.test(text)) return 'es-SUB';
  if (/\b(eng|english|en)\b/.test(text)) return 'en';
  return fallback;
}

export function makeStream(provider, url, options = {}) {
  if (!isPlayableUrl(url)) return null;
  const server = options.server || hostName(url);
  const language = languageOf(options.language || options.title, options.defaultLanguage || 'es');
  const quality = options.quality && options.quality !== 'Auto' ? options.quality : qualityOf(options.quality, options.title, url);
  return {
    name: provider,
    provider: options.providerId || provider.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    title: options.title || `${server} · ${language} · ${quality}`,
    url,
    quality,
    language,
    type: mediaKind(url, options.type),
    headers: options.headers || { 'User-Agent': 'Mozilla/5.0', ...(options.referer ? { Referer: options.referer } : {}) },
    ...(options.subtitles?.length ? { subtitles: options.subtitles } : {}),
  };
}

export function finalizeStreams(streams) {
  const seen = new Set();
  const output = [];
  for (const stream of streams.flat ? streams.flat(2) : streams) {
    if (!stream || !isPlayableUrl(stream.url)) continue;
    const key = `${stream.url}|${stream.language || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(stream);
  }
  return output.slice(0, 40);
}

export function providerGuard(provider, getStreams) {
  return async function guarded(contentId, mediaType, season, episode) {
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    if (!contentId) return [];
    if (type === 'tv' && (!Number(season) || !Number(episode))) return [];
    try {
      const streams = await getStreams(String(contentId), type, Number(season) || null, Number(episode) || null);
      return finalizeStreams(streams || []);
    } catch (error) {
      try { console.warn(`[${provider}] ${error && error.message ? error.message : error}`); } catch (_) { /* noop */ }
      return [];
    }
  };
}
