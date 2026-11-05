import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { decodeBase64Url } from '../../core/base64.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors, attribute } from '../../core/text.js';

const BASE = 'https://latanime.org';
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/buscar`, { q: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { path: /\/anime\//i });
}
async function streams(match, media) {
  let url = match.url;
  if (media.mediaType !== 'movie') {
    if (media.season !== 1) return [];
    const show = await fetchText(match.url, { referer: `${BASE}/` });
    const episode = anchors(show.text).find((anchor) => {
      const href = absoluteUrl(anchor.href, show.url);
      const number = href.match(/-episodio-(\d+)\/?$/i)?.[1] || anchor.raw.match(/episodio\s*(\d+)/i)?.[1];
      return Number(number) === media.episode && href.startsWith(match.url.replace('/anime/', '/ver/').replace(/\/$/, ''));
    });
    if (!episode) return [];
    url = absoluteUrl(episode.href, show.url);
  }
  const page = await fetchText(url, { referer: `${BASE}/` });
  const candidates = [...page.text.matchAll(/<a\b[^>]*data-player\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((item) => ({
    url: absoluteUrl(decodeBase64Url(item[1]), page.url), language: 'es-SUB', server: attribute(item[0], 'title') || 'Latanime', referer: page.url,
  })).filter((item) => item.url);
  return resolveCandidates(candidates, { provider: 'Latanime', providerId: 'latanime', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'Latanime', search, streams }) };
