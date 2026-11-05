import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { extractBalanced } from '../../core/text.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://tioanime.com';
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/directorio`, { q: query, p: 1 }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { path: /\/anime\//i });
}
async function streams(match, media) {
  if (media.season !== 1) return [];
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const rawEpisodes = extractBalanced(show.text, 'var episodes', '[', ']');
  let episodes = [];
  try { episodes = rawEpisodes ? JSON.parse(rawEpisodes) : []; } catch (_) { return []; }
  const number = media.mediaType === 'movie' ? 1 : media.episode;
  if (!episodes.map(Number).includes(number)) return [];
  const slug = match.url.split('/').filter(Boolean).pop();
  const url = `${BASE}/ver/${slug}-${number}`;
  const page = await fetchText(url, { referer: show.url });
  const rawVideos = extractBalanced(page.text, 'var videos', '[', ']');
  let videos = [];
  try { videos = rawVideos ? JSON.parse(rawVideos) : []; } catch (_) { return []; }
  const candidates = videos.filter((item) => Array.isArray(item) && /^(?:voe|yourupload)$/i.test(item[0] || '') && item[1]).map((item) => ({
    url: item[1], language: 'es-SUB', server: item[0], referer: page.url,
  }));
  return resolveCandidates(candidates, { provider: 'TioAnime', providerId: 'tioanime', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'TioAnime', search, streams }) };
