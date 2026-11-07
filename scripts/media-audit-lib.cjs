'use strict';



const MAX_PLAYLIST_BYTES = 128 * 1024;
const MAX_MEDIA_BYTES = 4096;
const MAX_VARIANTS = 4;
const MAX_SEGMENTS = 2;
const REQUEST_TIMEOUT_MS = 9000;

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return 'desconocido'; }
}



function discoveryStage(url) {
  try {
    const { pathname, searchParams, hostname } = new URL(url);
    if (/\.(?:m3u8|mp4)(?:$|\.)|\/m3u8\//i.test(pathname)
      || (/^sv\d+\.ibra\.lat$/i.test(hostname) && searchParams.has('s'))) return 'posible-medio';
    if (/\/(?:search(?:-route)?|buscar|busqueda|catalogo|directorio|ajax_search)(?:\/|$)/i.test(pathname)
      || ['s', 'q', 'query', 'search', 'buscar', 'Titulo'].some((key) => searchParams.has(key))) return 'busqueda';
    if (/\/(?:wp-json|wp-admin|player|embed|custom|watch|e|f|video|source)(?:\/|$)|\/(?:api|ajax)(?:\/|$)/i.test(pathname)) return 'player-api';
    if (/\/(?:pelicula|peliculas|movies|movie|serie|series|anime|ver|dorama|online)(?:\/|$)/i.test(pathname)) return 'ficha';
    return 'otro';
  } catch (_) { return 'otro'; }
}

function publicResult(outcome, stage, sample, format) {
  const bytes = sample?.bytes || Buffer.alloc(0);
  const prefix = bytes.toString('utf8', 0, 96).trimStart();
  const box = bytes.toString('ascii', 4, 8);
  const signature = !bytes.length ? 'vacio' : prefix.startsWith('#EXTM3U') ? 'hls'
    : bytes[0] === 0x47 && bytes[188] === 0x47 ? 'mpeg-ts'
      : ['ftyp', 'styp', 'moof', 'mdat'].includes(box) && bytes.length >= 12 ? 'mp4'
        : bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0 ? 'aac'
          : bytes.toString('ascii', 0, 3) === 'ID3' ? 'id3-audio'
            : /^<(?:!doctype|html|body|script)/i.test(prefix) ? 'html' : 'desconocida';
  const mime = String(sample?.contentType || '').split(';')[0].trim().toLowerCase();
  return {
    format,
    outcome,
    stage,
    host: hostOf(sample?.url),
    status: sample?.status || null,
    bytesRead: bytes.length,
    signature,
    mime: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : '',
    ...(sample?.error ? { error: sample.error } : {}),
  };
}

async function readLimited(response, maximum) {
  if (!response.body) return { bytes: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let done = false;
  try {
    while (length < maximum) {
      const next = await reader.read();
      if (next.done) { done = true; break; }
      const chunk = Buffer.from(next.value);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    if (!done) await reader.cancel().catch(() => {});
  }
  return { bytes: Buffer.concat(chunks).subarray(0, maximum), truncated: !done };
}

async function sampleUrl(url, options = {}) {
  const { fetchImpl = globalThis.fetch, headers = {}, signal, range = false, maximum = MAX_MEDIA_BYTES } = options;
  const requestHeaders = new Headers(headers);
  if (range) requestHeaders.set('Range', `bytes=0-${maximum - 1}`);
  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  const boundedSignal = AbortSignal.any(signals);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: requestHeaders, signal: boundedSignal, redirect: 'follow' });
    const finalUrl = response.url || url;
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      return { url: finalUrl, status: response.status, bytes: Buffer.alloc(0), truncated: false };
    }
    const body = await readLimited(response, maximum);
    return {
      url: finalUrl, status: response.status,
      contentType: response.headers?.get('content-type') || '',
      ...body,
    };
  } catch (error) {
    return { url, status: null, bytes: Buffer.alloc(0), error: error?.name === 'TimeoutError' || signal?.aborted ? 'timeout' : 'red' };
  }
}



async function sampleMedia(url, options) {
  const ranged = await sampleUrl(url, { ...options, range: true });
  if (ranged.status !== 403) return ranged;
  return sampleUrl(url, { ...options, range: false });
}

function looksLikeHtml(sample) {
  const prefix = sample.bytes.toString('utf8', 0, 160).trimStart().toLowerCase();
  return /text\/html/i.test(sample.contentType || '') || /^<(?:!doctype|html|body|script)/.test(prefix);
}

function looksLikeMp4(sample) {
  return sample.bytes.length >= 12
    && sample.bytes.toString('ascii', 4, 8) === 'ftyp'
    && !looksLikeHtml(sample);
}

function firstUri(line) {
  return /\bURI="([^"]+)"/i.exec(line)?.[1] || /\bURI=([^,\s]+)/i.exec(line)?.[1] || '';
}

function resolveUri(relative, base) {
  try {
    const result = new URL(relative, base);
    return /^https?:$/.test(result.protocol) ? result.href : '';
  } catch (_) { return ''; }
}

function playlistUris(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim());
  const variants = [];
  const segments = [];
  let waitingForVariant = false;
  for (const line of lines) {
    if (/^#EXT-X-STREAM-INF(?::|$)/i.test(line)) {
      waitingForVariant = true;
    } else if (!line || line.startsWith('#')) {

      continue;
    } else if (waitingForVariant) {
      variants.push(line);
      waitingForVariant = false;
    } else {
      segments.push(line);
    }
  }
  const encryption = lines.find((line) => /^#EXT-X-KEY:/i.test(line) && !/\bMETHOD=NONE(?:,|$)/i.test(line));
  const init = lines.find((line) => /^#EXT-X-MAP:/i.test(line));
  return { variants, segments, encryption, init };
}

function looksLikeHlsSegment(sample) {
  if (!sample || !sample.bytes || looksLikeHtml(sample)) return false;
  const bytes = sample.bytes;
  const box = bytes.toString('ascii', 4, 8);
  return (bytes[0] === 0x47 && bytes[188] === 0x47)
    || (bytes.length >= 12 && ['ftyp', 'styp', 'moof', 'mdat'].includes(box))
    || (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0)
    || bytes.toString('ascii', 0, 3) === 'ID3';
}

function classifySamples(samples, stage, format) {
  const valid = samples.find((item) => item.status >= 200 && item.status < 300 && looksLikeHlsSegment(item));
  if (valid) {
    return publicResult('ok', stage, valid, format);
  }
  if (samples.length && samples.every((item) => item.status === 403)) {
    return publicResult('http403', stage, samples[0], format);
  }
  return publicResult('otro', stage, samples.find((item) => item.status !== 403) || samples[0], format);
}

function adOnlyPlaylist(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim());
  if (!lines.some((line) => /^#EXT-X-ENDLIST(?:\s|$)/i.test(line))) return false;
  let inBreak = false;
  let adSegments = 0;
  let contentSegments = 0;
  for (const line of lines) {
    if (/^#EXT-X-(?:CUE-OUT|SCTE35-OUT)(?:[:\-]|$)/i.test(line)) inBreak = true;
    else if (/^#EXT-X-(?:CUE-IN|SCTE35-IN)(?:[:\-]|$)/i.test(line)) inBreak = false;
    else if (/^#EXT-X-PART:/i.test(line) || (line && !line.startsWith('#'))) {
      if (inBreak) adSegments += 1;
      else contentSegments += 1;
    }
  }
  return adSegments > 0 && contentSegments === 0;
}

async function checkHls(url, options = {}, depth = 0) {
  const playlist = await sampleUrl(url, { ...options, maximum: MAX_PLAYLIST_BYTES });
  if (playlist.status === 403) return publicResult('http403', depth ? 'variante' : 'playlist', playlist, 'hls');
  if (!playlist.status || playlist.status < 200 || playlist.status >= 300
      || !playlist.bytes.toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) {
    return publicResult('otro', depth ? 'variante' : 'playlist', playlist, 'hls');
  }


  const text = playlist.bytes.toString('utf8');
  const prefix = playlist.truncated ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  const { variants, segments, encryption, init } = playlistUris(prefix);
  if (variants.length) {
    if (depth >= 2) return publicResult('otro', 'variantes-sin-verificar', playlist, 'hls');
    const results = [];
    for (const ref of variants.slice(0, MAX_VARIANTS)) {
      const variant = resolveUri(ref, playlist.url);
      if (!variant) return publicResult('otro', 'variante-invalida', playlist, 'hls');
      results.push(await checkHls(variant, options, depth + 1));
      if (results.at(-1).outcome === 'ok') return results.at(-1);
    }

    if (playlist.truncated || variants.length > MAX_VARIANTS) return publicResult('otro', 'variantes-sin-verificar', playlist, 'hls');
    if (results.every((item) => item.outcome === 'http403')) return results[0];
    return results.find((item) => item.outcome !== 'http403');
  }


  if (adOnlyPlaylist(prefix)) return publicResult('otro', 'playlist-solo-anuncios', playlist, 'hls');
  if (encryption) {
    if (!/\bMETHOD=AES-128(?:,|$)/i.test(encryption)) return publicResult('otro', 'cifrado-no-verificado', playlist, 'hls');
    const keyUrl = resolveUri(firstUri(encryption), playlist.url);
    if (!keyUrl) return publicResult('otro', 'clave-invalida', playlist, 'hls');
    const key = await sampleUrl(keyUrl, { ...options, maximum: 32 });
    if (key.status === 403) return playlist.truncated
      ? publicResult('otro', 'clave-parcial', key, 'hls')
      : publicResult('http403', 'clave', key, 'hls');
    if (!key.status || key.status < 200 || key.status >= 300 || key.bytes.length < 16) {
      return publicResult('otro', 'clave', key, 'hls');
    }
  }
  if (init) {
    const initUrl = resolveUri(firstUri(init), playlist.url);
    if (!initUrl) return publicResult('otro', 'inicializacion-invalida', playlist, 'hls');
    const header = await sampleMedia(initUrl, options);
    if (header.status === 403) return playlist.truncated
      ? publicResult('otro', 'inicializacion-parcial', header, 'hls')
      : publicResult('http403', 'inicializacion', header, 'hls');
    if (!header.status || header.status < 200 || header.status >= 300 || !header.bytes.length || looksLikeHtml(header)) {
      return publicResult('otro', 'inicializacion', header, 'hls');
    }
  }
  if (!segments.length) return publicResult('otro', 'segmento-ausente', playlist, 'hls');
  const sampled = [];
  for (const ref of segments.slice(0, MAX_SEGMENTS)) {
    const segment = resolveUri(ref, playlist.url);
    if (!segment) return publicResult('otro', 'segmento-invalido', playlist, 'hls');
    sampled.push(await sampleMedia(segment, options));
  }
  const result = classifySamples(sampled, 'segmento', 'hls');
  return playlist.truncated && result.outcome === 'http403'
    ? publicResult('otro', 'segmentos-sin-verificar', playlist, 'hls') : result;
}

async function checkMp4(url, options = {}) {
  const media = await sampleMedia(url, options);
  if (media.status === 403) return publicResult('http403', 'mp4', media, 'mp4');
  return publicResult(looksLikeMp4(media) && media.status >= 200 && media.status < 300 ? 'ok' : 'otro', 'mp4', media, 'mp4');
}

async function checkMedia(stream, options = {}) {
  const format = String(stream.type || '').toLowerCase();
  if (format === 'hls') return checkHls(stream.url, { ...options, headers: stream.headers || {} });
  if (format === 'mp4') return checkMp4(stream.url, { ...options, headers: stream.headers || {} });
  return { format, outcome: 'otro', stage: 'formato-no-evaluado', host: hostOf(stream.url), status: null };
}

function classifyProvider(attempts, expected = 3) {
  if (attempts.some((attempt) => attempt.media?.some((item) => item.outcome === 'ok'))) return 'medio-accesible';


  if (attempts.length === expected && attempts.every((attempt) =>
    attempt.mediaCount > 0
    && attempt.otherFormats === 0
    && attempt.media.length === attempt.mediaCount
    && attempt.media.every((item) => item.outcome === 'http403')
  )) return 'retirar-403';
  return 'no-concluyente';
}

function selectProviders(scrapers, input = '') {
  const active = (Array.isArray(scrapers) ? scrapers : []).filter((item) => item && item.enabled);
  const raw = String(input || '').trim();
  if (!raw) return active;
  const ids = raw.split(',').map((id) => id.trim());
  if (ids.some((id) => !/^[a-z0-9_-]+$/.test(id))) throw new Error('Lista de proveedores inválida');
  const wanted = new Set(ids);
  const selected = active.filter((item) => wanted.has(item.id));
  if (selected.length !== wanted.size) throw new Error('La lista incluye proveedores desconocidos o inactivos');
  return selected;
}

module.exports = { checkMedia, checkHls, checkMp4, classifyProvider, playlistUris, hostOf, discoveryStage, selectProviders };
