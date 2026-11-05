import { createSiteProvider } from '../../core/site.js';
import { fetchText } from '../../core/http.js';
import { cardsFromAnchors, playerOptions } from '../../core/html.js';
import { decodeBase64Url } from '../../core/base64.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://tioplus.app';
async function search(query, mediaType) {
  const page = await fetchText(`${BASE}/search/${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:pelicula|serie|anime)\//i });
}
async function streams(match, media) {
  const url = media.mediaType === 'movie' ? match.url : `${match.url.replace(/\/$/, '')}/season/${media.season}/episode/${media.episode}`;
  const page = await fetchText(url, { referer: `${BASE}/` });
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
