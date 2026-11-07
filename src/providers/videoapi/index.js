import { createDirectProvider } from '../../core/site.js';
import { fetchJson, fetchText } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, attributes } from '../../core/text.js';

const BASE = 'https://videoapi.la';

async function videoapi(id, media) {
  const type = media.mediaType === 'movie' ? 'movie' : 'series';
  const suffix = type === 'movie' ? '' : `/${media.season}/${media.episode}`;
  const availability = await fetchJson(`${BASE}/api/v1/public/exists/${type}/${id}${suffix}`, { referer: `${BASE}/api`, timeoutMs: 4500 });
  const relativePath = availability.data?.path;
  if (availability.data?.exists !== true || typeof relativePath !== 'string'
    || !/^\/e\/(?:movie|tv|series)\/\d+(?:\/\d+\/\d+)?$/.test(relativePath)) return [];
  return resolveCandidates([{ url: `${BASE}${relativePath}`, referer: `${BASE}/`, language: 'es' }], {
    provider: 'VideoAPI', providerId: 'videoapi', referer: `${BASE}/`, maxCandidates: 10, timeoutMs: 4500,
  });
}

async function videoapp(id, media) {
  const path = media.mediaType === 'movie' ? `movie/${id}` : `tv/${id}/${media.season}/${media.episode}`;
  const pageUrl = `https://videoapp.zip/e/${path}`;
  const page = await fetchText(pageUrl, { referer: 'https://videoapp.zip/', timeoutMs: 4500 });
  for (const match of page.text.matchAll(/<iframe\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (attrs.id !== 'frame') continue;
    const url = absoluteUrl(attrs.src || '', page.url);
    if (!/^https:\/\/(?:lamovie\.link|vimeos\.net)(?:\/|$)/i.test(url)) return [];
    return resolveCandidates([{ url, referer: page.url, language: 'und', server: 'Videoapp' }], {
      provider: 'Videoapp', providerId: 'videoapi', referer: page.url, timeoutMs: 4500, maxCandidates: 1,
    });
  }
  return [];
}

async function limited(promise) {
  let timer;
  try {
    return await Promise.race([
      promise.catch(() => []),
      new Promise((resolve) => { timer = setTimeout(() => resolve([]), 6500); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function streams(id, media) {
  if (!/^\d+$/.test(id)) return [];
  const results = await Promise.all([limited(videoapi(id, media)), limited(videoapp(id, media))]);
  return results.flat();
}

module.exports = { getStreams: createDirectProvider({ name: 'VideoAPI', streams }) };
