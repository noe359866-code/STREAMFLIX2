import { createSiteProvider } from '../../core/site.js';
import { fetchText, mapLimit, origin, postForm } from '../../core/http.js';
import { cardsFromAnchors, episodeLinks } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';
import { absoluteUrl, attributes, stripTags, unique } from '../../core/text.js';
import { languageOf } from '../../core/streams.js';

const BASE = 'https://danimados.cc';

async function search(query) {

  const page = await fetchText(`${BASE}/?s=${encodeURIComponent(query)}`, { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { path: /\/series\//i, mediaType: 'tv' });
}

function optionLanguage(raw) {
  const explicit = languageOf(raw, '');
  if (explicit) return explicit;
  const flag = raw.match(/\/flags\/([a-z-]+)\.(?:png|svg|webp)/i)?.[1] || '';
  if (/^(?:mx|ar|lat|la|latino)$/i.test(flag)) return 'es-LAT';
  if (/^(?:es|esp|spain)$/i.test(flag)) return 'es-ES';
  if (/^sub/i.test(flag)) return 'es-SUB';
  return 'es';
}


function playerOptions(html) {
  const output = [];
  const regex = /<li\b[^>]*\bdata-nume\s*=\s*["'][^"']+["'][^>]*>[\s\S]*?<\/li>/gi;
  for (const match of String(html || '').matchAll(regex)) {
    const raw = match[0];
    const attrs = attributes(raw.slice(0, raw.indexOf('>') + 1));
    const number = Number(attrs['data-nume']);
    if (!Number.isInteger(number) || number < 1 || !attrs['data-post']) continue;
    const server = stripTags(raw.match(/<span\b[^>]*class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || 'Servidor';
    if (/tr[aá]iler|download|descarg/i.test(server)) continue;
    const language = optionLanguage(raw);
    output.push({
      number,
      postId: attrs['data-post'],
      type: attrs['data-type'] || 'tv',
      server,
      language,
      title: `${server} · ${language}`,
    });
  }
  return unique(output, (item) => `${item.postId}|${item.type}|${item.number}`);
}

async function ajaxCandidate(option, episodeUrl) {
  const response = await postForm(`${origin(episodeUrl)}/wp-admin/admin-ajax.php`, {
    action: 'doo_player_ajax',
    post: option.postId,
    type: option.type,
    nume: option.number,
  }, {
    referer: episodeUrl,
    extraHeaders: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  const url = absoluteUrl(response.data?.embed_url || '', episodeUrl);
  if (!url || /youtube\.com|youtu\.be|\/download\/|download\.php/i.test(url)) return null;
  return { ...option, url, referer: episodeUrl };
}

async function streams(match, media) {
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const episode = episodeLinks(show.text, show.url, media.season, media.episode);
  if (!episode) return [];
  const page = await fetchText(episode.url, { referer: show.url });
  if (!/["']play_method["']\s*:\s*["']admin_ajax["']/i.test(page.text)) return [];
  const options = playerOptions(page.text).slice(0, 8);
  const embeds = await mapLimit(options, 2, (option) => ajaxCandidate(option, page.url));
  return resolveCandidates(embeds.filter(Boolean), {
    provider: 'Danimados', providerId: 'danimados', referer: page.url,
    maxCandidates: 8, parallel: 2,
  });
}

module.exports = { getStreams: createSiteProvider({ name: 'Danimados', search, streams }) };
