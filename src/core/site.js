import { resolveMetadata } from './tmdb.js';
import { bestTitleMatch, unique } from './text.js';
import { providerGuard } from './streams.js';

export function createSiteProvider(config) {
  return providerGuard(config.name, async (contentId, mediaType, season, episode) => {
    const metadata = await resolveMetadata(contentId, mediaType);
    const queries = unique(config.queries
      ? config.queries(metadata)
      : [metadata.title, metadata.originalTitle, ...metadata.titles]).slice(0, config.maxQueries || 3);
    const candidates = [];
    for (const query of queries) {
      try {
        const found = await config.search(query, mediaType, metadata);
        if (found?.length) candidates.push(...found);
        if (bestTitleMatch(candidates, metadata, mediaType, 90)) break;
      } catch (_) { /* prueba el siguiente título alternativo */ }
    }
    const match = bestTitleMatch(candidates, metadata, mediaType, config.minimumScore || 60);
    if (!match) return [];
    return config.streams(match, { metadata, mediaType, season: season || 1, episode: episode || 1, candidates });
  });
}

export function createDirectProvider(config) {
  return providerGuard(config.name, async (contentId, mediaType, season, episode) => (
    config.streams(String(contentId).replace(/^tmdb[:/]/i, ''), { mediaType, season: season || 1, episode: episode || 1 })
  ));
}
