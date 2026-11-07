
'use strict';



const fs = require('node:fs');
const zlib = require('node:zlib');

const ORIGINAL_TARGETS = [
  { id: 'repelis24', base: 'https://repelis24.de' },
  { id: 'gnulaone', base: 'https://ver.gnula.one' },
];


const REQUESTED_TARGETS = [
  { id: 'tudorama', base: 'https://tudorama.com', paths: ['/?s=Minamahal', '/pelicula/minamahal/', '/serie/el-precio-de-una-confesion/'], title: /minamahal|precio|confesi[oó]n/i },
  { id: 'vixsrc', base: 'https://vixsrc.to', paths: ['/api/movie/550', '/api/tv/1396/1/1', '/movie/550?lang=es'], title: /fight|club|breaking|bad/i },
  { id: 'cinejoy', base: 'https://cinejoy.pk', paths: ['/watch/movie/550', '/watch/tv/1396/1/1', '/api/movie/550'], title: /one\s*piece/i },
  { id: 'atlantic', base: 'https://atlantic.bz', paths: ['/watch/movie/550', '/movie/550', '/api/movie/550', '/embed/movie/550', '/embed/tv/1396/1/1'], title: /fight|club/i },
  { id: 'cinemaarmy', base: 'https://cinema.army', paths: ['/watch?id=550&type=movie', '/api/tcloud/movie/550', '/api/cookiebakers/movie/550', '/api/tidb/movie/550', '/api/tidb/tv/1396/1/1'], title: /fight|club/i },
];
const targetIndex = process.argv.indexOf('--target');
const targetId = targetIndex >= 0 ? process.argv[targetIndex + 1] : '';
const TARGETS = targetId ? REQUESTED_TARGETS.filter((item) => item.id === targetId) : ORIGINAL_TARGETS;
const ATTEMPTS = targetId ? 3 : 1;
if (targetId && !TARGETS.length) throw new Error(`Sitio no registrado: ${targetId}`);
const PATHS = ['/', '/?s=Fight+Club', '/?s=Van+Helsing', '/buscar?q=Fight+Club', '/search?q=Fight+Club', '/search/Fight%20Club'];
const MAX_BYTES = 260000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
};

function strip(text) {
  return String(text || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|#39);/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 110);
}
function attribute(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = re.exec(tag);
  return (match?.[1] || match?.[2] || '').replace(/&amp;/g, '&');
}
function safeUrl(value, base) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    const host = url.hostname;
    return { host, path: url.pathname.replace(/\/[a-z0-9_-]{32,}/gi, '/<id>').slice(0, 160), queryKeys: [...url.searchParams.keys()].slice(0, 6) };
  } catch (_) { return null; }
}
function htmlInfo(html, url) {
  const title = strip(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].slice(0, 8).map(([raw]) => ({
    action: safeUrl(attribute(raw.slice(0, raw.indexOf('>') + 1), 'action'), url),
    method: attribute(raw.slice(0, raw.indexOf('>') + 1), 'method') || 'GET',
    fields: [...raw.matchAll(/<(?:input|select|button)\b[^>]*>/gi)].map(([tag]) => ({
      name: attribute(tag, 'name'), type: attribute(tag, 'type'), placeholder: attribute(tag, 'placeholder').slice(0, 80),
    })).filter((field) => field.name || field.placeholder).slice(0, 15),
  }));
  const allAnchors = [...html.matchAll(/<a\b([^>]*\bhref\s*=\s*["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi)]
    .map(([raw, start, contents]) => {
      const href = attribute(start, 'href');
      const link = safeUrl(href, url);
      if (!link || !/^https?:\/\//i.test(new URL(href, url).href)) return null;
      return { ...link, title: strip(contents) || strip(attribute(start, 'title')) || strip(attribute(contents.match(/<img\b[^>]*>/i)?.[0] || '', 'alt')) };
    }).filter(Boolean);
  const interesting = allAnchors.filter((item) => /fight|club|van\s*helsing|pel[ií]cula|serie|movie|video|player|embed|ver\b/i.test(`${item.title} ${item.path}`));
  const anchors = (interesting.length ? interesting : allAnchors).slice(0, 35);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => safeUrl(match[1], url)).filter(Boolean).slice(0, 15);
  const iframes = [...html.matchAll(/<iframe\b[^>]*>/gi)]
    .map(([tag]) => safeUrl(attribute(tag, 'src') || attribute(tag, 'data-src'), url)).filter(Boolean).slice(0, 12);
  const playerTags = [...html.matchAll(/<(?:div|section|li|button|a)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:play|server|opcion|option|video)[^"']*["'][^>]*>/gi)]
    .slice(0, 14).map(([tag]) => ({
      tag: tag.match(/^<\w+/)?.[0]?.slice(1) || '',
      class: attribute(tag, 'class').slice(0, 100), id: attribute(tag, 'id').slice(0, 70),
      dataKeys: [...tag.matchAll(/\b(data-[a-z-]+)=/gi)].map((m) => m[1]).slice(0, 10),
    }));
  return {
    title, forms, anchors, anchorCount: allAnchors.length, scripts, iframes, playerTags,
    nextData: /id=["']__NEXT_DATA__["']/.test(html),
    wordpress: /wp-content|wp-json|wp-admin/i.test(html),
    episodePanels: (html.match(/\bclass\s*=\s*["'][^"']*\beps\b[^"']*["']/gi) || []).length,
    hasPlayerId: /\bdata-id\s*=\s*["']\d+["']/i.test(html),
    hasPlayerNonce: /\bdata-nonce\s*=\s*["'][^"']+["']/i.test(html),
    jsonLdTypes: [...html.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]).slice(0, 10),
    challenge: /just a moment|cf-browser-verification|captcha|challenge-running/i.test(title + html.slice(0, 1000)),
  };
}
async function boundedBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let text = '';
  try {
    while (text.length < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('utf8');
    }
  } finally { await reader.cancel().catch(() => {}); }
  return text.slice(0, MAX_BYTES);
}
async function inspect(url, target, referer, redirects = 0) {
  const allowedHost = new URL(target.base).hostname;
  const request = new URL(url, target.base);
  if (request.protocol !== 'https:' || (request.hostname !== allowedHost && !request.hostname.endsWith(`.${allowedHost}`))) {
    return { request: safeUrl(request.href, target.base), skipped: 'fuera-del-dominio' };
  }
  const result = { request: safeUrl(request.href, target.base) };
  try {
    const response = await fetch(request.href, {
      headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) },
      redirect: 'manual', signal: AbortSignal.timeout(13000),
    });
    result.status = response.status;
    result.location = safeUrl(response.headers.get('location'), request.href);
    result.contentType = response.headers.get('content-type') || '';
    if (response.status >= 300 && response.status < 400) {
      if (response.body) await response.body.cancel().catch(() => {});
      if (redirects < 2 && result.location
        && (result.location.host === allowedHost || result.location.host.endsWith(`.${allowedHost}`))) {
        const next = await inspect(new URL(response.headers.get('location'), request.href).href, target, referer, redirects + 1);
        return { ...next, request: result.request, redirectChain: [result.status, ...(next.redirectChain || [])] };
      }
      return result;
    }


    if (result.contentType && !/html|json|text|xml/i.test(result.contentType)) {
      if (response.body) await response.body.cancel().catch(() => {});
      return result;
    }
    const html = await boundedBody(response);
    result.bytesSampled = Buffer.byteLength(html);
    if (/html/i.test(result.contentType) || /<!doctype|<html/i.test(html.slice(0, 1000))) {
      result.page = htmlInfo(html, request.href);
    } else if (/json/i.test(result.contentType)) {
      try {
        const value = JSON.parse(html);
        result.json = {
          kind: Array.isArray(value) ? 'array' : typeof value,
          keys: Object.keys(value || {}).slice(0, 12),


          src: typeof value?.src === 'string' && /^\/(?!\/)/.test(value.src)
            ? safeUrl(value.src, request.href) : null,
          hasData: Boolean(value?.data),
          ...(/^\/api\/tidb\//.test(request.pathname) ? { tidbFields: Object.fromEntries(
            ['intro', 'credits'].map((key) => [key, {
              type: Array.isArray(value?.[key]) ? 'array' : typeof value?.[key],
              keys: value?.[key] && typeof value[key] === 'object' ? Object.keys(value[key]).slice(0, 10) : [],
              count: Array.isArray(value?.[key]) ? value[key].length : null,
              hasMediaPath: typeof value?.[key] === 'string'
                && /\.m3u8|\.mp4|\/playlist\//i.test(value[key]),
            }]),
          ) } : {}),
        };
      } catch (_) { result.json = { kind: 'invalid' }; }
    }
  } catch (error) { result.error = error?.name === 'TimeoutError' ? 'timeout' : error?.cause?.code || error?.name || 'network-error'; }
  return result;
}

async function main() {
  const report = [];
  for (const target of TARGETS) {
    const attempts = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const pages = [];
      for (const subpath of target.paths || PATHS) {
        pages.push(await inspect(new URL(subpath, target.base).href, target, target.base + '/'));
      }


      const allowedHost = new URL(target.base).hostname;
      const candidates = pages.flatMap((page) => page.page?.anchors || []).filter((item) =>
        (item.host === allowedHost || item.host.endsWith(`.${allowedHost}`))
        && (target.title || /fight|club|helsing/i).test(`${item.title} ${item.path}`)
        && !/\b(?:search|buscar)\b/i.test(item.path),
      );
      const detail = [];
      for (const candidate of candidates.slice(0, targetId ? 1 : 2)) {
        detail.push(await inspect(`https://${candidate.host}${candidate.path}`, target, target.base + '/'));
      }
      attempts.push({ pages, detail });
      console.log(`${target.id} intento ${attempt + 1}: ${pages.map((p) => p.status || p.error).join('/')} / ficha ${detail.map((p) => p.status || p.error).join('/')}`);
    }

    report.push(targetId ? { id: target.id, base: target.base, attempts }
      : { id: target.id, base: target.base, ...attempts[0] });
  }
  const output = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : '.tmp/site-recon.json';
  fs.mkdirSync(require('node:path').dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const encoded = zlib.gzipSync(JSON.stringify(report)).toString('base64');
    const chunks = encoded.match(/.{1,3500}/g) || [];
    console.log(`::notice file=scripts/site-recon.cjs,title=site-recon-resumen::${JSON.stringify({ targets: report.length, parts: chunks.length, encoding: 'gzip+base64' })}`);
    for (let i = 0; i < chunks.length; i += 1) {
      console.log(`::notice file=scripts/site-recon.cjs,title=site-recon-${i + 1}-de-${chunks.length}::${chunks[i]}`);
    }
  }
}
main().catch((error) => { console.error(`Recon no completado: ${error.name || 'error'}`); process.exitCode = 1; });
