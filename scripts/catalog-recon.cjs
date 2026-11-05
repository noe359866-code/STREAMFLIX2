#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Read public documents through Jina's documented output API; do not click or solve challenges.
const targets = [
  ['hdfull-movie', 'https://hdfull.company/peliculas/weapons'],
  ['hdfull-episode', 'https://hdfull.company/series/slow-horses/temporada/2/episodio/3'],
  ['pelisgo-movie', 'https://pelisgo.online/movies/la-hora-de-la-desaparicion'],
  ['pelisgo-episode', 'https://pelisgo.online/series/caballos-lentos/temporada/3/episodio/3'],
];
const root = path.resolve(__dirname, '..', 'recon-shared');
const assetsRoot = path.join(root, 'assets');
fs.mkdirSync(assetsRoot, { recursive: true });
const headers = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.7',
};
function values(html, regex) {
  return [...new Set([...html.matchAll(regex)].map((match) => match[1]).filter(Boolean))];
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 1500));
async function reader(url, format = 'html') {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: { ...headers, 'x-return-format': format, ...(format === 'html' ? { 'x-timeout': '20' } : {}) },
    redirect: 'follow', signal: AbortSignal.timeout(90000),
  });
  return { response, text: await response.text() };
}
(async () => {
  const report = [];
  const downloaded = new Map();
  for (const [name, url] of targets) {
    const item = { name, inputUrl: url, assets: [] };
    try {
      const { response, text: html } = await reader(url);
      fs.writeFileSync(path.join(root, `${name}.html`), html);
      const scripts = values(html, /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)
        .map((src) => new URL(src.replace(/&amp;/g, '&'), url).href)
        .filter((src) => new URL(src).hostname === new URL(url).hostname).slice(0, 20);
      Object.assign(item, {
        status: response.status, finalUrl: response.url, bytes: html.length,
        title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], scripts,
        iframes: values(html, /<iframe\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["']/gi),
        hasNextData: html.includes('__NEXT_DATA__'),
        apiSnippets: values(html, /["']([^"']*(?:\/api\/|loadPlayer|player\/|\/player|\.m3u8|\/search)[^"']*)["']/gi).slice(0, 100),
      });
      for (const script of scripts) {
        const asset = { url: script };
        item.assets.push(asset);
        if (downloaded.size >= 32 && !downloaded.has(script)) { asset.skipped = 'asset cap'; continue; }
        try {
          if (!downloaded.has(script)) {
            await pause();
            const result = await reader(script, 'text');
            const filename = `${crypto.createHash('sha1').update(script).digest('hex')}.js`;
            if (result.text.length <= 3000000) fs.writeFileSync(path.join(assetsRoot, filename), result.text);
            downloaded.set(script, { filename, status: result.response.status, bytes: result.text.length, saved: result.text.length <= 3000000 });
          }
          Object.assign(asset, downloaded.get(script));
        } catch (error) { asset.error = error.message; }
      }
    } catch (error) { item.error = error.message; }
    report.push(item);
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...item, assets: item.assets?.length }));
    await pause();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
