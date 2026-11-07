const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü',
};

export function decodeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/\\u002F/gi, '/').replace(/\\\//g, '/')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      try { return Number.isFinite(number) ? String.fromCodePoint(number) : ''; } catch (_) { return ''; }
    })
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name] === undefined ? match : ENTITIES[name]);
}

export function stripTags(value) {
  return decodeHtml(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(value) {
  let text = decodeHtml(value).toLowerCase();
  try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) { /* QuickJS antiguo */ }
  return text
    .replace(/\.(mkv|mp4|avi)$/i, '')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(ver|pelicula|serie|online|gratis|audio|latino|castellano|subtitulado|sub espanol|espanol)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function slugify(value) {
  return normalizeTitle(value).replace(/\s+/g, '-');
}

export function titleScore(candidate, metadata, mediaType) {
  const normalized = normalizeTitle(candidate && (candidate.title || candidate.name || candidate.url));
  if (!normalized) return -1;
  const titles = (metadata.titles || []).map(normalizeTitle).filter(Boolean);
  let score = -1;
  for (const title of titles) {
    if (normalized === title) score = Math.max(score, 100);
    else if (normalized.startsWith(`${title} `) || normalized.endsWith(` ${title}`)) score = Math.max(score, 82);
    else if (title.length >= 5 && normalized.includes(title)) score = Math.max(score, 68);
  }
  if (score < 0) return -1;
  const year = String(candidate.year || candidate.released || '').match(/(?:19|20)\d{2}/);
  if (metadata.year && year) score += year[0] === String(metadata.year) ? 15 : -25;
  if (candidate.type && mediaType) {
    const candidateTv = /tv|serie|anime|dorama|show/i.test(candidate.type) && !/movie|pelicula/i.test(candidate.type);
    score += candidateTv === (mediaType !== 'movie') ? 10 : -35;
  }
  return score;
}

export function bestTitleMatch(candidates, metadata, mediaType, minimum = 60) {
  return (candidates || [])
    .map((candidate, index) => ({ candidate, index, score: titleScore(candidate, metadata, mediaType) }))
    .filter((entry) => entry.score >= minimum)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.candidate || null;
}

export function absoluteUrl(value, base) {
  const url = decodeHtml(value).trim();
  if (!url || /^(about:|javascript:|data:|#)/i.test(url)) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  const originMatch = String(base || '').match(/^(https?:\/\/[^/?#]+)/i);
  if (!originMatch) return url;
  const origin = originMatch[1];
  if (url.startsWith('/')) return origin + url;
  const page = String(base).split(/[?#]/)[0];
  if (url.startsWith('?')) return page + url;
  // Una base sin barra final (https://host) también tiene un directorio raíz.
  const directory = page === origin ? `${origin}/` : page.replace(/\/[^/]*$/, '/');
  const match = url.match(/^([^?#]*)([\s\S]*)$/);
  const path = `${directory.slice(origin.length)}${match[1]}`;
  const segments = [];
  for (const segment of path.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') { if (segments.length > 1) segments.pop(); }
    else segments.push(segment);
  }
  if (/\/(?:\.|\.\.)$/.test(path)) segments.push('');
  return origin + segments.join('/') + match[2];
}

export function hostName(url) {
  const host = String(url || '').match(/^https?:\/\/([^/]+)/i)?.[1] || '';
  const clean = host.replace(/^www\./i, '').split('.')[0];
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Servidor';
}

export function anchors(html) {
  const output = [];
  const regex = /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(String(html || '')))) {
    const raw = match[0];
    const imageAlt = raw.match(/<img\b[^>]*(?:alt|title)\s*=\s*(["'])(.*?)\1/i)?.[2];
    const anchorTitle = raw.match(/<a\b[^>]*title\s*=\s*(["'])(.*?)\1/i)?.[2];
    output.push({
      href: decodeHtml(match[2]),
      raw,
      title: stripTags(match[3]) || stripTags(imageAlt || anchorTitle || ''),
      imageAlt: stripTags(imageAlt || ''),
      anchorTitle: stripTags(anchorTitle || ''),
    });
  }
  return output;
}

export function attributes(tag) {
  const result = {};
  const regex = /([:\w-]+)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while ((match = regex.exec(String(tag || '')))) result[match[1].toLowerCase()] = decodeHtml(match[3]);
  return result;
}

export function attribute(tag, name) {
  return attributes(tag)[String(name || '').toLowerCase()] || '';
}

export function tags(html, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(html || '').match(new RegExp(`<${escaped}\\b[^>]*>`, 'gi')) || [];
}

export function extractBalanced(source, marker, opening = '[', closing = ']') {
  const text = String(source || '');
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf(opening, markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export function unique(values, keyOf = (value) => value) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue;
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

export function yearOf(value) {
  return String(value || '').match(/(?:19|20)\d{2}/)?.[0] || '';
}
