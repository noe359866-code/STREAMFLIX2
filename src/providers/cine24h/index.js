import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks, playerOptions } from '../../core/html.js';
import { decodeBase64Url } from '../../core/base64.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://cine24h.online';
async function search(query, mediaType) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:peliculas|series)\//i });
}
async function streams(match, media) {
  let url = match.url;
  if (media.mediaType !== 'movie') {
    const show = await fetchText(url, { referer: `${BASE}/` });
    const episode = episodeLinks(show.text, show.url, media.season, media.episode);
    if (!episode) return [];
    url = episode.url;
  }
  const page = await fetchText(url, { referer: `${BASE}/` });
  const candidates = playerOptions(page.text, page.url).map((item) => ({
    url: item.url || decodeBase64Url(item.server), language: 'es', server: `Opción ${item.number}`, referer: page.url,
  })).filter((item) => item.url);
  return resolveCandidates(candidates, { provider: 'Cine24H', providerId: 'cine24h', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'Cine24H', search, streams }) };
