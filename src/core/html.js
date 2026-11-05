import { anchors, attributes, absoluteUrl, stripTags, tags, yearOf } from './text.js';

export function cardsFromAnchors(html, base, options = {}) {
  const seen = new Set();
  const output = [];
  for (const anchor of anchors(html)) {
    const url = absoluteUrl(anchor.href, base);
    if (!url || (options.path && !options.path.test(url)) || seen.has(url)) continue;
    const title = anchor.imageAlt || anchor.anchorTitle || anchor.title;
    if (!title || title.length > 300) continue;
    const type = /\/(?:serie|series|anime|dorama|tvshows?)(?:\/|$)/i.test(url) ? 'tv'
      : /\/(?:pelicula|peliculas|movie|movies)(?:\/|$)/i.test(url) ? 'movie' : '';
    if (options.mediaType === 'movie' && type === 'tv') continue;
    if (options.mediaType === 'tv' && type === 'movie') continue;
    seen.add(url);
    output.push({ url, title, year: yearOf(anchor.raw), type, raw: anchor.raw });
  }
  return output;
}

export function playerOptions(html, base) {
  return tags(html, 'li').map((tag) => {
    const attrs = attributes(tag);
    const nume = attrs['data-nume'];
    const post = attrs['data-post'];
    const type = attrs['data-type'];
    const option = attrs['data-option'];
    const server = attrs['data-server'] || attrs['data-src'] || attrs['data-url'];
    const url = absoluteUrl(option || '', base);
    if (!nume && !url && !server) return null;
    return {
      number: Number(nume) || 1,
      postId: post || '',
      type: type || 'movie',
      url,
      server,
      raw: tag,
    };
  }).filter(Boolean);
}

export function episodeLinks(html, base, season, episode) {
  const wanted = [];
  for (const anchor of anchors(html)) {
    const url = absoluteUrl(anchor.href, base);
    if (!url || !/episodio|episodes?|\/ver\/|temporada|season/i.test(url)) continue;
    const text = `${url} ${anchor.raw.replace(/<[^>]+>/g, ' ')}`;
    const pair = text.match(/(?:^|\D)(\d{1,2})\s*[x×-]\s*(?:e)?(\d{1,4})(?:\D|$)/i);
    const urlPair = url.match(/(?:temporada|season)[=/](\d+)[^\d]+(?:episodio|episode|capitulo)[=/](\d+)/i);
    const s = Number(urlPair?.[1] || pair?.[1]);
    const e = Number(urlPair?.[2] || pair?.[2]);
    if (s === Number(season) && e === Number(episode)) wanted.push({ url, title: anchor.title, raw: anchor.raw });
  }
  return wanted[0] || null;
}

export function nextData(html) {
  const match = String(html || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (_) { return null; }
}

export function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html || '').match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'));
  return match ? stripTags(match[1]) : '';
}
