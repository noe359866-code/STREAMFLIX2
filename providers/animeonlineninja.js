/* animeonlineninja · STREAMFLIX2 · Apache-2.0 · Generado con npm run build */

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
  let url = decodeHtml(value).trim().replace(/&amp;/g, "&");
  if (!url || /^(about:|javascript:|data:|#)/i.test(url)) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  const originMatch = String(base || "").match(/^(https?:\/\/[^/]+)/i);
  if (!originMatch) return url;
  if (url.startsWith("/")) return originMatch[1] + url;
  const directory = String(base || "").split("?")[0].replace(/\/[^/]*$/, "/");
  return directory + url;
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
function tags(html, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(html || "").match(new RegExp(`<${escaped}\\b[^>]*>`, "gi")) || [];
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
  const seen = /* @__PURE__ */ new Set();
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

// src/core/tmdb.js
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
  if (/\b(lat|latino|dub|doblaje|es-mx|es-la)\b/.test(text)) return "es-LAT";
  if (/\b(cast|castellano|esp|spanish|es-es)\b/.test(text)) return "es-ES";
  if (/\b(sub|subtitulado|vose|sub espanol)\b/.test(text)) return "es-SUB";
  if (/\b(eng|english|en)\b/.test(text)) return "en";
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
      return finalizeStreams(streams2 || []);
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

// src/core/html.js
function cardsFromAnchors(html, base, options = {}) {
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const anchor of anchors(html)) {
    const url = absoluteUrl(anchor.href, base);
    if (!url || options.path && !options.path.test(url) || seen.has(url)) continue;
    const title = anchor.imageAlt || anchor.anchorTitle || anchor.title;
    if (!title || title.length > 300) continue;
    const type = /\/(?:serie|series|anime|dorama|tvshows?)(?:\/|$)/i.test(url) ? "tv" : /\/(?:pelicula|peliculas|movie|movies)(?:\/|$)/i.test(url) ? "movie" : "";
    if (options.mediaType === "movie" && type === "tv") continue;
    if (options.mediaType === "tv" && type === "movie") continue;
    seen.add(url);
    output.push({ url, title, year: yearOf(anchor.raw), type, raw: anchor.raw });
  }
  return output;
}
function playerOptions(html, base) {
  return tags(html, "li").map((tag) => {
    const attrs = attributes(tag);
    const nume = attrs["data-nume"];
    const post = attrs["data-post"];
    const type = attrs["data-type"];
    const option = attrs["data-option"];
    const server = attrs["data-server"] || attrs["data-src"] || attrs["data-url"];
    const url = absoluteUrl(option || "", base);
    if (!nume && !url && !server) return null;
    return {
      number: Number(nume) || 1,
      postId: post || "",
      type: type || "movie",
      url,
      server,
      raw: tag
    };
  }).filter(Boolean);
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

// src/core/base64.js
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

// src/core/extractors.js
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
    const tokens = /* @__PURE__ */ new Map();
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
function directMediaInHtml(html, base) {
  const text = unpackAll(html);
  const output = [];
  const patterns = [
    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?/gi,
    /(?:file|src|source|url|hls[1-4]?)\s*[:=]\s*["']([^"']+?\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi,
    /["']([^"']*?\/m3u8\/[a-zA-Z0-9_-]+[^"']*)["']/g,
    /\bwurl\b[\s\S]{0,80}?["']([^"']+)["']/gi,
    /file\s*:\s*["']([^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    let match;
    while (match = pattern.exec(text)) {
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
function streamtapeUrl(html, base) {
  const match = String(html || "").match(/document\.getElementById\(['"](?:bot|robot)link['"]\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('([^']+)'\)\.substring\((\d+)\)/i);
  if (!match) return "";
  const path = `${match[1]}${match[2].substring(Number(match[3]))}`.replace(/&amp;/g, "&");
  return absoluteUrl(path.startsWith("http") ? path : `https:${path.startsWith("//") ? path : `//streamtape.com/${path.replace(/^\/+/, "")}`}`, base);
}
function mixdropUrl(html, base) {
  const match = unpackAll(html).match(/\bwurl\b[\s\S]{0,120}?=\s*["']([^"']+)["']/i);
  if (!match) return "";
  const value = match[1];
  return cleanMediaUrl(value.startsWith("//") ? `https:${value}` : value.startsWith("http") ? value : `https://${value}`, base);
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
function voeUrls(html) {
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
    if (isPlayableUrl(config.source)) return [config.source];
    const fallback = (Array.isArray(config.fallback) ? config.fallback : []).map((item) => item?.file).filter((url) => isPlayableUrl(url));
    if (fallback.length) return unique(fallback);
  }
  const output = [];
  const candidates = [...text.matchAll(/(?:source|hls|file)\s*[:=]\s*["']([^"']+)["']/gi)];
  for (const match of candidates) {
    if (/\.m3u8/i.test(match[1]) && isPlayableUrl(match[1])) output.push(match[1]);
    else if (/^[a-zA-Z0-9+/=_-]{40,}$/.test(match[1])) {
      const decoded = decodeBase64Url(match[1]);
      if (decoded.includes(".m3u8") && isPlayableUrl(decoded)) output.push(decoded);
    }
  }
  return unique(output);
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
          if (/download|1fichier/i.test(label)) continue;
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
        if (/download|1fichier/i.test(embed.servername || "") || String(embed.link || "").split(".").length === 3) continue;
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
  const response = await fetchJson(candidate.url, { referer: candidate.referer || "https://api.moviemaster.lat/" });
  const url = response.data.url || response.data.source || "";
  return isPlayableUrl(url) ? [{ ...candidate, url }] : [];
}
function zilla(candidate) {
  const match = candidate.url.match(/player\.zilla-networks\.com\/(?:watch\/)?([a-zA-Z0-9_-]+)/i);
  if (!match) return null;
  return [{ ...candidate, url: `https://player.zilla-networks.com/m3u8/${match[1]}`, referer: candidate.url }];
}
async function resolveOne(candidate, context, depth) {
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
  const response = await fetchText(candidate.url, {
    referer: candidate.referer || context.referer,
    timeoutMs: context.timeoutMs || 1e4
  });
  const html = response.text;
  const pageUrl = response.url || candidate.url;
  const direct = unique([
    // El JSON autenticado de Voe tiene prioridad sobre MP4 de muestra incrustados en su página.
    ...voeUrls(html),
    ...directMediaInHtml(html, pageUrl),
    streamtapeUrl(html, pageUrl),
    mixdropUrl(html, pageUrl)
  ].filter(Boolean));
  if (direct.length) return direct.map((url) => ({ ...candidate, url, referer: pageUrl, subtitles: subtitlesInHtml(html, pageUrl) }));
  const pass = html.match(/(?:\$\.get|fetch)\(\s*["'](\/pass_md5\/[^"']+)["']/i);
  if (pass) {
    const token = await fetchText(absoluteUrl(pass[1], pageUrl), { referer: pageUrl });
    const tokenText = token.text.trim();
    const directUrl = html.match(/\/pass_md5\/[^"']+[\s\S]{0,500}?["'](https?:\/\/[^"']+)["']/i)?.[1];
    if (directUrl && tokenText) return [{ ...candidate, url: `${directUrl}${tokenText}`, referer: pageUrl }];
  }
  const nestedServers = protectedDataLinkCandidates(html, pageUrl);
  if (nestedServers.length && depth < 2) {
    const nested = await resolveCandidates(nestedServers, { ...context, referer: pageUrl }, depth + 1);
    if (nested.length) return nested.map((item) => ({ ...item, language: item.language || candidate.language }));
  }
  const iframe = html.match(/<iframe\b[^>]*src\s*=\s*["']([^"']+)["']/i)?.[1] || html.match(/var\s+url\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1] || html.match(/window\.location\.replace\(["'](https?:\/\/[^"']+)["']\)/i)?.[1] || html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1] || (/window\.onload/i.test(html) ? html.match(/["'](https?:\/\/[^"']+)["']/i)?.[1] : "");
  const next = absoluteUrl(iframe || "", pageUrl);
  if (next && next !== candidate.url && depth < 2) {
    return resolveOne({ ...candidate, url: next, referer: pageUrl }, context, depth + 1);
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
function embedCandidatesFromHtml(html, base, defaults = {}) {
  const output = dataLinkCandidates(html, base);
  const iframeRegex = /<iframe\b[^>]*src\s*=\s*["']([^"']+)["']/gi;
  let match;
  while (match = iframeRegex.exec(String(html || ""))) {
    const url = absoluteUrl(match[1], base);
    if (url) output.push({ ...defaults, url });
  }
  for (const anchor of anchors(html)) {
    if (!/streamwish|voe\.|filemoon|vidhide|mixdrop|mp4upload|streamtape|dood|yourupload|uqload|vidmoly|ok\.ru|vimeos|goodstream|zilla|vk\.com|mail\.ru/i.test(anchor.href)) continue;
    output.push({ ...defaults, url: absoluteUrl(anchor.href, base), title: anchor.title || defaults.title });
  }
  return output;
}

// src/providers/animeonlineninja/index.js
var BASE = "https://ww3.animeonline.ninja";
async function search(query, mediaType) {
  const page = await fetchText(withQuery(`${BASE}/`, { s: query }), { referer: `${BASE}/inicio/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:online|pelicula)\//i });
}
async function streams(match, media) {
  let url = match.url;
  if (media.mediaType !== "movie") {
    const show = await fetchText(match.url, { referer: `${BASE}/` });
    const episode = episodeLinks(show.text, show.url, media.season, media.episode);
    if (!episode) return [];
    url = episode.url;
  }
  const page = await fetchText(url, { referer: `${BASE}/` });
  let options = playerOptions(page.text, page.url);
  const postId = options.find((item) => item.postId)?.postId || page.text.match(/postid-(\d+)/i)?.[1] || page.text.match(/data-post\s*=\s*["'](\d+)["']/i)?.[1];
  if (!options.length && postId) options = [1, 2, 3, 4, 5].map((number) => ({ number, postId, type: media.mediaType === "movie" ? "movie" : "tv" }));
  const candidates = [];
  for (const option of options.filter((item) => item.postId).slice(0, 8)) {
    try {
      const response = await fetchJson(`${BASE}/wp-json/dooplayer/v1/post/${encodeURIComponent(option.postId)}?type=${encodeURIComponent(option.type)}&source=${option.number}`, { referer: page.url });
      if (response.data.embed_url) candidates.push({ url: response.data.embed_url, language: "es-SUB", server: `Opci\xF3n ${option.number}`, referer: page.url });
    } catch (_) {
    }
  }
  candidates.push(...embedCandidatesFromHtml(page.text, page.url, { language: "es-SUB", referer: page.url }));
  return resolveCandidates(candidates, { provider: "Anime Online Ninja", providerId: "animeonlineninja", referer: page.url, maxCandidates: 8 });
}
module.exports = { getStreams: createSiteProvider({ name: "Anime Online Ninja", search, streams }) };
