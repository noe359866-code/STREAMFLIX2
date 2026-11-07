#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const providerId = argument('provider');
const tmdbId = argument('tmdb');
const mediaType = argument('type', 'movie');
const season = Number(argument('season', 1));
const episode = Number(argument('episode', 1));
const playback = process.argv.includes('--playback');
const output = argument('output');

if (!providerId || !tmdbId || !['movie', 'tv'].includes(mediaType)) {
  console.error(`Uso:
  TMDB_API_KEY=... npm run test:live -- --provider cuevana --tmdb 550 --type movie
  TMDB_API_KEY=... npm run test:playback -- --provider animeav1 --tmdb 37854 --type tv --season 1 --episode 1

--playback hace una petición real y limitada al medio. Sin ella solo se ejecuta el descubrimiento.`);
  process.exitCode = 2;
  return;
}
const imdbId = /^tt\d+$/i.test(String(tmdbId || '')) ? String(tmdbId) : '';
const metadataKeyOptional = new Set(['videoapi', 'vixsrc', 'warezcdn', 'superembed']).has(providerId);
if (!metadataKeyOptional && !process.env.TMDB_API_KEY && !imdbId) {
  console.error('Falta TMDB_API_KEY. Alternativamente, pasa un IMDb ID (tt...) para resolver metadatos con Cinemeta.');
  process.exitCode = 2;
  return;
}
global.TMDB_API_KEY = process.env.TMDB_API_KEY || '';
if (imdbId) {
  const { resolveStremioMetadata } = require('../stremio/metadata.cjs');
  const parsed = {
    mediaType: mediaType === 'movie' ? 'movie' : 'tv',
    imdbId,
    tmdbId: '',
    season: mediaType === 'tv' ? season : null,
    episode: mediaType === 'tv' ? episode : null,
  };
  global.__STREAMFLIX_METADATA_HOOK = async () => {
    const metadata = await resolveStremioMetadata(parsed, { useCache: false });
    if (!metadata) throw new Error(`Cinemeta no devolvió metadatos para ${imdbId}.`);
    return { ...metadata, id: metadata.tmdbId || imdbId, mediaType: parsed.mediaType };
  };
}
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const registration = manifest.scrapers.find((item) => item.id === providerId);
if (!registration) {
  console.error(`Proveedor desconocido: ${providerId}`);
  process.exitCode = 2;
  return;
}
if (!registration.supportedTypes.includes(mediaType)) {
  console.error(`${providerId} no admite ${mediaType} en el manifiesto.`);
  process.exitCode = 2;
  return;
}
const plugin = require(path.join(root, registration.filename));
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); originalWarn(...args); };

async function readPrefix(response, maximum = 4096) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.subarray(0, maximum);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < maximum) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      size += chunk.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).subarray(0, maximum);
}

async function probe(stream) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(stream.url, {
      headers: { ...stream.headers, Range: 'bytes=0-4095' }, signal: controller.signal, redirect: 'follow',
    });
    const prefix = await readPrefix(response);
    const text = prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart();
    let kind = 'desconocido';
    if (text.startsWith('#EXTM3U')) kind = 'hls-valido';
    else if (prefix.subarray(4, 8).toString('ascii') === 'ftyp') kind = 'mp4-valido';
    else if (prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3) kind = 'mkv-webm-valido';
    return {
      title: stream.title, url: stream.url, status: response.status,
      valid: response.ok && kind !== 'desconocido', kind,
      bytesRead: prefix.length, finalUrl: response.url,
    };
  } catch (error) {
    return { title: stream.title, url: stream.url, valid: false, kind: 'error-de-red-o-acceso', error: error.message };
  } finally { clearTimeout(timeout); }
}

(async () => {
  const started = Date.now();
  const streams = await plugin.getStreams(tmdbId, mediaType, season, episode);
  const result = {
    provider: providerId, content: { tmdbId, mediaType, season, episode },
    discovery: {
      streams: streams.length,
      interpretation: streams.length
        ? 'El conector devolvió candidatos; no implica reproducción hasta usar --playback.'
        : 'Sin resultados. Puede deberse a catálogo/título, red, anti-bot o extractor; no se clasifica automáticamente como proveedor roto.',
      warnings,
    },
    streams: streams.map(({ title, url, quality, language, type }) => ({ title, url, quality, language, type })),
    elapsedMs: Date.now() - started,
  };
  if (playback) {
    result.playback = [];
    for (const stream of streams.slice(0, 5)) result.playback.push(await probe(stream));
    result.playbackInterpretation = 'Valida solo la firma de los primeros bytes (en HLS, la playlist inicial; no variantes ni segmentos). No sustituye una prueba en Nuvio ni verifica audio, subtítulos o duración.';
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(output), serialized);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const playbackSummary = (result.playback || []).map((item, index) =>
      `| ${index + 1} | ${item.valid ? 'válido' : 'no válido'} | ${item.kind} | ${item.status || 'sin HTTP'} | ${item.bytesRead || 0} |`,
    );
    const summary = [
      `## Prueba real: ${providerId}`,
      '',
      `- Contenido: ${mediaType} ${tmdbId}`,
      `- Streams descubiertos: ${streams.length}`,
      `- Tiempo: ${result.elapsedMs} ms`,
      `- Advertencias del conector: ${warnings.length}`,
      ...(playback ? ['', '| # | Resultado | Firma | HTTP | Bytes |', '| - | - | - | -: | -: |', ...(playbackSummary.length ? playbackSummary : ['| — | sin candidato | — | — | 0 |'])] : []),
      '',
    ].join('\n');
    fs.appendFileSync(summaryPath, summary);
  }
  console.log(serialized);
  if (!streams.length || (playback && !result.playback.some((item) => item.valid))) process.exitCode = 1;
})().catch((error) => {
  console.error(JSON.stringify({ provider: providerId, error: error.message, classification: 'error no clasificado; revisar red y logs' }, null, 2));
  process.exitCode = 1;
}).finally(() => { console.warn = originalWarn; });
