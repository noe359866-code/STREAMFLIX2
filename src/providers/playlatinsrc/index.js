import { resolveMetadata } from '../../core/tmdb.js';
import { resolveCandidates } from '../../core/extractors.js';
import { providerGuard } from '../../core/streams.js';

const BASE = 'https://playlatinsrc.co';

async function getStreams(contentId, mediaType, season, episode) {
  const metadata = await resolveMetadata(contentId, mediaType);
  if (!metadata.imdbId) return [];
  const path = mediaType === 'movie'
    ? `/custom/movie/${encodeURIComponent(metadata.imdbId)}`
    : `/custom/serial/${encodeURIComponent(metadata.imdbId)}/${season}/${episode}`;
  const url = `${BASE}${path}`;
  return resolveCandidates([{ url, referer: `${BASE}/`, language: 'es' }], {
    provider: 'PlayLatinSRC', providerId: 'playlatinsrc', referer: url, maxCandidates: 10,
  });
}

module.exports = { getStreams: providerGuard('PlayLatinSRC', getStreams) };
