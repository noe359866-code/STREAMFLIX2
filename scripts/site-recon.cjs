#!/usr/bin/env node
'use strict';

// Temporary read-only diagnostics. Responses are stored as text and never evaluated.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'recon');
fs.mkdirSync(root, { recursive: true });
const report = [];
const seen = new Set();
let sequence = 0;

function safeName(url) {
  const parsed = new URL(url);
  return `${String(++sequence).padStart(2, '0')}-${parsed.hostname}-${parsed.pathname}`
    .replace(/[^a-z0-9.-]+/gi, '-').replace(/-+/g, '-').slice(0, 150);
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return result;
}

function strip(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

async function inspect(inputUrl, options = {}) {
  if (seen.has(inputUrl) || report.length >= 30) return null;
  seen.add(inputUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  const started = Date.now();
  try {
    const response = await fetch(inputUrl, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'es-ES,es;q=0.9,en;q=0.5',
        ...(options.referer ? { referer: options.referer } : {}),
      },
    });
    const html = await response.text();
    const name = safeName(response.url || inputUrl);
    fs.writeFileSync(path.join(root, `${name}.txt`), html);
    const tags = [...html.matchAll(/<(?:li|div|iframe|button|a|source)\b[^>]*>/gi)]
      .map((match) => match[0])
      .filter((tag) => /data-|iframe|dooplay|player|server|option|embed|video|source/i.test(tag))
      .slice(0, 350);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => ({
      attributes: match[1].trim(),
      inline: /ajax|player|dooplay|iframe|embed|video|source|byse|w1tv|swish|link|post/i.test(match[2])
        ? match[2].slice(0, 18000) : '',
    })).filter((script) => script.attributes || script.inline).slice(0, 100);
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
      ...attributes(match[1]), text: strip(match[2]).slice(0, 250),
    })).filter((link) => link.href && /pelicula|serie|episod|capitul|temporada|player|embed|ver-|online/i.test(`${link.href} ${link.text}`)).slice(0, 250);
    const keywordSnippets = [];
    const keywords = /dooplay_player_option|playeroptions|admin-ajax|doo_player|ajaxurl|byse|w1tv|swish|data-post|data-nume|embed_url|<iframe|sources\s*:|file\s*:/gi;
    for (const match of html.matchAll(keywords)) {
      keywordSnippets.push(html.slice(Math.max(0, match.index - 600), Math.min(html.length, match.index + 1800)));
      if (keywordSnippets.length >= 80) break;
    }
    const item = {
      inputUrl, finalUrl: response.url, status: response.status,
      contentType: response.headers.get('content-type'), bytes: Buffer.byteLength(html), elapsedMs: Date.now() - started,
      title: strip(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
      file: `recon/${name}.txt`, links, tags, scripts, keywordSnippets,
      text: options.includeText ? strip(html).slice(0, 12000) : undefined,
    };
    report.push(item);
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(response.status, html.length, response.url);
    return { item, html, response };
  } catch (error) {
    report.push({ inputUrl, error: error.message, elapsedMs: Date.now() - started });
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.error(inputUrl, error.message);
    return null;
  } finally { clearTimeout(timer); }
}

async function main() {
  const targets = [
    ['https://verpeliculasonline.org/', true],
    ['https://verpeliculasonline.net/?s=Van+Helsing', true],
    ['https://verpeliculasonline.net/pelicula/van-helsing/', false],
    ['https://verpeliculasonline.net/?s=Breaking+Bad', true],
    ['https://www2.pelisforte.se/', true],
    ['https://www2.pelisforte.se/?s=Hotel+Transylvania+4', true],
    ['https://www2.pelisforte.se/pelicula/hotel-transylvania-4-2022-1711083273', false],
    ['https://www2.pelisforte.se/?s=Breaking+Bad', true],
  ];
  const pages = [];
  for (const [url, includeText] of targets) {
    const result = await inspect(url, { includeText });
    if (result) pages.push(result);
  }

  // Follow only real result links found in the downloaded search/detail HTML.
  const discovered = [];
  for (const page of pages) {
    if (!page.item.inputUrl.includes('?s=')) continue;
    for (const link of page.item.links) {
      if (!link.href || discovered.includes(link.href)) continue;
      try {
        const parsed = new URL(link.href, page.item.finalUrl);
        if (!/verpeliculasonline\.net$|pelisforte\.se$/.test(parsed.hostname)) continue;
        if (!/\/(pelicula|serie|series|episodio|capitulo)\//i.test(parsed.pathname)) continue;
        discovered.push(parsed.href);
      } catch {}
      if (discovered.length >= 8) break;
    }
  }
  for (const url of discovered) await inspect(url, { includeText: true });

  // If the actual page exposes DooPlay options, query only those declared post/nume/type values.
  for (const page of [...report]) {
    if (!page.file || page.error || !page.tags) continue;
    const options = [];
    for (const tag of page.tags) {
      if (!/dooplay_player_option|player-option/i.test(tag)) continue;
      const attrs = attributes(tag);
      if (attrs['data-post'] && attrs['data-nume']) {
        options.push({ post: attrs['data-post'], nume: attrs['data-nume'], type: attrs['data-type'] || 'movie', tag });
      }
    }
    for (const option of options.slice(0, 8)) {
      const origin = new URL(page.finalUrl).origin;
      const ajax = `${origin}/wp-admin/admin-ajax.php`;
      const body = new URLSearchParams({
        action: 'doo_player_ajax', post: option.post, nume: option.nume, type: option.type,
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(ajax, {
          method: 'POST', body, signal: controller.signal,
          headers: { referer: page.finalUrl, 'x-requested-with': 'XMLHttpRequest', 'user-agent': 'Mozilla/5.0', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        });
        const text = await response.text();
        const name = safeName(`${ajax}-${option.post}-${option.nume}-${option.type}`);
        fs.writeFileSync(path.join(root, `${name}.txt`), text);
        report.push({ inputUrl: ajax, method: 'POST', referer: page.finalUrl, option, status: response.status, bytes: text.length, file: `recon/${name}.txt`, response: text.slice(0, 30000) });
        console.log('AJAX', response.status, option.post, option.nume, option.type, text.slice(0, 300));
      } catch (error) {
        report.push({ inputUrl: ajax, method: 'POST', option, error: error.message });
      } finally { clearTimeout(timer); }
      fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
