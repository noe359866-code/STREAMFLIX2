#!/usr/bin/env node
'use strict';

// Diagnóstico público de warezcdn.sbs/doc. Solo estructura de JSON/HTML y
// estados HTTP; nunca se guardan iframes completos, URLs firmadas ni tokens.
const fs = require('node:fs');
const path = require('node:path');
const BASE = 'https://warezcdn.sbs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BYTES = 240000;

function safe(value, base = BASE) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    const parts = url.pathname.split('/').filter(Boolean);
    const prefix = /^(?:e|embed|player|video|stream|filme|serie|api|doc|lista|watch|source)$/i.test(parts[0])
      ? `/${parts[0]}` : '/<ruta>';
    return url.protocol === 'https:' ? { host: url.hostname,
      pathShape: parts.length > 1 ? `${prefix}/<id>` : prefix,
      queryKeys: [...url.searchParams.keys()].slice(0, 8) } : null;
  } catch (_) { return null; }
}
async function bounded(url) {
  const uri = new URL(url, BASE);
  if (uri.hostname !== 'warezcdn.sbs' || uri.protocol !== 'https:') return { error: 'fuera-del-dominio' };
  try {
    const res = await fetch(uri.href, { headers: { 'User-Agent': UA, Referer: `${BASE}/doc`,
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.7' }, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    const outcome = { status: res.status, mime: (res.headers.get('content-type') || '').split(';')[0],
      location: safe(res.headers.get('location'), url) };
    if (!/html|json|text/i.test(outcome.mime)) { await res.body?.cancel().catch(() => {}); return outcome; }
    const reader = res.body?.getReader();
    let size = 0;
    const chunks = [];
    if (reader) {
      try {
        while (size < MAX_BYTES) {
          const next = await reader.read();
          if (next.done) break;
          const data = Buffer.from(next.value).subarray(0, MAX_BYTES - size);
          chunks.push(data); size += data.length;
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    return { ...outcome, text: Buffer.concat(chunks).toString('utf8'), bytes: size, truncated: size >= MAX_BYTES };
  } catch (error) { return { status: null, error: error?.cause?.code || error?.name || 'red' }; }
}
function info(result, route) {
  const { text = '', mime, status, error, location, bytes, truncated } = result;
  const report = { route, status, error, mime, location, bytes, truncated };
  if (/json/i.test(mime || '')) {
    try {
      const payload = JSON.parse(text);
      const root = Array.isArray(payload) ? payload : typeof payload === 'object' ? payload : null;
      const first = Array.isArray(root) ? root[0] : root?.data?.[0] || root?.items?.[0] || root?.results?.[0];
      report.json = { kind: Array.isArray(root) ? 'array' : typeof root,
        keys: Object.keys(root || {}).slice(0, 20), count: Array.isArray(root) ? root.length : null,
        firstKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 22) : [],
        hasMovieId: /(?:tt0137523|tt0068646|"550")/i.test(text),
      };
    } catch (_) { report.json = { kind: 'invalid' }; }
  } else if (/html/i.test(mime || '') || /<html\b/i.test(text.slice(0, 1000))) {
    const frames = [...text.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)/gi)]
      .map((item) => safe(item[1], `${BASE}${route}`)).filter(Boolean).slice(0, 8);
    const direct = [...text.matchAll(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi)]
      .map((item) => safe(item[0], `${BASE}${route}`)).filter(Boolean).slice(0, 5);
    const scripts = [...text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)/gi)]
      .map((item) => safe(item[1], `${BASE}${route}`)).filter(Boolean).slice(0, 10);
    report.html = {
      title: (/<title\b[^>]*>([^<]*)/i.exec(text)?.[1] || '').replace(/\s+/g, ' ').slice(0, 110),
      login: /<form\b[\s\S]{0,1000}(?:password|login)|fazer\s*login|fa[cç]a\s*login/i.test(text),
      captcha: /just a moment|cf-browser-verification|captcha/i.test(text.slice(0, 1000)),
      player: /(?:<video\b|player-container|jwplayer|video-js|plyr)/i.test(text),
      episodeLinks: (text.match(/href=["'][^"']*\/serie\/(?:1396|\d+)\/\d+\/\d+/gi) || []).length,
      frames, direct, scripts,
    };
  }
  return report;
}

(async () => {
  const paths = [
    '/doc', '/lista?category=filme&type=imdb&format=json',
    '/lista?category=pesquisa&q=breaking+bad&limit=5&format=json',
    '/filme/tt0068646', '/filme/550', '/serie/1396/1/1',
  ];
  const attempts = [];
  for (let number = 1; number <= 3; number += 1) {
    const pages = [];
    for (const route of paths) pages.push(info(await bounded(`${BASE}${route}`), route.split('?')[0]));
    attempts.push({ number, pages });
    console.log(`warezcdn intento ${number}: ${pages.map((page) => page.status || page.error).join('/')}`);
  }
  const outputIndex = process.argv.indexOf('--output');
  const filename = outputIndex < 0 ? '.tmp/warezcdn-recon.json' : process.argv[outputIndex + 1];
  if (!filename) throw new Error('--output requiere ruta');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify({ site: 'warezcdn', attempts }, null, 2)}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const attempt of attempts) {
      console.log(`::notice file=scripts/warezcdn-recon.cjs,title=warezcdn-${attempt.number}::${JSON.stringify(attempt)}`);
    }
  }
})().catch((error) => { console.error(`WarezCDN: ${error.name || 'error'}`); process.exitCode = 1; });
