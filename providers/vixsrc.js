/* vixsrc · STREAMFLIX2 · Apache-2.0 · Generado con npm run build */

// src/core/http.js
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var cookieJar = /* @__PURE__ */ new Map();
function urlParts(url) {
  const match = String(url || "").match(/^https?:\/\/([^/]+)([^?#]*)/i);
  return match ? { host: match[1].toLowerCase(), path: match[2] || "/" } : { host: "", path: "/" };
}
function cookieHeader(url) {
  const { host, path } = urlParts(url);
  const pairs = [];
  for (const [domain, cookies] of cookieJar) {
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    for (const [name, cookie] of cookies) {
      if (cookie.expires && cookie.expires < Date.now()) {
        cookies.delete(name);
        continue;
      }
      if (path.startsWith(cookie.path || "/")) pairs.push(`${name}=${cookie.value}`);
    }
  }
  return pairs.join("; ");
}
function storeCookies(url, headers) {
  const { host, path } = urlParts(url);
  if (!host || !headers) return;
  const raw = typeof headers.get === "function" ? headers.get("set-cookie") : headers["set-cookie"] || headers["Set-Cookie"];
  if (!raw) return;
  for (const line of String(raw).split(/,(?=[^;,]+=)/)) {
    const parts = line.split(";").map((part) => part.trim());
    const separator = parts[0].indexOf("=");
    if (separator < 1) continue;
    const name = parts[0].slice(0, separator);
    const value = parts[0].slice(separator + 1);
    const attrs = Object.fromEntries(parts.slice(1).map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index < 0 ? part.length : index).toLowerCase(), index < 0 ? "" : part.slice(index + 1)];
    }));
    const domain = (attrs.domain || host).replace(/^\./, "").toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (!cookieJar.has(domain)) cookieJar.set(domain, /* @__PURE__ */ new Map());
    const maxAge = Number(attrs["max-age"]);
    const expires = Number.isFinite(maxAge) && attrs["max-age"] !== void 0 ? Date.now() + maxAge * 1e3 : attrs.expires ? Date.parse(attrs.expires) : 0;
    if (maxAge <= 0 && attrs["max-age"] !== void 0) cookieJar.get(domain).delete(name);
    else cookieJar.get(domain).set(name, { value, path: attrs.path || path.replace(/\/[^/]*$/, "/") || "/", expires });
  }
}
function withQuery(url, params = {}) {
  const query = Object.keys(params).filter((key) => params[key] !== void 0 && params[key] !== null).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`).join("&");
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}
function requestHeaders(referer, extra = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.6",
    ...extra
  };
  if (referer) headers.Referer = referer;
  return headers;
}
async function request(url, options = {}) {
  const timeoutMs = Math.max(500, Math.min(options.timeoutMs || 12e3, 45e3));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo agotado (${timeoutMs} ms)`)), timeoutMs);
  });
  try {
    const headers = { ...options.headers || requestHeaders(options.referer, options.extraHeaders) };
    const hasCookie = Object.keys(headers).some((key) => key.toLowerCase() === "cookie");
    const cookies = options.cookies === false ? "" : cookieHeader(url);
    if (cookies && !hasCookie) headers.Cookie = cookies;
    const response = await Promise.race([
      fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        redirect: "follow"
      }),
      timeout
    ]);
    storeCookies(response.url || url, response.headers);
    const text = await Promise.race([response.text(), timeout]);
    const result = {
      status: response.status || 0,
      ok: response.ok !== void 0 ? response.ok : response.status >= 200 && response.status < 300,
      url: response.url || url,
      text,
      headers: response.headers
    };
    if (!result.ok && !options.allowError) {
      const error = new Error(`HTTP ${result.status} en ${url}`);
      error.response = result;
      throw error;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function fetchText(url, options = {}) {
  const response = await request(url, options);
  if (/just a moment|cf-browser-verification|challenge-running|attention required/i.test(response.text) && !/#[[]?EXTM3U|<article|<!doctype html[^>]*>[\s\S]{500,}/i.test(response.text)) {
    const error = new Error(`Protecci\xF3n anti-bot en ${url}`);
    error.response = response;
    throw error;
  }
  return response;
}
async function fetchJson(url, options = {}) {
  const response = await request(url, {
    ...options,
    extraHeaders: { Accept: "application/json, text/plain, */*", ...options.extraHeaders || {} }
  });
  try {
    return { ...response, data: JSON.parse(response.text) };
  } catch (_) {
    throw new Error(`JSON inv\xE1lido en ${url}: ${response.text.slice(0, 120)}`);
  }
}

// src/core/text.js
var ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  aacute: "\xE1",
  eacute: "\xE9",
  iacute: "\xED",
  oacute: "\xF3",
  uacute: "\xFA",
  ntilde: "\xF1",
  Aacute: "\xC1",
  Eacute: "\xC9",
  Iacute: "\xCD",
  Oacute: "\xD3",
  Uacute: "\xDA",
  Ntilde: "\xD1",
  uuml: "\xFC"
};
function decodeHtml(value) {
  return String(value == null ? "" : value).replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&#(x?[0-9a-f]+);/gi, (_, code) => {
    const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    try {
      return Number.isFinite(number) ? String.fromCodePoint(number) : "";
    } catch (_2) {
      return "";
    }
  }).replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name] === void 0 ? match : ENTITIES[name]);
}
function absoluteUrl(value, base) {
  const url = decodeHtml(value).trim();
  if (!url || /^(about:|javascript:|data:|#)/i.test(url)) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  const originMatch = String(base || "").match(/^(https?:\/\/[^/?#]+)/i);
  if (!originMatch) return url;
  const origin = originMatch[1];
  if (url.startsWith("/")) return origin + url;
  const page = String(base).split(/[?#]/)[0];
  if (url.startsWith("?")) return page + url;
  const directory = page === origin ? `${origin}/` : page.replace(/\/[^/]*$/, "/");
  const match = url.match(/^([^?#]*)([\s\S]*)$/);
  const path = `${directory.slice(origin.length)}${match[1]}`;
  const segments = [];
  for (const segment of path.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 1) segments.pop();
    } else segments.push(segment);
  }
  if (/\/(?:\.|\.\.)$/.test(path)) segments.push("");
  return origin + segments.join("/") + match[2];
}
function hostName(url) {
  const host = String(url || "").match(/^https?:\/\/([^/]+)/i)?.[1] || "";
  const clean = host.replace(/^www\./i, "").split(".")[0];
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Servidor";
}

// src/core/media-filter.js
var PLAYLIST_BYTES = 64 * 1024;
var MEDIA_BYTES = 2048;
var NATIVE_BODY_LIMIT = 128 * 1024;
var PROBE_BUDGET_MS = 2400;
var CONFIRM_DELAY_MS = 120;
var MAX_PROBES = 6;
function publicUrl(url) {
  const match = String(url || "").match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match || match[1].includes("@")) return false;
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(match[1])) return false;
  const host = match[1].replace(/:\d+$/, "").toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || /\.(?:localhost|local|internal|lan)$/.test(host) || /^[\da-fx.]+$/i.test(host) && host.split(".").length !== 4) return false;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (host.split(".").some((part) => part.length > 1 && part.startsWith("0"))) return false;
    return parts[0] !== 0 && parts[0] !== 10 && parts[0] !== 127 && parts[0] < 224 && !(parts[0] === 169 && parts[1] === 254) && !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) && !(parts[0] === 192 && parts[1] === 168) && !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  return true;
}
function header(response, name) {
  if (typeof response?.headers?.get === "function") return String(response.headers.get(name) || "");
  const found = Object.entries(response?.headers || {}).find(([key]) => key.toLowerCase() === name);
  return String(found?.[1] || "");
}
async function sample(url, options, maximum, ranged = true) {
  if (!publicUrl(url) || options.signal?.aborted) return { status: 0 };
  let current = url;
  let forwardedHeaders = { ...options.headers };
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!publicUrl(current) || options.signal?.aborted) return { status: 0 };
    try {
      const headers = { ...forwardedHeaders };
      for (const key of Object.keys(headers)) if (key.toLowerCase() === "range") delete headers[key];
      if (ranged) headers.Range = `bytes=0-${maximum - 1}`;
      const response = await options.fetchImpl(current, {
        method: "GET",
        headers,
        signal: options.signal,
        redirect: "manual"
      });
      const status = Number(response.status) || 0;
      if (status >= 300 && status < 400) {
        const next = absoluteUrl(header(response, "location"), current);
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
      const result = {
        status,
        url: current,
        mime: header(response, "content-type").toLowerCase(),
        streamable: typeof response.body?.getReader === "function"
      };
      if (status < 200 || status >= 300) return result;
      const contentRange = header(response, "content-range");
      if (status === 206 && contentRange && !/^bytes\s+0-/i.test(contentRange)) return { ...result, status: 0 };
      if (result.streamable) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        let finished = false;
        try {
          while (size < maximum) {
            const chunk = await reader.read();
            if (chunk.done) {
              finished = true;
              break;
            }
            const bytes = new Uint8Array(chunk.value);
            chunks.push(bytes.subarray(0, maximum - size));
            size += bytes.length;
          }
        } finally {
          if (!finished) Promise.resolve(reader.cancel()).catch(() => {
          });
        }
        result.bytes = new Uint8Array(Math.min(size, maximum));
        let offset = 0;
        for (const chunk of chunks) {
          result.bytes.set(chunk, offset);
          offset += chunk.length;
        }
        result.truncated = !finished;
      } else {
        const length = Number(header(response, "content-length"));
        if (status === 206 || length > 0 && length <= maximum) {
          if (typeof response.arrayBuffer === "function") result.bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, maximum);
          else if (typeof response.text === "function") result.bytes = new TextEncoder().encode(await response.text()).subarray(0, maximum);
          result.truncated = status === 206 || length > maximum;
        }
      }
      return result;
    } catch (_) {
      return { status: 0 };
    }
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
  return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}
function clearlyNotVideo(sampled) {
  const mime = sampled.mime || "";
  const prefix = textOf(sampled.bytes?.subarray(0, 160)).trimStart();
  return /^(?:text\/|application\/(?:json|xml|xhtml\+xml)|image\/)/i.test(mime) || /^<(?:!doctype|html|body|script|\?xml)\b/i.test(prefix) || /^\{\s*"(?:error|message|status)"\s*:/i.test(prefix) || sampled.bytes?.length >= 4 && sampled.bytes[0] === 137 && sampled.bytes[1] === 80 && sampled.bytes[2] === 78 && sampled.bytes[3] === 71;
}
function mediaStatus(sampled) {
  if ([401, 403, 404, 410].includes(sampled.status)) return "bad";
  if (sampled.status < 200 || sampled.status >= 300) return "unknown";
  if (sampled.bytes && sampled.bytes.length === 0) return "bad";
  if (clearlyNotVideo(sampled)) return "bad";
  return "unknown";
}
function binaryStatus(sampled, kind = "segment") {
  if (sampled.status >= 200 && sampled.status < 300 && sampled.bytes) {
    const bytes = sampled.bytes;
    const box = bytes.length >= 12 ? String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) : "";
    if (kind === "mp4" && box === "ftyp") return "good";
    if (kind !== "mp4" && (["ftyp", "styp", "moof", "mdat"].includes(box) || bytes.length > 188 && bytes[0] === 71 && bytes[188] === 71 || bytes.length > 1 && bytes[0] === 255 && (bytes[1] & 246) === 240 || textOf(bytes.subarray(0, 3)) === "ID3")) return "good";
  }
  return mediaStatus(sampled);
}
function playlistRefs(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim());
  const variants = [];
  const segments = [];
  let variant = false;
  for (const line of lines) {
    if (/^#EXT-X-STREAM-INF(?::|$)/i.test(line)) variant = true;
    else if (!line || line.startsWith("#")) continue;
    else if (variant) {
      variants.push(line);
      variant = false;
    } else segments.push(line);
  }
  return {
    variants,
    segments,
    key: lines.find((line) => /^#EXT-X-KEY:/i.test(line) && !/\bMETHOD=NONE(?:,|$)/i.test(line)) || "",
    init: lines.find((line) => /^#EXT-X-MAP:/i.test(line)) || ""
  };
}
function attributeUri(line) {
  return /\bURI="([^"]+)"/i.exec(line)?.[1] || /\bURI=([^,\s]+)/i.exec(line)?.[1] || "";
}
async function checkHls(url, options, depth = 0) {
  const playlist = await checkedSample(url, options, PLAYLIST_BYTES);
  if (playlist.status < 200 || playlist.status >= 300) return mediaStatus(playlist);
  if (!playlist.bytes) return mediaStatus(playlist);
  if (playlist.bytes[0] === 31 && playlist.bytes[1] === 139) return "unknown";
  const text = textOf(playlist.bytes).replace(/^\uFEFF/, "").trimStart();
  if (!/^#EXTM3U(?:\r?\n|$)/.test(text)) return "bad";
  const full = playlist.truncated ? text.slice(0, text.lastIndexOf("\n") + 1) : text;
  const { variants, segments, key, init } = playlistRefs(full);
  if (variants.length) {
    if (depth >= 2) return "unknown";
    const verdicts2 = [];
    for (const ref of variants.slice(0, 3)) {
      const variant = absoluteUrl(ref, playlist.url);
      verdicts2.push(publicUrl(variant) ? await checkHls(variant, options, depth + 1) : "unknown");
      if (verdicts2[verdicts2.length - 1] === "good") return "good";
    }
    return !playlist.truncated && variants.length <= 3 && verdicts2.every((item) => item === "bad") ? "bad" : "unknown";
  }
  let encryptedWithKey = false;
  if (key) {
    if (!/\bMETHOD=AES-128(?:,|$)/i.test(key)) return "unknown";
    const keyUrl = absoluteUrl(attributeUri(key), playlist.url);
    const secret = await checkedSample(keyUrl, options, 32);
    if (mediaStatus(secret) === "bad" || secret.bytes && secret.bytes.length < 16) return playlist.truncated ? "unknown" : "bad";
    if (!secret.bytes) return "unknown";
    encryptedWithKey = secret.bytes.length === 16;
  }
  if (init) {
    const initUrl = absoluteUrl(attributeUri(init), playlist.url);
    const headerSample = await checkedSample(initUrl, options, MEDIA_BYTES);
    if (mediaStatus(headerSample) === "bad") return playlist.truncated ? "unknown" : "bad";
    if (!headerSample.bytes) return "unknown";
  }
  if (!segments.length) return playlist.truncated ? "unknown" : "bad";
  const verdicts = [];
  for (const ref of segments.slice(0, 2)) {
    const segment = absoluteUrl(ref, playlist.url);
    if (!publicUrl(segment)) {
      verdicts.push("unknown");
      continue;
    }
    const sampled = await checkedSample(segment, options, MEDIA_BYTES);
    let verdict = binaryStatus(sampled);
    if (encryptedWithKey && verdict === "bad" && sampled.status >= 200 && sampled.status < 300 && /^text\/html\b/i.test(sampled.mime) && sampled.bytes?.length >= 188) {
      const bytes = sampled.bytes.subarray(0, Math.min(256, sampled.bytes.length));
      let printable = 0;
      for (const byte of bytes) if (byte === 9 || byte === 10 || byte === 13 || byte >= 32 && byte <= 126) printable += 1;
      if (printable < bytes.length * 0.6) verdict = "unknown";
    }
    verdicts.push(verdict);
    if (verdict === "good") return "good";
  }
  return verdicts.every((item) => item === "bad") ? "bad" : "unknown";
}
async function nativeHeadAllowsSample(url, options) {
  if (!publicUrl(url) || options.signal?.aborted) return false;
  try {
    const response = await options.fetchImpl(url, { method: "HEAD", headers: options.headers, signal: options.signal, redirect: "manual" });
    if (Number(response.status) !== 200) return false;
    const length = Number(header(response, "content-length"));
    return length > 0 && length <= NATIVE_BODY_LIMIT;
  } catch (_) {
    return false;
  }
}
async function probeStream(stream, options = {}) {
  if (!stream || !publicUrl(stream.url) || !["hls", "mp4"].includes(String(stream.type).toLowerCase())) return "unknown";
  const context = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    headers: stream.headers || {},
    signal: options.signal,
    // El fetch de QuickJS ya descarga el cuerpo completo antes de entregarlo:
    // cada GET (también de segmentos/inicialización) requiere HEAD pequeño o Range.
    nativeBridge: options.nativeBridge !== void 0 ? options.nativeBridge : typeof globalThis.__native_fetch === "function"
  };
  if (stream.type === "hls") return checkHls(stream.url, context);
  return binaryStatus(await checkedSample(stream.url, context, MEDIA_BYTES), "mp4");
}
async function filterUnplayableStreams(streams2, options = {}) {
  const result = [...streams2];
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, options.budgetMs || PROBE_BUDGET_MS);
  });
  const eligible = result.map((stream, index) => ({ stream, index })).filter(({ stream }) => ["hls", "mp4"].includes(String(stream.type).toLowerCase())).slice(0, MAX_PROBES);
  let cursor = 0;
  const removed = /* @__PURE__ */ new Set();
  const worker = async () => {
    while (cursor < eligible.length && !controller?.signal.aborted) {
      const { stream, index } = eligible[cursor++];
      try {
        const context = { ...options, signal: controller?.signal };
        if (await probeStream(stream, context) !== "bad" || controller?.signal.aborted) continue;
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));
        if (!controller?.signal.aborted && await probeStream(stream, context) === "bad" && !controller?.signal.aborted) removed.add(index);
      } catch (_) {
      }
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(2, eligible.length) }, worker));
  try {
    await Promise.race([workers, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (controller) controller.abort();
  }
  return result.filter((_, index) => !removed.has(index));
}

// src/core/streams.js
function mediaKind(url, explicit) {
  if (explicit) return explicit;
  if (/\.m3u8(?:$|[?#])|\/m3u8\//i.test(url)) return "hls";
  if (/\.mpd(?:$|[?#])/i.test(url)) return "dash";
  if (/\.mkv(?:$|[?#])/i.test(url)) return "mkv";
  if (/\.webm(?:$|[?#])/i.test(url)) return "webm";
  return "mp4";
}
function isPlayableUrl(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) return false;
  if (/^https?:\/\/(?:[^/@]+\.)?test-videos\.co\.uk(?::\d+)?\//i.test(url)) return false;
  if (/^https?:\/\/cdn\.zss90\.pl\/vod-video\.mp4(?:$|[?#])/i.test(url)) return false;
  if (/\/e\/[^?#]+\.mp4(?:$|[?#])/i.test(url)) return false;
  if (/\.mpd(?:$|[?#])/i.test(url)) return false;
  return /\.(?:m3u8|mp4|mkv|webm)(?:$|[?#])/i.test(url) || /\/m3u8\/|\/get_video\?|\/videoplayback(?:\?|$)|\/manifest\.m3u8/i.test(url);
}
function qualityOf(...values) {
  const text = values.filter(Boolean).join(" ");
  const match = text.match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)\s*p?\b/i);
  if (match) return `${match[1]}p`;
  if (/\b(?:4k|uhd)\b/i.test(text)) return "2160p";
  if (/\b(?:full\s*hd|fhd)\b/i.test(text)) return "1080p";
  if (/\bhd\b/i.test(text)) return "720p";
  if (/\bcam\b/i.test(text)) return "CAM";
  return "Auto";
}
function languageOf(value, fallback = "es") {
  const text = String(value || "").toLowerCase();
  if (/^(?:und|unknown|desconocido)$/.test(text.trim())) return "und";
  if (/^(?:it|ita|italiano|italian)$/.test(text.trim())) return "it";
  if (/^(?:pt|por|pt-br|portugu[eê]s|portuguese)$/.test(text.trim())) return "pt-BR";
  if (/\b(lat|latino|dub|doblaje|es-mx|es-la)\b/.test(text)) return "es-LAT";
  if (/\b(cast|castellano|esp|spanish|español|espanol|es-es)\b/.test(text)) return "es-ES";
  if (/\b(sub|subtitulad[oa]|subt[ií]tulos?|vose|sub espanol)\b/.test(text)) return "es-SUB";
  if (/\b(eng|english|ingl[eé]s|ingles|en)\b/.test(text)) return "en";
  return fallback;
}
function makeStream(provider, url, options = {}) {
  if (!isPlayableUrl(url)) return null;
  const server = options.server || hostName(url);
  const language = languageOf(options.language || options.title, options.defaultLanguage || "es");
  const quality = options.quality && options.quality !== "Auto" ? options.quality : qualityOf(options.quality, options.title, url);
  return {
    name: provider,
    provider: options.providerId || provider.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    title: options.title || `${server} \xB7 ${language} \xB7 ${quality}`,
    url,
    quality,
    language,
    type: mediaKind(url, options.type),
    headers: options.headers || { "User-Agent": "Mozilla/5.0", ...options.referer ? { Referer: options.referer } : {} },
    ...options.subtitles?.length ? { subtitles: options.subtitles } : {}
  };
}
function finalizeStreams(streams2) {
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const stream of streams2.flat ? streams2.flat(2) : streams2) {
    if (!stream || !isPlayableUrl(stream.url)) continue;
    const key = `${stream.url}|${stream.language || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(stream);
  }
  return output.slice(0, 40);
}
function providerGuard(provider, getStreams) {
  return async function guarded(contentId, mediaType, season, episode) {
    const type = mediaType === "movie" ? "movie" : "tv";
    if (!contentId) return [];
    if (type === "tv" && (!Number(season) || !Number(episode))) return [];
    try {
      const streams2 = await getStreams(String(contentId), type, Number(season) || null, Number(episode) || null);
      const finalized = finalizeStreams(streams2 || []);
      if (globalThis.__STREAMFLIX_AUDIT_RAW_MEDIA === true) return finalized;
      if (typeof globalThis.__STREAMFLIX_MEDIA_PROBE_ALLOWED === "function" && !globalThis.__STREAMFLIX_MEDIA_PROBE_ALLOWED()) return finalized;
      return await filterUnplayableStreams(finalized);
    } catch (error) {
      try {
        console.warn(`[${provider}] ${error && error.message ? error.message : error}`);
      } catch (_) {
      }
      return [];
    }
  };
}

// src/core/site.js
function createDirectProvider(config) {
  return providerGuard(config.name, async (contentId, mediaType, season, episode) => config.streams(String(contentId).replace(/^tmdb[:/]/i, ""), { mediaType, season: season || 1, episode: episode || 1 }));
}

// src/providers/vixsrc/index.js
var BASE = "https://vixsrc.to";
var PLAYLIST = /^https:\/\/(?:[a-z0-9-]+\.)*(?:vixsrc\.to|vixcloud\.(?:co|cc))\/playlist\/[-\w]+(?:\.m3u8)?(?:\?[^#]*)?$/i;
var EMBED = /^https:\/\/vixsrc\.to\/embed\/\d+(?:[/?#]|$)/i;
var HEADERS = {
  "User-Agent": USER_AGENT,
  Origin: BASE,
  "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7"
};
function mediaDeclarations(html) {
  const text = String(html || "");
  const token = /["']token["']\s*:\s*["']([\w-]{8,200})["']/i.exec(text)?.[1] || "";
  const expires = /["']expires["']\s*:\s*["'](\d{9,13})["']/i.exec(text)?.[1] || "";
  const playlist = [...text.matchAll(/["']url["']\s*:\s*["']([^"']+)["']/gi)].map((match) => absoluteUrl(decodeHtml(match[1].replace(/\\u0026/gi, "&")), BASE)).find((url) => PLAYLIST.test(url)) || "";
  const fhd = /["']canPlayFHD["']\s*:\s*true|canPlayFHD\s*=\s*true/i.test(text);
  return { token, expires, playlist, fhd };
}
function audioLanguage(master) {
  const rows = String(master || "").split(/\r?\n/).filter((line) => /^#EXT-X-MEDIA:/i.test(line) && /\bTYPE=AUDIO(?:,|$)/i.test(line));
  const preferred = rows.find((line) => /\bDEFAULT=YES(?:,|$)/i.test(line)) || rows[0] || "";
  const raw = /\bLANGUAGE=["']?([a-z-]+)["']?/i.exec(preferred)?.[1]?.toLowerCase() || "";
  if (/^(?:spa|es(?:-|$))/.test(raw)) return "es";
  if (/^(?:eng|en(?:-|$))/.test(raw)) return "en";
  if (/^(?:ita|it(?:-|$))/.test(raw)) return "it";
  if (/^(?:por|pt(?:-|$))/.test(raw)) return "pt-BR";
  return "und";
}
function subtitlesFrom(master, playlistUrl) {
  const tracks = [];
  for (const row of String(master || "").split(/\r?\n/)) {
    if (!/^#EXT-X-MEDIA:/i.test(row) || !/\bTYPE=SUBTITLES(?:,|$)/i.test(row)) continue;
    const raw = /\bURI="([^"]+)"/i.exec(row)?.[1];
    const language = /\bLANGUAGE="?([a-z-]+)"?/i.exec(row)?.[1]?.toLowerCase() || "";
    const url = absoluteUrl(raw || "", playlistUrl);
    if (!/^https:\/\//i.test(url)) continue;
    const code = /^(?:spa|es(?:-|$))/.test(language) ? "es" : /^(?:eng|en(?:-|$))/.test(language) ? "en" : /^(?:ita|it(?:-|$))/.test(language) ? "it" : "";
    if (code && !tracks.some((track) => track.url === url)) {
      tracks.push({ url, language: code, name: code === "es" ? "Espa\xF1ol" : code === "en" ? "English" : "Italiano" });
    }
    if (tracks.length >= 8) break;
  }
  return tracks;
}
async function streams(id, media) {
  if (!/^\d{1,12}$/.test(id)) return [];
  const path = media.mediaType === "movie" ? `/api/movie/${id}` : `/api/tv/${id}/${media.season}/${media.episode}`;
  const api = await fetchJson(withQuery(`${BASE}${path}`, { lang: "es" }), { referer: `${BASE}/` });
  const src = api.data?.src;
  const embedUrl = absoluteUrl(typeof src === "string" ? src : "", BASE);
  if (!EMBED.test(embedUrl)) return [];
  const page = await fetchText(embedUrl, { referer: `${BASE}/`, timeoutMs: 9500 });
  const declared = mediaDeclarations(page.text);
  const expiry = Number(declared.expires) * (declared.expires.length > 10 ? 1 : 1e3);
  if (!declared.playlist || !declared.token || !Number.isFinite(expiry) || expiry < Date.now() + 1e4) return [];
  const pathUrl = declared.playlist.split("?")[0].replace(/(\/playlist\/[-\w]+)(?:\.m3u8)?$/, "$1.m3u8");
  const url = withQuery(pathUrl, {
    token: declared.token,
    expires: declared.expires,
    ...declared.fhd ? { h: 1 } : {},
    lang: "es"
  });
  const headers = { ...HEADERS, Referer: page.url };
  const sample2 = await fetchText(url, { headers, timeoutMs: 9e3, allowError: true });
  if (!sample2.ok || !sample2.text.replace(/^\uFEFF/, "").trimStart().startsWith("#EXTM3U")) return [];
  const language = audioLanguage(sample2.text);
  const subtitles = subtitlesFrom(sample2.text, url);
  const stream = makeStream("VixSrc", url, {
    providerId: "vixsrc",
    type: "hls",
    language,
    subtitles,
    headers,
    title: `VixSrc \xB7 ${language === "und" ? "audio no verificado" : language.toUpperCase()} \xB7 HLS`
  });
  return stream ? [stream] : [];
}
module.exports = { getStreams: createDirectProvider({ name: "VixSrc", streams }) };
