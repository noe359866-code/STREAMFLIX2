#!/usr/bin/env node
'use strict';
// Temporary diagnostics only. Never click advertisements or solve interactive challenges.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..', 'recon-player-browser');
fs.mkdirSync(root, { recursive: true });
const targets = [
  { name: 'hdfull-movie', url: 'https://hdfull.company/peliculas/weapons', button: /^ver ahora$/i },
  { name: 'hdfull-episode', url: 'https://hdfull.company/series/slow-horses/temporada/2/episodio/3', button: /^ver ahora$/i },
  { name: 'pelisgo-movie', url: 'https://pelisgo.online/movies/la-hora-de-la-desaparicion', button: /^ver pel[ií]cula$/i },
  { name: 'pelisgo-episode', url: 'https://pelisgo.online/series/caballos-lentos/temporada/3/episodio/3', button: /^ver (?:episodio|cap[ií]tulo)$/i },
];
function safe(value) { return value.replace(/[^a-z0-9.-]+/gi, '-').replace(/-+/g, '-').slice(0, 130); }
async function details(page) {
  return page.evaluate(() => {
    const text = (value) => (value || '').replace(/\s+/g, ' ').trim();
    return {
      bodyText: text(document.body?.innerText).slice(0, 12000),
      buttons: [...document.querySelectorAll('button, [role=button]')].map((x) => ({ text: text(x.innerText), html: x.outerHTML.slice(0, 5000) })).slice(0, 100),
      inputs: [...document.querySelectorAll('input, form')].map((x) => x.outerHTML.slice(0, 3000)).slice(0, 80),
      iframes: [...document.querySelectorAll('iframe')].map((x) => ({ src: x.src, dataSrc: x.getAttribute('data-src'), html: x.outerHTML.slice(0, 4000) })),
      playerHtml: [...document.querySelectorAll('[id*=player i], [class*=player i], [data-post], [data-src], [data-embed]')].map((x) => x.outerHTML.slice(0, 12000)).slice(0, 100),
      scripts: [...document.scripts].map((x) => ({ src: x.src, inline: /api|player|embed|search|ajax|source|video/i.test(x.textContent) ? x.textContent.slice(0, 30000) : '' })).filter((x) => x.src || x.inline).slice(0, 100),
    };
  });
}
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    locale: 'es-ES', viewport: { width: 1365, height: 900 }, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const report = [];
  try {
    for (const target of targets) {
      const page = await context.newPage();
      const item = { ...target, network: [], errors: [] };
      report.push(item);
      const pending = new Set();
      let networkId = 0;
      page.on('pageerror', (error) => item.errors.push(error.message));
      page.on('response', (response) => {
        const request = response.request();
        const type = request.resourceType();
        if (!['xhr', 'fetch', 'document'].includes(type)) return;
        const entry = { url: response.url(), status: response.status(), type, contentType: response.headers()['content-type'] };
        item.network.push(entry);
        if (pending.size > 40 || !/json|text|javascript|html/i.test(entry.contentType || '')) return;
        const task = (async () => {
          try {
            const body = await response.text();
            if (body.length > 2000000) return;
            const filename = `${target.name}-network-${String(++networkId).padStart(2, '0')}-${safe(new URL(response.url()).hostname)}.txt`;
            fs.writeFileSync(path.join(root, filename), body);
            entry.file = `recon-player-browser/${filename}`;
            entry.bytes = body.length;
          } catch (_) { /* response may already be gone */ }
        })();
        pending.add(task);
        task.finally(() => pending.delete(task));
      });
      try {
        const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        item.status = response?.status();
        await page.waitForTimeout(12000);
        if (/just a moment|un momento/i.test(await page.title())) await page.waitForTimeout(25000);
        item.finalUrl = page.url();
        item.title = await page.title();
        item.before = await details(page);
        fs.writeFileSync(path.join(root, `${target.name}-before.html`), await page.content());
        const buttons = page.locator('button:visible').filter({ hasText: target.button });
        const count = await buttons.count();
        item.matchingButtons = count;
        if (count) {
          await buttons.last().click({ timeout: 10000 });
          item.clicked = true;
          await page.waitForTimeout(15000);
        } else {
          const links = page.locator('a:visible').filter({ hasText: target.button });
          if (await links.count()) {
            await links.last().click({ timeout: 10000 });
            item.clickedLink = true;
            await page.waitForTimeout(12000);
          }
        }
        item.after = await details(page);
        item.frames = page.frames().map((frame) => frame.url());
        fs.writeFileSync(path.join(root, `${target.name}-after.html`), await page.content());
        await Promise.allSettled([...pending]);
      } catch (error) { item.error = error.message; }
      finally {
        fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ name: target.name, status: item.status, title: item.title, error: item.error, clicked: item.clicked, clickedLink: item.clickedLink, matchingButtons: item.matchingButtons, frames: item.frames, network: item.network }));
        await page.close();
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
