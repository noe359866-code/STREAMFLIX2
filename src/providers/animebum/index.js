import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors, decodeHtml } from '../../core/text.js';


const BASE = 'https://www.animebum.net';
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/search`, { s: query, page: 1 }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { path: /\/(?:series|peliculas|anime|ver)\//i });
}
async function streams(match, media) {
  if (media.season !== 1) return [];
  let url = match.url;
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const episode = anchors(show.text).find((anchor) => {
    const number = anchor.raw.match(/episodio\s*(\d+)/i)?.[1];
    return Number(number) === (media.mediaType === 'movie' ? 1 : media.episode);
  });
  if (media.mediaType === 'movie') url = episode ? absoluteUrl(episode.href, show.url) : match.url;
  else {
    if (!episode) return [];
    url = absoluteUrl(episode.href, show.url);
  }
  const page = await fetchText(url, { referer: show.url });
  const candidates = [];
  for (const matchVideo of page.text.matchAll(/video\[\d+\]\s*=\s*['"]<iframe[^>]+src=["']([^"']+)["']/gi)) {
    let urlVideo = decodeHtml(matchVideo[1]);
    if (urlVideo.startsWith('//')) urlVideo = `https:${urlVideo}`;
    candidates.push({ url: absoluteUrl(urlVideo, page.url), language: 'es-LAT', server: 'AnimeBum', referer: page.url });
  }
  return resolveCandidates(candidates, { provider: 'AnimeBum', providerId: 'animebum', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'AnimeBum', search, streams }) };
