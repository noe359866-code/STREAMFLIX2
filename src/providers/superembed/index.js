import { createDirectProvider } from '../../core/site.js';
import { withQuery } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';

async function streams(id, media) {
  const value = String(id || '').trim();
  const isTmdb = /^\d{1,12}$/.test(value);
  if (!isTmdb && !/^tt\d{1,12}$/i.test(value)) return [];
  const params = { video_id: value, ...(isTmdb ? { tmdb: 1 } : {}),
    ...(media.mediaType === 'tv' ? { s: media.season, e: media.episode } : {}) };
  const url = withQuery('https://multiembed.mov/', params);
  return resolveCandidates([{ url, referer: 'https://www.superembed.stream/', language: 'und' }], {
    provider: 'SuperEmbed', providerId: 'superembed', referer: 'https://www.superembed.stream/',
    maxCandidates: 1, maxNestedCandidates: 4, timeoutMs: 6000,
  });
}

module.exports = { getStreams: createDirectProvider({ name: 'SuperEmbed', streams }) };
