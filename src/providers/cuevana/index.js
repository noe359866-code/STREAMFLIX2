import { createSiteProvider } from '../../core/site.js';
import { fetchJson, withQuery } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';
import { yearOf } from '../../core/text.js';

const BASE = 'https://cuevana.gs';
const API = `${BASE}/wp-api/v1`;

async function api(path, params) {
  const response = await fetchJson(withQuery(`${API}/${path.replace(/^\//, '')}`, params), { referer: `${BASE}/` });
  return response.data.data;
}

async function search(query, mediaType) {
  const data = await api('search', { q: query, page: 1, postType: 'any', postsPerPage: 24 });
  return (data?.posts || []).filter((item) => mediaType === 'movie'
    ? /movie|pelicula/i.test(item.type)
    : /tv|serie|anime/i.test(item.type) && !/episode/i.test(item.type)).map((item) => ({
      id: item._id,
      slug: item.slug,
      postType: item.type,
      title: item.title || item.original_title,
      year: yearOf(item.release_date || item.years?.[0]),
      type: /movie|pelicula/i.test(item.type) ? 'movie' : 'tv',
    }));
}

async function streams(match, media) {
  let postId = match.id;
  if (media.mediaType !== 'movie') {
    const list = await api('single/episodes/list', {
      _id: match.id, season: media.season, page: 1, postsPerPage: 100,
    });
    const episode = (list?.posts || []).find((item) => Number(item.season_number) === media.season && Number(item.episode_number) === media.episode);
    if (!episode) return [];
    postId = episode._id;
  }
  const player = await api('player', { postId, demo: 0 });
  const candidates = (player?.embeds || []).filter((entry) => entry.url && entry.type !== 'download').map((entry) => ({
    url: entry.url,
    language: entry.lang || entry.language || 'es',
    quality: entry.quality || entry.resolution,
    server: entry.server || entry.serverName || 'Cuevana',
    referer: `${BASE}/`,
  }));
  return resolveCandidates(candidates, { provider: 'Cuevana 3', providerId: 'cuevana', referer: `${BASE}/` });
}

module.exports = { getStreams: createSiteProvider({ name: 'Cuevana 3', search, streams }) };
