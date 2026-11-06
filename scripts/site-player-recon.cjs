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
const ALLOWED = new Set(['repelis24.de', 'ver.gnula.one']);
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
async function get(url, referer, post) {
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
    return { status: response.status, contentType: response.headers.get('content-type') || '', html: await readBounded(response), url };
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
      options: dooplayOptions(page.html).map(({ post, ...option }) => ({ ...option, postIsNumber: /^\d+$/.test(post) })),
      players: [],
    };
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
      summary.players.push({ type, nume: option.nume, lang: option.title, server: option.server,
        endpoint: safeUrl(endpoint, base), status: reply.status, error: reply.error,
        response: responseInfo(reply.html, endpoint),
      });
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
      summary.frames.push({ status: frame.status, error: frame.error, contentType: frame.contentType,
        url: safeUrl(frameUrl.href, base), iframes: iframeInfo(frame.html, frameUrl.href),
        media: mediaHints(frame.html), response: responseInfo(frame.html, frameUrl.href),
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
