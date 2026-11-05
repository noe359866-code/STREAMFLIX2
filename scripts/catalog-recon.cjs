#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const targets = [
  ['cuevana-movie', 'https://cuevana3c.cam/peliculas/weapons'],
  ['cuevana-episode', 'https://cuevana3c.cam/series/slow-horses/temporada/2/episodio/3'],
  ['repelis-movie', 'https://repelisplus.asia/peliculas/weapons'],
  ['repelis-episode', 'https://repelisplus.asia/series/slow-horses/temporada/2/episodio/3'],
];
const root = path.resolve(__dirname, '..', 'recon-shared');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });
const headers = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.7',
};
function values(html, regex) {
  return [...new Set([...html.matchAll(regex)].map((match) => match[1]).filter(Boolean))];
}
async function get(url) {
  const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  return { response, text: await response.text() };
}
(async () => {
  const report = [];
  const downloaded = new Map();
  for (const [name, url] of targets) {
    const item = { name, inputUrl: url, assets: [] };
    try {
      const { response, text: html } = await get(url);
      fs.writeFileSync(path.join(root, `${name}.html`), html);
      const scripts = values(html, /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)
        .map((src) => new URL(src, response.url).href)
        .filter((src) => new URL(src).hostname === new URL(response.url).hostname).slice(0, 30);
      Object.assign(item, {
        status: response.status, finalUrl: response.url, bytes: html.length,
        title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], scripts,
        iframes: values(html, /<iframe\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["']/gi),
        hasNextData: html.includes('__NEXT_DATA__'),
        apiSnippets: values(html, /["']([^"']*(?:\/api\/|loadPlayer|player\/|\/player|\.m3u8)[^"']*)["']/gi).slice(0, 100),
      });
      for (const script of scripts) {
        const asset = { url: script };
        item.assets.push(asset);
        try {
          if (!downloaded.has(script)) {
            const result = await get(script);
            const filename = `${crypto.createHash('sha1').update(script).digest('hex')}.js`;
            fs.writeFileSync(path.join(assets, filename), result.text);
            downloaded.set(script, { filename, status: result.response.status, bytes: result.text.length });
          }
          Object.assign(asset, downloaded.get(script));
        } catch (error) { asset.error = error.message; }
      }
    } catch (error) { item.error = error.message; }
    report.push(item);
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...item, assets: item.assets?.length }));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
