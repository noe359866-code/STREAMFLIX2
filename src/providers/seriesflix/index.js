import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { decodeBase64Url } from '../../core/base64.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors, attribute, decodeHtml, hostName, stripTags, unique } from '../../core/text.js';

const BASE = 'https://seriesflixhd.lol';
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType: 'tv', path: /\/serie\//i });
}

function seasonLink(html, base, season) {
  const links = anchors(html).filter((anchor) => /\/temporada(?:\/|-)/i.test(anchor.href));
  if (!links.length) return { url: base, hasSeasonPages: false };
  const match = links.find((anchor) => {
    const fromText = anchor.raw.replace(/<[^>]+>/g, ' ').match(/temporada\s*(\d+)/i)?.[1];
    const fromUrl = anchor.href.match(/-(\d+)\/?(?:[?#].*)?$/i)?.[1];
    return Number(fromText || fromUrl) === Number(season);
  });
  return { url: match ? absoluteUrl(match.href, base) : '', hasSeasonPages: true };
}

function findEpisode(html, base, season, episode) {
  const paired = episodeLinks(html, base, season, episode);
  if (paired) return paired.url;
  const rows = String(html || '').match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const href = row.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || !/\/episodio\//i.test(href)) continue;
    const pair = row.match(/(\d+)\s*[x×-]\s*(\d+)/i);
    const number = row.match(/class\s*=\s*["'][^"']*Num[^"']*["'][^>]*>\s*(\d+)/i)?.[1]
      || row.match(/(?:episodio|cap[ií]tulo)\s*(\d+)/i)?.[1];
    if ((pair && Number(pair[1]) === Number(season) && Number(pair[2]) === Number(episode))
      || (!pair && Number(number) === Number(episode))) return absoluteUrl(href, base);
  }
  return '';
}

function unwrapServerUrl(value) {
  const decoded = decodeHtml(value);
  const inner = decoded.match(/[?&]url=([^&]+)/i)?.[1];
  if (!inner) return decoded;
  try {
    const url = decodeURIComponent(inner);
    return /^https?:\/\//i.test(url) ? url : decoded;
  } catch (_) { return decoded; }
}

function serverCandidates(html, base) {
  // Cada .drpdn agrupa los servidores de un idioma; aceptar también estructuras simples.
  const groups = String(html || '').split(/<div\b(?=[^>]*class\s*=\s*["'][^"']*drpdn)[^>]*>/i).slice(1);
  const candidates = [];
  for (const group of groups.length ? groups : [String(html || '')]) {
    const language = stripTags(group.match(/<button\b(?=[^>]*class\s*=\s*["'][^"']*bstd)[^>]*>([\s\S]*?)<\/button>/i)?.[1] || '') || 'es';
    const tags = group.match(/<(?:a|button|li)\b[^>]*data-url\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    tags.forEach((tag, index) => {
      const decoded = decodeBase64Url(attribute(tag, 'data-url'));
      if (!decoded) return;
      const url = absoluteUrl(unwrapServerUrl(decoded), base);
      if (!url) return;
      candidates.push({ url, language, server: `${hostName(url)} ${index + 1}`, referer: base });
    });
  }
  return unique(candidates, (item) => item.url);
}

async function streams(match, media) {
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const season = seasonLink(show.text, show.url, media.season);
  if (!season.url) return [];
  const seasonPage = season.hasSeasonPages
    ? await fetchText(season.url, { referer: show.url })
    : show;
  const episodeUrl = findEpisode(seasonPage.text, seasonPage.url, media.season, media.episode);
  if (!episodeUrl) return [];
  const page = await fetchText(episodeUrl, { referer: seasonPage.url });
  return resolveCandidates(serverCandidates(page.text, page.url), {
    provider: 'SeriesFlix', providerId: 'seriesflix', referer: page.url,
  });
}
module.exports = { getStreams: createSiteProvider({ name: 'SeriesFlix', search, streams }) };
