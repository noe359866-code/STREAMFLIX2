import { createSiteProvider } from '../../core/site.js';
import { fetchText } from '../../core/http.js';
import { cardsFromAnchors, playerOptions } from '../../core/html.js';
import { decodeBase64Url } from '../../core/base64.js';
import { resolveCandidates } from '../../core/extractors.js';
import { extractBalanced } from '../../core/text.js';

const BASE = 'https://tioplus.app';
async function search(query, mediaType) {
  const page = await fetchText(`${BASE}/search/${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:pelicula|serie|anime)\//i });
}
async function streams(match, media) {
  let url = match.url;
  let referer = `${BASE}/`;
  if (media.mediaType !== 'movie') {
    const show = await fetchText(match.url, { referer: `${BASE}/` });
    const raw = extractBalanced(show.text, 'seasonsJson', '{', '}');
    let seasons = null;
    try { seasons = raw ? JSON.parse(raw) : null; } catch (_) { return []; }
    const episodes = seasons?.[String(media.season)];
    if (!Array.isArray(episodes) || !episodes.some((item) => Number(item.episode) === media.episode)) return [];
    url = `${match.url.replace(/\/$/, '')}/season/${media.season}/episode/${media.episode}`;
    referer = show.url;
  }
  const page = await fetchText(url, { referer });
  const candidates = playerOptions(page.text, page.url).map((item) => {
    const decoded = decodeBase64Url(item.server);
    return {
      url: decoded || (item.server ? `${BASE}/player/${btoa(item.server)}` : ''),
      language: 'es-LAT', server: `Opción ${item.number}`, referer: page.url,
    };
  }).filter((item) => item.url);
  return resolveCandidates(candidates, { provider: 'TioPlus', providerId: 'tioplus', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'TioPlus', search, streams }) };
