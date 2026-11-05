#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', 'recon-player');
fs.mkdirSync(root, { recursive: true });
const report = { pages: [], ajax: [], redirects: [], mediaRequests: [] };
let sequence = 0;
const save = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

async function capture(page, url, label, referer) {
  const item = { label, inputUrl: url, referer, media: [] };
  report.pages.push(item);
  const listener = (request) => {
    if (/\.m3u8(?:\?|$)|\.mp4(?:\?|$)|api\/v1\/video|pass_md5/i.test(request.url())) {
      const entry = { page: label, url: request.url(), resourceType: request.resourceType() };
      item.media.push(entry); report.mediaRequests.push(entry);
    }
  };
  page.on('request', listener);
  try {
    if (referer) await page.setExtraHTTPHeaders({ referer });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    item.status = response?.status();
    await page.waitForTimeout(12000);
    if (/just a moment/i.test(await page.title())) await page.waitForTimeout(30000);
    item.finalUrl = page.url(); item.title = await page.title();
    const html = await page.content();
    const name = `${String(++sequence).padStart(2, '0')}-${label}.html`;
    item.file = `recon-player/${name}`;
    fs.writeFileSync(path.join(root, name), html);
    item.details = await page.evaluate(() => {
      const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      return {
        bodyText: text(document.body?.innerText).slice(0, 30000),
        iframes: [...document.querySelectorAll('iframe')].map((frame) => ({ src: frame.src, dataSrc: frame.getAttribute('data-src'), html: frame.outerHTML })),
        options: [...document.querySelectorAll('.dooplay_player_option, .video-options, .video-player, .section.player, #seasons, .episodes, .episodios, .aa-tbs, [data-season], [data-episode]')]
          .slice(0, 100).map((element) => ({ tag: element.tagName, id: element.id, class: element.className, text: text(element.innerText).slice(0, 2000), html: element.outerHTML.slice(0, 50000) })),
        links: [...document.querySelectorAll('a[href]')].map((anchor) => ({ href: anchor.href, text: text(anchor.innerText), html: anchor.outerHTML.slice(0, 10000) }))
          .filter((link) => /serie|episod|capitul|temporada|season|options-|voe|byse|w1tv|swish/i.test(`${link.href} ${link.text} ${link.html}`)).slice(0, 400),
        scripts: [...document.scripts].map((script) => ({ src: script.src, inline: /m3u8|mp4|source|player|ajax|video|byse|voe|atob|crypto|verify/i.test(script.textContent) ? script.textContent.slice(0, 40000) : '' }))
          .filter((script) => script.src || script.inline).slice(0, 100),
        buttons: [...document.querySelectorAll('button, [role=button], input[type=button], .play, .play-button, #play, #play-button')].slice(0, 100).map((element) => ({ text: text(element.innerText || element.value), html: element.outerHTML.slice(0, 5000) })),
      };
    });
    console.log('PAGE', item.status, label, item.title, item.finalUrl, html.length);
    return item;
  } catch (error) { item.error = error.message; console.error('PAGE ERROR', label, error.message); return item; }
  finally { page.off('request', listener); save(); }
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    locale: 'es-ES', viewport: { width: 1365, height: 900 }, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  try {
    const vpo = await context.newPage();
    const movie = await capture(vpo, 'https://verpeliculasonline.net/pelicula/van-helsing', 'vpo-movie');
    if (movie.status === 200) {
      const options = await vpo.locator('li.dooplay_player_option').evaluateAll((elements) => elements.map((element) => ({
        post: element.getAttribute('data-post'), nume: element.getAttribute('data-nume'), type: element.getAttribute('data-type'),
        language: element.querySelector('.title')?.textContent?.trim(), server: element.querySelector('.server')?.textContent?.trim(),
      })).filter((option) => option.post && /^\d+$/.test(option.nume || '')));
      for (const option of options) {
        try {
          const result = await vpo.evaluate(async (option) => {
            const body = new URLSearchParams({ action: 'doo_player_ajax', post: option.post, nume: option.nume, type: option.type });
            const response = await fetch('/wp-admin/admin-ajax.php', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' }, body,
            });
            return { status: response.status, url: response.url, text: await response.text() };
          }, option);
          const entry = { provider: 'vpo', option, ...result };
          report.ajax.push(entry);
          fs.writeFileSync(path.join(root, `vpo-${option.nume}.txt`), result.text);
          console.log('AJAX', option.nume, result.status, result.text.slice(0, 300));
        } catch (error) { report.ajax.push({ provider: 'vpo', option, error: error.message }); }
        save();
      }
      const embeds = [];
      for (const entry of report.ajax) {
        try {
          const data = JSON.parse(entry.text);
          const embed = data.embed_url || data.embed || '';
          const url = typeof embed === 'string' ? (embed.match(/https?:\/\/[^\s"'<>]+/)?.[0] || '') : '';
          if (url) embeds.push({ url, option: entry.option });
        } catch {}
      }
      if (embeds[0]) {
        const host = await context.newPage();
        await capture(host, embeds[0].url, 'vpo-voe', movie.finalUrl);
        try {
          const response = await context.request.get(embeds[0].url, { headers: { referer: movie.finalUrl }, timeout: 45000 });
          const text = await response.text();
          report.redirects.push({ provider: 'vpo-voe-http', inputUrl: embeds[0].url, finalUrl: response.url(), status: response.status(), bytes: text.length });
          fs.writeFileSync(path.join(root, 'vpo-voe-http.html'), text);
          console.log('VOE HTTP', response.status(), response.url(), text.length);
        } catch (error) { report.redirects.push({ provider: 'vpo-voe-http', error: error.message }); }
        await host.close();
      }
    }
    await vpo.close();

    const seriesPage = await context.newPage();
    const series = await capture(seriesPage, 'https://www2.pelisforte.se/serie/el-eternauta-2025-1746286683', 'pf-series');
    const episodeLinks = series.details?.links?.filter((link) => /\/(episodio|episodios|capitulo)\//i.test(link.href)) || [];
    const selected = episodeLinks.find((link) => /(?:1\s*[x×-]\s*0?1|temporada-1[^\d]+episodio-0?1|season-1[^\d]+episode-0?1)/i.test(`${link.href} ${link.text}`)) || episodeLinks[0];
    console.log('EPISODE LINKS', episodeLinks.map((link) => `${link.text} ${link.href}`));
    if (selected) await capture(seriesPage, selected.href, 'pf-episode', series.finalUrl);
    const iframe = (await seriesPage.locator('.video-player iframe').evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-src') || frame.src).filter(Boolean)).catch(() => []))[0];
    if (iframe && /[?&]h=/.test(iframe)) {
      const parsed = new URL(iframe);
      const redirectUrl = `${parsed.origin}/r.php?h=${encodeURIComponent(parsed.searchParams.get('h'))}`;
      try {
        const response = await context.request.get(redirectUrl, { headers: { referer: iframe }, timeout: 45000 });
        const text = await response.text();
        const entry = { provider: 'pf-episode', inputUrl: redirectUrl, referer: iframe, finalUrl: response.url(), status: response.status(), text: text.slice(0, 200000) };
        report.redirects.push(entry);
        fs.writeFileSync(path.join(root, 'pf-episode-redirect.txt'), text);
        console.log('REDIRECT', response.status(), response.url());
        if (response.url() !== redirectUrl) await capture(seriesPage, response.url(), 'pf-episode-host', iframe);
      } catch (error) { report.redirects.push({ provider: 'pf-episode', inputUrl: redirectUrl, error: error.message }); }
      save();
    }
    await seriesPage.close();

    const byseUrl = 'https://byseraguci.com/e/0albi51inneu/HT4TR4-18LA.mp4';
    const byse = await context.newPage();
    const before = await capture(byse, byseUrl, 'pf-byse-before', 'https://mp4.nu/');
    if (before.status === 200) {
      const play = byse.locator('button, [role=button], .play, .play-button, #play, #play-button').filter({ hasText: /play|reproducir/i }).first();
      if (await play.count() && await play.isVisible().catch(() => false)) {
        try { await play.click({ timeout: 5000 }); await byse.waitForTimeout(12000); } catch (error) { before.clickError = error.message; }
        const html = await byse.content();
        fs.writeFileSync(path.join(root, '99-pf-byse-after.html'), html);
        before.afterClick = { finalUrl: byse.url(), title: await byse.title(), bodyText: clean(await byse.locator('body').innerText()).slice(0, 20000), media: before.media };
      }
    }
    await byse.close();

    const nestedUrl = 'https://n1mwq.org/6vd4p/0albi51inneu';
    const nested = await context.newPage();
    await capture(nested, nestedUrl, 'pf-byse-nested', byseUrl);
    await nested.close();
    for (const asset of [nestedUrl, 'https://n1mwq.org/assets/videoPagesBundle-Bgi0QmPo.js', 'https://n1mwq.org/assets/pow-DEJGtdh2.js']) {
      try {
        const response = await context.request.get(asset, { headers: { referer: byseUrl }, timeout: 45000 });
        const text = await response.text();
        const name = asset === nestedUrl ? 'pf-byse-nested-http.html' : asset.split('/').pop();
        fs.writeFileSync(path.join(root, name), text);
        report.redirects.push({ provider: 'pf-byse-asset', inputUrl: asset, finalUrl: response.url(), status: response.status(), bytes: text.length, file: `recon-player/${name}` });
        console.log('BYSE HTTP', response.status(), response.url(), text.length);
      } catch (error) { report.redirects.push({ provider: 'pf-byse-asset', inputUrl: asset, error: error.message }); }
      save();
    }
  } finally { await browser.close(); save(); }
}

main().catch((error) => { console.error(error); save(); process.exitCode = 1; });
