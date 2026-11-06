import { createDirectProvider } from '../../core/site.js';
import { fetchJson, fetchText, withQuery } from '../../core/http.js';
import { MOVIEMASTER_USER_AGENT, resolveCandidates } from '../../core/extractors.js';

const API = 'https://api.moviemaster.lat';
const LANGUAGES = { LAT: 'es-LAT', ESP: 'es-ES', SUB: 'es-SUB' };

async function getStreams(tmdb, media) {
  const id = tmdb.replace(/\D/g, '');
  if (!id) return [];
  const type = media.mediaType === 'movie' ? 'movie' : 'tv';
  const params = type === 'movie'
    ? { tmdb: id, type }
    : { tmdb: id, type, season: media.season, episode: media.episode };
  const embedPath = type === 'movie' ? `/e/movie/${id}` : `/e/tv/${id}/${media.season}/${media.episode}`;
  const embed = await fetchText(API + embedPath, {
    referer: `${API}/`, extraHeaders: { 'User-Agent': MOVIEMASTER_USER_AGENT, 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate' },
  });
  const ui = embed.text.match(/window\.PM_UI\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!ui) return [];
  const response = await fetchJson(withQuery(`${API}/servers`, { ...params, ui }), {
    referer: `${API}/`, extraHeaders: { 'User-Agent': MOVIEMASTER_USER_AGENT },
  });
  const candidates = (response.data.servers || []).filter((server) => server.id).map((server, index) => ({
    url: withQuery(`${API}/video`, { ...params, embed: server.id, noiframe: 1, r: 1 }),
    language: LANGUAGES[String(server.lang || '').toUpperCase()] || 'es',
    server: `MovieMaster ${index + 1}`,
    referer: `${API}/`,
  }));
  return resolveCandidates(candidates, { provider: 'CineHax', providerId: 'cinehax', referer: `${API}/`, maxCandidates: 12 });
}

module.exports = { getStreams: createDirectProvider({ name: 'CineHax', streams: getStreams }) };
