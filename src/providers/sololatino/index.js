import { createSiteProvider } from '../../core/site.js';
import { cookieValue, fetchJson, fetchText, postJson, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { embedCandidatesFromHtml, protectedDataLinkCandidates, resolveCandidates } from '../../core/extractors.js';
import { attribute, attributes, unique } from '../../core/text.js';

const BASE = 'https://sololatino.net';
const EMBED = 'https://embed69.org';

async function openProtected(url, referer) {
  const page = await fetchText(url, { referer });
  return protectedDataLinkCandidates(page.text, page.url);
}

async function playerToken(token, referer) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const xsrf = cookieValue(BASE, 'XSRF-TOKEN');
    try {
      return await postJson(`${BASE}/api/player-url`, { t: token }, {
        referer,
        extraHeaders: { 'X-Requested-With': 'XMLHttpRequest', ...(xsrf ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } : {}) },
      });
    } catch (error) {
      if (attempt || ![403, 419].includes(error.response?.status)) throw error;
      await fetchText(`${BASE}/sanctum/csrf-cookie`, { referer, allowError: true });
    }
  }
  throw new Error('No se pudo renovar CSRF');
}

async function streams(match, media) {
  const tmdb = media.metadata;
  let url = match.url;
  if (media.mediaType !== 'movie') {
    const show = await fetchText(url, { referer: `${BASE}/` });
    const episode = episodeLinks(show.text, show.url, media.season, media.episode);
    if (!episode) return [];
    url = episode.url;
  }
  const page = await fetchText(url, { referer: `${BASE}/` });
  const candidates = embedCandidatesFromHtml(page.text, page.url, { language: 'es', referer: page.url });
  const buttons = [...page.text.matchAll(/<button\b[^>]*class\s*=\s*["'][^"']*server-btn[^"']*["'][^>]*>/gi)].map((match) => match[0]);
  for (const button of buttons) {
    const attrs = attributes(button);
    const direct = attribute(button, 'data-server-url');
    if (direct) candidates.push({ url: direct, language: 'es', referer: page.url });
    else if (attrs['data-player-id'] && attrs['data-player-model']) {
      try {
        const response = await fetchJson(`${BASE}/api/player-url/${encodeURIComponent(attrs['data-player-model'])}/${encodeURIComponent(attrs['data-player-id'])}`, {
          referer: page.url, extraHeaders: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (response.data.url) candidates.push({ url: response.data.url, language: 'es', referer: page.url });
      } catch (_) {                                      }
    } else if (attrs['data-player-token']) {
      try {
        const response = await playerToken(attrs['data-player-token'], page.url);
        if (response.data.url) candidates.push(...await openProtected(response.data.url, page.url));
      } catch (_) {                                                           }
    }
  }
  if (!candidates.length && tmdb.imdbId) {
    const path = media.mediaType === 'movie'
      ? tmdb.imdbId
      : `${tmdb.imdbId}-${media.season}x${String(media.episode).padStart(2, '0')}`;
    candidates.push(...await openProtected(`${EMBED}/f/${path}`, `${EMBED}/`).catch(() => []));
  }
  const uniqueCandidates = unique(candidates, (item) => item.url);
  return resolveCandidates(uniqueCandidates, { provider: 'SoloLatino', providerId: 'sololatino', referer: page.url });
}

module.exports = { getStreams: createSiteProvider({ name: 'SoloLatino', search: async (query, mediaType) => {
  const page = await fetchText(withQuery(`${BASE}/buscar`, { q: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:pelicula|serie|series|animes)\//i });
}, streams }) };
