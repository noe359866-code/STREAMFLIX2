#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'recon-host');
fs.mkdirSync(root, { recursive: true });
const url = 'https://shannoncoldalready.com/e/jfconahnwkyn';
function decodeVoe(html) {
  try {
    const raw = html.match(/<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1].trim();
    let encoded = JSON.parse(raw)[0];
    encoded = encoded.replace(/[a-z]/gi, (char) => {
      const base = char <= 'Z' ? 65 : 97;
      return String.fromCharCode((char.charCodeAt(0) - base + 13) % 26 + base);
    });
    for (const pattern of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) encoded = encoded.split(pattern).join('_');
    const binary = Buffer.from(encoded.replace(/_/g, ''), 'base64').toString('latin1');
    const shifted = Array.from(binary, (char) => String.fromCharCode(char.charCodeAt(0) - 3)).reverse().join('');
    return JSON.parse(Buffer.from(shifted, 'base64').toString('utf8'));
  } catch (error) { return { decodeError: error.message }; }
}
(async () => {
  const response = await fetch(url, {
    redirect: 'follow', signal: AbortSignal.timeout(45000),
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', referer: 'https://verpeliculasonline.net/pelicula/van-helsing/' },
  });
  const html = await response.text();
  fs.writeFileSync(path.join(root, 'voe.html'), html);
  const config = decodeVoe(html);
  const media = config.source ? [config.source] : [...new Set([...html.matchAll(/https?:\\?\/\\?\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi)].map((match) => match[0].replace(/\\\//g, '/')))];
  const snippets = [];
  for (const match of html.matchAll(/hls|sources|source|file|mp4|m3u8|atob|base64/gi)) {
    snippets.push(html.slice(Math.max(0, match.index - 300), Math.min(html.length, match.index + 900)));
    if (snippets.length >= 50) break;
  }
  const report = {
    inputUrl: url, finalUrl: response.url, status: response.status, bytes: html.length,
    decodedTitle: config.title, decodeError: config.decodeError, media,
    decoyRejected: !media.some((item) => /test-videos\.co\.uk|Big_Buck_Bunny/i.test(item)),
    downloadExcluded: !media.some((item) => item === config.direct_access_url), snippets,
  };
  if (media[0]) {
    try {
      const probe = await fetch(media[0], { headers: { Range: 'bytes=0-4095', Referer: response.url }, signal: AbortSignal.timeout(20000) });
      const buffer = Buffer.from(await probe.arrayBuffer()).subarray(0, 4096);
      report.probe = { url: media[0], status: probe.status, contentType: probe.headers.get('content-type'), bytes: buffer.length, hls: buffer.toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U'), finalUrl: probe.url };
    } catch (error) { report.probe = { url: media[0], error: error.message }; }
  }
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, snippets: undefined }, null, 2));
})().catch((error) => { fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify({ inputUrl: url, error: error.message }, null, 2)); console.error(error); process.exitCode = 1; });
