import { absoluteUrl } from './text.js';



const PLAYLIST_BYTES = 64 * 1024;
const MEDIA_BYTES = 2048;


const NATIVE_BODY_LIMIT = 128 * 1024;
const PROBE_BUDGET_MS = 2400;
const CONFIRM_DELAY_MS = 120;
const MAX_PROBES = 6;

function publicUrl(url) {
  const match = String(url || '').match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match || match[1].includes('@')) return false;
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(match[1])) return false;
  const host = match[1].replace(/:\d+$/, '').toLowerCase();
  if (!host.includes('.') || host.endsWith('.') || /\.(?:localhost|local|internal|lan)$/.test(host)
    || (/^[\da-fx.]+$/i.test(host) && host.split('.').length !== 4)) return false;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (host.split('.').some((part) => part.length > 1 && part.startsWith('0'))) return false;
    return parts[0] !== 0 && parts[0] !== 10 && parts[0] !== 127 && parts[0] < 224
      && !(parts[0] === 169 && parts[1] === 254)
      && !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      && !(parts[0] === 192 && parts[1] === 168)
      && !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  return true;
}

function header(response, name) {
  if (typeof response?.headers?.get === 'function') return String(response.headers.get(name) || '');
  const found = Object.entries(response?.headers || {}).find(([key]) => key.toLowerCase() === name);
  return String(found?.[1] || '');
}

async function sample(url, options, maximum, ranged = true) {
  if (!publicUrl(url) || options.signal?.aborted) return { status: 0 };
  let current = url;
  let forwardedHeaders = { ...options.headers };
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!publicUrl(current) || options.signal?.aborted) return { status: 0 };
    try {
      const headers = { ...forwardedHeaders };
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'range') delete headers[key];
      if (ranged) headers.Range = `bytes=0-${maximum - 1}`;
      const response = await options.fetchImpl(current, {
        method: 'GET', headers, signal: options.signal, redirect: 'manual',
      });
      const status = Number(response.status) || 0;
      if (status >= 300 && status < 400) {
        const next = absoluteUrl(header(response, 'location'), current);
        if (!next || !publicUrl(next)) return { status: 0 };
        const currentHost = current.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
        const nextHost = next.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
        if (currentHost !== nextHost) {

          for (const key of Object.keys(forwardedHeaders)) {
            if (/^(?:cookie|authorization|proxy-authorization)$/i.test(key)) delete forwardedHeaders[key];
          }
        }
        current = next;
        continue;
      }
      const result = { status, url: current, mime: header(response, 'content-type').toLowerCase(),
        streamable: typeof response.body?.getReader === 'function' };
      if (status < 200 || status >= 300) return result;
      const contentRange = header(response, 'content-range');
      if (status === 206 && contentRange && !/^bytes\s+0-/i.test(contentRange)) return { ...result, status: 0 };
      if (result.streamable) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        let finished = false;
        try {
          while (size < maximum) {
            const chunk = await reader.read();
            if (chunk.done) { finished = true; break; }
            const bytes = new Uint8Array(chunk.value);
            chunks.push(bytes.subarray(0, maximum - size));
            size += bytes.length;
          }
        } finally {
          if (!finished) Promise.resolve(reader.cancel()).catch(() => {});
        }
        result.bytes = new Uint8Array(Math.min(size, maximum));
        let offset = 0;
        for (const chunk of chunks) { result.bytes.set(chunk, offset); offset += chunk.length; }
        result.truncated = !finished;
      } else {


        const length = Number(header(response, 'content-length'));
        if (status === 206 || (length > 0 && length <= maximum)) {
          if (typeof response.arrayBuffer === 'function') result.bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, maximum);
          else if (typeof response.text === 'function') result.bytes = new TextEncoder().encode(await response.text()).subarray(0, maximum);
          result.truncated = status === 206 || length > maximum;
        }
      }
      return result;
    } catch (_) { return { status: 0 }; }
  }
  return { status: 0 };
}

async function checkedSample(url, options, maximum) {
  if (options.nativeBridge && !await nativeHeadAllowsSample(url, options)) return { status: 0 };
  const ranged = await sample(url, options, maximum);



  if ([401, 403, 404, 410, 416].includes(ranged.status)) {
    if (options.nativeBridge) return { status: 0 };
    return sample(url, options, maximum, false);
  }
  return ranged;
}

function textOf(bytes) {
  return bytes ? new TextDecoder('utf-8').decode(bytes) : '';
}

function clearlyNotVideo(sampled) {
  const mime = sampled.mime || '';
  const prefix = textOf(sampled.bytes?.subarray(0, 160)).trimStart();
  return /^(?:text\/|application\/(?:json|xml|xhtml\+xml)|image\/)/i.test(mime)
    || /^<(?:!doctype|html|body|script|\?xml)\b/i.test(prefix)
    || /^\{\s*"(?:error|message|status)"\s*:/i.test(prefix)
    || (sampled.bytes?.length >= 4 && sampled.bytes[0] === 0x89 && sampled.bytes[1] === 0x50
      && sampled.bytes[2] === 0x4e && sampled.bytes[3] === 0x47);
}

function mediaStatus(sampled) {
  if ([401, 403, 404, 410].includes(sampled.status)) return 'bad';
  if (sampled.status < 200 || sampled.status >= 300) return 'unknown';
  if (sampled.bytes && sampled.bytes.length === 0) return 'bad';
  if (clearlyNotVideo(sampled)) return 'bad';
  return 'unknown';
}

function binaryStatus(sampled, kind = 'segment') {
  if (sampled.status >= 200 && sampled.status < 300 && sampled.bytes) {
    const bytes = sampled.bytes;
    const box = bytes.length >= 12 ? String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) : '';
    if (kind === 'mp4' && box === 'ftyp') return 'good';
    if (kind !== 'mp4' && (['ftyp', 'styp', 'moof', 'mdat'].includes(box)
      || (bytes.length > 188 && bytes[0] === 0x47 && bytes[188] === 0x47)
      || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0)
      || textOf(bytes.subarray(0, 3)) === 'ID3')) return 'good';
  }
  return mediaStatus(sampled);
}

function playlistRefs(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim());
  const variants = [];
  const segments = [];
  let variant = false;
  let adBreak = false;
  let adSegments = 0;
  let otherSegments = 0;
  for (const line of lines) {
    if (/^#EXT-X-(?:CUE-OUT|SCTE35-OUT)(?:[:\-]|$)/i.test(line)) adBreak = true;
    else if (/^#EXT-X-(?:CUE-IN|SCTE35-IN)(?:[:\-]|$)/i.test(line)) adBreak = false;
    else if (/^#EXT-X-PART:/i.test(line)) { if (!adBreak) otherSegments += 1; }
    else if (/^#EXT-X-STREAM-INF(?::|$)/i.test(line)) variant = true;
    else if (!line || line.startsWith('#')) continue;
    else if (variant) { variants.push(line); variant = false; }
    else {
      segments.push(line);
      if (adBreak) adSegments += 1;
      else otherSegments += 1;
    }
  }
  return {
    variants, segments,


    adOnly: lines.some((line) => /^#EXT-X-ENDLIST(?:\s|$)/i.test(line)) && adSegments > 0 && otherSegments === 0,
    key: lines.find((line) => /^#EXT-X-KEY:/i.test(line) && !/\bMETHOD=NONE(?:,|$)/i.test(line)) || '',
    init: lines.find((line) => /^#EXT-X-MAP:/i.test(line)) || '',
  };
}

function attributeUri(line) {
  return /\bURI="([^"]+)"/i.exec(line)?.[1] || /\bURI=([^,\s]+)/i.exec(line)?.[1] || '';
}

async function checkHls(url, options, depth = 0) {
  const playlist = await checkedSample(url, options, PLAYLIST_BYTES);
  if (playlist.status < 200 || playlist.status >= 300) return mediaStatus(playlist);
  if (!playlist.bytes) return mediaStatus(playlist);


  if (playlist.bytes[0] === 0x1f && playlist.bytes[1] === 0x8b) return 'unknown';
  const text = textOf(playlist.bytes).replace(/^\uFEFF/, '').trimStart();

  if (!/^#EXTM3U(?:\r?\n|$)/.test(text)) return 'bad';
  const full = playlist.truncated ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  const { variants, segments, adOnly, key, init } = playlistRefs(full);


  if (adOnly) return 'bad';
  if (variants.length) {
    if (depth >= 2) return 'unknown';
    const verdicts = [];
    for (const ref of variants.slice(0, 3)) {
      const variant = absoluteUrl(ref, playlist.url);
      verdicts.push(publicUrl(variant) ? await checkHls(variant, options, depth + 1) : 'unknown');
      if (verdicts[verdicts.length - 1] === 'good') return 'good';
    }
    return !playlist.truncated && variants.length <= 3 && verdicts.every((item) => item === 'bad') ? 'bad' : 'unknown';
  }
  let encryptedWithKey = false;
  if (key) {
    if (!/\bMETHOD=AES-128(?:,|$)/i.test(key)) return 'unknown';
    const keyUrl = absoluteUrl(attributeUri(key), playlist.url);
    const secret = await checkedSample(keyUrl, options, 32);
    if (mediaStatus(secret) === 'bad' || (secret.bytes && secret.bytes.length < 16)) return playlist.truncated ? 'unknown' : 'bad';
    if (!secret.bytes) return 'unknown';
    encryptedWithKey = secret.bytes.length === 16;
  }
  if (init) {
    const initUrl = absoluteUrl(attributeUri(init), playlist.url);
    const headerSample = await checkedSample(initUrl, options, MEDIA_BYTES);
    if (mediaStatus(headerSample) === 'bad') return playlist.truncated ? 'unknown' : 'bad';
    if (!headerSample.bytes) return 'unknown';
  }
  if (!segments.length) return playlist.truncated ? 'unknown' : 'bad';
  const verdicts = [];
  for (const ref of segments.slice(0, 2)) {
    const segment = absoluteUrl(ref, playlist.url);
    if (!publicUrl(segment)) { verdicts.push('unknown'); continue; }
    const sampled = await checkedSample(segment, options, MEDIA_BYTES);
    let verdict = binaryStatus(sampled);




    if (encryptedWithKey && verdict === 'bad' && sampled.status >= 200 && sampled.status < 300
      && /^text\/html\b/i.test(sampled.mime) && sampled.bytes?.length >= 188) {
      const bytes = sampled.bytes.subarray(0, Math.min(256, sampled.bytes.length));
      let printable = 0;
      for (const byte of bytes) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) printable += 1;
      if (printable < bytes.length * 0.6) verdict = 'unknown';
    }
    verdicts.push(verdict);
    if (verdict === 'good') return 'good';
  }
  return verdicts.every((item) => item === 'bad') ? 'bad' : 'unknown';
}

async function nativeHeadAllowsSample(url, options) {
  if (!publicUrl(url) || options.signal?.aborted) return false;
  try {
    const response = await options.fetchImpl(url, { method: 'HEAD', headers: options.headers, signal: options.signal, redirect: 'manual' });
    if (Number(response.status) !== 200) return false;
    const length = Number(header(response, 'content-length'));


    return length > 0 && length <= NATIVE_BODY_LIMIT;
  } catch (_) { return false; }
}

export async function probeStream(stream, options = {}) {
  if (!stream || !publicUrl(stream.url) || !['hls', 'mp4'].includes(String(stream.type).toLowerCase())) return 'unknown';
  const context = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    headers: stream.headers || {},
    signal: options.signal,


    nativeBridge: options.nativeBridge !== undefined ? options.nativeBridge : typeof globalThis.__native_fetch === 'function',
  };
  if (stream.type === 'hls') return checkHls(stream.url, context);
  return binaryStatus(await checkedSample(stream.url, context, MEDIA_BYTES), 'mp4');
}

export async function filterUnplayableStreams(streams, options = {}) {
  const result = [...streams];
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, options.budgetMs || PROBE_BUDGET_MS); });
  const eligible = result.map((stream, index) => ({ stream, index }))
    .filter(({ stream }) => ['hls', 'mp4'].includes(String(stream.type).toLowerCase())).slice(0, MAX_PROBES);
  let cursor = 0;
  const removed = new Set();
  const worker = async () => {
    while (cursor < eligible.length && !controller?.signal.aborted) {
      const { stream, index } = eligible[cursor++];
      try {
        const context = { ...options, signal: controller?.signal };
        if (await probeStream(stream, context) !== 'bad' || controller?.signal.aborted) continue;



        await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));
        if (!controller?.signal.aborted && await probeStream(stream, context) === 'bad'
          && !controller?.signal.aborted) removed.add(index);
      } catch (_) {                                                        }
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(2, eligible.length) }, worker));
  try { await Promise.race([workers, timeout]); }
  finally {
    if (timer) clearTimeout(timer);
    if (controller) controller.abort();
  }
  return result.filter((_, index) => !removed.has(index));
}
