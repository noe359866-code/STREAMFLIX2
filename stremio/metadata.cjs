'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

const requestContext = new AsyncLocalStorage();
const metadataCache = new Map();
const inflightRequests = new Map();

let hooksInstalled = false;
let fallbackGlobalTmdbKey = globalThis.TMDB_API_KEY;

function installRuntimeHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  fallbackGlobalTmdbKey = globalThis.TMDB_API_KEY;

  Object.defineProperty(globalThis, 'TMDB_API_KEY', {
    configurable: true,
    enumerable: true,
    get() {
      const store = requestContext.getStore();
      if (store && store.active) return store.tmdbApiKey || '';
      return fallbackGlobalTmdbKey;
    },
    set(value) {
      fallbackGlobalTmdbKey = value;
    },
  });

  globalThis.__STREAMFLIX_METADATA_HOOK = async (_contentId, mediaType) => {
    const store = requestContext.getStore();
    if (!store || !store.active || !store.metadata) return null;
    return {
      ...store.metadata,
      mediaType: mediaType === 'movie' ? 'movie' : 'tv',
    };
  };
}

function runWithRequestContext(context, fn) {
  installRuntimeHooks();
  return requestContext.run({ active: true, ...context }, fn);
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const val of values || []) {
    const clean = String(val == null ? '' : val).trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function extractYear(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match ? match[0] : '';
}

/**
 * Parsea cualquier identificador enviado por Stremio:
 * - Películas: `tt0137523`, `imdb:tt0137523`, `tmdb:550`
 * - Series: `tt0903747:2:3`, `tt0903747%3A2%3A3`, `tmdb:1396:2:3`
 */
function parseStremioId(rawType, rawId) {
  const normalizedType = String(rawType || '').trim().toLowerCase();
  const mediaType = normalizedType === 'movie'
    ? 'movie'
    : (normalizedType === 'series' || normalizedType === 'tv' || normalizedType === 'anime' ? 'tv' : null);
  if (!mediaType) return null;

  let decoded = '';
  try {
    decoded = decodeURIComponent(String(rawId || '').trim());
  } catch (_) {
    decoded = String(rawId || '').trim();
  }
  decoded = decoded.replace(/\.json$/i, '').trim();
  if (!decoded) return null;

  const parts = decoded.split(':').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  let imdbId = '';
  let tmdbId = '';
  let rest = [];

  if (/^tt\d+$/i.test(parts[0])) {
    imdbId = parts[0].toLowerCase();
    rest = parts.slice(1);
  } else if (parts[0].toLowerCase() === 'imdb' && /^tt\d+$/i.test(parts[1] || '')) {
    imdbId = parts[1].toLowerCase();
    rest = parts.slice(2);
  } else if (parts[0].toLowerCase() === 'tmdb' && /^\d+$/.test(parts[1] || '')) {
    tmdbId = parts[1];
    rest = parts.slice(2);
  } else if (/^\d+$/.test(parts[0])) {
    tmdbId = parts[0];
    rest = parts.slice(1);
  } else {
    return null;
  }

  if (mediaType === 'movie') {
    if (rest.length > 0) return null;
    return { mediaType: 'movie', imdbId, tmdbId, season: null, episode: null };
  }

  if (rest.length < 2) return null;
  const season = Number(rest[0]);
  const episode = Number(rest[1]);
  if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) {
    return null;
  }
  return { mediaType: 'tv', imdbId, tmdbId, season, episode };
}

async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout (${timeoutMs} ms) en ${url}`)), timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'STREAMFLIX2-Stremio-Addon/1.0',
        },
        redirect: 'follow',
      }),
      timeoutPromise,
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
    const text = await Promise.race([response.text(), timeoutPromise]);
    return JSON.parse(text);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveFromTmdb(parsed, tmdbKey) {
  const endpoint = parsed.mediaType === 'movie' ? 'movie' : 'tv';
  let numericId = parsed.tmdbId;

  if (!numericId && parsed.imdbId) {
    const found = await fetchJsonWithTimeout(
      `${TMDB_BASE}/find/${encodeURIComponent(parsed.imdbId)}?api_key=${encodeURIComponent(tmdbKey)}&external_source=imdb_id`,
    );
    const match = endpoint === 'movie' ? found?.movie_results?.[0] : found?.tv_results?.[0];
    if (match?.id) numericId = String(match.id);
  }
  if (!numericId) return null;

  const [es, en] = await Promise.all(['es-MX', 'en-US'].map((lang) => fetchJsonWithTimeout(
    `${TMDB_BASE}/${endpoint}/${encodeURIComponent(numericId)}?api_key=${encodeURIComponent(tmdbKey)}&language=${lang}&append_to_response=alternative_titles,external_ids`,
  ).catch(() => null)));

  const primary = es || en;
  if (!primary || primary.success === false) return null;

  const altTitles = [
    ...(primary.alternative_titles?.titles || primary.alternative_titles?.results || []),
    ...(en?.alternative_titles?.titles || en?.alternative_titles?.results || []),
  ].map((item) => item?.title || item?.name);

  const titles = uniqueStrings([
    primary.title,
    primary.name,
    primary.original_title,
    primary.original_name,
    en?.title,
    en?.name,
    en?.original_title,
    en?.original_name,
    ...altTitles,
  ]);
  if (!titles.length) return null;

  const imdbId = parsed.imdbId
    || primary.external_ids?.imdb_id
    || primary.imdb_id
    || en?.external_ids?.imdb_id
    || en?.imdb_id
    || '';

  return {
    id: String(numericId),
    tmdbId: String(numericId),
    imdbId,
    title: primary.title || primary.name || en?.title || en?.name || titles[0],
    originalTitle: primary.original_title || primary.original_name || en?.original_title || en?.original_name || titles[0],
    titles,
    year: extractYear(primary.release_date || primary.first_air_date || en?.release_date || en?.first_air_date),
    mediaType: endpoint,
    source: 'tmdb',
  };
}

async function resolveFromCinemeta(parsed) {
  if (!parsed.imdbId) return null;
  const cinemetaType = parsed.mediaType === 'movie' ? 'movie' : 'series';
  const data = await fetchJsonWithTimeout(
    `${CINEMETA_BASE}/meta/${cinemetaType}/${encodeURIComponent(parsed.imdbId)}.json`,
  );
  const meta = data && data.meta;
  if (!meta || !meta.name) return null;

  const tmdbId = meta.moviedb_id ? String(meta.moviedb_id) : (parsed.tmdbId || '');
  const aliases = Array.isArray(meta.aliases) ? meta.aliases : [];
  const titles = uniqueStrings([meta.name, ...aliases]);

  return {
    id: tmdbId || parsed.imdbId,
    tmdbId,
    imdbId: parsed.imdbId,
    title: meta.name,
    originalTitle: meta.name,
    titles,
    year: extractYear(meta.releaseInfo || meta.year || meta.released),
    mediaType: parsed.mediaType,
    source: 'cinemeta',
  };
}

function getCached(cacheKey) {
  const entry = metadataCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    metadataCache.delete(cacheKey);
    return null;
  }
  // Refrescar orden LRU
  metadataCache.delete(cacheKey);
  metadataCache.set(cacheKey, entry);
  return entry.value;
}

function setCached(cacheKey, value) {
  if (!value) return;
  if (metadataCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = metadataCache.keys().next().value;
    if (oldestKey !== undefined) metadataCache.delete(oldestKey);
  }
  metadataCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function resolveStremioMetadata(parsed, options = {}) {
  if (!parsed) return null;
  const tmdbKey = String(options.tmdbKey || '').trim();
  const idPart = parsed.tmdbId ? `tmdb:${parsed.tmdbId}` : `imdb:${parsed.imdbId}`;
  const cacheKey = `${parsed.mediaType}:${idPart}:${tmdbKey ? 'tmdb' : 'cinemeta'}`;

  if (options.useCache !== false) {
    const hit = getCached(cacheKey);
    if (hit) return hit;
  }

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const promise = (async () => {
    let resolved = null;
    if (tmdbKey) {
      try {
        resolved = await resolveFromTmdb(parsed, tmdbKey);
      } catch (_) {
        resolved = null;
      }
    }
    if (!resolved && parsed.imdbId) {
      try {
        resolved = await resolveFromCinemeta(parsed);
      } catch (_) {
        resolved = null;
      }
    }
    if (resolved && options.useCache !== false) {
      setCached(cacheKey, resolved);
    }
    return resolved;
  })();

  inflightRequests.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflightRequests.delete(cacheKey);
  }
}

function clearMetadataCache() {
  metadataCache.clear();
}

module.exports = {
  installRuntimeHooks,
  runWithRequestContext,
  parseStremioId,
  resolveStremioMetadata,
  clearMetadataCache,
};
