#!/usr/bin/env node
'use strict';

// Temporary diagnostics: use a real browser, never click ads or solve interactive challenges.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', 'recon-browser');
fs.mkdirSync(root, { recursive: true });
const report = [];
let sequence = 0;

function filename(url) {
  const parsed = new URL(url);
  return `${String(++sequence).padStart(2, '0')}-${parsed.hostname}-${parsed.pathname}`
    .replace(/[^a-z0-9.-]+/gi, '-').replace(/-+/g, '-').slice(0, 150);
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'es-ES', viewport: { width: 1365, height: 900 }, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  try {
    const targets = [
      'https://verpeliculasonline.net/pelicula/van-helsing',
      'https://www2.pelisforte.se/pelicula/hotel-transylvania-4-2022-1711083273',
      'https://verpeliculasonline.net/?s=Breaking+Bad',
      'https://www2.pelisforte.se/?s=Breaking+Bad',
    ];
    for (const url of targets) {
      const page = await context.newPage();
      const item = { inputUrl: url, console: [], errors: [] };
      report.push(item);
      page.on('pageerror', (error) => item.errors.push(error.message));
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        item.status = response?.status();
        await page.waitForTimeout(15000);
        if (/just a moment|moment/i.test(await page.title())) await page.waitForTimeout(30000);
        item.finalUrl = page.url();
        item.title = await page.title();
        const html = await page.content();
        const name = filename(item.finalUrl);
        item.file = `recon-browser/${name}.html`;
        fs.writeFileSync(path.join(root, `${name}.html`), html);
        item.details = await page.evaluate(() => {
          const text = (value) => (value || '').replace(/\s+/g, ' ').trim();
          const interesting = [...document.querySelectorAll('iframe, [data-tplayernv], [data-post], [data-nume], [data-src], .video-player, .TPlayer, .TPlayerNv, .TPlayerTb, .player, .options, .lrt, [tab]')];
          return {
            bodyText: text(document.body?.innerText).slice(0, 30000),
            playerElements: interesting.slice(0, 250).map((element) => ({
              tag: element.tagName, id: element.id, class: element.className,
              text: text(element.innerText).slice(0, 500), html: element.outerHTML.slice(0, 15000),
            })),
            iframes: [...document.querySelectorAll('iframe')].map((frame) => ({
              src: frame.src, dataSrc: frame.getAttribute('data-src'), outerHTML: frame.outerHTML,
            })),
            links: [...document.querySelectorAll('a[href]')].map((anchor) => ({
              href: anchor.href, text: text(anchor.innerText).slice(0, 300), html: anchor.outerHTML.slice(0, 2000),
            })).filter((link) => /pelicula|serie|episod|capitul|temporada|voe|player|enlace/i.test(`${link.href} ${link.text}`)).slice(0, 300),
            scripts: [...document.scripts].map((script) => ({
              src: script.src,
              inline: /ajax|player|iframe|video|source|r\.php|\?h=|voe|byse|w1tv|swish/i.test(script.textContent)
                ? script.textContent.slice(0, 20000) : '',
            })).filter((script) => script.src || script.inline).slice(0, 100),
          };
        });
        console.log(item.status, item.title, item.finalUrl, html.length);
      } catch (error) {
        item.error = error.message;
        console.error(url, error.message);
      } finally {
        fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
        await page.close();
      }
    }
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
