import { createDirectProvider } from '../../core/site.js';
import { fetchJson } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://videoapi.la';

async function streams(id, media) {
  if (!/^\d+$/.test(id)) return [];
  const type = media.mediaType === 'movie' ? 'movie' : 'series';
  const suffix = type === 'movie' ? '' : `/${media.season}/${media.episode}`;
  const availability = await fetchJson(`${BASE}/api/v1/public/exists/${type}/${id}${suffix}`, {
    referer: `${BASE}/api`,
  });
  const relativePath = availability.data?.path;
  // Solo se siguen rutas relativas documentadas; no se aceptan redirecciones externas del API.
  if (availability.data?.exists !== true || typeof relativePath !== 'string'
    || !/^\/e\/(?:movie|tv|series)\/\d+(?:\/\d+\/\d+)?$/.test(relativePath)) return [];
  const url = `${BASE}${relativePath}`;
  return resolveCandidates([{ url, referer: `${BASE}/`, language: 'es' }], {
    provider: 'VideoAPI', providerId: 'videoapi', referer: url, maxCandidates: 10,
  });
}

module.exports = { getStreams: createDirectProvider({ name: 'VideoAPI', streams }) };
