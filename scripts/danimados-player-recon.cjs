
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'recon-danimados-player');
fs.mkdirSync(root, { recursive: true });
const pageUrl = 'https://danimados.cc/episodios/sangre-de-zeus-2x3/';
const headers = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.7',
};
(async () => {
  const page = await fetch(pageUrl, { headers, signal: AbortSignal.timeout(45000) });
  const html = await page.text();
  fs.writeFileSync(path.join(root, 'episode.html'), html);
  const report = { pageStatus: page.status, options: [] };
  const options = [...html.matchAll(/<li\b[^>]*class=['"][^'"]*dooplay_player_option[^'"]*['"][^>]*>[\s\S]*?<\/li>/gi)];
  for (const match of options) {
    const raw = match[0];
    const attr = (name) => raw.match(new RegExp(`\\b${name}=['"]([^'"]+)`, 'i'))?.[1] || '';
    const post = attr('data-post');
    const nume = attr('data-nume');
    const type = attr('data-type') || 'tv';
    const title = raw.match(/<span class=['"]title['"]>([\s\S]*?)<\/span>/i)?.[1] || '';
    const item = { post, nume, type, title };
    report.options.push(item);
    try {
      const body = new URLSearchParams({ action: 'doo_player_ajax', post, nume, type });
      const response = await fetch('https://danimados.cc/wp-admin/admin-ajax.php', {
        method: 'POST', headers: { ...headers, referer: pageUrl, 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body, signal: AbortSignal.timeout(45000),
      });
      const text = await response.text();
      item.status = response.status;
      item.body = text;
      fs.writeFileSync(path.join(root, `option-${nume}.txt`), text);
    } catch (error) { item.error = error.message; }
    console.log(JSON.stringify({ ...item, body: item.body?.slice(0, 1000) }));
  }
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
