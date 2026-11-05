import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks, playerOptions } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://www.cinecalidad.am';
async function search(query, mediaType) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/ver-(?:pelicula|serie)\//i });
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
  const candidates = playerOptions(page.text, page.url).filter((item) => item.url && !/trailer/i.test(item.raw)).map((item) => ({
    url: item.url, language: 'es-LAT', server: `Opción ${item.number}`, referer: page.url,
  }));
  return resolveCandidates(candidates, { provider: 'CineCalidad', providerId: 'cinecalidad', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'CineCalidad', search, streams }) };
