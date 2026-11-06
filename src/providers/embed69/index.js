import { resolveMetadata } from '../../core/tmdb.js';
import { fetchText } from '../../core/http.js';
import { protectedDataLinkCandidates, resolveCandidates } from '../../core/extractors.js';
import { providerGuard } from '../../core/streams.js';

const BASE = 'https://embed69.org';

async function getStreams(contentId, mediaType, season, episode) {
  const metadata = await resolveMetadata(contentId, mediaType);
  if (!metadata.imdbId) return [];
  const id = mediaType === 'movie'
    ? metadata.imdbId
    : `${metadata.imdbId}-${season}x${String(episode).padStart(2, '0')}`;
  const page = await fetchText(`${BASE}/f/${encodeURIComponent(id)}`, { referer: `${BASE}/` });
  const candidates = protectedDataLinkCandidates(page.text, page.url)
    .map((item) => ({ ...item, referer: page.url }));
  return resolveCandidates(candidates, {
    provider: 'Embed69', providerId: 'embed69', referer: page.url, maxCandidates: 8,
  });
}

module.exports = { getStreams: providerGuard('Embed69', getStreams) };
