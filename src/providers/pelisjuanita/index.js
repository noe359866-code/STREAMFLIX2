import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { embedCandidatesFromHtml, protectedDataLinkCandidates, resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors, stripTags, unique } from '../../core/text.js';

const BASE = 'https://pelisjuanita.org';
const MOVIE_PATH = /\/pelicula\//i;
const TV_PATH = /\/(?:serie|anime|novela)\//i;

async function search(query, mediaType) {
  const url = withQuery(`${BASE}/`, { s: query });
  const page = await fetchText(url, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, {
    mediaType,
    path: mediaType === 'movie' ? MOVIE_PATH : TV_PATH,
  });
}

function requestedEpisode(html, base, season, episode) {
  for (const anchor of anchors(html)) {
    const url = absoluteUrl(anchor.href, base);
    if (!url || !/episodio|episodes?|capitulo|chapter|\/ver\//i.test(url)) continue;
    const label = `${url} ${stripTags(anchor.raw)}`;
    const match = label.match(/(?:\bT|temporada\s*)(\d{1,2})\s*[·:.-]?\s*(?:E|episodio\s*)(\d{1,3})\b/i);
    if (match && Number(match[1]) === Number(season) && Number(match[2]) === Number(episode)) {
      return { url, title: stripTags(anchor.raw), raw: anchor.raw };
    }
  }
  return episodeLinks(html, base, season, episode);
}

async function streams(match, media) {
  let page = await fetchText(match.url, { referer: `${BASE}/` });
  if (media.mediaType === 'tv') {
    const episode = requestedEpisode(page.text, page.url, media.season, media.episode);
    if (!episode) return [];
    page = await fetchText(episode.url, { referer: page.url });
  }
  const candidates = [
    ...embedCandidatesFromHtml(page.text, page.url, { language: 'es', referer: page.url }),
    ...protectedDataLinkCandidates(page.text, page.url).map((item) => ({ ...item, referer: page.url })),
  ];
  return resolveCandidates(unique(candidates, (item) => item.url), {
    provider: 'Pelis Juanita', providerId: 'pelisjuanita', referer: page.url, maxCandidates: 10,
  });
}

module.exports = { getStreams: createSiteProvider({
  name: 'Pelis Juanita', search, streams, maxQueries: 3, minimumScore: 70,
}) };
