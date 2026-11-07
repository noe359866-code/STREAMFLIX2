import { createSiteProvider } from '../../core/site.js';
import { fetchText, mapLimit, postForm } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { embedCandidatesFromHtml, resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, attributes, unique } from '../../core/text.js';
import { isPlayableUrl, languageOf } from '../../core/streams.js';

const BASE = 'https://tudorama.com';
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const ITEM = /^https:\/\/tudorama\.com\/(?:pelicula|serie)\/[^/?#]+\/?$/i;
const EPISODE = /^https:\/\/tudorama\.com\/ver\/[^/?#]+\/?$/i;

async function search(query, mediaType) {
  const result = await fetchText(`${BASE}/?s=${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cardsFromAnchors(result.text, result.url, { mediaType, path: ITEM })
    .filter((item) => ITEM.test(item.url) && !/%3c|%3e|[<>]/i.test(item.url));
}

function playerFields(html) {
  for (const tag of String(html || '').match(/<div\b[^>]*>/gi) || []) {
    const fields = attributes(tag);
    if (!/(?:^|\s)(?:servers|ep__dropdown)(?:\s|$)/i.test(fields.class || '')) continue;
    if (/^\d{1,12}$/.test(fields['data-id'] || '') && /^[\w-]{4,160}$/.test(fields['data-nonce'] || '')) {
      return { id: fields['data-id'], nonce: fields['data-nonce'] };
    }
  }
  return null;
}

function optionLanguage(row) {
  const name = String(row.name || row.server || '');
  const lang = String(row.lang || '').toLowerCase();
  // «sub» no demuestra el idioma de los subtítulos. La etiqueta del propio
  // servidor indica inglés («en») o español («es»), no VOSE verificada.
  if (lang === 'en') return 'en';
  if (/\b(?:lat|latino)\b/i.test(name)) return 'es-LAT';
  if (/\b(?:cast|castellano)\b/i.test(name)) return 'es-ES';
  if (lang === 'es' || /\besp\b/i.test(name)) return 'es';
  if (/\bsub(?:titulado)?\b/i.test(name)) return '';
  const explicit = languageOf(name, '');
  return explicit || '';
}

async function episodeUrl(show, season, episode) {
  const found = episodeLinks(show.text, show.url, season, episode);
  if (found && EPISODE.test(found.url)) return found.url;
  // WStream pagina episodios; no fabricar una ruta /ver/<slug>-sNxM.
  for (const tag of String(show.text || '').match(/<div\b[^>]*>/gi) || []) {
    const fields = attributes(tag);
    if (!/(?:^|\s)eps(?:\s|$)/i.test(fields.class || '')) continue;
    if (Number(fields['data-season-number'] || 1) !== Number(season)
      || !/^\d{1,12}$/.test(fields['data-tmdb-id'] || '')
      || !/^[\w-]{4,160}$/.test(fields['data-nonce'] || '')) continue;
    const results = Math.max(1, Math.min(50, Number(fields['data-results']) || 20));
    for (let offset = 0; offset < results * 2; offset += results) {
      const reply = await postForm(AJAX, {
        action: 'corvus_get_episodes', nonce: fields['data-nonce'], post_id: fields['data-tmdb-id'],
        season, results, offset, order: 'DESC',
      }, { referer: show.url, extraHeaders: { 'X-Requested-With': 'XMLHttpRequest' } });
      const rows = reply.data?.data?.results;
      if (!Array.isArray(rows)) break;
      const match = rows.find((row) => Number(row?.season_number || season) === Number(season)
        && Number(row?.episode_number) === Number(episode));
      const url = absoluteUrl(match?.permalink || '', show.url);
      if (url && EPISODE.test(url)) return url;
      if (!reply.data?.data?.hasMore || rows.length === 0) break;
    }
  }
  return '';
}

async function serverOptions(html, referer) {
  const fields = playerFields(html);
  if (!fields) return [];
  const reply = await postForm(AJAX, {
    action: 'corvus_get_servers', nonce: fields.nonce, post_id: fields.id,
  }, { referer, extraHeaders: { 'X-Requested-With': 'XMLHttpRequest' } });
  const rows = Array.isArray(reply.data?.data) ? reply.data.data : Array.isArray(reply.data) ? reply.data : [];
  return rows.filter((row) => typeof row?.url === 'string' && !/tr[aá]iler|download|descarg/i.test(row.name || ''))
    .map((row) => ({
      url: absoluteUrl(row.url, referer), referer, server: row.name || row.server || 'Tudorama',
      language: optionLanguage(row),
    })).filter((row) => /^https:\/\//i.test(row.url) && row.language)
    .sort((a, b) => (a.language === 'en' ? 1 : 0) - (b.language === 'en' ? 1 : 0))
    .slice(0, 6);
}

async function unwrap(option) {
  if (isPlayableUrl(option.url)) return [option];
  // Los wrappers observados pertenecen al CDN de Tudorama. Nunca solicitar
  // una URL arbitraria que el AJAX devuelva disfrazada de página del sitio.
  if (!/^https:\/\/(?:cdn\.)?tudorama\.com\/stream\/[^?#]+/i.test(option.url)) return [option];
  try {
    const wrapper = await fetchText(option.url, { referer: option.referer, timeoutMs: 8500 });
    const dynamic = wrapper.text.match(/iframe\.src\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]
      || wrapper.text.match(/iframe\.setAttribute\(\s*["']src["']\s*,\s*["'](https?:\/\/[^"']+)["']/i)?.[1];
    const found = [
      dynamic ? { ...option, url: dynamic, referer: wrapper.url } : null,
      ...embedCandidatesFromHtml(wrapper.text, wrapper.url, { ...option, referer: wrapper.url }),
    ].filter((item) => item && /^https:\/\//i.test(item.url));
    return unique(found, (item) => item.url).slice(0, 2);
  } catch (_) { return []; }
}

async function streams(match, media) {
  if (!ITEM.test(match.url)) return [];
  let page = await fetchText(match.url, { referer: `${BASE}/` });
  if (media.mediaType !== 'movie') {
    const url = await episodeUrl(page, media.season, media.episode);
    if (!url) return [];
    page = await fetchText(url, { referer: page.url });
    if (!EPISODE.test(page.url)) return [];
  } else if (!/^https:\/\/tudorama\.com\/pelicula\//i.test(page.url)) return [];
  const options = await serverOptions(page.text, page.url);
  const groups = await mapLimit(options, 2, unwrap);
  const candidates = unique(groups.flat().filter(Boolean), (item) => `${item.url}|${item.language}`);
  return resolveCandidates(candidates, {
    provider: 'TuDorama', providerId: 'tudorama', referer: page.url,
    maxCandidates: 8, parallel: 2,
  });
}

module.exports = { getStreams: createSiteProvider({
  name: 'TuDorama', search, streams, maxQueries: 3, minimumScore: 70,
}) };
