import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { embedCandidatesFromHtml, protectedDataLinkCandidates, resolveCandidates } from '../../core/extractors.js';
import { unique } from '../../core/text.js';

const BASE = 'https://pelispedia.is';

async function search(query, mediaType) {
  const url = withQuery(`${BASE}/`, { s: query });
  const page = await fetchText(url, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, {
    mediaType,
    path: mediaType === 'movie' ? /\/pelicula\//i : /\/serie\//i,
  });
}

async function streams(match, media) {
  let page = await fetchText(match.url, { referer: `${BASE}/` });
  if (media.mediaType === 'tv') {
    const episode = episodeLinks(page.text, page.url, media.season, media.episode);
    if (!episode) return [];
    page = await fetchText(episode.url, { referer: page.url });
  }
  const candidates = [
    ...embedCandidatesFromHtml(page.text, page.url, { language: 'es', referer: page.url }),
    ...protectedDataLinkCandidates(page.text, page.url).map((item) => ({ ...item, referer: page.url })),
  ];
  return resolveCandidates(unique(candidates, (item) => item.url), {
    provider: 'Pelispedia', providerId: 'pelispedia', referer: page.url, maxCandidates: 10,
  });
}

module.exports = { getStreams: createSiteProvider({
  name: 'Pelispedia', search, streams, maxQueries: 3, minimumScore: 70,
}) };
