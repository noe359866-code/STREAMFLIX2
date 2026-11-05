import { createSiteProvider } from '../../core/site.js';
import { fetchText, postForm, withQuery } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { absoluteUrl, extractBalanced, unique } from '../../core/text.js';
import { decodeBase64Url } from '../../core/base64.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://jkanime.net';
const SUPPORTED = /streamwish|voe|vidhide|filemoon|mixdrop|mp4upload|streamtape|doodstream|jkplayer/i;
async function search(query, mediaType) {
  let page;
  try {
    const home = await fetchText(`${BASE}/`, { referer: `${BASE}/` });
    const token = home.text.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (!token) throw new Error('CSRF no disponible');
    const response = await postForm(`${BASE}/ajax_search`, { _token: token, query }, {
      referer: home.url, extraHeaders: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': token },
    });
    return (Array.isArray(response.data) ? response.data : []).map((item) => ({
      url: `${BASE}/${item.slug}/`, title: item.title, type: /movie|pelicula/i.test(item.type || item.tipo || '') ? 'movie' : 'tv',
    })).filter((item) => mediaType === 'movie' ? item.type === 'movie' : item.type !== 'movie');
  } catch (_) {
    page = await fetchText(withQuery(`${BASE}/directorio`, { buscar: query, p: 1 }), { referer: `${BASE}/` });
  }
  const raw = extractBalanced(page.text, 'var animes', '{', '}');
  if (raw) {
    try {
      const json = JSON.parse(raw);
      return (json.data || []).map((item) => ({
        url: `${BASE}/${item.slug}/`, title: item.title, type: /movie|pelicula/i.test(item.type || item.tipo || '') ? 'movie' : 'tv',
      })).filter((item) => mediaType === 'movie' ? item.type === 'movie' : item.type !== 'movie');
    } catch (_) { /* HTML de compatibilidad */ }
  }
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /jkanime\.net\/[^/]+\/?$/i });
}
async function streams(match, media) {
  if (media.season !== 1) return [];
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const numericId = show.text.match(/data-anime\s*=\s*["'](\d+)["']/i)?.[1];
  const token = show.text.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)?.[1];
  let confirmed = media.mediaType === 'movie';
  if (numericId && token) {
    try {
      const page = Math.floor((media.episode - 1) / 16) + 1;
      const response = await postForm(`${BASE}/ajax/episodes/${numericId}/${page}`, { _token: token }, {
        referer: show.url, extraHeaders: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': token },
      });
      confirmed = (response.data.data || []).some((item) => Number(item.number) === media.episode);
    } catch (_) { confirmed = false; }
  }
  if (!confirmed) return [];
  const slug = match.url.split('/').filter(Boolean).pop();
  const url = `${BASE}/${slug}/${media.mediaType === 'movie' ? 1 : media.episode}/`;
  const page = await fetchText(url, { referer: show.url });
  const candidates = [];
  const rawServers = extractBalanced(page.text, 'var servers', '[', ']');
  if (rawServers) {
    try {
      for (const item of JSON.parse(rawServers)) {
        const decoded = decodeBase64Url(item.remote);
        if (decoded && SUPPORTED.test(`${item.server} ${decoded}`)) candidates.push({ url: decoded, server: item.server, language: 'es-SUB', referer: page.url });
      }
    } catch (_) { /* también hay iframes video[] */ }
  }
  for (const matchIframe of page.text.matchAll(/video\[(\d+)\]\s*=\s*['"]<iframe[^>]+src=["']([^"']+)["']/gi)) {
    if (SUPPORTED.test(matchIframe[2])) candidates.push({ url: absoluteUrl(matchIframe[2], page.url), server: `JKPlayer ${matchIframe[1]}`, language: 'es-SUB', referer: page.url });
  }
  return resolveCandidates(unique(candidates, (item) => item.url), { provider: 'JKAnime', providerId: 'jkanime', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'JKAnime', search, streams }) };
