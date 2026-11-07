#!/usr/bin/env node
'use strict';

// Revisión reproducible de la referencia carlosfdezb/cuevana3 (2022).
// Solo consulta catálogo y fichas públicas; NO interpreta un 403 HTML como
// evidencia de que un HLS/MP4 esté bloqueado, ni abre embeds o descarga medios.
const fs = require('node:fs');
const path = require('node:path');

const TARGETS = [
  {
    id: 'legacy-me', base: 'https://cuevana3.me',
    paths: ['/', '/page/1?s=Joker', '/21711/joker'],
  },
  {
    id: 'legacy-io', base: 'https://cuevana3.io',
    paths: ['/', '/page/1?s=Joker', '/21711/joker'],
  },
  {
    id: 'current-gs', base: 'https://cuevana.gs',
    paths: ['/', '/wp-api/v1/search?q=Joker&page=1&postType=any&postsPerPage=24',
      '/wp-api/v1/search?q=One%20Piece&page=1&postType=any&postsPerPage=24'],
  },
  {
    // Destino HTTPS del 301 observado en .gs (Actions 42317819695).
    id: 'redirect-pro', base: 'https://cuevanas3.pro',
    paths: ['/', '/wp-api/v1/search?q=Joker&page=1&postType=any&postsPerPage=24',
      '/wp-api/v1/search?q=One%20Piece&page=1&postType=any&postsPerPage=24'],
  },
];
const HOSTS = new Set(TARGETS.map((item) => new URL(item.base).hostname));
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.5',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
};
const MAX_BYTES = 350_000;

function inspectBody(text, contentType) {
  if (/json/i.test(contentType)) {
    try {
      const payload = JSON.parse(text);
      const posts = payload?.data?.posts ?? payload?.data?.data?.posts;
      if (!Array.isArray(posts)) return { kind: 'json', posts: null };
      return {
        kind: 'json', posts: posts.length,
        types: [...new Set(posts.map((item) => String(item?.type || '').slice(0, 30)))].slice(0, 6),
        jokerMoviesWithId: posts.filter((item) => item?._id
          && /joker/i.test(String(item?.title || item?.original_title || ''))
          && /movie|pelicula/i.test(String(item?.type || ''))).length,
      };
    } catch (_) { return { kind: 'json-invalid' }; }
  }
  if (!/html|text/i.test(contentType)) return { kind: 'non-text' };
  const ids = [...text.matchAll(/\bid\s*=\s*["']Opt([LES])\d{1,2}["']/gi)]
    .reduce((counts, match) => {
      counts[match[1].toUpperCase()] += 1;
      return counts;
    }, { L: 0, E: 0, S: 0 });
  return {
    kind: 'html',
    legacyCatalog: /\bid\s*=\s*["']aa-wp["']/i.test(text) && /\bTPost\b/.test(text),
    legacyDetail: /\bid\s*=\s*["']top-single["']/i.test(text),
    legacySeason: /\bid\s*=\s*["']season-\d+["']/i.test(text),
    options: ids,
    lazyIframes: (text.match(/<iframe\b[^>]*\bdata-src\s*=/gi) || []).length,
  };
}

async function boundedBody(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const part = value.subarray(0, MAX_BYTES - size);
      chunks.push(part);
      size += part.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function inspect(url) {
  let current = new URL(url);
  const redirects = [];
  try {
    for (let hop = 0; hop < 4; hop += 1) {
      const response = await fetch(current, {
        headers: HEADERS, redirect: 'manual', signal: AbortSignal.timeout(8_000),
      });
      const location = response.headers.get('location');
      if (location && response.status >= 300 && response.status < 400) {
        const next = new URL(location, current);
        await response.body?.cancel();
        redirects.push({ status: response.status, host: next.hostname });
        // Nunca seguir redirecciones a sitios terceros ni a HTTP sin cifrar.
        if (next.protocol !== 'https:' || !HOSTS.has(next.hostname)) {
          return { status: response.status, redirects, stopped: 'outside-known-domains' };
        }
        current = next;
        continue;
      }
      const contentType = (response.headers.get('content-type') || '').split(';')[0].slice(0, 70);
      const body = response.ok && /html|json|text/i.test(contentType)
        ? inspectBody(await boundedBody(response), contentType) : null;
      if (!body) await response.body?.cancel();
      return { status: response.status, host: current.hostname, contentType, redirects, body };
    }
    return { redirects, stopped: 'too-many-redirects' };
  } catch (error) {
    return { redirects, error: error?.cause?.code || error?.name || 'network-error' };
  }
}

async function main() {
  const report = [];
  for (const target of TARGETS) {
    const attempts = [];
    for (let index = 0; index < 3; index += 1) {
      const pages = [];
      for (const route of target.paths) pages.push({ route, ...await inspect(new URL(route, target.base)) });
      attempts.push(pages);
    }
    report.push({ id: target.id, base: target.base, attempts });
    console.log(`${target.id}: ${attempts.map((pages) => pages.map((page) => page.status || page.error || page.stopped).join('/')).join(' | ')}`);
    if (process.env.GITHUB_ACTIONS === 'true') {
      // Solo estados, dominios y conteos; ni HTML, ni embeds, ni URLs firmadas.
      console.log(`::notice file=scripts/cuevana-reference-recon.cjs,title=cuevana-reference-${target.id}::${JSON.stringify({ id: target.id, attempts })}`);
    }
  }
  const flag = process.argv.indexOf('--output');
  const output = flag >= 0 ? process.argv[flag + 1] : '.tmp/cuevana-reference-recon.json';
  if (!output) throw new Error('--output necesita una ruta');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => {
  console.error(`Diagnóstico de Cuevana no completado: ${error.name || 'error'}`);
  process.exitCode = 1;
});
module.exports = { inspectBody };
