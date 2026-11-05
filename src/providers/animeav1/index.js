import { createSiteProvider } from '../../core/site.js';
import { fetchJson, fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://animeav1.com';
async function search(query, mediaType) {
  if (mediaType === 'movie') return [];
  const page = await fetchText(withQuery(`${BASE}/catalogo`, { search: query, page: 1 }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType: 'tv', path: /\/media\//i }).map((item) => ({
    ...item, url: item.url.replace(/\/\d+\/?$/, ''), type: 'tv',
  }));
}
function episodeEmbeds(json) {
  for (const node of json.nodes || []) {
    const data = node?.data;
    const root = Array.isArray(data) ? data[0] : null;
    if (!root || root.embeds === undefined || root.episode === undefined) continue;
    const embeds = data[root.embeds];
    const output = [];
    for (const [language, label] of [['SUB', 'es-SUB'], ['DUB', 'es-LAT']]) {
      if (!embeds || embeds[language] === undefined) continue;
      const list = data[embeds[language]] || [];
      for (const index of list) {
        const server = data[index];
        if (!server) continue;
        const name = data[server.server];
        const url = data[server.url];
        if (/^https?:\/\//i.test(url || '') && !/mega/i.test(name || '')) output.push({ url, language: label, server: name });
      }
    }
    return output;
  }
  return [];
}
async function streams(match, media) {
  if (media.season !== 1) return [];
  const url = `${match.url.replace(/\/$/, '')}/${media.episode}`;
  const response = await fetchJson(`${url}/__data.json`, { referer: `${BASE}/` });
  return resolveCandidates(episodeEmbeds(response.data), { provider: 'AnimeAV1', providerId: 'animeav1', referer: url });
}
module.exports = { getStreams: createSiteProvider({ name: 'AnimeAV1', search, streams }) };
