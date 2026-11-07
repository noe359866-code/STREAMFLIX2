import { createSiteProvider } from '../../core/site.js';
import { fetchJson, fetchText, mapLimit, postForm } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, attributes, stripTags, unique } from '../../core/text.js';


const BASE = 'https://verpeliculasonline.net';

function language(label) {
  if (/latino/i.test(label)) return 'es-LAT';
  if (/subtitulad/i.test(label)) return 'es-SUB';
  if (/español|castellano/i.test(label)) return 'es-ES';
  return 'es';
}

function options(html) {
  const output = [];
  const regex = /<li\b[^>]*class\s*=\s*["'][^"']*dooplay_player_option[^"']*["'][^>]*>[\s\S]*?<\/li>/gi;
  for (const match of String(html || '').matchAll(regex)) {
    const raw = match[0];
    const attrs = attributes(raw.slice(0, raw.indexOf('>') + 1));
    if (!attrs['data-post'] || !/^\d+$/.test(attrs['data-nume'] || '')) continue;
    const label = stripTags(raw.match(/<span\b[^>]*class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const server = stripTags(raw.match(/<span\b[^>]*class\s*=\s*["'][^"']*server[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    output.push({
      post: attrs['data-post'], number: attrs['data-nume'], type: attrs['data-type'] || 'movie',
      language: language(label), languageLabel: label, server: server || 'Servidor',
    });
  }
  return output;
}

function embedUrl(data, base) {
  const value = typeof data?.embed_url === 'string' ? data.embed_url : '';
  const source = value.match(/<iframe\b[^>]*src\s*=\s*["']([^"']+)["']/i)?.[1] || value;
  return absoluteUrl(source, base);
}

async function search(query, mediaType) {
  if (mediaType !== 'movie') return [];
  const page = await fetchText(`${BASE}/?s=${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/pelicula\//i });
}

async function streams(match, media) {
  if (media.mediaType !== 'movie') return [];
  const page = await fetchText(match.url, { referer: `${BASE}/` });
  const method = page.text.match(/["']play_method["']\s*:\s*["']([^"']+)["']/i)?.[1] || 'admin_ajax';
  const candidates = await mapLimit(options(page.text).slice(0, 10), 3, async (option) => {
    try {
      const response = method === 'wp_json'
        ? await fetchJson(`${BASE}/wp-json/dooplayer/v2/${encodeURIComponent(option.post)}/${encodeURIComponent(option.type)}/${encodeURIComponent(option.number)}`, { referer: page.url })
        : await postForm(`${BASE}/wp-admin/admin-ajax.php`, {
          action: 'doo_player_ajax', post: option.post, nume: option.number, type: option.type,
        }, { referer: page.url, extraHeaders: { 'X-Requested-With': 'XMLHttpRequest' } });
      const url = embedUrl(response.data, page.url);
      if (!url || /youtube\.com|youtu\.be|\/enlace\//i.test(url)) return null;
      return {
        url, referer: page.url, language: option.language, server: option.server,
        title: `${option.server} · ${option.languageLabel || option.language}`,
      };
    } catch (_) { return null; }
  });
  const playable = unique(candidates.filter(Boolean), (item) => `${item.url}|${item.language}`);
  return resolveCandidates(playable, {
    provider: 'VerPeliculasOnline', providerId: 'verpeliculasonline', referer: page.url,
    maxCandidates: 10, parallel: 3,
  });
}

module.exports = { getStreams: createSiteProvider({ name: 'VerPeliculasOnline', search, streams }) };
