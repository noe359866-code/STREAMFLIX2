
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var cookieJar =                 new Map();
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
    if (!cookieJar.has(domain)) cookieJar.set(domain,                 new Map());
    const maxAge = Number(attrs["max-age"]);
    const expires = Number.isFinite(maxAge) && attrs["max-age"] !== void 0 ? Date.now() + maxAge * 1e3 : attrs.expires ? Date.parse(attrs.expires) : 0;
    if (maxAge <= 0 && attrs["max-age"] !== void 0) cookieJar.get(domain).delete(name);
    else cookieJar.get(domain).set(name, { value, path: attrs.path || path.replace(/\/[^/]*$/, "/") || "/", expires });
  }
}
function origin(url) {
  const match = String(url || "").match(/^https?:\/\/[^/]+/i);
  return match ? match[0] : "";
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
        redirect: options.redirect || "follow"
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
async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        output[index] = await mapper(items[index], index);
      } catch (_) {
        output[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return output;
}


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
function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function normalizeTitle(value) {
  let text = decodeHtml(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {
  }
  return text.replace(/\.(mkv|mp4|avi)$/i, "").replace(/\b(19|20)\d{2}\b/g, " ").replace(/\b(ver|pelicula|serie|online|gratis|audio|latino|castellano|subtitulado|sub espanol|espanol)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function titleScore(candidate, metadata, mediaType) {
  const normalized = normalizeTitle(candidate && (candidate.title || candidate.name || candidate.url));
  if (!normalized) return -1;
  const titles = (metadata.titles || []).map(normalizeTitle).filter(Boolean);
  let score = -1;
  for (const title of titles) {
    if (normalized === title) score = Math.max(score, 100);
    else if (normalized.startsWith(`${title} `) || normalized.endsWith(` ${title}`)) score = Math.max(score, 82);
    else if (title.length >= 5 && normalized.includes(title)) score = Math.max(score, 68);
  }
  if (score < 0) return -1;
  const year = String(candidate.year || candidate.released || "").match(/(?:19|20)\d{2}/);
  if (metadata.year && year) score += year[0] === String(metadata.year) ? 15 : -25;
  if (candidate.type && mediaType) {
    const candidateTv = /tv|serie|anime|dorama|show/i.test(candidate.type) && !/movie|pelicula/i.test(candidate.type);
    score += candidateTv === (mediaType !== "movie") ? 10 : -35;
  }
  return score;
}
function bestTitleMatch(candidates, metadata, mediaType, minimum = 60) {
  return (candidates || []).map((candidate, index) => ({ candidate, index, score: titleScore(candidate, metadata, mediaType) })).filter((entry) => entry.score >= minimum).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.candidate || null;
}
function absoluteUrl(value, base) {
  const url = decodeHtml(value).trim();
  if (!url || /^(about:|javascript:|data:|#)/i.test(url)) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  const originMatch = String(base || "").match(/^(https?:\/\/[^/?#]+)/i);
  if (!originMatch) return url;
  const origin2 = originMatch[1];
  if (url.startsWith("/")) return origin2 + url;
  const page = String(base).split(/[?#]/)[0];
  if (url.startsWith("?")) return page + url;
  const directory = page === origin2 ? `${origin2}/` : page.replace(/\/[^/]*$/, "/");
  const match = url.match(/^([^?#]*)([\s\S]*)$/);
  const path = `${directory.slice(origin2.length)}${match[1]}`;
  const segments = [];
  for (const segment of path.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 1) segments.pop();
    } else segments.push(segment);
  }
  if (/\/(?:\.|\.\.)$/.test(path)) segments.push("");
  return origin2 + segments.join("/") + match[2];
}
function hostName(url) {
  const host = String(url || "").match(/^https?:\/\/([^/]+)/i)?.[1] || "";
  const clean = host.replace(/^www\./i, "").split(".")[0];
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Servidor";
}
function anchors(html) {
  const output = [];
  const regex = /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while (match = regex.exec(String(html || ""))) {
    const raw = match[0];
    const imageAlt = raw.match(/<img\b[^>]*(?:alt|title)\s*=\s*(["'])(.*?)\1/i)?.[2];
    const anchorTitle = raw.match(/<a\b[^>]*title\s*=\s*(["'])(.*?)\1/i)?.[2];
    output.push({
      href: decodeHtml(match[2]),
      raw,
      title: stripTags(match[3]) || stripTags(imageAlt || anchorTitle || ""),
      imageAlt: stripTags(imageAlt || ""),
      anchorTitle: stripTags(anchorTitle || "")
    });
  }
  return output;
}
function attributes(tag) {
  const result = {};
  const regex = /([:\w-]+)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while (match = regex.exec(String(tag || ""))) result[match[1].toLowerCase()] = decodeHtml(match[3]);
  return result;
}
function attribute(tag, name) {
  return attributes(tag)[String(name || "").toLowerCase()] || "";
}
function extractBalanced(source, marker, opening = "[", closing = "]") {
  const text = String(source || "");
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf(opening, markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
function unique(values, keyOf = (value) => value) {
  const seen =                 new Set();
  const output = [];
  for (const value of values || []) {
    if (value === void 0 || value === null || typeof value === "string" && !value.trim()) continue;
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}
function yearOf(value) {
  return String(value || "").match(/(?:19|20)\d{2}/)?.[0] || "";
}


function apiKey() {
  const key = globalThis.TMDB_API_KEY;
  if (!key) throw new Error("Nuvio no proporcion\xF3 TMDB_API_KEY.");
  return key;
}
function endpointType(mediaType) {
  return mediaType === "movie" ? "movie" : "tv";
}
async function resolveMetadata(contentId, mediaType) {
  const type = endpointType(mediaType);
  if (typeof globalThis.__STREAMFLIX_METADATA_HOOK === "function") {
    const hooked = await globalThis.__STREAMFLIX_METADATA_HOOK(contentId, type);
    if (hooked) return hooked;
  }
  let id = String(contentId || "").trim().replace(/^tmdb[:/]/i, "").split("/")[0];
  if (!id) throw new Error("ID de contenido vac\xEDo.");
  if (/^(?:imdb:)?tt\d+$/i.test(id)) {
    const imdb = id.replace(/^imdb:/i, "");
    const response = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdb)}?api_key=${encodeURIComponent(apiKey())}&external_source=imdb_id`);
    const found = type === "movie" ? response.data.movie_results?.[0] : response.data.tv_results?.[0];
    if (!found?.id) throw new Error(`TMDB no encontr\xF3 ${imdb}.`);
    id = String(found.id);
  }
  if (!/^\d+$/.test(id)) throw new Error(`Se esperaba un ID TMDB num\xE9rico; recibido: ${id}`);
  const languages = ["es-MX", "en-US"];
  const responses = await Promise.all(languages.map((language) => fetchJson(
    `https://api.themoviedb.org/3/${type}/${id}?api_key=${encodeURIComponent(apiKey())}&language=${language}&append_to_response=alternative_titles,external_ids`,
    { referer: "https://www.themoviedb.org/" }
  ).catch(() => null)));
  const es = responses[0]?.data;
  const en = responses[1]?.data;
  const primary = es || en;
  if (!primary || primary.success === false) throw new Error(`TMDB no devolvi\xF3 metadatos para ${id}.`);
  const alternatives = [
    ...primary.alternative_titles?.titles || primary.alternative_titles?.results || [],
    ...en?.alternative_titles?.titles || en?.alternative_titles?.results || []
  ].map((item) => item.title || item.name);
  const titles = unique([
    primary.title,
    primary.name,
    primary.original_title,
    primary.original_name,
    en?.title,
    en?.name,
    en?.original_title,
    en?.original_name,
    ...alternatives
  ]);
  return {
    id,
    imdbId: primary.external_ids?.imdb_id || primary.imdb_id || en?.external_ids?.imdb_id || en?.imdb_id || "",
    title: primary.title || primary.name || en?.title || en?.name || "",
    originalTitle: primary.original_title || primary.original_name || en?.original_title || en?.original_name || "",
    titles,
    year: yearOf(primary.release_date || primary.first_air_date || en?.release_date || en?.first_air_date),
    mediaType: type
  };
}


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
  let adBreak = false;
  let adSegments = 0;
  let otherSegments = 0;
  for (const line of lines) {
    if (/^#EXT-X-(?:CUE-OUT|SCTE35-OUT)(?:[:\-]|$)/i.test(line)) adBreak = true;
    else if (/^#EXT-X-(?:CUE-IN|SCTE35-IN)(?:[:\-]|$)/i.test(line)) adBreak = false;
    else if (/^#EXT-X-PART:/i.test(line)) {
      if (!adBreak) otherSegments += 1;
    } else if (/^#EXT-X-STREAM-INF(?::|$)/i.test(line)) variant = true;
    else if (!line || line.startsWith("#")) continue;
    else if (variant) {
      variants.push(line);
      variant = false;
    } else {
      segments.push(line);
      if (adBreak) adSegments += 1;
      else otherSegments += 1;
    }
  }
  return {
    variants,
    segments,
    adOnly: lines.some((line) => /^#EXT-X-ENDLIST(?:\s|$)/i.test(line)) && adSegments > 0 && otherSegments === 0,
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
  const { variants, segments, adOnly, key, init } = playlistRefs(full);
  if (adOnly) return "bad";
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
  const removed =                 new Set();
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
  const path = String(url).split(/[?#]/, 1)[0];
  if (/\/(?:pre[-_]?roll|mid[-_]?roll|post[-_]?roll|vast[-_]?ad|advert(?:isement)?|commercial|ad[-_]?(?:video|clip|break)|promo[-_]?clip)(?:[-_]?\d{1,3}(?:s|sec)?)?\.(?:m3u8|mp4|webm)$/i.test(path)) return false;
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
  const seen =                 new Set();
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


function createSiteProvider(config) {
  return providerGuard(config.name, async (contentId, mediaType, season, episode) => {
    const metadata = await resolveMetadata(contentId, mediaType);
    const queries = unique(config.queries ? config.queries(metadata) : [metadata.title, metadata.originalTitle, ...metadata.titles]).slice(0, config.maxQueries || 3);
    const candidates = [];
    for (const query of queries) {
      try {
        const found = await config.search(query, mediaType, metadata);
        if (found?.length) candidates.push(...found);
        if (bestTitleMatch(candidates, metadata, mediaType, 90)) break;
      } catch (_) {
      }
    }
    const match = bestTitleMatch(candidates, metadata, mediaType, config.minimumScore || 60);
    if (!match) return [];
    return config.streams(match, { metadata, mediaType, season: season || 1, episode: episode || 1, candidates });
  });
}


function cardsFromAnchors(html, base, options = {}) {
  const seen =                 new Map();
  const output = [];
  for (const anchor of anchors(html)) {
    const url = absoluteUrl(anchor.href, base);
    if (!url || options.path && !options.path.test(url)) continue;
    const title = anchor.imageAlt || anchor.anchorTitle || anchor.title;
    if (!title || title.length > 300) continue;
    const type = /\/(?:serie|series|anime|dorama|tvshows?)(?:\/|$)/i.test(url) ? "tv" : /\/(?:pelicula|peliculas|movie|movies)(?:\/|$)/i.test(url) ? "movie" : "";
    if (options.mediaType === "movie" && type === "tv") continue;
    if (options.mediaType === "tv" && type === "movie") continue;
    const index = seen.get(url);
    if (index !== void 0) {
      if (!normalizeTitle(output[index].title) && normalizeTitle(title)) {
        output[index] = { ...output[index], title, year: output[index].year || yearOf(anchor.raw), raw: anchor.raw };
      }
      continue;
    }
    seen.set(url, output.length);
    output.push({ url, title, year: yearOf(anchor.raw), type, raw: anchor.raw });
  }
  return output;
}
function episodeLinks(html, base, season, episode) {
  const wanted = [];
  for (const anchor of anchors(html)) {
    const url = absoluteUrl(anchor.href, base);
    if (!url || !/episodio|episodes?|\/ver\/|temporada|season/i.test(url)) continue;
    const text = `${url} ${anchor.raw.replace(/<[^>]+>/g, " ")}`;
    const pair = text.match(/(?:^|\D)(\d{1,2})\s*[x×-]\s*(?:e)?(\d{1,4})(?:\D|$)/i);
    const urlPair = url.match(/(?:temporada|season)[=/](\d+)[^\d]+(?:episodio|episode|capitulo)[=/](\d+)/i);
    const s = Number(urlPair?.[1] || pair?.[1]);
    const e = Number(urlPair?.[2] || pair?.[2]);
    if (s === Number(season) && e === Number(episode)) wanted.push({ url, title: anchor.title, raw: anchor.raw });
  }
  return wanted[0] || null;
}


function decodeBase64Binary(value) {
  let input = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  while (input.length % 4) input += "=";
  return atob(input);
}
function decodeBase64(value) {
  const binary = decodeBase64Binary(value);
  if (typeof TextDecoder !== "undefined") {
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch (_) {
    }
  }
  try {
    return decodeURIComponent(binary.split("").map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
  } catch (_) {
    return binary;
  }
}
function decodeBase64Url(value) {
  try {
    const decoded = decodeBase64(value).trim();
    const match = decoded.match(/https?:\/\/[^\s<>"']+/i);
    return match ? match[0].replace(/\\\//g, "/") : "";
  } catch (_) {
    return "";
  }
}
function decodeTokenLink(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return "";
  try {
    const payload = JSON.parse(decodeBase64(parts[1]));
    return payload.link || payload.url || "";
  } catch (_) {
    return "";
  }
}


function nuploadEndpointFromHtml(html) {
  const source = String(html || "");
  if (source.length > 4e5) return "";
  const loop = /\b([a-z_$][\w$]*)\.forEach\(function\s+[a-z_$][\w$]*\(value\)\s*\{\s*([a-z_$][\w$]*)\s*\+=\s*String\.fromCharCode\(parseInt\(atob\(value\)\.replace\(\/\\D\/g\s*,\s*["']["']\)\)\s*-\s*(\d+)\)/i.exec(source);
  if (!loop) return "";
  const [, arrayName, outputName, offset] = loop;
  const quoted = (name) => name.replace(/[$]/g, "\\$&");
  const array = new RegExp(`\\b${quoted(arrayName)}\\s*=\\s*(\\[[^\\]]{1,120000}\\])`, "i").exec(source)?.[1];
  if (!array) return "";
  const inner = array.slice(1, -1);
  const values = [...inner.matchAll(/(["'])([a-zA-Z0-9+/=_-]{8,100})\1/g)];
  if (values.length < 8 || values.length > 200 || inner.replace(/(["'])[a-zA-Z0-9+/=_-]{8,100}\1/g, "").replace(/[\s,]/g, "")) return "";
  let base = "";
  try {
    for (const match of values) {
      const decoded = decodeBase64Binary(match[2]).replace(/\D/g, "");
      const code = Number(decoded) - Number(offset);
      if (!decoded || !Number.isInteger(code) || code < 32 || code > 126) return "";
      base += String.fromCharCode(code);
    }
  } catch (_) {
    return "";
  }
  if (!/^https:\/\/sv\d+\.ibra\.lat\/$/i.test(base)) return "";
  const file = /\bfile\s*:\s*([a-z_$][\w$]*)\s*\+\s*(["'])([^"']*)\2\s*\+\s*([a-z_$][\w$]*)\s*\+\s*(["'])([^"']*)\5/i.exec(source);
  if (!file || file[1] !== outputName || file[3] !== "?s=" || file[6] !== "") return "";
  const token = new RegExp(`\\b${quoted(file[4])}\\s*=\\s*(["'])([^"']{20,300})\\1`, "i").exec(source)?.[2] || "";
  if (!/^[a-zA-Z0-9%+/_=-]{20,300}$/.test(token)) return "";
  return base + "?s=" + token;
}
async function nuploadMediaRedirect(endpoint, referer, timeoutMs = 9e3) {
  if (!/^https:\/\/sv\d+\.ibra\.lat\/\?s=[a-zA-Z0-9%+/_=-]{20,300}$/i.test(endpoint)) return "";
  let timer;
  try {
    const response = await Promise.race([
      fetch(endpoint, {
        method: "GET",
        redirect: "manual",
        headers: requestHeaders(referer, { Accept: "*/*", Range: "bytes=0-4095" })
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Tiempo agotado")), timeoutMs);
      })
    ]);
    const location = [301, 302, 303, 307, 308].includes(response.status) ? response.headers?.get("location") || "" : response.status >= 200 && response.status < 300 ? response.url || "" : "";
    if (response.body?.cancel) await response.body.cancel().catch(() => {
    });
    const url = absoluteUrl(location, endpoint);
    const sourceHost = endpoint.match(/^https:\/\/([^/]+)/i)?.[1];
    const mediaHost = url.match(/^https:\/\/([^/]+)/i)?.[1];
    return mediaHost === sourceHost && isPlayableUrl(url) ? url : "";
  } catch (_) {
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}


var MOVIEMASTER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
function decodeJsString(value) {
  return String(value || "").replace(/\\(u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, (_, escape) => {
    if (escape[0].toLowerCase() === "u") return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (escape[0].toLowerCase() === "x") return String.fromCharCode(parseInt(escape.slice(1), 16));
    return { n: "\n", r: "\r", t: "	", b: "\b", f: "\f", v: "\v", "0": "\0" }[escape] ?? escape;
  });
}
function base62(value, alphabet) {
  let number = Number(value);
  if (number === 0) return alphabet[0];
  let output = "";
  while (number > 0) {
    output = alphabet[number % alphabet.length] + output;
    number = Math.floor(number / alphabet.length);
  }
  return output;
}
function unpack(source) {
  const text = String(source || "");
  const pattern = /}\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/g;
  let output = text;
  let match;
  while (match = pattern.exec(text)) {
    const payload = decodeJsString(match[1]);
    const radix = Number(match[2]);
    const dictionary = decodeJsString(match[4]).split("|");
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const tokens =                 new Map();
    for (let index = 0; index < dictionary.length; index += 1) {
      tokens.set(base62(index, alphabet.slice(0, Math.max(2, radix))), dictionary[index]);
    }
    const unpacked = payload.replace(/\b[a-zA-Z0-9]+\b/g, (token) => tokens.get(token) || token);
    output = output.replace(match[0], unpacked).replace(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/i, unpacked);
  }
  return output === text ? text : `${output}
${text}`;
}
function unpackAll(html) {
  const scripts = String(html || "").match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?(?:<\/script>|$)/gi) || [];
  return [String(html || ""), ...scripts.map(unpack)].join("\n");
}
function cleanMediaUrl(value, base) {
  const url = absoluteUrl(decodeHtml(value).replace(/\\u0026/gi, "&"), base);
  return isPlayableUrl(url) ? url : "";
}
var AD_LABEL = /(?:^|[\s_-])(?:ad(?:s|frame|slot|video|player|container)?|advert(?:isement|ising)?|anuncio|publicidad|banner|vast|(?:pre|mid|post)[-_]?roll|promo|tr[aá]iler)(?=$|[\s_-])/i;
function adLabeledTag(tag) {
  const attrs = attributes(tag);
  const label = [attrs.id, attrs.class, attrs.title, attrs["aria-label"], attrs["data-role"]].join(" ");
  return AD_LABEL.test(label);
}
function withoutAdContexts(html) {
  let text = unpackAll(html);
  text = text.replace(/<(script|video|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (block) => adLabeledTag(block.slice(0, block.indexOf(">") + 1)) ? " ".repeat(block.length) : block);
  text = text.replace(/<(?:iframe|video|source)\b[^>]*>/gi, (tag) => adLabeledTag(tag) ? " ".repeat(tag.length) : tag);
  const spans = [];
  const adKey = /\b(?:ads?|advertising|advertisement|anuncio|publicidad|ad(?:Tag|Src|Url|Video|Config|Schedule)(?:Url)?|vast(?:Url)?|(?:pre|mid|post)[-_]?roll(?:Url)?|promo(?:Url)?|trailer(?:Url)?)\b["']?\s*[:=]\s*([\[{"'])/gi;
  for (const match of text.matchAll(adKey)) {
    const start = match.index + match[0].length - 1;
    const open = text[start];
    if (open === "{" || open === "[") {
      const block = extractBalanced(text.slice(start), "", open, open === "{" ? "}" : "]");
      if (block) spans.push([match.index, start + block.length]);
    } else {
      let end = start + 1;
      for (; end < text.length; end += 1) {
        if (text[end] === "\\") {
          end += 1;
          continue;
        }
        if (text[end] === open) break;
      }
      if (end < text.length) spans.push([match.index, end + 1]);
    }
  }
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
  }
  return text;
}
function directMediaInHtml(html, base) {
  const text = withoutAdContexts(html);
  const declared = [];
  const sourcePattern = /\b(?:file|src|source|hls[1-4]?|wurl)\s*[:=]\s*["']([^"']+)["']/gi;
  const addSources = (source, pattern, output2) => {
    for (const match of source.matchAll(pattern)) {
      const raw = match[1].replace(/\\\//g, "/");
      const url = cleanMediaUrl(raw.startsWith("//") ? `https:${raw}` : raw, base);
      if (url) output2.push(url);
    }
  };
  const setup = /\b(?:player\s*\.setup|jwplayer(?:\([^)]{0,300}\))?\s*\.setup|new\s+(?:Playerjs|Clappr\.Player))\s*\(\s*\{/gi;
  for (const match of text.matchAll(setup)) {
    const block = extractBalanced(text.slice(match.index + match[0].length - 1), "", "{", "}");
    if (block) addSources(block, sourcePattern, declared);
  }
  addSources(text, /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, declared);
  if (declared.length) return unique(declared);
  if (/<iframe\b[^>]*\b(?:src|data-src)\s*=/i.test(text)) return [];
  const weak = [];
  addSources(text, sourcePattern, weak);
  if (weak.length) return unique(weak);
  const output = [];
  const patterns = [
    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?(?![\w.-])/gi,
    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?(?![\w.-])/gi,
    /["']([^"']*?\/m3u8\/[a-zA-Z0-9_-]+[^"']*)["']/g,
    /\bwurl\b[\s\S]{0,80}?["']([^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] || match[0]).replace(/\\\//g, "/");
      const url = cleanMediaUrl(raw.startsWith("//") ? `https:${raw}` : raw, base);
      if (url) output.push(url);
    }
  }
  return unique(output);
}
function subtitlesInHtml(html, base) {
  const subtitles = [];
  const regex = /(?:file|src)\s*:\s*["']([^"']+\.(?:vtt|srt)(?:\?[^"']*)?)["'][\s\S]{0,160}?(?:label|kind|language)\s*:\s*["']([^"']+)["']/gi;
  let match;
  while (match = regex.exec(unpackAll(html))) {
    subtitles.push({ url: absoluteUrl(match[1], base), language: match[2], name: match[2] });
  }
  return subtitles;
}
var PACKED_CAPTION_HOSTS =                 new Set(["luluvdo.com", "luluvdoo.com", "luluvid.com", "lulust.com", "dropload.tv", "dropload.io", "dropload.pro", "dr0pstream.com"]);
function packedCaptionHost(url) {
  const host = String(url || "").match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || "";
  return PACKED_CAPTION_HOSTS.has(host);
}
function packedCaptions(html, base) {
  const source = withoutAdContexts(html);
  const result = [];
  for (const match of source.matchAll(/\btracks\s*:\s*\[/gi)) {
    const raw = extractBalanced(source.slice(match.index + match[0].length - 1), "", "[", "]");
    if (!raw || raw.length > 1e5) continue;
    for (const entry of raw.matchAll(/\{[^{}]{0,2000}\}/g)) {
      const file = entry[0].match(/\b(?:file|src)\s*:\s*["']([^"']+)["']/i)?.[1];
      const label = entry[0].match(/\b(?:label|language|srclang)\s*:\s*["']([^"']+)["']/i)?.[1];
      const kind = entry[0].match(/\bkind\s*:\s*["']([^"']+)["']/i)?.[1];
      if (!file || !label || /upload captions/i.test(label) || kind && !/^(?:captions|subtitles)$/i.test(kind)) continue;
      const url = absoluteUrl(file, base);
      if (!/^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(url) || !/\.(?:vtt|srt)(?:$|[?#])/i.test(url)) continue;
      result.push({ url, language: label, name: label });
    }
  }
  return unique(result, (item) => item.url).slice(0, 20);
}
function streamtapeUrl(html, base) {
  const match = String(html || "").match(/document\.getElementById\(['"](?:bot|robot)link['"]\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('([^']+)'\)\.substring\((\d+)\)/i);
  if (!match) return "";
  const path = `${match[1]}${match[2].substring(Number(match[3]))}`.replace(/&amp;/g, "&");
  return absoluteUrl(path.startsWith("http") ? path : `https:${path.startsWith("//") ? path : `//streamtape.com/${path.replace(/^\/+/, "")}`}`, base);
}
function mixdropUrl(html, base) {
  const match = withoutAdContexts(html).match(/\bwurl\b[\s\S]{0,120}?=\s*["']([^"']+)["']/i);
  if (!match) return "";
  const value = match[1];
  return cleanMediaUrl(value.startsWith("//") ? `https:${value}` : value.startsWith("http") ? value : `https://${value}`, base);
}
var MIXDROP_HOSTS =                 new Set(["mixdrop.co", "mixdrop.bz", "mixdrop.ag", "mixdrop.ch", "mixdrop.to", "mixdrop.cv", "mxdrop.to", "mixdrop.club", "m1xdrop.net", "miiixdrop.net", "miixdrop.net", "mxdrop.click", "mixdrop.vip", "mixdrop.si"]);
function mixdropHost(url) {
  const host = String(url || "").match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || "";
  return MIXDROP_HOSTS.has(host) || /^md[3bfyz][a-z0-9]*\.[a-z0-9]+$/i.test(host);
}
function normalizeMixdrop(url) {
  if (!mixdropHost(url)) return url;
  return url.replace(/^(https?:\/\/)(mixdrop\.(?:vip|si))(?=\/)/i, "$1mxdrop.click").replace(/^(https?:\/\/mixdrop\.club)(?=\/)/i, "https://mixdrop.ag").replace(/^(https?:\/\/[^/]+)\/(?:emb|f)\//i, "$1/e/");
}
function lamovieData(html, base) {
  if (!/^https?:\/\/(?:lamovie\.link|vimeos\.net)(?:[/:?#]|$)/i.test(base)) return null;
  const source = withoutAdContexts(html);
  function array(name) {
    const match = new RegExp(`(?:["']${name}["']|\\b${name})\\s*:\\s*\\[`, "i").exec(source);
    if (!match) return [];
    const raw = extractBalanced(source.slice(match.index + match[0].length - 1), "", "[", "]");
    if (!raw || raw.length > 1e5) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  const urls = array("stream_urls").filter((value) => typeof value === "string").slice(0, 10).map((value) => cleanMediaUrl(value, base)).filter(Boolean);
  const subtitles = array("default_subs").filter((sub) => sub && typeof sub.url === "string").slice(0, 20).map((sub) => ({ url: absoluteUrl(sub.url, base), language: String(sub.lang || sub.code || "und").slice(0, 40) })).filter((sub) => /^https?:\/\//i.test(sub.url) && /\.(?:vtt|srt)(?:$|[?#])/i.test(sub.url));
  return { urls, subtitles };
}
function rot13(value) {
  return value.replace(/[a-z]/gi, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode((char.charCodeAt(0) - base + 13) % 26 + base);
  });
}
function decodeVoeConfig(encoded) {
  try {
    let value = rot13(encoded);
    for (const pattern of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) value = value.split(pattern).join("_");
    value = value.replace(/_/g, "");
    const binary = decodeBase64Binary(value);
    const shifted = Array.from(binary, (char) => String.fromCharCode(char.charCodeAt(0) - 3)).reverse().join("");
    const config = JSON.parse(decodeBase64(shifted));
    return config && typeof config === "object" ? config : null;
  } catch (_) {
    return null;
  }
}
function voeConfig(html) {
  const text = String(html || "");
  const scripts = text.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    const raw = script[1].trim();
    let encoded = "";
    try {
      const wrapper = JSON.parse(raw);
      if (Array.isArray(wrapper) && typeof wrapper[0] === "string") encoded = wrapper[0];
    } catch (_) {
    }
    if (!encoded) encoded = raw.match(/^\[\s*"([^"]+)"\s*\]$/)?.[1] || "";
    const config = encoded ? decodeVoeConfig(encoded) : null;
    if (!config) continue;
    if (isPlayableUrl(config.source)) return { ...config, urls: [config.source] };
    const fallback = (Array.isArray(config.fallback) ? config.fallback : []).map((item) => item?.file).filter((url) => isPlayableUrl(url));
    if (fallback.length) return { ...config, urls: unique(fallback) };
  }
  return null;
}
function voeSubtitles(config, html, pageUrl) {
  if (!config || !Array.isArray(config.captions)) return [];
  const base = String(html || "").match(/\bvar\s+base\s*=\s*["']([^"']+)["']/i)?.[1] || pageUrl;
  const subtitleBase = absoluteUrl(base, pageUrl);
  if (!/^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(subtitleBase)) return [];
  return unique(config.captions.slice(0, 20).filter((item) => item && typeof item.file === "string").map((item) => ({
    url: absoluteUrl(item.file, subtitleBase),
    language: String(item.label || item.language || "und").slice(0, 40)
  })).filter((item) => /^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(item.url) && /\.(?:vtt|srt)(?:$|[?#])/i.test(item.url)), (item) => item.url);
}
function voeUrls(html, allowLegacy = true) {
  const text = String(html || "");
  const config = voeConfig(text);
  if (config) return config.urls;
  if (!allowLegacy) return [];
  const output = [];
  const candidates = [...withoutAdContexts(text).matchAll(/(?:source|hls|file)\s*[:=]\s*["']([^"']+)["']/gi)];
  for (const match of candidates) {
    if (/\.m3u8/i.test(match[1]) && isPlayableUrl(match[1])) output.push(match[1]);
    else if (/^[a-zA-Z0-9+/=_-]{40,}$/.test(match[1])) {
      const decoded = decodeBase64Url(match[1]);
      if (decoded.includes(".m3u8") && isPlayableUrl(decoded)) output.push(decoded);
    }
  }
  return unique(output);
}
var VOE_ALIASES =                 new Set(["jilliandescribecompany.com", "mikaylaarealike.com", "christopheruntilpoint.com", "walterprettytheir.com", "crystaltreatmenteast.com", "lauradaydo.com", "lancewhosedifficult.com", "dianaavoidthey.com", "jefferycontrolmodel.com", "charlestoughrace.com", "richardquestionbuilding.com", "jessicayeahcatch.com", "juliewomanwish.com", "rebeccapracticeloss.com", "johnbeyondnation.com", "jamesbornmain.com"]);
function isVoeUrl(url) {
  const host = String(url || "").match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || "";
  return /^(?:[^.]+\.)?voe\.[a-z0-9-]+$/i.test(host) || VOE_ALIASES.has(host);
}
function jkplayerSource(html, pageUrl) {
  if (!/^https:\/\/jkanime\.net\/jkplayer\/(?:[^?#]*)?(?:[?#]|$)/i.test(pageUrl)) return "";
  const text = withoutAdContexts(html);
  const encoded = text.match(/\burl\s*:\s*atob\(\s*["']([A-Za-z0-9+/_=-]+)["']\s*\)/i)?.[1];
  let value = "";
  if (encoded) {
    try {
      value = decodeBase64(encoded).trim().replace(/\\\//g, "/");
    } catch (_) {
      value = "";
    }
  }
  if (!value) value = text.match(/(?:\burl\s*:\s*|\bloadSource\(\s*)["'](https?:\/\/[^"']+)["']/i)?.[1] || "";
  if (!/^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(value) || !/\.m3u8(?:$|[?#])/i.test(value)) return "";
  return cleanMediaUrl(value, pageUrl);
}
function dataLinkCandidates(html, base) {
  const output = [];
  const raw = extractBalanced(html, "dataLink", "[", "]");
  if (raw) {
    try {
      const items = JSON.parse(raw);
      for (const item of items) {
        const language = item.video_language || item.language || item.lang || "es";
        const embeds = item.sortedEmbeds || item.sorted_embeds || item.embeds || [];
        for (const embed of embeds) {
          const label = embed.servername || embed.server || hostName(embed.link || "");
          if (/download|1fichier/i.test(label) || AD_LABEL.test(label)) continue;
          const link = decodeTokenLink(embed.link) || (/^https?:\/\//i.test(embed.link || "") ? embed.link : "");
          if (link) output.push({ url: absoluteUrl(link, base), language, server: label });
        }
      }
    } catch (_) {
    }
  }
  const onclick = /go_to_playerVast\(\s*['"]([^'"]+)['"]/gi;
  let match;
  while (match = onclick.exec(String(html || ""))) {
    const url = absoluteUrl(match[1], base);
    if (url) output.push({ url, language: "es" });
  }
  return output;
}
function protectedDataLinkCandidates(html, base) {
  const plain = dataLinkCandidates(html, base);
  const challenge = String(html || "").match(/(?:const|let|var)\s+POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  const difficulty = Number(String(html || "").match(/(?:const|let|var)\s+POW_DIFFICULTY\s*=\s*(\d+)/i)?.[1]);
  const salt = String(html || "").match(/(?:const|let|var)\s+POW_SALT\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (!challenge || !difficulty || difficulty > 6 || salt === void 0) return plain;
  try {
    const CryptoJS = require("crypto-js");
    const prefix = "0".repeat(difficulty);
    let key;
    for (let nonce = 0; nonce < 2e6; nonce += 1) {
      if (CryptoJS.SHA256(challenge + nonce).toString().startsWith(prefix)) {
        key = CryptoJS.SHA256(challenge + nonce + salt);
        break;
      }
    }
    if (!key) return plain;
    const raw = extractBalanced(html, "dataLink", "[", "]");
    const items = raw ? JSON.parse(raw) : [];
    const output = [...plain];
    for (const item of items) {
      for (const embed of item.sortedEmbeds || []) {
        if (/download|1fichier/i.test(embed.servername || "") || AD_LABEL.test(embed.servername || "") || String(embed.link || "").split(".").length === 3) continue;
        const decoded = CryptoJS.enc.Base64.parse(embed.link);
        const iv = CryptoJS.lib.WordArray.create(decoded.words.slice(0, 4), 16);
        const ciphertext = CryptoJS.lib.WordArray.create(decoded.words.slice(4), Math.max(0, decoded.sigBytes - 16));
        const url = CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext }), key, { iv }).toString(CryptoJS.enc.Utf8);
        if (/^https?:\/\//i.test(url)) output.push({ url: absoluteUrl(url, base), language: item.video_language || "es", server: embed.servername });
      }
    }
    return output;
  } catch (_) {
    return plain;
  }
}
async function resolveMovieMaster(candidate) {
  if (!/moviemaster\.[^/]+\/video\?/i.test(candidate.url)) return null;
  const referer = candidate.referer || "https://api.moviemaster.lat/";
  const response = await fetchJson(candidate.url, { referer, extraHeaders: { "User-Agent": MOVIEMASTER_USER_AGENT } });
  const url = response.data.url || response.data.source || "";
  return isPlayableUrl(url) ? [{ ...candidate, url, headers: { "User-Agent": MOVIEMASTER_USER_AGENT, Referer: referer } }] : [];
}
function maxstreamCastvUrl(embedUrl) {
  const match = String(embedUrl || "").match(/^https:\/\/(?:www\.)?maxstream\.video\/(?!castv(?:\/|$))[a-z0-9_-]+\/([a-z0-9_-]{4,128})(?:[/?#]|$)/i);
  return match ? `${origin(embedUrl)}/castv/${match[1]}` : "";
}
async function maxstreamCastv(candidate, context) {
  const castvUrl = maxstreamCastvUrl(candidate.url);
  if (!castvUrl) return [];
  try {
    const response = await fetchText(castvUrl, { referer: candidate.url, timeoutMs: context.timeoutMs || 1e4 });
    const script = response.text.match(/<script\b(?=[^>]*\bid\s*=\s*["']m3u8["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    const url = decodeHtml(script || "").trim().split("#")[0].trim();
    if (!/^https:\/\//i.test(url) || !/\.m3u8(?:\?|$)/i.test(url) || !isPlayableUrl(url)) return [];
    return [{ ...candidate, url, referer: response.url || castvUrl }];
  } catch (_) {
    return [];
  }
}
function zilla(candidate) {
  if (/^https:\/\/player\.zilla-networks\.com\/m3u8\//i.test(candidate.url)) return null;
  const match = candidate.url.match(/^https:\/\/player\.zilla-networks\.com\/(?:[a-zA-Z0-9_-]+\/){0,3}([a-zA-Z0-9_-]{4,128})\/?(?:[?#]|$)/i);
  if (!match) return null;
  return [{
    ...candidate,
    url: `https://player.zilla-networks.com/m3u8/${match[1]}`,
    referer: candidate.url,
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0",
      Accept: "*/*",
      "Accept-Language": "es-MX,es-ES;q=0.9,es;q=0.8,en-US;q=0.7,en;q=0.6",
      Referer: candidate.url,
      Origin: "https://player.zilla-networks.com",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin"
    }
  }];
}
async function resolveUqload(candidate, context) {
  const match = String(candidate.url || "").match(/^(https:\/\/(?:uqload\.cx|uqload\.is|uqload\.vc))\/(?:e\/)?([a-z0-9_-]{1,128})\/?(?:[?#].*)?$/i);
  if (!match || /^embed-/i.test(match[2])) return null;
  const base = match[1];
  const referer = candidate.referer || `${base}/`;
  const body = `op=embed&file_code=${encodeURIComponent(match[2])}&auto=1&referer=${encodeURIComponent(referer)}`;
  try {
    const response = await fetchText(`${base}/dl`, {
      method: "POST",
      body,
      referer,
      redirect: "manual",
      timeoutMs: context.timeoutMs || 1e4,
      extraHeaders: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
    });
    if (!/eval\(function\(p,a,c,k,e,d\)/i.test(response.text)) return [];
    const unpacked = unpackAll(response.text);
    const matchFile = withoutAdContexts(unpacked).match(/\bfile\s*:\s*["']([^"']+)["']/i);
    const url = matchFile ? cleanMediaUrl(matchFile[1], base) : "";
    if (!url) return [];
    return [{ ...candidate, url, headers: { "User-Agent": USER_AGENT, Referer: base } }];
  } catch (_) {
    return [];
  }
}
var GOODSTREAM_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var VIDMOLY_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
function hosterProfile(url) {
  const host = String(url || "").match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || "";
  if (host === "goodstream.one") return { id: "goodstream", headers: { "User-Agent": GOODSTREAM_AGENT, "Accept-Language": "en-US,en;q=0.9", Referer: "https://goodstream.one" } };
  if (["vidmoly.me", "vidmoly.to", "vidmoly.net", "vidmoly.org"].includes(host)) {
    return { id: "vidmoly", headers: { "User-Agent": VIDMOLY_AGENT, Referer: "https://vidmoly.to/" } };
  }
  return null;
}
async function resolveOne(candidate, context, depth) {
  candidate = { ...candidate, url: normalizeMixdrop(candidate.url).replace(/^(https?:\/\/)vidmoly\.me(?=\/)/i, "$1vidmoly.to") };
  const profile = hosterProfile(candidate.url);
  if (/u\.pcloud\.link\/publink\/show/i.test(candidate.url)) {
    const code = candidate.url.match(/[?&]code=([^&]+)/i)?.[1];
    if (code) {
      const response2 = await fetchJson(`https://api.pcloud.com/getpublinkdownload?code=${encodeURIComponent(code)}`, { referer: candidate.url });
      const host = response2.data.hosts?.[0];
      const path = response2.data.path;
      if (host && path && isPlayableUrl(`https://${host}${path}`)) return [{ ...candidate, url: `https://${host}${path}` }];
    }
  }
  const directZilla = zilla(candidate);
  if (directZilla) return directZilla;
  if (isPlayableUrl(candidate.url)) return [candidate];
  const movieMaster = await resolveMovieMaster(candidate);
  if (movieMaster) return movieMaster;
  if (depth > 2) return [];
  const uqload = await resolveUqload(candidate, context);
  if (uqload) return uqload;
  let response;
  try {
    response = await fetchText(candidate.url, {
      referer: /^https:\/\/jkanime\.net\/jkplayer\//i.test(candidate.url) ? "https://jkanime.net/" : profile?.id === "vidmoly" ? profile.headers.Referer : candidate.referer || context.referer,
      extraHeaders: profile ? { "User-Agent": profile.headers["User-Agent"], ...profile.id === "goodstream" ? { "Accept-Language": profile.headers["Accept-Language"] } : {} } : {},
      timeoutMs: context.timeoutMs || 1e4
    });
  } catch (error) {
    if (error.response?.status === 404 && maxstreamCastvUrl(candidate.url)) return maxstreamCastv(candidate, context);
    throw error;
  }
  const html = response.text;
  const pageUrl = response.url || candidate.url;
  if (profile && hosterProfile(pageUrl)?.id !== profile.id) return [];
  const isVoe = isVoeUrl(pageUrl);
  const voe = voeUrls(html, isVoe);
  const config = isVoe ? voeConfig(html) : null;
  const jkplayer = jkplayerSource(html, pageUrl);
  if (jkplayer) return [{ ...candidate, url: jkplayer, referer: "https://jkanime.net/", headers: { "User-Agent": USER_AGENT, Origin: "https://jkanime.net", Referer: "https://jkanime.net/" } }];
  const lamovie = lamovieData(html, pageUrl);
  const direct = unique(voe.length ? voe : lamovie?.urls.length ? lamovie.urls : [
    ...directMediaInHtml(html, pageUrl),
    /^https?:\/\/(?:[^/]+\.)?streamtape\.[^/]+\//i.test(pageUrl) ? streamtapeUrl(html, pageUrl) : "",
    mixdropHost(pageUrl) ? mixdropUrl(html, pageUrl) : ""
  ].filter(Boolean));
  if (direct.length) return direct.map((url) => ({ ...candidate, url, referer: pageUrl, ...profile ? { headers: profile.headers } : {}, subtitles: unique([...lamovie?.subtitles || [], ...voeSubtitles(config, html, pageUrl), ...packedCaptionHost(pageUrl) ? packedCaptions(html, pageUrl) : subtitlesInHtml(html, pageUrl)], (sub) => sub.url) }));
  if (maxstreamCastvUrl(candidate.url)) {
    const fallback = await maxstreamCastv(candidate, context);
    if (fallback.length) return fallback;
  }
  if (/^https:\/\/nupload\.(?:my|me)\/watch\/[^/?#]+/i.test(pageUrl)) {
    const endpoint = nuploadEndpointFromHtml(html);
    if (endpoint) {
      const url = await nuploadMediaRedirect(endpoint, pageUrl);
      if (url) return [{ ...candidate, url, referer: pageUrl }];
    }
  }
  const pass = html.match(/(?:\$\.get|fetch)\(\s*["'](\/pass_md5\/[^"']+)["']/i);
  if (pass) {
    const token = await fetchText(absoluteUrl(pass[1], pageUrl), { referer: pageUrl });
    const tokenText = token.text.trim();
    const directUrl = html.match(/\/pass_md5\/[^"']+[\s\S]{0,500}?["'](https?:\/\/[^"']+)["']/i)?.[1];
    if (directUrl && tokenText) return [{ ...candidate, url: `${directUrl}${tokenText}`, referer: pageUrl }];
  }
  const nestedServers = protectedDataLinkCandidates(html, pageUrl);
  if (nestedServers.length && depth < 2) {
    const nested2 = await resolveCandidates(nestedServers, { ...context, referer: pageUrl }, depth + 1);
    if (nested2.length) return nested2.map((item) => ({ ...item, language: item.language || candidate.language }));
  }
  const nested = embedCandidatesFromHtml(html, pageUrl, { ...candidate, referer: pageUrl }).map((item) => ({ ...candidate, ...item, referer: pageUrl })).filter((item) => item.url && item.url !== candidate.url);
  const redirect = html.match(/var\s+url\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1] || html.match(/window\.location\.replace\(["'](https?:\/\/[^"']+)["']\)/i)?.[1] || html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1] || (/window\.onload/i.test(html) ? html.match(/["'](https?:\/\/[^"']+)["']/i)?.[1] : "");
  const redirectUrl = absoluteUrl(redirect || "", pageUrl);
  if (redirectUrl && redirectUrl !== candidate.url) nested.push({ ...candidate, url: redirectUrl, referer: pageUrl });
  const nextCandidates = unique(nested, (item) => item.url).slice(0, context.maxNestedCandidates || 4);
  if (nextCandidates.length && depth < 2) {
    const resolved = await mapLimit(nextCandidates, context.parallel || 3, (item) => resolveOne(item, context, depth + 1));
    return resolved.flat();
  }
  return [];
}
async function resolveCandidates(candidates, context = {}, depth = 0) {
  const list = (candidates || []).filter((candidate) => candidate && /^https?:\/\//i.test(candidate.url || "")).slice(0, context.maxCandidates || 10);
  if (depth > 2) return [];
  const resolved = await mapLimit(list, context.parallel || 3, async (candidate) => {
    const items = await resolveOne({ ...candidate, referer: candidate.referer || context.referer }, context, depth);
    return (items || []).map((item) => makeStream(context.provider || "Streamflix", item.url, {
      ...item,
      providerId: context.providerId,
      defaultLanguage: item.language || candidate.language || "es",
      title: item.title || `${item.server || candidate.server || hostName(item.url)} \xB7 ${item.language || candidate.language || "Espa\xF1ol"}`,
      referer: item.referer || candidate.referer || context.referer,
      headers: item.headers || { "User-Agent": USER_AGENT, Referer: item.referer || candidate.referer || context.referer || origin(item.url) + "/" }
    })).filter(Boolean);
  });
  return resolved.flat().filter(Boolean);
}
var SUPPORTED_EMBED_HOST = /streamwish|voe\.|filemoon|vidhide|mp4upload|streamtape|dood|yourupload|uqload|ok\.ru|vimeos?|zilla|vk\.com|mail\.ru|dropload|unlimplay|earnvids|streamhg|videoapp/i;
var VIDHIDE_ALIASES = /(?:^|\.)(?:minochinos\.com|moflix-stream\.click|filelions\.to|dhtpre\.com|peytonepre\.com|dingtezuni\.com|dintezuvio\.com|morencius\.com)$/i;
function isSupportedEmbedUrl(url) {
  const host = String(url || "").match(/^https?:\/\/([^/:?#]+)/i)?.[1] || "";
  return SUPPORTED_EMBED_HOST.test(host) || hosterProfile(url) || packedCaptionHost(url) || isVoeUrl(url) || mixdropHost(url) || /^(?:lamovie\.link|byselapuix\.com)$/i.test(host) || VIDHIDE_ALIASES.test(host) || /(?:^|\.)maxstream\.video$/i.test(host);
}
function embedCandidatesFromHtml(html, base, defaults = {}) {
  const source = String(html || "");
  const output = dataLinkCandidates(source, base);
  for (const match of source.matchAll(/<iframe\b[^>]*>/gi)) {
    if (adLabeledTag(match[0])) continue;
    const attrs = attributes(match[0]);
    const raw = attrs.src || attrs["data-src"] || attrs["data-lazy-src"] || attrs["data-embed"] || attrs["data-url"];
    const url = absoluteUrl(raw || "", base);
    if (url) output.push({ ...defaults, url });
  }
  for (const anchor of anchors(source)) {
    if (adLabeledTag(anchor.raw.slice(0, anchor.raw.indexOf(">") + 1))) continue;
    const url = absoluteUrl(anchor.href, base);
    if (!url || !isSupportedEmbedUrl(url)) continue;
    output.push({ ...defaults, url, title: anchor.title || defaults.title });
  }
  for (const match of source.matchAll(/<(?:a|button|div|li)\b[^>]*>/gi)) {
    if (adLabeledTag(match[0])) continue;
    const attrs = attributes(match[0]);
    const raw = attrs["data-server-url"] || attrs["data-embed"] || attrs["data-src"] || attrs["data-link"] || attrs["data-url"];
    const url = absoluteUrl(raw || "", base);
    if (!url || !isPlayableUrl(url) && !isSupportedEmbedUrl(url)) continue;
    output.push({ ...defaults, url, title: attrs.title || attrs["data-server"] || defaults.title });
  }
  return unique(output, (item) => item.url);
}


var BASE = "https://seriesflixhd.lol";
async function search(query) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType: "tv", path: /\/serie\//i });
}
function seasonLink(html, base, season) {
  const links = anchors(html).filter((anchor) => /\/temporada(?:\/|-)/i.test(anchor.href));
  if (!links.length) return { url: base, hasSeasonPages: false };
  const match = links.find((anchor) => {
    const fromText = anchor.raw.replace(/<[^>]+>/g, " ").match(/temporada\s*(\d+)/i)?.[1];
    const fromUrl = anchor.href.match(/-(\d+)\/?(?:[?#].*)?$/i)?.[1];
    return Number(fromText || fromUrl) === Number(season);
  });
  return { url: match ? absoluteUrl(match.href, base) : "", hasSeasonPages: true };
}
function findEpisode(html, base, season, episode) {
  const paired = episodeLinks(html, base, season, episode);
  if (paired) return paired.url;
  const rows = String(html || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const href = row.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || !/\/episodio\//i.test(href)) continue;
    const pair = row.match(/(\d+)\s*[x×-]\s*(\d+)/i);
    const number = row.match(/class\s*=\s*["'][^"']*Num[^"']*["'][^>]*>\s*(\d+)/i)?.[1] || row.match(/(?:episodio|cap[ií]tulo)\s*(\d+)/i)?.[1];
    if (pair && Number(pair[1]) === Number(season) && Number(pair[2]) === Number(episode) || !pair && Number(number) === Number(episode)) return absoluteUrl(href, base);
  }
  return "";
}
function unwrapServerUrl(value) {
  const decoded = decodeHtml(value);
  const inner = decoded.match(/[?&]url=([^&]+)/i)?.[1];
  if (!inner) return decoded;
  try {
    const url = decodeURIComponent(inner);
    return /^https?:\/\//i.test(url) ? url : decoded;
  } catch (_) {
    return decoded;
  }
}
function serverCandidates(html, base) {
  const groups = String(html || "").split(/<div\b(?=[^>]*class\s*=\s*["'][^"']*drpdn)[^>]*>/i).slice(1);
  const candidates = [];
  for (const group of groups.length ? groups : [String(html || "")]) {
    const language = stripTags(group.match(/<button\b(?=[^>]*class\s*=\s*["'][^"']*bstd)[^>]*>([\s\S]*?)<\/button>/i)?.[1] || "") || "es";
    const tags2 = group.match(/<(?:a|button|li)\b[^>]*data-url\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    tags2.forEach((tag, index) => {
      const decoded = decodeBase64Url(attribute(tag, "data-url"));
      if (!decoded) return;
      const url = absoluteUrl(unwrapServerUrl(decoded), base);
      if (!url) return;
      candidates.push({ url, language, server: `${hostName(url)} ${index + 1}`, referer: base });
    });
  }
  return unique(candidates, (item) => item.url);
}
async function streams(match, media) {
  const show = await fetchText(match.url, { referer: `${BASE}/` });
  const season = seasonLink(show.text, show.url, media.season);
  if (!season.url) return [];
  const seasonPage = season.hasSeasonPages ? await fetchText(season.url, { referer: show.url }) : show;
  const episodeUrl = findEpisode(seasonPage.text, seasonPage.url, media.season, media.episode);
  if (!episodeUrl) return [];
  const page = await fetchText(episodeUrl, { referer: seasonPage.url });
  return resolveCandidates(serverCandidates(page.text, page.url), {
    provider: "SeriesFlix",
    providerId: "seriesflix",
    referer: page.url
  });
}
module.exports = { getStreams: createSiteProvider({ name: "SeriesFlix", search, streams }) };
