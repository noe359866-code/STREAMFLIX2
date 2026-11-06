import { createDirectProvider } from '../../core/site.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://tukiplay.com';

async function streams(id, media) {
  if (!/^\d+$/.test(id) && !/^tt\d+$/i.test(id)) return [];
  const path = media.mediaType === 'movie'
    ? `/embed/movie/${encodeURIComponent(id)}`
    : `/embed/tv/${encodeURIComponent(id)}/${media.season}/${media.episode}`;
  const url = `${BASE}${path}`;
  return resolveCandidates([{ url, referer: `${BASE}/`, language: 'es' }], {
    provider: 'TukiPlay', providerId: 'tukiplay', referer: url, maxCandidates: 10,
  });
}

module.exports = { getStreams: createDirectProvider({ name: 'TukiPlay', streams }) };
