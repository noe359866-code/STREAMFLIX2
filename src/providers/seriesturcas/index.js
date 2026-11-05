import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors } from '../../core/text.js';

const BASE = 'https://tbg.seriesturcastv.to';
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/home/` });
  return cardsFromAnchors(page.text, page.url, { mediaType: 'tv', path: /\/series?\//i });
}
async function streams(match, media) {
  const show = await fetchText(match.url, { referer: `${BASE}/home/` });
  const episode = episodeLinks(show.text, show.url, media.season, media.episode);
  if (!episode) return [];
  const page = await fetchText(episode.url, { referer: show.url });
  const candidates = anchors(page.text).filter((anchor) => /vidmoly|voe\.|esprinahy|streamwish|filemoon|mp4upload/i.test(anchor.href)).map((anchor) => ({
    url: absoluteUrl(anchor.href, page.url), language: 'es-SUB', server: anchor.title || 'Series Turcas', referer: page.url,
  }));
  return resolveCandidates(candidates, { provider: 'Series Turcas', providerId: 'seriesturcas', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'Series Turcas', search, streams }) };
