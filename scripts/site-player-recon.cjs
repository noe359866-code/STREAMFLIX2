#!/usr/bin/env node
'use strict';

// Diagnóstico acotado de fichas/opciones públicas: no guarda HTML, tokens ni
// URLs firmadas. Solo se ejecuta manualmente en Actions con [site-player].
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
};
const ALLOWED = new Set(['repelis24.de', 'ver.gnula.one', 'nupload.me', 'nupload.my', 'waaw.tv', 'waaw.to']);
const MAX = 260000;

function clean(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|#39);/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 130);
}
function attr(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(String(tag || ''));
  return (match?.[1] || match?.[2] || '').replace(/&amp;/g, '&');
}
function safeUrl(value, base) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return { host: url.hostname, path: url.pathname.replace(/\/[a-z0-9_-]{30,}/gi, '/<id>').slice(0, 140), queryKeys: [...url.searchParams.keys()].slice(0, 5) };
  } catch (_) { return null; }
}
async function readBounded(response) {
  let body = '';
  const reader = response.body?.getReader();
  if (!reader) return body;
  try {
    while (body.length < MAX) {
      const { value, done } = await reader.read();
      if (done) break;
      body += Buffer.from(value).toString('utf8');
    }
  } finally { await reader.cancel().catch(() => {}); }
  return body.slice(0, MAX);
}
async function get(url, referer, post, depth = 0) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !ALLOWED.has(target.hostname)) return { status: null, error: 'fuera-de-dominio', html: '' };
  try {
    const response = await fetch(url, {
      method: post ? 'POST' : 'GET',
      body: post ? new URLSearchParams(post) : undefined,
      headers: {
        ...HEADERS, ...(referer ? { Referer: referer } : {}),
        ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } : {}),
      },
      redirect: 'manual', signal: AbortSignal.timeout(16000),
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location && depth < 2) {
      if (response.body) await response.body.cancel().catch(() => {});
      const target = new URL(location, url);
      if (target.protocol === 'https:' && ALLOWED.has(target.hostname)) {
        const next = await get(target.href, referer, post, depth + 1);
        return { ...next, requested: safeUrl(url), redirectChain: [response.status, ...(next.redirectChain || [])],
          redirectLocations: [safeUrl(target.href), ...(next.redirectLocations || [])],
          redirectSame: [target.href === url, ...(next.redirectSame || [])],
          redirectParam: [target.searchParams.get('trembed') === new URL(url).searchParams.get('trembed'), ...(next.redirectParam || [])] };
      }
      return { status: response.status, contentType: response.headers.get('content-type') || '', html: '', url, location: safeUrl(location, url) };
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text|json|javascript|xml/i.test(contentType)) {
      if (response.body) await response.body.cancel().catch(() => {});
      return { status: response.status, contentType, html: '', url, location: safeUrl(location, url) };
    }
    return { status: response.status, contentType, html: await readBounded(response), url,
      location: safeUrl(location, url) };
  } catch (error) { return { status: null, error: error?.name || 'red', html: '', url }; }
}
function anchors(html, base, pattern) {
  return [...html.matchAll(/<a\b([^>]*\bhref\s*=\s*["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi)]
    .map(([, start, inner]) => ({ href: attr(start, 'href'), label: clean(inner) || attr(start, 'title') }))
    .filter((item) => item.href && pattern.test(item.href))
    .map((item) => ({ ...item, safe: safeUrl(item.href, base) }));
}
function iframeInfo(html, base) {
  return [...html.matchAll(/<iframe\b[^>]*>/gi)].map(([tag]) =>
    safeUrl(attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-embed'), base),
  ).filter(Boolean).slice(0, 10);
}
function nuploadCodeInfo(html) {
  const loop = /\b([a-z_$][\w$]*)\.forEach\(function\s+[a-z_$][\w$]*\(value\)\s*\{\s*([a-z_$][\w$]*)\s*\+=\s*String\.fromCharCode\(parseInt\(atob\(value\)\.replace\(\/\\D\/g\s*,\s*["']["']\)\)\s*-\s*(\d+)\)/i.exec(html);
  if (!loop) return { loopFound: false };
  const [, arrayName, outputName, offset] = loop;
  const escapedArray = arrayName.replace(/[$]/g, '\\$&');
  const declaration = new RegExp(`\\b${escapedArray}\\s*=\\s*(\\[[\\s\\S]{1,140000}?\\])`, 'i').exec(html);
  const arrayText = declaration?.[1] || '';
  const entries = [...arrayText.matchAll(/["']([a-zA-Z0-9+/=_-]{8,100})["']/g)].map((match) => match[1]);
  const decoded = entries.map((entry) => {
    const digits = Buffer.from(entry, 'base64').toString('utf8').replace(/\D/g, '');
    const code = Number(digits) - Number(offset);
    return Number.isInteger(code) && code >= 0 && code <= 255 ? String.fromCharCode(code) : '';
  }).join('');
  const file = /\bfile\s*:\s*([a-z_$][\w$]*)\s*\+\s*(["'])([^"']*)\2\s*\+\s*([a-z_$][\w$]*)\s*\+\s*(["'])([^"']*)\5/i.exec(html);
  const tokenName = file?.[4] || '';
  const token = tokenName && new RegExp(`\\b${tokenName}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(html)?.[2] || '';
  const full = file?.[1] === outputName && token && decoded ? decoded + file[3] + token + file[6] : '';
  return { loopFound: true, arrayFound: Boolean(arrayText), arrayChars: arrayText.length, entries: entries.length,
    firstLengths: entries.slice(0, 4).map((entry) => entry.length), decodedLength: decoded.length,
    decodedUrl: safeUrl(decoded), fileExpressionFound: Boolean(file), tokenLength: token.length,
    result: safeUrl(full), isHls: /\.m3u8(?:[?#]|$)/i.test(full), isMp4: /\.mp4(?:[?#]|$)/i.test(full),
    candidateUrl: full };
}
async function mediaProbe(url, referer) {
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !/^sv\d+\.ibra\.lat$/.test(target.hostname)) return { error: 'fuera-de-host-observado' };
    const response = await fetch(url, { headers: { ...HEADERS, Accept: '*/*', Range: 'bytes=0-4095', Referer: referer },
      redirect: 'manual', signal: AbortSignal.timeout(12000) });
    const reader = response.body?.getReader();
    let prefix = Buffer.alloc(0);
    if (reader && response.status >= 200 && response.status < 300) {
      try { prefix = Buffer.from((await reader.read()).value || []).subarray(0, 64); }
      finally { await reader.cancel().catch(() => {}); }
    } else if (reader) await reader.cancel().catch(() => {});
    return { status: response.status, contentType: response.headers.get('content-type') || '',
      contentRange: Boolean(response.headers.get('content-range')),
      contentLength: Number(response.headers.get('content-length') || 0),
      location: safeUrl(response.headers.get('location'), url),
      magic: prefix.toString('utf8').startsWith('#EXTM3U') ? 'hls'
        : prefix.subarray(4, 8).toString('ascii') === 'ftyp' ? 'mp4'
          : /^\s*<(!doctype|html)/i.test(prefix.toString('utf8')) ? 'html' : 'otro',
      prefixBytes: prefix.length };
  } catch (error) { return { status: null, error: error?.name || 'red' }; }
}
function mediaHints(html) {
  return {
    hls: [...html.matchAll(/\.m3u8(?:[?"'\s]|$)/gi)].length,
    mp4: [...html.matchAll(/\.mp4(?:[?"'\s]|$)/gi)].length,
    embeds: [...html.matchAll(/<(?:iframe|video)\b/gi)].length,
    hasDataLink: /dataLink/.test(html),
  };
}
function dooplayOptions(html) {
  return [...html.matchAll(/<li\b[^>]*class\s*=\s*["'][^"']*dooplay_player_option[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)]
    .slice(0, 6).map(([raw]) => {
      const tag = raw.slice(0, raw.indexOf('>') + 1);
      return {
        post: attr(tag, 'data-post'), type: attr(tag, 'data-type'), nume: attr(tag, 'data-nume'),
        title: clean(/<span\b[^>]*class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(raw)?.[1]),
        server: clean(/<span\b[^>]*class\s*=\s*["'][^"']*server[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(raw)?.[1]),
      };
    });
}
function responseInfo(text, base) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { /* puede ser HTML */ }
  const raw = parsed?.embed_url || parsed?.url || parsed?.player || '';
  const iframe = /<iframe\b[^>]*>/i.exec(String(raw))?.[0];
  const url = iframe ? attr(iframe, 'src') : raw;
  return {
    jsonKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 12) : [],
    embed: typeof url === 'string' ? safeUrl(url, base) : null,
    iframes: iframeInfo(text, base),
    media: mediaHints(text),
    errorPage: /just a moment|captcha|forbidden/i.test(text.slice(0, 300)),
  };
}
async function repelis() {
  const base = 'https://repelis24.de';
  const urls = [
    `${base}/pelicula/money-fight/`,
    `${base}/pelicula/bram-stokers-van-helsing/`,
    `${base}/serie/van-helsing/`,
  ];
  const results = [];
  for (const url of urls) {
    const page = await get(url, `${base}/`);
    const summary = { page: safeUrl(url, base), status: page.status, error: page.error,
      title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.html)?.[1]),
      playMethod: /["']play_method["']\s*:\s*["']([^"']+)/i.exec(page.html)?.[1] || '',
      iframes: iframeInfo(page.html, url), media: mediaHints(page.html),
      episodeLinks: anchors(page.html, url, /episodios?|temporada|season|capitulo/i).slice(0, 20).map((a) => ({ label: a.label, url: a.safe })),
      seasonTags: [...page.html.matchAll(/<(?:div|section|ul|li)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:seasons?|episodios?|temporada)[^"']*["'][^>]*>/gi)]
        .slice(0, 14).map(([tag]) => ({ tag: tag.match(/^<\w+/)?.[0]?.slice(1), class: attr(tag, 'class'), id: attr(tag, 'id'),
          dataKeys: [...tag.matchAll(/\b(data-[a-z-]+)=/gi)].map((m) => m[1]).slice(0, 10) })),
      options: dooplayOptions(page.html).map(({ post, ...option }) => ({ ...option, postIsNumber: /^\d+$/.test(post) })),
      players: [],
    };
    if (url.includes('/serie/')) {
      const region = /<ul\b[^>]*class\s*=\s*["'][^"']*episodios[^"']*["'][^>]*>[\s\S]{0,12000}/i.exec(page.html)?.[0] || '';
      summary.seriesRegion = {
        hasEpisodesMarkup: Boolean(region), startText: clean(region),
        links: anchors(region, url, /./).slice(0, 18).map((a) => ({ label: a.label, url: a.safe })),
        liTags: [...region.matchAll(/<li\b[^>]*>/gi)].slice(0, 12).map(([tag]) => ({ class: attr(tag, 'class'),
          dataKeys: [...tag.matchAll(/\b(data-[a-z-]+)=/gi)].map((m) => m[1]).slice(0, 10),
        })),
      };
    }
    const firstEpisode = anchors(page.html, url, /episodios?|temporada|season|capitulo/i)
      .find((a) => /1[x×-]0?1|temporada[=/]1.*episodio[=/]1|episode[=/]1/i.test(a.href + ' ' + a.label));
    if (url.includes('/serie/') && firstEpisode) {
      const episodeUrl = new URL(firstEpisode.href, url).href;
      const episodePage = await get(episodeUrl, url);
      summary.episode = { url: safeUrl(episodeUrl, base), status: episodePage.status,
        options: dooplayOptions(episodePage.html).map(({ post, ...option }) => ({ ...option, postIsNumber: /^\d+$/.test(post) })),
        media: mediaHints(episodePage.html),
      };
    }
    const options = dooplayOptions(page.html).slice(0, 3);
    for (const option of options) {
      if (!/^\d+$/.test(option.post) || !/^\d+$/.test(option.nume)) continue;
      const type = option.type || 'movie';
      const endpoint = summary.playMethod === 'wp_json'
        ? `${base}/wp-json/dooplayer/v2/${option.post}/${encodeURIComponent(type)}/${option.nume}`
        : `${base}/wp-admin/admin-ajax.php`;
      const reply = await get(endpoint, url, summary.playMethod === 'wp_json'
        ? undefined : { action: 'doo_player_ajax', post: option.post, type, nume: option.nume });
      const item = { type, nume: option.nume, lang: option.title, server: option.server,
        endpoint: safeUrl(endpoint, base), status: reply.status, error: reply.error,
        response: responseInfo(reply.html, endpoint),
      };
      let playerData;
      try { playerData = JSON.parse(reply.html); } catch (_) { /* sin JSON */ }
      let wrappedTarget;
      try {
        const wrapper = new URL(playerData?.embed_url);
        wrappedTarget = wrapper.searchParams.get('url');
        item.wrapperTarget = safeUrl(wrappedTarget);
      } catch (_) { /* no es URL o no lleva destino anidado */ }
      if (summary.players.length === 1 && /^https:\/\/waaw\.tv\//i.test(wrappedTarget || '')) {
        const target = await get(wrappedTarget, url);
        item.hoster = { status: target.status, error: target.error, contentType: target.contentType,
          redirectChain: target.redirectChain, redirectLocations: target.redirectLocations, location: target.location,
          title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(target.html)?.[1]),
          iframes: iframeInfo(target.html, target.url || wrappedTarget), media: mediaHints(target.html),
          scripts: [...target.html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
            .slice(0, 12).map((m) => safeUrl(m[1], target.url || wrappedTarget)),
        };
      }
      if (summary.players.length === 0 && item.response.embed?.host === 'nupload.me') {
        let data;
        try { data = JSON.parse(reply.html); } catch (_) { /* sin JSON, no hay embed */ }
        const embedded = String(data?.embed_url || '').match(/<iframe\b[^>]*src\s*=\s*["']([^"']+)/i)?.[1] || data?.embed_url;
        if (typeof embedded === 'string' && /^https:\/\/nupload\.me\//i.test(embedded)) {
          const hoster = await get(embedded, url);
          const { candidateUrl, ...numericPlayer } = nuploadCodeInfo(hoster.html);
          item.hoster = { status: hoster.status, error: hoster.error, redirectChain: hoster.redirectChain,
            redirectLocations: hoster.redirectLocations, location: hoster.location, contentType: hoster.contentType,
            title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(hoster.html)?.[1]),
            iframes: iframeInfo(hoster.html, hoster.url || embedded), media: mediaHints(hoster.html),
            numericPlayer,
            scripts: [...hoster.html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
              .slice(0, 12).map((m) => safeUrl(m[1], hoster.url || embedded)),
            signals: ['jwplayer', 'hls', 'base64', 'atob(', 'plyr', 'playerjs', 'fetch(', 'eval(', 'iframe', 'source:']
              .filter((marker) => hoster.html.toLowerCase().includes(marker)),
            base64Literals: [...hoster.html.matchAll(/atob\(\s*["']([a-zA-Z0-9+/=_-]{12,5000})["']\s*\)/gi)]
              .slice(0, 8).map((m) => {
                const decoded = Buffer.from(m[1], 'base64').toString('utf8');
                return { length: m[1].length, decodedMedia: safeUrl(decoded),
                  hls: (decoded.match(/\.m3u8/gi) || []).length, mp4: (decoded.match(/\.mp4/gi) || []).length,
                  scriptKeys: ['file', 'source', 'sources', 'playlist', 'jwplayer', 'fetch', 'iframe']
                    .filter((key) => decoded.toLowerCase().includes(key)),
                };
              }),
            atobShapes: [...hoster.html.matchAll(/.{0,45}atob\(.{0,60}/gi)].slice(0, 4).map(([snippet]) => snippet
              .replace(/https?:\/\/[^\s"']+/gi, '<url>')
              .replace(/(["'`])[^"'`]{0,250}\1/g, '<string>')
              .replace(/[a-z0-9_-]{20,}/gi, '<token>').slice(0, 130)),
            jwShapes: [...hoster.html.matchAll(/.{0,45}jwplayer\(.{0,100}/gi)].slice(0, 4).map(([snippet]) => snippet
              .replace(/https?:\/\/[^\s"']+/gi, '<url>')
              .replace(/(["'`])[^"'`]{0,250}\1/g, '<string>')
              .replace(/[a-z0-9_-]{20,}/gi, '<token>').slice(0, 150)),
            numericDecoderShape: (() => {
              const index = hoster.html.indexOf('atob(value)');
              if (index < 0) return null;
              return hoster.html.slice(Math.max(0, index - 1200), index + 210)
                .replace(/https?:\/\/[^\s"']+/gi, '<url>')
                .replace(/(["'`])(?:\\.|(?!\1)[^\\])*?\1/g, (literal) => `<string:${literal.length - 2}>`)
                .replace(/[a-z0-9_-]{20,}/gi, '<token>').slice(-1000);
            })(),
            setupShape: (() => {
              const index = hoster.html.indexOf('player.setup({');
              if (index < 0) return null;
              return hoster.html.slice(index, index + 500)
                .replace(/https?:\/\/[^\s"']+/gi, '<url>')
                .replace(/(["'`])(?:\\.|(?!\1)[^\\])*?\1/g, (literal) => `<string:${literal.length - 2}>`)
                .replace(/[a-z0-9_-]{20,}/gi, '<token>');
            })(),
          };
          if (candidateUrl) item.hoster.mediaProbe = await mediaProbe(candidateUrl, hoster.url);
        }
      }
      summary.players.push(item);
    }
    results.push(summary);
  }
  return results;
}
async function gnula() {
  const base = 'https://ver.gnula.one';
  const urls = [`${base}/movies/money-fight/`, `${base}/movies/street-fighter/`, `${base}/search/Breaking%20Bad`, `${base}/series/`];
  const results = [];
  for (const url of urls) {
    const page = await get(url, base + '/');
    const links = anchors(page.html, url, /trembed=/i);
    const summary = {
      page: safeUrl(url, base), status: page.status, error: page.error,
      title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.html)?.[1]),
      iframes: iframeInfo(page.html, url), media: mediaHints(page.html),
      movieLinks: anchors(page.html, url, /\/(?:movies|series|tvshows|episodios?)\//i)
        .map((a) => ({ label: a.label, url: a.safe })).filter((a) => /breaking|van helsing|fight|s01|01/i.test(a.label + a.url?.path)).slice(0, 15),
      trembedCount: links.length,
      trembed: links.slice(0, 6).map((a) => ({ label: a.label, url: a.safe })),
      frames: [],
    };
    for (const link of links.slice(0, 3)) {
      const frameUrl = new URL(link.href, url);
      if (frameUrl.hostname !== 'ver.gnula.one' || !frameUrl.searchParams.has('trembed')) continue;
      const frame = await get(frameUrl.href, url);
      const param = frameUrl.searchParams.get('trembed') || '';
      let decoded;
      try { decoded = Buffer.from(param, 'base64').toString('utf8'); } catch (_) { /* no base64 */ }
      const external = /^https?:\/\//i.test(param) ? param : /^https?:\/\//i.test(decoded || '') ? decoded : null;
      summary.frames.push({ status: frame.status, error: frame.error, contentType: frame.contentType,
        url: safeUrl(frameUrl.href, base), paramLength: param.length,
        paramKind: /^\d+$/.test(param) ? 'numeric' : external ? 'external-url' : 'other',
        paramTarget: safeUrl(external), redirectChain: frame.redirectChain, redirectLocations: frame.redirectLocations,
        redirectSame: frame.redirectSame, redirectParam: frame.redirectParam,
        location: frame.location, finalUrl: safeUrl(frame.url || frameUrl.href),
        title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(frame.html)?.[1]),
        iframes: iframeInfo(frame.html, frame.url || frameUrl.href),
        media: mediaHints(frame.html), response: responseInfo(frame.html, frame.url || frameUrl.href),
      });
    }
    results.push(summary);
  }
  return results;
}
async function main() {
  const output = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : '.tmp/site-player.json';
  const report = { repelis24: await repelis(), gnulaone: await gnula() };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const chunks = zlib.gzipSync(JSON.stringify(report)).toString('base64').match(/.{1,3500}/g) || [];
    console.log(`::notice file=scripts/site-player-recon.cjs,title=site-player-resumen::${JSON.stringify({ parts: chunks.length, encoding: 'gzip+base64' })}`);
    for (let i = 0; i < chunks.length; i += 1) {
      console.log(`::notice file=scripts/site-player-recon.cjs,title=site-player-${i + 1}-de-${chunks.length}::${chunks[i]}`);
    }
  }
  console.log('Contratos públicos inspeccionados:', report.repelis24.map((r) => r.status).join('/'), report.gnulaone.map((r) => r.status).join('/'));
}
main().catch((error) => { console.error(`Recon no completado: ${error.name || 'error'}`); process.exitCode = 1; });
