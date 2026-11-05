#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const targets = [
  ['hdfull-home', 'https://hdfull.company/'],
  ['hdfull-movie', 'https://hdfull.company/peliculas/weapons'],
  ['hdfull-episode', 'https://hdfull.company/series/slow-horses/temporada/2/episodio/3'],
  ['hdfull-search', 'https://hdfull.company/?s=weapons'],
  ['danimados-search', 'https://danimados.cc/?s=sangre+de+zeus'],
  ['danimados-episode', 'https://danimados.cc/episodios/sangre-de-zeus-2x3/'],
  ['danimados-movies', 'https://danimados.cc/peliculas/'],
  ['pelisgo-search', 'https://pelisgo.online/search?q=weapons'],
  ['pelisgo-movie', 'https://pelisgo.online/movies/la-hora-de-la-desaparicion'],
  ['pelisgo-series', 'https://pelisgo.online/series/caballos-lentos'],
  ['pelisgo-episode', 'https://pelisgo.online/series/caballos-lentos/temporada/3/episodio/3'],
];
const root = path.resolve(__dirname, '..', 'recon-catalog');
fs.mkdirSync(root, { recursive: true });
const headers = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.7',
};
function values(html, regex) {
  return [...new Set([...html.matchAll(regex)].map((match) => match[1]).filter(Boolean))];
}
(async () => {
  const report = [];
  for (const [name, url] of targets) {
    const item = { name, inputUrl: url };
    try {
      const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(45000) });
      const html = await response.text();
      fs.writeFileSync(path.join(root, `${name}.html`), html);
      Object.assign(item, {
        status: response.status, finalUrl: response.url, bytes: html.length,
        title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
        scripts: values(html, /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi),
        iframes: values(html, /<iframe\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["']/gi),
        hasNextData: html.includes('__NEXT_DATA__'),
        hasDooPlayer: html.includes('dooplay_player_option'),
        apiSnippets: values(html, /["']([^"']*(?:\/api\/|admin-ajax|loadPlayer|player\/|\/player)[^"']*)["']/gi).slice(0, 80),
      });
    } catch (error) { item.error = error.message; }
    report.push(item);
    console.log(JSON.stringify(item));
  }
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
