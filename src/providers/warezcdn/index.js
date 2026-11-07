import { createDirectProvider } from '../../core/site.js';
import { fetchText } from '../../core/http.js';
import { directMediaInHtml, embedCandidatesFromHtml, resolveCandidates } from '../../core/extractors.js';
import { unique } from '../../core/text.js';
import { isPlayableUrl } from '../../core/streams.js';

const BASE = 'https://warezcdn.sbs';
const EMBED_HOST = /(?:^|\.)(?:warezcdn\.sbs|voe\.(?:sx|to)|filemoon\.(?:sx|to)|streamwish\.(?:to|com)|earnvids\.(?:com|to)|hgcloud\.to|streamhg\.to|vidhide\.(?:com|to)|mp4upload\.com)$/i;

function publicHttps(url) {
  const match = String(url || '').match(/^https:\/\/([^/@?#:]+)(?::\d+)?\//i);
  const host = match?.[1]?.toLowerCase() || '';
  return host.includes('.') && !/\.(?:local|localhost|internal|lan)$/.test(host)
    && !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
}

async function streams(id, media) {
  if (media.mediaType === 'movie' ? !/^(?:tt\d{5,12}|\d{1,12})$/i.test(id) : !/^\d{1,12}$/.test(id)) return [];
  const url = media.mediaType === 'movie' ? `${BASE}/filme/${id}`
    : `${BASE}/serie/${id}/${media.season}/${media.episode}`;
  // La documentación ofrece iframe, no promete una API de vídeos directos.
  // Cloudflare devolvió 403 a Actions; no se simula navegador ni se evade.
  const page = await fetchText(url, { referer: `${BASE}/doc`, timeoutMs: 9500 });
  if (!/^https:\/\/warezcdn\.sbs\/(?:filme|serie)\//i.test(page.url)) return [];
  const direct = directMediaInHtml(page.text, page.url)
    .filter((value) => publicHttps(value) && isPlayableUrl(value))
    .map((value) => ({ url: value, language: 'und', referer: page.url }));
  const embeds = embedCandidatesFromHtml(page.text, page.url, { language: 'und', referer: page.url })
    .filter((candidate) => publicHttps(candidate.url)
      && (isPlayableUrl(candidate.url) || EMBED_HOST.test(candidate.url.match(/^https:\/\/([^/:?#]+)/i)?.[1] || '')));
  const candidates = unique([...direct, ...embeds], (item) => item.url).slice(0, 6);
  return resolveCandidates(candidates, {
    provider: 'WarezCDN', providerId: 'warezcdn', referer: page.url,
    maxCandidates: 6, parallel: 2,
  });
}

module.exports = { getStreams: createDirectProvider({ name: 'WarezCDN', streams }) };
