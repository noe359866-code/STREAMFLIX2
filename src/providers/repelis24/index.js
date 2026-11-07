import { createSiteProvider } from '../../core/site.js';
import { fetchJson, fetchText, mapLimit } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors, attributes, stripTags, unique, yearOf } from '../../core/text.js';

const BASE = 'https://repelis24.de';

function isMoviePage(url) {
  return /^https:\/\/repelis24\.de\/pelicula\/[^/?#]+\/?$/i.test(url)
    && !/%3c|%3e|[<>]/i.test(url);
}

async function search(query, mediaType) {
  if (mediaType !== 'movie') return [];
  const page = await fetchText(`${BASE}/?s=${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  const items = anchors(page.text).map((anchor) => {
    const url = absoluteUrl(anchor.href, page.url);
    const title = anchor.imageAlt || anchor.anchorTitle || anchor.title;
    if (!isMoviePage(url) || !title || /^(?:pel[ií]cula|ver|reproducir)$/i.test(title)) return null;
    return { url, title, type: 'movie', year: yearOf(anchor.raw) };
  }).filter(Boolean);
  return unique(items, (item) => item.url);
}

function language(label) {
  if (/\blatino|\blat\b/i.test(label)) return 'es-LAT';
  if (/castellano|espa[nñ]ol|\bcas\b/i.test(label)) return 'es-ES';
  if (/subtitulad|\bsub\b/i.test(label)) return 'es-SUB';
  return 'es';
}

function playerOptions(html) {
  const output = [];
  for (const match of String(html || '').matchAll(/<li\b[^>]*class\s*=\s*["'][^"']*dooplay_player_option[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)) {
    const raw = match[0];
    const attrs = attributes(raw.slice(0, raw.indexOf('>') + 1));
    const post = attrs['data-post'];
    const number = attrs['data-nume'];
    if (!/^\d{1,12}$/.test(post || '') || !/^\d{1,2}$/.test(number || '') || Number(number) < 1
      || attrs['data-type'] !== 'movie') continue;
    const label = stripTags(raw.match(/<span\b[^>]*class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    if (/tr[aá]iler|download|descarg/i.test(label)) continue;
    output.push({ post, number, server: label || 'Servidor', language: language(label) });
  }
  return unique(output, (item) => `${item.post}|${item.number}`);
}

function embedUrl(data, base) {
  const raw = typeof data?.embed_url === 'string' ? data.embed_url : '';
  const src = raw.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || raw;
  const url = absoluteUrl(src, base);
  if (!/^https?:\/\//i.test(url) || /youtube\.com|youtu\.be|\/download\/|download\.php/i.test(url)) return '';


  if (/^https:\/\/nupload\.me\/iframe\//i.test(url)) {
    const target = url.match(/[?&]url=([^&#]+)/i)?.[1];
    if (target) {
      try {
        const decoded = decodeURIComponent(target);
        if (/^https:\/\/waaw\.(?:tv|to)\/watch_video\.php\?v=/i.test(decoded)) return decoded;
      } catch (_) {                                                  }
    }
  }
  return url;
}

async function streams(match, media) {
  if (media.mediaType !== 'movie' || !isMoviePage(match.url)) return [];
  const page = await fetchText(match.url, { referer: `${BASE}/` });
  if (!isMoviePage(page.url) || !/["']play_method["']\s*:\s*["']wp_json["']/i.test(page.text)) return [];
  const candidates = await mapLimit(playerOptions(page.text).slice(0, 6), 2, async (option) => {
    try {
      const endpoint = `${BASE}/wp-json/dooplayer/v2/${option.post}/movie/${option.number}`;
      const result = await fetchJson(endpoint, { referer: page.url });
      const url = embedUrl(result.data, page.url);
      return url ? { url, referer: page.url, language: option.language, server: option.server } : null;
    } catch (_) { return null; }
  });
  return resolveCandidates(candidates.filter(Boolean), {
    provider: 'Repelis24', providerId: 'repelis24', referer: page.url,
    maxCandidates: 6, parallel: 2,
  });
}



module.exports = { getStreams: createSiteProvider({
  name: 'Repelis24', search, streams, maxQueries: 3, minimumScore: 70,
}) };
