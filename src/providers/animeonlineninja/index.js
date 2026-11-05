import { createSiteProvider } from '../../core/site.js';
import { fetchJson, fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks, playerOptions } from '../../core/html.js';
import { embedCandidatesFromHtml, resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://ww3.animeonline.ninja';
async function search(query, mediaType) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/inicio/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:online|pelicula)\//i });
}
async function streams(match, media) {
  let url = match.url;
  if (media.mediaType !== 'movie') {
    const show = await fetchText(match.url, { referer: `${BASE}/` });
    const episode = episodeLinks(show.text, show.url, media.season, media.episode);
    if (!episode) return [];
    url = episode.url;
  }
  const page = await fetchText(url, { referer: `${BASE}/` });
  let options = playerOptions(page.text, page.url);
  const postId = options.find((item) => item.postId)?.postId || page.text.match(/postid-(\d+)/i)?.[1] || page.text.match(/data-post\s*=\s*["'](\d+)["']/i)?.[1];
  if (!options.length && postId) options = [1, 2, 3, 4, 5].map((number) => ({ number, postId, type: media.mediaType === 'movie' ? 'movie' : 'tv' }));
  const candidates = [];
  for (const option of options.filter((item) => item.postId).slice(0, 8)) {
    try {
      const response = await fetchJson(`${BASE}/wp-json/dooplayer/v1/post/${encodeURIComponent(option.postId)}?type=${encodeURIComponent(option.type)}&source=${option.number}`, { referer: page.url });
      if (response.data.embed_url) candidates.push({ url: response.data.embed_url, language: 'es-SUB', server: `Opción ${option.number}`, referer: page.url });
    } catch (_) { /* Cloudflare u opción inexistente */ }
  }
  candidates.push(...embedCandidatesFromHtml(page.text, page.url, { language: 'es-SUB', referer: page.url }));
  return resolveCandidates(candidates, { provider: 'Anime Online Ninja', providerId: 'animeonlineninja', referer: page.url, maxCandidates: 8 });
}
module.exports = { getStreams: createSiteProvider({ name: 'Anime Online Ninja', search, streams }) };
