#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'recon-hdfull');
fs.mkdirSync(root, { recursive: true });
const headers = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.7',
};
const media = [
  ['title-content-url', 'https://hdfull.company/vod-movie/v1/weapons.mp4?d=7722&q=1080&title=Weapons'],
  ['generic-player-decoy', 'https://cdn.zss90.pl/vod-video.mp4'],
];
function selectedHeaders(input) {
  const output = {};
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'location']) {
    if (input.headers.get(name)) output[name] = input.headers.get(name);
  }
  return output;
}
async function prefix(response, maximum = 4096) {
  if (!response.body?.getReader) return Buffer.from(await response.arrayBuffer()).subarray(0, maximum);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < maximum) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.byteLength;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).subarray(0, maximum);
}
(async () => {
  const report = { search: null, media: [] };
  try {
    const response = await fetch('https://hdfull.company/search-route', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ host: 'hdfull.company', locale: 'es', searchTerm: 'weapons' }),
      signal: AbortSignal.timeout(45000),
    });
    const text = await response.text();
    report.search = { status: response.status, headers: selectedHeaders(response), bytes: text.length, body: text.slice(0, 1000) };
    fs.writeFileSync(path.join(root, 'search-route.txt'), text);
  } catch (error) { report.search = { error: error.message }; }
  for (const [name, url] of media) {
    const item = { name, url };
    report.media.push(item);
    try {
      const head = await fetch(url, { method: 'HEAD', headers, redirect: 'follow', signal: AbortSignal.timeout(45000) });
      item.head = { status: head.status, finalUrl: head.url, headers: selectedHeaders(head) };
      if (![200, 405, 501].includes(head.status)) continue;
      const response = await fetch(url, { headers: { ...headers, range: 'bytes=0-4095' }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
      const bytes = await prefix(response);
      item.range = {
        status: response.status, finalUrl: response.url, headers: selectedHeaders(response), bytesRead: bytes.length,
        ftyp: bytes.subarray(4, 8).toString('ascii') === 'ftyp', hex: bytes.subarray(0, 32).toString('hex'),
      };
    } catch (error) { item.error = error.message; }
  }
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
