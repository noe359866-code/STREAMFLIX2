import { createSiteProvider } from '../../core/site.js';
import { fetchText, mapLimit } from '../../core/http.js';
import { cardsFromAnchors } from '../../core/html.js';
import { directMediaInHtml, embedCandidatesFromHtml, resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors, stripTags, unique } from '../../core/text.js';

const BASE = 'https://ver.gnula.one';

function isMoviePage(url) {
  return /^https:\/\/ver\.gnula\.one\/movies\/[^/?#]+\/?$/i.test(url)
    && !/%3c|%3e|[<>]/i.test(url);
}

async function search(query, mediaType) {
  if (mediaType !== 'movie') return [];

  const page = await fetchText(`${BASE}/search/${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, {
    mediaType: 'movie', path: /^https:\/\/ver\.gnula\.one\/movies\/[^/?#]+\/?$/i,
  }).filter((card) => isMoviePage(card.url));
}

function language(label) {
  if (/subtitulad|\bsub\b/i.test(label)) return 'es-SUB';
  if (/castellano|\bcas\b/i.test(label)) return 'es-ES';
  if (/latino|\blat\b/i.test(label)) return 'es-LAT';
  return 'es';
}

function options(html, base) {
  const found = anchors(html).map((anchor) => {
    const url = absoluteUrl(anchor.href, base);
    if (!/^https:\/\/ver\.gnula\.one\/(?:movies\/[^/?#]+\/?)?\?trembed=\d+(?:&|$)/i.test(url)) return null;
    const label = stripTags(anchor.raw);
    return { url, server: label || 'Servidor', language: language(label), referer: base };
  }).filter(Boolean);
  return unique(found, (item) => item.url).slice(0, 8);
}

async function frameCandidates(option, movieUrl) {
  try {
    const frame = await fetchText(option.url, { referer: movieUrl });
    const title = stripTags(frame.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');


    if (/^G Nula\s*-\s*G Nula\b/i.test(title)) return [];
    const referer = frame.url || option.url;
    const direct = directMediaInHtml(frame.text, referer).map((url) => ({ ...option, url, referer }));
    const embedded = embedCandidatesFromHtml(frame.text, referer, option)
      .filter((item) => item.url !== referer && !/youtube\.com|youtu\.be|\/download\/|download\.php/i.test(item.url))
      .map((item) => ({ ...option, ...item, referer }));
    return unique([...direct, ...embedded], (item) => item.url).slice(0, 4);
  } catch (_) { return []; }
}

async function streams(match, media) {
  if (media.mediaType !== 'movie' || !isMoviePage(match.url)) return [];
  const page = await fetchText(match.url, { referer: `${BASE}/` });
  if (!isMoviePage(page.url)) return [];
  const players = options(page.text, page.url);
  const groups = await mapLimit(players, 2, (player) => frameCandidates(player, page.url));
  const candidates = unique(groups.flat().filter(Boolean), (item) => `${item.url}|${item.language}`);
  return resolveCandidates(candidates, {
    provider: 'Gnula One', providerId: 'gnulaone', referer: page.url,
    maxCandidates: 10, parallel: 2,
  });
}


module.exports = { getStreams: createSiteProvider({
  name: 'Gnula One', search, streams, maxQueries: 3, minimumScore: 70,
}) };
