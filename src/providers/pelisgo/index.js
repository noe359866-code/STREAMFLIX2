import { createSiteProvider } from '../../core/site.js';
import { fetchText } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, decodeHtml, unique } from '../../core/text.js';
import { languageOf, qualityOf } from '../../core/streams.js';

const BASE = 'https://pelisgo.online';

async function search(query, mediaType) {
  const page = await fetchText(`${BASE}/search?q=${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { path: /\/(?:movies|series)\//i, mediaType });
}

// Los objetos pueden estar en HTML o escapados dentro de self.__next_f.push.
function normalizeServerData(html) {
  return String(html || '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&');
}

function field(raw, name) {
  const regex = new RegExp(`["']?${name}["']?\\s*:\\s*["']([^"']*)["']`, 'i');
  return decodeHtml(raw.match(regex)?.[1] || '').trim();
}

function isDownload(raw, url) {
  const kind = [field(raw, 'type'), field(raw, 'kind'), field(raw, 'action'), field(raw, 'server')].join(' ');
  return /download|descarg|1fichier|pixeldrain|uptobox/i.test(`${kind} ${url}`)
    || /[?&](?:download|d)=1(?:&|$)/i.test(url);
}

function serverCandidates(html, base) {
  // La sección de descargas tiene objetos parecidos, pero no son opciones de reproducción.
  const source = normalizeServerData(html).split(/<[^>]+id\s*=\s*["']downloads["'][^>]*>/i)[0];
  const output = [];
  for (const match of source.matchAll(/\{(?=[^{}]{0,1800}\bserver\b)[^{}]{1,1800}\}/gi)) {
    const raw = match[0];
    const server = field(raw, 'server');
    const url = absoluteUrl(field(raw, 'url'), base);
    if (!server || !url || isDownload(raw, url) || /youtube\.com|youtu\.be/i.test(url)) continue;
    const languageLabel = field(raw, 'language') || field(raw, 'lang');
    const language = languageOf(languageLabel, 'es');
    const quality = qualityOf(field(raw, 'quality'));
    output.push({
      url, server, language, quality, referer: base,
      title: `${server} · ${languageLabel || language} · ${quality}`,
    });
  }
  return unique(output, (item) => `${item.url}|${item.language}`);
}

function validEpisodePage(html, season, episode) {
  if (/Escena no encontrada|P[aá]gina no encontrada|<title>\s*404\b/i.test(html)) return false;
  const headings = [...String(html || '').matchAll(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/gi)]
    .map((match) => decodeHtml(match[1].replace(/<[^>]+>/g, ' '))).join(' ');
  const pair = new RegExp(`(?:T0*${Number(season)}\\s*E0*${Number(episode)}\\b|S0*${Number(season)}\\s*E0*${Number(episode)}\\b|Temporada\\s+0*${Number(season)}\\D{0,80}Episodio\\s+0*${Number(episode)}\\b)`, 'i');
  return pair.test(headings);
}

async function streams(match, media) {
  // El slug procede de la búsqueda; nunca se deriva del título ni se reintenta otro episodio.
  const url = media.mediaType === 'movie' ? match.url
    : `${match.url.replace(/\/+$/, '')}/temporada/${Number(media.season)}/episodio/${Number(media.episode)}`;
  let page;
  try {
    page = await fetchText(url, { referer: media.mediaType === 'movie' ? `${BASE}/` : match.url });
  } catch (error) {
    if (error?.response?.status === 404) return [];
    throw error;
  }
  if (media.mediaType !== 'movie' && !validEpisodePage(page.text, media.season, media.episode)) return [];
  const candidates = serverCandidates(page.text, page.url);
  return resolveCandidates(candidates, {
    provider: 'PelisGo', providerId: 'pelisgo', referer: page.url,
    maxCandidates: 10, parallel: 2,
  });
}

module.exports = { getStreams: createSiteProvider({ name: 'PelisGo', search, streams }) };
