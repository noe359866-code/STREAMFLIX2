'use strict';

// Sonda de medios acotada: nunca descarga una película. No interpreta un 403
// del catálogo como un 403 del vídeo; únicamente comprueba HLS y MP4 reales.
const MAX_PLAYLIST_BYTES = 128 * 1024;
const MAX_MEDIA_BYTES = 4096;
const MAX_VARIANTS = 4;
const MAX_SEGMENTS = 2;
const REQUEST_TIMEOUT_MS = 9000;

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return 'desconocido'; }
}

function publicResult(outcome, stage, sample, format) {
  const bytes = sample?.bytes || Buffer.alloc(0);
  const prefix = bytes.toString('utf8', 0, 96).trimStart();
  const signature = !bytes.length ? 'vacio' : prefix.startsWith('#EXTM3U') ? 'hls'
    : bytes.toString('ascii', 4, 8) === 'ftyp' ? 'mp4'
      : bytes[0] === 0x47 && bytes[188] === 0x47 ? 'mpeg-ts'
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

// Algunos hosters deniegan Range pero sí permiten GET normal. En ese caso no
// se considera el 403 suficiente para retirar el proveedor.
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
      // Las etiquetas entre STREAM-INF y la URL no convierten la URL en segmento.
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

function classifySamples(samples, stage, format) {
  const valid = samples.find((item) => item.status >= 200 && item.status < 300 && item.bytes.length && !looksLikeHtml(item));
  if (valid) {
    return publicResult('ok', stage, valid, format);
  }
  if (samples.length && samples.every((item) => item.status === 403)) {
    return publicResult('http403', stage, samples[0], format);
  }
  return publicResult('otro', stage, samples.find((item) => item.status !== 403) || samples[0], format);
}

async function checkHls(url, options = {}, depth = 0) {
  const playlist = await sampleUrl(url, { ...options, maximum: MAX_PLAYLIST_BYTES });
  if (playlist.status === 403) return publicResult('http403', depth ? 'variante' : 'playlist', playlist, 'hls');
  if (!playlist.status || playlist.status < 200 || playlist.status >= 300
      || playlist.truncated || !playlist.bytes.toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) {
    return publicResult('otro', depth ? 'variante' : 'playlist', playlist, 'hls');
  }
  const { variants, segments, encryption, init } = playlistUris(playlist.bytes.toString('utf8'));
  if (variants.length) {
    if (depth >= 2 || variants.length > MAX_VARIANTS) return publicResult('otro', 'variantes-sin-verificar', playlist, 'hls');
    const results = [];
    for (const ref of variants) {
      const variant = resolveUri(ref, playlist.url);
      if (!variant) return publicResult('otro', 'variante-invalida', playlist, 'hls');
      results.push(await checkHls(variant, options, depth + 1));
      if (results.at(-1).outcome === 'ok') return results.at(-1);
    }
    if (results.every((item) => item.outcome === 'http403')) return results[0];
    return results.find((item) => item.outcome !== 'http403');
  }
  if (encryption) {
    if (!/\bMETHOD=AES-128(?:,|$)/i.test(encryption)) return publicResult('otro', 'cifrado-no-verificado', playlist, 'hls');
    const keyUrl = resolveUri(firstUri(encryption), playlist.url);
    if (!keyUrl) return publicResult('otro', 'clave-invalida', playlist, 'hls');
    const key = await sampleUrl(keyUrl, { ...options, maximum: 32 });
    if (key.status === 403) return publicResult('http403', 'clave', key, 'hls');
    if (!key.status || key.status < 200 || key.status >= 300 || key.bytes.length < 16) {
      return publicResult('otro', 'clave', key, 'hls');
    }
  }
  if (init) {
    const initUrl = resolveUri(firstUri(init), playlist.url);
    if (!initUrl) return publicResult('otro', 'inicializacion-invalida', playlist, 'hls');
    const header = await sampleMedia(initUrl, options);
    if (header.status === 403) return publicResult('http403', 'inicializacion', header, 'hls');
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
  return classifySamples(sampled, 'segmento', 'hls');
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
  // Solo se propone quitarlo cuando *todos* los enlaces HLS/MP4 hallados en
  // *cada* uno de los tres intentos devuelven 403 en una parte indispensable.
  if (attempts.length === expected && attempts.every((attempt) =>
    attempt.mediaCount > 0
    && attempt.otherFormats === 0
    && attempt.media.length === attempt.mediaCount
    && attempt.media.every((item) => item.outcome === 'http403')
  )) return 'retirar-403';
  return 'no-concluyente';
}

module.exports = { checkMedia, checkHls, checkMp4, classifyProvider, playlistUris, hostOf };
