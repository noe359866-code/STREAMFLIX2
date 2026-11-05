import { createSiteProvider } from '../../core/site.js';
import { fetchJson, withQuery } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';
import { yearOf } from '../../core/text.js';

const BASE = 'https://fanpelis.to';
const API = `${BASE}/api/rest`;

async function search(query, mediaType) {
  const response = await fetchJson(withQuery(`${API}/search`, {
    query, page: 1, post_type: mediaType === 'movie' ? 'movies' : 'tvshows,animes', posts_per_page: 24,
  }), { referer: `${BASE}/` });
  return (response.data.data?.posts || []).map((item) => ({
    id: item._id,
    slug: item.slug,
    title: item.title,
    year: yearOf(item.release_date),
    type: item.type === 'movies' ? 'movie' : 'tv',
    rawType: item.type,
  }));
}

async function streams(match, media) {
  let postId = match.id;
  if (media.mediaType !== 'movie') {
    const episodes = await fetchJson(withQuery(`${API}/episodes`, { post_id: match.id }), { referer: `${BASE}/` });
    const episode = (episodes.data.data || []).find((item) => Number(item.season_number) === media.season && Number(item.episode_number) === media.episode);
    if (!episode) return [];
    postId = episode._id;
  }
  const player = await fetchJson(withQuery(`${API}/player`, { post_id: postId, _any: 1 }), { referer: `${BASE}/` });
  const candidates = (player.data.data?.embeds || []).filter((item) => item.url).map((item) => ({
    url: item.url,
    language: item.lang || 'es',
    quality: item.quality,
    server: item.server || 'Fanpelis',
    referer: `${BASE}/`,
  }));
  return resolveCandidates(candidates, { provider: 'Fanpelis', providerId: 'fanpelis', referer: `${BASE}/` });
}

module.exports = { getStreams: createSiteProvider({ name: 'Fanpelis', search, streams }) };
