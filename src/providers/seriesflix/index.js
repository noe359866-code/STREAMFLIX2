import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks, playerOptions } from '../../core/html.js';
import { decodeBase64Url } from '../../core/base64.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://seriesflixhd.lol';
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType: 'tv', path: /\/serie\//i });
}
async function streams(match, media) {
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const episode = episodeLinks(show.text, show.url, media.season, media.episode);
  if (!episode) return [];
  const page = await fetchText(episode.url, { referer: show.url });
  const candidates = playerOptions(page.text, page.url).map((item) => ({
    url: item.url || decodeBase64Url(item.server), language: 'es', server: `Opción ${item.number}`, referer: page.url,
  })).filter((item) => item.url);
  return resolveCandidates(candidates, { provider: 'SeriesFlix', providerId: 'seriesflix', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'SeriesFlix', search, streams }) };
