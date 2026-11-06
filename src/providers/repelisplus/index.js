import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { embedCandidatesFromHtml, protectedDataLinkCandidates, resolveCandidates } from '../../core/extractors.js';
import { unique } from '../../core/text.js';

const BASE = 'https://repelisplus.asia';

async function search(query, mediaType) {
  const urls = [
    withQuery(`${BASE}/buscar`, { q: query }),
    withQuery(`${BASE}/`, { s: query }),
  ];
  for (const url of urls) {
    try {
      const page = await fetchText(url, { referer: `${BASE}/` });
      const found = cardsFromAnchors(page.text, page.url, {
        mediaType,
        path: mediaType === 'movie' ? /\/peliculas?\//i : /\/series?\//i,
      });
      if (found.length) return found;
    } catch (_) { /* probar la forma alternativa de búsqueda pública */ }
  }
  return [];
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
    provider: 'RepelisPlus', providerId: 'repelisplus', referer: page.url, maxCandidates: 12,
  });
}

module.exports = { getStreams: createSiteProvider({
  name: 'RepelisPlus', search, streams, maxQueries: 2, minimumScore: 70,
}) };
