#!/usr/bin/env node
'use strict';

// Reconocimiento de puertas públicas, no resolución de streams. Los IDs,
// nonces, tokens y URL firmadas se usan solo en memoria: nunca se serializan.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { checkHls } = require('./media-audit-lib.cjs');
const BASES = { tudorama: 'https://tudorama.com', vixsrc: 'https://vixsrc.to' };
const site = process.argv[process.argv.indexOf('--site') + 1];
if (!BASES[site]) throw new Error('Use --site tudorama|vixsrc');
const BASE = BASES[site];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BYTES = 280000;

function attr(tag, key) {
  const m = new RegExp(`\\b${key}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag || '');
  return m?.[2] || '';
}
function host(value, base = BASE) {
  if (!value) return '';
  try { return new URL(value, base).hostname; } catch (_) { return ''; }
}
function sameSite(url) {
  try {
    const target = new URL(url, BASE);
    return target.protocol === 'https:' && (target.hostname === new URL(BASE).hostname
      || (site === 'tudorama' && target.hostname.endsWith('.tudorama.com')));
  } catch (_) { return false; }
}
async function limited(url, options = {}) {
  if (!sameSite(url)) return { status: null, error: 'fuera-del-dominio' };
  try {
    const response = await fetch(url, {
      method: options.body ? 'POST' : 'GET', body: options.body,
      headers: {
        'User-Agent': UA, Accept: options.body ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,application/json,*/*;q=0.8',
        Referer: options.referer || `${BASE}/`,
        ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } : {}),
      },
      redirect: 'manual', signal: AbortSignal.timeout(9000),
    });
    const result = { status: response.status, mime: (response.headers.get('content-type') || '').split(';')[0] };
    if (!/json|html|text/i.test(result.mime)) {
      await response.body?.cancel().catch(() => {});
      return result;
    }
    const reader = response.body?.getReader();
    if (!reader) return { ...result, text: '' };
    const chunks = [];
    let size = 0;
    try {
      while (size < MAX_BYTES) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value).subarray(0, MAX_BYTES - size);
        chunks.push(chunk);
        size += chunk.length;
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { ...result, text: Buffer.concat(chunks).toString('utf8') };
  } catch (error) { return { status: null, error: error?.cause?.code || error?.name || 'red' }; }
}
function json(text) { try { return JSON.parse(text); } catch (_) { return null; } }
function scrub(value) { return String(value || '').slice(0, 40).replace(/[\r\n:]/g, ' '); }

async function tudorama() {
  const output = [];
  for (const route of ['/pelicula/minamahal/', '/ver/el-precio-de-una-confesion-s1x1/']) {
    const page = await limited(`${BASE}${route}`);
    const tag = page.text?.match(/<(?:div|section)\b(?=[^>]*\bclass\s*=\s*["'][^"']*(?:servers|ep__dropdown)[^"']*["'])[^>]*>/i)?.[0] || '';
    const id = attr(tag, 'data-id');
    const nonce = attr(tag, 'data-nonce');
    const entry = { route, status: page.status, error: page.error, player: Boolean(id), nonce: Boolean(nonce) };
    if (/^\d{1,12}$/.test(id) && /^[\w-]{4,160}$/.test(nonce)) {
      const body = new URLSearchParams({ action: 'corvus_get_servers', nonce, post_id: id }).toString();
      const response = await limited(`${BASE}/wp-admin/admin-ajax.php`, { body, referer: `${BASE}${route}` });
      const payload = json(response.text);
      const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
      entry.ajax = {
        status: response.status, error: response.error, success: payload?.success === true,
        count: rows.length, servers: rows.slice(0, 8).map((row) => ({
          name: scrub(row?.name || row?.server), lang: scrub(row?.lang), host: host(row?.url),
          direct: /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(String(row?.url || '')),
        })),
      };
      const wrapper = rows.find((row) => typeof row?.url === 'string' && sameSite(row.url)
        && !/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(row.url));
      if (wrapper) {
        const page = await limited(new URL(wrapper.url, BASE).href, { referer: `${BASE}${route}` });
        const frame = page.text?.match(/iframe\.src\s*=\s*["'](https?:\/\/[^"']+)/i)?.[1]
          || page.text?.match(/<iframe\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)/i)?.[1];
        entry.wrapper = { status: page.status, error: page.error, host: host(wrapper.url), frameHost: host(frame, wrapper.url) };
      }
    }
    output.push(entry);
  }
  return output;
}

function mediaDeclarations(html) {
  // Los nombres de atributos del reproductor se detectan sin almacenar sus valores.
  const token = /["']token["']\s*:\s*["']([^"']+)/i.exec(html)?.[1] || '';
  const expires = /["']expires["']\s*:\s*["'](\d{9,13})/i.exec(html)?.[1] || '';
  const playlist = [...html.matchAll(/["']url["']\s*:\s*["']([^"']+)/gi)]
    .map((match) => match[1].replace(/\\u002F/gi, '/').replace(/\\\//g, '/'))
    .find((url) => /\/playlist\/|\.m3u8(?:[?#]|$)/i.test(url)) || '';
  return { token, expires, playlist };
}
// Si un segmento AES-128 no muestra firma MPEG-TS *antes* de descifrarlo,
// comprobar con la clave publicada en la propia playlist (sin guardarla).
function mediaUrl(uri, base) {
  try {
    const url = new URL(uri, base);
    if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*(?:vixsrc\.to|vixcloud\.(?:co|cc)|secretanchor\d+\.boats|crystalharbor\d+\.boats)$/i.test(url.hostname)) return null;
    return url;
  } catch (_) { return null; }
}
async function smallSample(url, referer, maximum, range = false) {
  try {
    const response = await fetch(url, { headers: {
      'User-Agent': UA, Referer: referer, Origin: BASE,
      ...(range ? { Range: `bytes=0-${maximum - 1}` } : {}),
    }, redirect: 'manual', signal: AbortSignal.timeout(9000) });
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      try {
        while (size < maximum) {
          const part = await reader.read();
          if (part.done) break;
          const bytes = Buffer.from(part.value).subarray(0, maximum - size);
          chunks.push(bytes); size += bytes.length;
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    return { status: response.status, body: Buffer.concat(chunks), mime: (response.headers.get('content-type') || '').split(';')[0] };
  } catch (error) { return { status: null, error: error?.name || 'red', body: Buffer.alloc(0) }; }
}
function tsSignature(bytes) {
  return bytes?.length >= 376 && bytes[0] === 0x47 && bytes[188] === 0x47 ? 'mpeg-ts'
    : bytes?.length >= 12 && ['ftyp', 'styp', 'moof'].includes(bytes.toString('ascii', 4, 8)) ? 'mp4'
      : bytes?.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3' ? 'id3-audio' : 'desconocida';
}
async function inspectEncrypted(playlistUrl, embedUrl) {
  const master = await smallSample(playlistUrl, embedUrl, 128000);
  if (master.status !== 200 || !master.body.toString('utf8').startsWith('#EXTM3U')) return { master: master.status };
  const lines = master.body.toString('utf8').split(/\r?\n/).map((line) => line.trim());
  const variantAt = lines.findIndex((line) => /^#EXT-X-STREAM-INF:/i.test(line));
  const variantRef = variantAt >= 0 ? lines.slice(variantAt + 1).find((line) => line && !line.startsWith('#')) : '';
  const variantUrl = variantRef ? mediaUrl(variantRef, playlistUrl) : mediaUrl(playlistUrl, playlistUrl);
  if (!variantUrl) return { master: master.status, skipped: 'variante-fuera-de-dominios-observados' };
  const variant = variantRef ? await smallSample(variantUrl.href, embedUrl, 128000) : master;
  if (variant.status !== 200 || !variant.body.toString('utf8').startsWith('#EXTM3U')) return { master: master.status, variant: variant.status };
  const rows = variant.body.toString('utf8').split(/\r?\n/).map((line) => line.trim());
  const key = rows.find((line) => /^#EXT-X-KEY:/i.test(line)) || '';
  const method = /\bMETHOD=([A-Z0-9-]+)/i.exec(key)?.[1] || 'ninguno';
  const segmentAt = rows.findIndex((line) => /^#EXTINF:/i.test(line));
  const segmentRef = segmentAt >= 0 ? rows.slice(segmentAt + 1).find((line) => line && !line.startsWith('#')) : '';
  const segmentUrl = segmentRef ? mediaUrl(segmentRef, variantUrl.href) : null;
  if (!segmentUrl) return { master: master.status, variant: variant.status, method, skipped: 'sin-segmento-observable' };
  const segment = await smallSample(segmentUrl.href, embedUrl, 4096, true);
  const result = { master: master.status, variant: variant.status, method,
    segment: segment.status, mime: scrub(segment.mime), bytes: segment.body.length,
    signatureRaw: tsSignature(segment.body) };
  if (method !== 'AES-128' || !key) return result;
  const keyRef = /\bURI="([^"]+)"/i.exec(key)?.[1] || '';
  const keyUrl = keyRef ? mediaUrl(keyRef, variantUrl.href) : null;
  if (!keyUrl) return { ...result, key: 'no-observable' };
  const secret = await smallSample(keyUrl.href, embedUrl, 32);
  result.key = secret.status;
  if (secret.status !== 200 || secret.body.length !== 16) return result;
  const ivHex = /\bIV=0x([a-f0-9]{32})(?:,|$)/i.exec(key)?.[1];
  const iv = ivHex ? Buffer.from(ivHex, 'hex') : Buffer.alloc(16);
  if (!ivHex) {
    const sequence = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/i.exec(variant.body.toString('utf8'))?.[1] || 0);
    if (Number.isSafeInteger(sequence) && sequence >= 0) iv.writeBigUInt64BE(BigInt(sequence), 8);
  }
  const bytes = segment.body.subarray(0, segment.body.length - (segment.body.length % 16));
  if (bytes.length < 384) return result;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', secret.body, iv);
    decipher.setAutoPadding(false);
    result.signatureDecrypted = tsSignature(Buffer.concat([decipher.update(bytes), decipher.final()]));
  } catch (_) { result.signatureDecrypted = 'no-decodificable'; }
  return result;
}
async function vixsrc() {
  const output = [];
  for (const route of ['/api/movie/550?lang=es', '/api/tv/1396/1/1?lang=es']) {
    const response = await limited(`${BASE}${route}`);
    const payload = json(response.text);
    let target = null;
    try { if (typeof payload?.src === 'string') target = new URL(payload.src, BASE); } catch (_) { /* JSON no confiable */ }
    const entry = { route: route.split('?')[0], api: response.status, error: response.error,
      hasEmbed: Boolean(target && target.hostname === 'vixsrc.to' && /^\/embed\/\d+/.test(target.pathname)),
      lang: scrub(target?.searchParams.get('lang')),
    };
    if (entry.hasEmbed) {
      const page = await limited(target.href, { referer: `${BASE}${route.replace('/api/', '/')}` });
      const media = mediaDeclarations(page.text || '');
      entry.embed = { status: page.status, error: page.error, token: Boolean(media.token),
        expires: Boolean(media.expires), playlistHost: host(media.playlist),
        playlistShape: /^https:\/\//i.test(media.playlist) ? 'absolute' : media.playlist.startsWith('//')
          ? 'protocol-relative' : media.playlist.startsWith('/') ? 'relative' : media.playlist ? 'other' : 'absent',
        playlistExtension: /\.m3u8(?:[?#]|$)/i.test(media.playlist),
        canPlayFHD: /["']canPlayFHD["']\s*:\s*true|canPlayFHD\s*=\s*true/i.test(page.text || '') };
      if (media.playlist && media.token && media.expires && Number(media.expires) * 1000 > Date.now()
        && /^[-\w]+$/.test(media.token) && /^(?:https:\/\/|\/)/i.test(media.playlist)) {
        // Solo una URL de playlist declarada por la página, no una derivada de
        // un iframe; nunca se publica el token ni se descarga un segmento aquí.
        const playlistUrl = new URL(media.playlist, BASE);
        if (playlistUrl.protocol !== 'https:') { output.push(entry); continue; }
        // El contrato del reproductor documentado en Stream4me/vixsrc.py
        // añade .m3u8 a /playlist/<id> y h=1 cuando canPlayFHD es true.
        // No se infiere una ruta a partir del ID de TMDB: solo se completa
        // la URL /playlist/ declarada expresamente por el embed.
        if (/^\/playlist\/[-\w]+$/i.test(playlistUrl.pathname)) playlistUrl.pathname += '.m3u8';
        playlistUrl.searchParams.set('token', media.token);
        playlistUrl.searchParams.set('expires', media.expires);
        if (entry.embed.canPlayFHD) playlistUrl.searchParams.set('h', '1');
        if (target.searchParams.get('lang')) playlistUrl.searchParams.set('lang', target.searchParams.get('lang'));
        // La playlist puede residir en un CDN: solo hosts conocidos y hasta
        // 128 KiB. Los demás quedan sin sondear, no se presumen bloqueados.
        if (!/^(?:[a-z0-9-]+\.)*(?:vixcloud\.co|vixcloud\.cc|vixsrc\.to)$/i.test(playlistUrl.hostname)) {
          entry.playlist = { host: playlistUrl.hostname, skipped: 'cdn-desconocido' };
          output.push(entry);
          continue;
        }
        try {
          const res = await fetch(playlistUrl.href, { headers: {
            'User-Agent': UA, Referer: target.href, Origin: BASE,
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
          }, redirect: 'manual', signal: AbortSignal.timeout(9000) });
          const reader = res.body?.getReader();
          let content = '';
          if (reader) {
            try {
              while (content.length < 128000) {
                const next = await reader.read();
                if (next.done) break;
                content += Buffer.from(next.value).toString('utf8');
              }
            } finally { await reader.cancel().catch(() => {}); }
          }
          const langs = (kind) => [...content.matchAll(new RegExp(`^#EXT-X-MEDIA:TYPE=${kind}[^\\r\\n]*LANGUAGE=["']([^"']+)`, 'gim'))]
            .map((m) => scrub(m[1])).slice(0, 12);
          const audio = langs('AUDIO');
          const subtitles = langs('SUBTITLES');
          entry.playlist = { status: res.status, host: new URL(res.url).hostname, hls: content.startsWith('#EXTM3U'),
            audio, subtitles, spanishAudio: audio.some((lang) => /^(?:spa|es(?:-|$)|spanish)/i.test(lang)),
            spanishSubtitles: subtitles.some((lang) => /^(?:spa|es(?:-|$)|spanish)/i.test(lang)) };
          if (entry.playlist.hls) {
            const sample = await checkHls(playlistUrl.href, { headers: {
              'User-Agent': UA, Referer: target.href, Origin: BASE,
              'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            } });
            // Se publica únicamente host, estado y firma de unos KB del primer
            // segmento; la URL con firma caduca y jamás sale del proceso.
            entry.segment = { outcome: sample.outcome, stage: sample.stage,
              status: sample.status, host: sample.host, signature: sample.signature,
              bytes: sample.bytesRead, mime: sample.mime };
            if (sample.stage === 'segmento' && sample.signature === 'desconocida') {
              entry.encryption = await inspectEncrypted(playlistUrl.href, target.href);
            }
          }
        } catch (error) { entry.playlist = { error: error?.cause?.code || error?.name || 'red' }; }
      }
    }
    output.push(entry);
  }
  return output;
}

async function main() {
  const report = [];
  for (let i = 0; i < 3; i += 1) {
    const result = site === 'tudorama' ? await tudorama() : await vixsrc();
    report.push({ attempt: i + 1, result });
    console.log(`${site} intento ${i + 1}: ${result.map((entry) => entry.status || entry.api || entry.error).join('/')}`);
  }
  const outputIndex = process.argv.indexOf('--output');
  const filename = outputIndex < 0 ? `.tmp/${site}-players-recon.json` : process.argv[outputIndex + 1];
  if (!filename) throw new Error('--output requiere una ruta');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify({ site, attempts: report }, null, 2)}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const attempt of report) {
      console.log(`::notice file=scripts/requested-players-recon.cjs,title=player-${site}-${attempt.attempt}::${JSON.stringify(attempt)}`);
    }
  }
}
main().catch((error) => { console.error(`Player recon: ${error.name || 'error'}`); process.exitCode = 1; });
