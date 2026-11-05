import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { embedCandidatesFromHtml, resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://flixlatam.com';
async function search(query, mediaType) {
  const page = await fetchText(withQuery(`${BASE}/search`, { s: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:pelicula|serie|series|anime)\//i });
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
  const candidates = embedCandidatesFromHtml(page.text, page.url, { language: 'es', referer: page.url });
  return resolveCandidates(candidates, { provider: 'FlixLatam', providerId: 'flixlatam', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'FlixLatam', search, streams }) };
