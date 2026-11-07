#!/usr/bin/env node
'use strict';

// Diagnóstico de assets públicos de las tres SPA. Nunca guarda el código,
// datos de sesión, parámetros de consulta ni URLs firmadas: solo host/path
// genéricos y presencia de familias de API observables en JS/HTML.
const fs = require('node:fs');
const path = require('node:path');
const SITES = { cinejoy: 'https://cinejoy.pk', atlantic: 'https://atlantic.bz', cinemaarmy: 'https://cinema.army' };
const index = process.argv.indexOf('--site');
const site = process.argv[index + 1];
if (!SITES[site]) throw new Error('Usa --site cinejoy|atlantic|cinemaarmy');
const BASE = SITES[site];
const HOME = { cinejoy: '/watch/movie/550', atlantic: '/watch/movie/550', cinemaarmy: '/watch?id=550&type=movie' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BYTES = 4000000;

async function read(url, referer) {
  const uri = new URL(url, BASE);
  if (uri.protocol !== 'https:' || uri.hostname !== new URL(BASE).hostname) return { skipped: 'fuera-de-dominio' };
  try {
    const response = await fetch(uri.href, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/javascript,*/*;q=0.8', Referer: referer || `${BASE}/` },
      redirect: 'manual', signal: AbortSignal.timeout(11000),
    });
    const outcome = { status: response.status, mime: (response.headers.get('content-type') || '').split(';')[0] };
    if (!/html|javascript|text|json/i.test(outcome.mime)) {
      await response.body?.cancel().catch(() => {});
      return outcome;
    }
    let count = 0;
    const chunks = [];
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (count < MAX_BYTES) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value).subarray(0, MAX_BYTES - count);
          chunks.push(chunk);
          count += chunk.length;
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    return { ...outcome, text: Buffer.concat(chunks).toString('utf8'), bytes: count,
      truncated: count >= MAX_BYTES };
  } catch (error) { return { status: null, error: error?.cause?.code || error?.name || 'red' }; }
}

function publicPath(value) {
  try {
    const url = new URL(value, BASE);
    if (url.hostname !== new URL(BASE).hostname || url.protocol !== 'https:') return '';
    // Solo JS del propio sitio y sin parámetros. Un hash de build no es un token.
    return /^\/(?:assets|_next\/static|static|js)\/[a-z0-9/_-]+\.js$/i.test(url.pathname)
      ? url.pathname : '';
  } catch (_) { return ''; }
}
function scripts(html) {
  const matches = [...String(html || '').matchAll(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => publicPath(match[1])).filter(Boolean);
  return [...new Set(matches)].slice(0, 4);
}
function pathsIn(text) {
  const found = [...String(text || '').matchAll(/\/(?:api|source|sources|watch|embed|stream|playlist|search|movie|tv|tcloud|cookiebakers)\/[a-z0-9_/.-]{1,75}/gi)]
    .map(([pathname]) => pathname.replace(/\/[a-z0-9_-]{24,}(?=\/|$)/gi, '/<id>'))
    .filter((pathname) => !/\.(?:png|jpe?g|svg|webp|css|js|map)(?:$|\/)/i.test(pathname)
      && !/^\/api\/(?:admin|analytics|rooms)(?:\/|$)/i.test(pathname));
  return [...new Set(found)].slice(0, 65);
}
function signals(body) {
  return {
    apiPaths: pathsIn(body),
    tmdb: /(?:themoviedb\.org|api\.tmdb|tmdb)/i.test(body),
    iframe: /(?:<iframe\b|createElement\(["']iframe|\/embed\/)/i.test(body),
    m3u8: /\.m3u8|#EXTM3U/i.test(body),
    sources: /(?:getSources|fetchSources|\/source\/|\/sources\/)/i.test(body),
    authorization: /authorization|bearer|x-api-key/i.test(body),
    jsBundle: /__vite__|vitePreload|webpackJsonp|__NEXT_DATA__|react\.production/i.test(body),
  };
}

(async () => {
  const attempts = [];
  for (let number = 1; number <= 3; number += 1) {
    const home = await read(`${BASE}${HOME[site]}`);
    const assetPaths = scripts(home.text);
    const assets = [];
    for (const pathname of assetPaths.slice(0, 2)) {
      const asset = await read(`${BASE}${pathname}`, `${BASE}${HOME[site]}`);
      assets.push({ pathname, status: asset.status, error: asset.error,
        mime: asset.mime, sampledBytes: asset.bytes || 0, truncated: asset.truncated || false,
        signals: signals(asset.text),
      });
    }
    attempts.push({ number, home: { status: home.status, error: home.error, mime: home.mime,
      bytes: home.bytes || 0, titlePresent: /<title\b[^>]*>[^<]+/i.test(home.text || ''),
      rootPresent: /id=["'](?:root|app|__next)["']/i.test(home.text || ''),
      scripts: assetPaths, signals: signals(home.text) }, assets });
    console.log(`${site} intento ${number}: HTML ${home.status || home.error}; JS ${assets.map((asset) => asset.status || asset.error).join('/') || 'sin JS propio'}`);
  }
  const outputIndex = process.argv.indexOf('--output');
  const filename = outputIndex < 0 ? `.tmp/${site}-assets.json` : process.argv[outputIndex + 1];
  if (!filename) throw new Error('--output requiere ruta');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify({ site, attempts }, null, 2)}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const attempt of attempts) {
      console.log(`::notice file=scripts/spa-assets-recon.cjs,title=${site}-assets-${attempt.number}::${JSON.stringify(attempt)}`);
    }
  }
})().catch((error) => { console.error(`Assets: ${error.name || 'error'}`); process.exitCode = 1; });
