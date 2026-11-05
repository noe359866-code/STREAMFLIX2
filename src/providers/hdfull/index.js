import { createSiteProvider } from '../../core/site.js';
import { fetchText, postJson } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, attributes, decodeHtml, unique, yearOf } from '../../core/text.js';
import { isPlayableUrl, qualityOf } from '../../core/streams.js';

const BASE = 'https://hdfull.company';

async function search(query, mediaType) {
  const response = await postJson(`${BASE}/search-route`, {
    host: 'hdfull.company', locale: 'es', searchTerm: query,
  }, { referer: `${BASE}/` });
  const items = Array.isArray(response.data?.data) ? response.data.data : [];
  return unique(items.map((item) => {
    const type = item?.type === 'serie' ? 'tv' : 'movie';
    if (type !== mediaType || !item?.slug || !item?.title) return null;
    const url = absoluteUrl(`/${type === 'tv' ? 'series' : 'peliculas'}/${String(item.slug).replace(/^\/+/, '')}`, BASE);
    return {
      url, type, title: item.title_with_prefix || item.title,
      year: yearOf(item.release_date || ''), raw: JSON.stringify(item),
    };
  }).filter(Boolean), (item) => item.url);
}

function contentUrls(html, base) {
  const output = [];
  for (const match of String(html || '').matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(decodeHtml(match[1]));
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item?.['@type'] === 'VideoObject' && item.contentUrl) output.push(absoluteUrl(item.contentUrl, base));
      }
    } catch (_) { /* un bloque JSON-LD ajeno no invalida los demás */ }
  }
  for (const match of String(html || '').matchAll(/<video\b[^>]*>/gi)) {
    const url = absoluteUrl(attributes(match[0]).src || '', base);
    if (url) output.push(url);
  }
  const slug = base.match(/\/peliculas\/([^/?#]+)/i)?.[1] || '';
  return unique(output.filter((url) => {
    if (!isPlayableUrl(url) || /cdn\.zss90\.pl\/vod-video\.mp4/i.test(url)) return false;
    const path = url.match(/^https?:\/\/[^/]+(\/[^?#]*)/i)?.[1] || '';
    // Solo la fuente declarada para esta ficha; nunca el video genérico del player publicitario.
    return new URL(url).hostname === 'hdfull.company'
      && path === `/vod-movie/v1/${slug}.mp4`;
  }));
}

async function streams(match, media) {
  // En el episodio observado ModernPlayer solo carga un video genérico con fines publicitarios.
  if (media.mediaType !== 'movie') return [];
  const page = await fetchText(match.url, { referer: `${BASE}/` });
  const candidates = contentUrls(page.text, page.url).map((url) => ({
    url, server: 'HDFull', language: 'es', quality: qualityOf(url),
    title: `HDFull · es · ${qualityOf(url)}`, referer: page.url,
  }));
  return resolveCandidates(candidates, {
    provider: 'HDFull', providerId: 'hdfull', referer: page.url, maxCandidates: 2,
  });
}

module.exports = { getStreams: createSiteProvider({ name: 'HDFull', search, streams }) };
