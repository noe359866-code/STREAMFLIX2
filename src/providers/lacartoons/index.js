import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors } from '../../core/text.js';

const BASE = 'https://www.lacartoons.com';
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/`, { Titulo: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType: 'tv', path: /\/(?:serie|series|cartoon|ver)/i });
}
async function streams(match, media) {
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const panels = show.text.split(/<div\b[^>]*class\s*=\s*["'][^"']*episodio-panel/i).slice(1);
  const panel = panels[media.season - 1] || (media.season === 1 ? show.text : '');
  const episode = anchors(panel).find((anchor) => Number(anchor.title.match(/cap[ií]tulo\s*(\d+)/i)?.[1]) === media.episode);
  if (!episode) return [];
  const page = await fetchText(absoluteUrl(episode.href, show.url), { referer: show.url });
  const iframe = page.text.match(/<iframe\b[^>]*src\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!iframe) return [];
  const candidates = [{ url: absoluteUrl(iframe, page.url), language: 'es-LAT', server: 'LaCartoons', referer: page.url }];
  return resolveCandidates(candidates, { provider: 'LaCartoons', providerId: 'lacartoons', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'LaCartoons', search, streams }) };
