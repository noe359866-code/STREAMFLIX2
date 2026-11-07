import { createSiteProvider } from '../../core/site.js';
import { fetchText, mapLimit, origin } from '../../core/http.js';
import { directMediaInHtml, resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, anchors, attributes, stripTags, unique, yearOf } from '../../core/text.js';

const BASE = 'https://www2.pelisforte.se';

function language(label) {
  if (/latino/i.test(label)) return 'es-LAT';
  if (/subtitulad/i.test(label)) return 'es-SUB';
  if (/castellano|español/i.test(label)) return 'es-ES';
  return 'es';
}


function cards(html, base, mediaType) {
  const output = [];
  for (const match of String(html || '').matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)) {
    const raw = match[0];
    if (!/\bpost\b/i.test(raw.slice(0, raw.indexOf('>') + 1))) continue;
    const link = anchors(raw).find((anchor) => /\/(?:pelicula|serie)\//i.test(anchor.href));
    if (!link) continue;
    const url = absoluteUrl(link.href, base);
    const type = /\/serie\//i.test(url) ? 'tv' : 'movie';
    if (type !== mediaType) continue;
    const title = stripTags(raw.match(/<h[1-3]\b[^>]*class\s*=\s*["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] || link.imageAlt || link.title);
    if (!title) continue;
    output.push({ url, title, type, year: yearOf(raw.match(/<span\b[^>]*class\s*=\s*["'][^"']*year[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || raw), raw });
  }
  return unique(output, (item) => item.url);
}

async function search(query, mediaType) {
  const page = await fetchText(`${BASE}/?s=${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cards(page.text, page.url, mediaType);
}

function episodePanel(html) {
  return String(html || '').match(/<ul\b[^>]*id\s*=\s*["']episode_by_temp["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
}

function episodeFrom(html, base, season, episode) {
  const panel = episodePanel(html) || String(html || '');
  for (const anchor of anchors(panel)) {
    const url = absoluteUrl(anchor.href, base);
    if (!/\/episodio\//i.test(url)) continue;
    const pair = `${url} ${anchor.raw}`.match(/(?:^|\D)(\d{1,2})\s*x\s*(\d{1,3})(?:\D|$)/i);
    if (Number(pair?.[1]) === Number(season) && Number(pair?.[2]) === Number(episode)) return { url, raw: anchor.raw };
  }
  return null;
}

async function episodeUrl(show, media) {
  let found = episodeFrom(show.text, show.url, media.season, media.episode);
  if (found) return found.url;
  const seasonLink = [...show.text.matchAll(/<a\b[^>]*>/gi)].map((match) => attributes(match[0]))
    .find((attrs) => attrs['data-post'] && Number(attrs['data-season']) === Number(media.season));
  const nonce = show.text.match(/["']content_nonce["']\s*:\s*["']([^"']+)["']/i)?.[1];
  if (!seasonLink || !nonce) return '';
  const body = [
    'action=action_select_season', `nonce=${encodeURIComponent(nonce)}`,
    `season=${encodeURIComponent(media.season)}`, `post=${encodeURIComponent(seasonLink['data-post'])}`,
  ].join('&');
  const response = await fetchText(`${origin(show.url)}/wp-admin/admin-ajax.php`, {
    method: 'POST', body, referer: show.url,
    extraHeaders: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
  });
  found = episodeFrom(response.text, response.url, media.season, media.episode);
  return found?.url || '';
}

function playerCandidates(html, base) {
  const labels = new Map();
  for (const match of String(html || '').matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const raw = match[0];
    const href = attributes(raw.slice(0, raw.indexOf('>') + 1)).href || '';
    if (!/^#options-[\w-]+$/i.test(href)) continue;
    const serverText = stripTags(raw.match(/<span\b[^>]*class\s*=\s*["'][^"']*server[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || raw);
    const server = serverText.split(/[-–]/)[0].replace(/opci[oó]n\s*\d+/ig, '').trim() || 'Servidor';
    labels.set(href.slice(1), { server, language: language(serverText), languageLabel: serverText });
  }
  const output = [];
  const regex = /<div\b[^>]*id\s*=\s*["'](options-[\w-]+)["'][^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of String(html || '').matchAll(regex)) {
    const frame = match[2].match(/<iframe\b[^>]*>/i)?.[0];
    if (!frame) continue;
    const attrs = attributes(frame);
    const url = absoluteUrl(attrs['data-src'] || attrs.src || '', base);
    if (!url || /youtube\.com|youtu\.be|download\.php/i.test(url)) continue;
    const label = labels.get(match[1]) || { server: 'Servidor', language: 'es', languageLabel: '' };
    output.push({ ...label, url, referer: base, title: `${label.server} · ${label.languageLabel || label.language}` });
  }
  return output;
}

async function expandGateway(candidate) {
  const key = candidate.url.match(/[?&]h=([^&]+)/i)?.[1];
  if (!key) return [candidate];
  const gateway = `${origin(candidate.url)}/r.php?h=${key}`;
  const response = await fetchText(gateway, { referer: candidate.url, timeoutMs: 15000 });
  const finalUrl = absoluteUrl(response.url || gateway, gateway);
  const output = directMediaInHtml(response.text, finalUrl).map((url) => ({
    ...candidate, url, referer: finalUrl,
  }));
  if (finalUrl) output.push({ ...candidate, url: finalUrl, referer: candidate.url });
  return unique(output, (item) => item.url);
}

async function streams(match, media) {
  let url = match.url;
  if (media.mediaType !== 'movie') {
    const show = await fetchText(match.url, { referer: `${BASE}/` });
    url = await episodeUrl(show, media);
    if (!url) return [];
  }
  const page = await fetchText(url, { referer: match.url });
  const players = playerCandidates(page.text, page.url);
  const expanded = await mapLimit(players.slice(0, 10), 2, async (candidate) => {
    try { return await expandGateway(candidate); } catch (_) { return []; }
  });
  const candidates = unique(expanded.flat().filter(Boolean), (item) => `${item.url}|${item.language}`);
  return resolveCandidates(candidates, {
    provider: 'PelisForte', providerId: 'pelisforte', referer: page.url,
    maxCandidates: 12, parallel: 2,
  });
}

module.exports = { getStreams: createSiteProvider({ name: 'PelisForte', search, streams }) };
