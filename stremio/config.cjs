'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const nuvioManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const CATEGORY_MAP = {
  animeav1: 'anime',
  animeonlineninja: 'anime',
  jkanime: 'anime',
  latanime: 'anime',
  tioanime: 'anime',
  animebum: 'anime',
  doramasflix: 'doramas',
  danimados: 'series',
  lacartoons: 'series',
  seriesflix: 'series',
  seriesturcas: 'series',
  hdfull: 'movies',
  verpeliculasonline: 'movies',
};

const ALL_SCRAPERS = nuvioManifest.scrapers.map((scraper) => ({
  ...scraper,
  category: CATEGORY_MAP[scraper.id] || 'general',
}));

const ACTIVE_SCRAPERS = ALL_SCRAPERS.filter((scraper) => scraper.enabled);
const ACTIVE_IDS = ACTIVE_SCRAPERS.map((scraper) => scraper.id);
const ACTIVE_ID_SET = new Set(ACTIVE_IDS);

const VALID_PROXY_MODES = new Set(['direct', 'nginx', 'both']);
const VALID_LANG_MODES = new Set([
  'all',
  'prefer-es-LAT',
  'prefer-es-ES',
  'prefer-es-SUB',
  'only-es-LAT',
  'only-es-ES',
  'only-es-SUB',
]);

function normalizeProxyUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const cleanPath = parsed.pathname
      .replace(/\/+$/, '')
      .replace(/\/hlsp(?:\/.*)?$/i, '');
    return `${parsed.origin}${cleanPath}`;
  } catch (_) {
    return '';
  }
}

function sanitizeToken(raw) {
  return String(raw || '').trim().replace(/[^A-Za-z0-9._~-]/g, '').slice(0, 128);
}

function sanitizeTmdbKey(raw) {
  return String(raw || '').trim().replace(/[^\w.-]/g, '').slice(0, 256);
}

function clampTimeout(value, fallback = 10) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(4, Math.min(25, Math.round(num)));
}

function defaultConfig(env = process.env) {
  const envMode = String(env.DEFAULT_PROXY_MODE || '').trim().toLowerCase();
  const proxyUrl = normalizeProxyUrl(env.NGINX_PROXY_URL || '');
  const defaultMode = VALID_PROXY_MODES.has(envMode) ? envMode : 'direct';
  const defaultTimeoutSec = clampTimeout(
    env.PROVIDER_TIMEOUT_MS ? Number(env.PROVIDER_TIMEOUT_MS) / 1000 : 10,
    10,
  );
  return {
    providers: [...ACTIVE_IDS],
    lang: 'all',
    proxyMode: defaultMode,
    proxyAll: env.NGINX_PROXY_ALL === '1' || env.NGINX_PROXY_ALL === 'true',
    proxyUrl,
    proxyToken: sanitizeToken(env.NGINX_PROXY_TOKEN || ''),
    tmdbKey: sanitizeTmdbKey(env.TMDB_API_KEY || ''),
    timeoutSec: defaultTimeoutSec,
  };
}

function normalizeConfig(input = {}, env = process.env) {
  const defaults = defaultConfig(env);
  if (!input || typeof input !== 'object') return defaults;

  let providers = defaults.providers;
  if (Array.isArray(input.providers)) {
    const filtered = input.providers
      .map((id) => String(id || '').trim().toLowerCase())
      .filter((id) => ACTIVE_ID_SET.has(id));
    providers = [...new Set(filtered)];
  } else if (typeof input.providers === 'string' && input.providers.trim()) {
    if (input.providers.trim().toLowerCase() === 'all') {
      providers = [...ACTIVE_IDS];
    } else {
      const filtered = input.providers
        .split(',')
        .map((id) => id.trim().toLowerCase())
        .filter((id) => ACTIVE_ID_SET.has(id));
      providers = [...new Set(filtered)];
    }
  }

  const lang = VALID_LANG_MODES.has(input.lang) ? input.lang : defaults.lang;
  const proxyMode = VALID_PROXY_MODES.has(input.proxyMode) ? input.proxyMode : defaults.proxyMode;
  const proxyAll = input.proxyAll === undefined
    ? defaults.proxyAll
    : (input.proxyAll === true || input.proxyAll === 1 || input.proxyAll === '1' || input.proxyAll === 'true' || input.proxyAll === 'on');

  const proxyUrl = input.proxyUrl !== undefined
    ? (normalizeProxyUrl(input.proxyUrl) || (input.proxyUrl === '' ? '' : defaults.proxyUrl))
    : defaults.proxyUrl;

  const proxyToken = input.proxyToken !== undefined
    ? sanitizeToken(input.proxyToken)
    : defaults.proxyToken;

  const tmdbKey = input.tmdbKey !== undefined
    ? sanitizeTmdbKey(input.tmdbKey)
    : defaults.tmdbKey;

  const timeoutSec = input.timeoutSec !== undefined
    ? clampTimeout(input.timeoutSec, defaults.timeoutSec)
    : defaults.timeoutSec;

  return {
    providers,
    lang,
    proxyMode,
    proxyAll,
    proxyUrl,
    proxyToken,
    tmdbKey,
    timeoutSec,
  };
}

/**
 * Codifica únicamente las diferencias respecto a la configuración base vacía
 * para generar un segmento `cfg_<base64url>` corto, sin `/` ni `=`, apto para `stremio://`.
 */
function encodeConfig(input = {}) {
  const clean = normalizeConfig(input, {});
  const payload = {};

  const isAllProviders = clean.providers.length === ACTIVE_IDS.length
    && ACTIVE_IDS.every((id) => clean.providers.includes(id));
  if (!isAllProviders) payload.p = clean.providers;
  if (clean.lang !== 'all') payload.l = clean.lang;
  if (clean.proxyMode !== 'direct') payload.m = clean.proxyMode;
  if (clean.proxyAll) payload.a = 1;
  if (clean.proxyUrl) payload.u = clean.proxyUrl;
  if (clean.proxyToken) payload.k = clean.proxyToken;
  if (clean.tmdbKey) payload.t = clean.tmdbKey;
  if (clean.timeoutSec !== 10) payload.s = clean.timeoutSec;

  if (Object.keys(payload).length === 0) return '';
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `cfg_${encoded}`;
}

function expandShortPayload(raw = {}) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    providers: raw.providers !== undefined ? raw.providers : raw.p,
    lang: raw.lang !== undefined ? raw.lang : raw.l,
    proxyMode: raw.proxyMode !== undefined ? raw.proxyMode : raw.m,
    proxyAll: raw.proxyAll !== undefined ? raw.proxyAll : raw.a,
    proxyUrl: raw.proxyUrl !== undefined ? raw.proxyUrl : raw.u,
    proxyToken: raw.proxyToken !== undefined ? raw.proxyToken : raw.k,
    tmdbKey: raw.tmdbKey !== undefined ? raw.tmdbKey : raw.t,
    timeoutSec: raw.timeoutSec !== undefined ? raw.timeoutSec : raw.s,
  };
}

function decodeConfig(segment, env = process.env) {
  if (!segment || typeof segment !== 'string') return defaultConfig(env);
  const trimmed = decodeURIComponent(segment).trim();
  if (!trimmed) return defaultConfig(env);

  if (trimmed.startsWith('cfg_')) {
    try {
      const json = Buffer.from(trimmed.slice(4), 'base64url').toString('utf8');
      return normalizeConfig(expandShortPayload(JSON.parse(json)), env);
    } catch (_) {
      return defaultConfig(env);
    }
  }

  if (trimmed.startsWith('{')) {
    try {
      return normalizeConfig(expandShortPayload(JSON.parse(trimmed)), env);
    } catch (_) {
      return defaultConfig(env);
    }
  }

  if (trimmed.includes('=')) {
    const params = new URLSearchParams(trimmed);
    const parsed = {};
    for (const [key, value] of params.entries()) parsed[key] = value;
    return normalizeConfig(expandShortPayload(parsed), env);
  }

  try {
    const json = Buffer.from(trimmed, 'base64url').toString('utf8');
    if (json.startsWith('{')) {
      return normalizeConfig(expandShortPayload(JSON.parse(json)), env);
    }
  } catch (_) { /* segmento inválido: usar valores predeterminados */ }

  return defaultConfig(env);
}

module.exports = {
  ADDON_VERSION: pkg.version || '1.0.0',
  ADDON_ID: 'org.streamflix2.es',
  ADDON_NAME: 'STREAMFLIX2 · Español y Latino',
  ALL_SCRAPERS,
  ACTIVE_SCRAPERS,
  ACTIVE_IDS,
  ACTIVE_ID_SET,
  VALID_PROXY_MODES,
  VALID_LANG_MODES,
  normalizeProxyUrl,
  sanitizeToken,
  sanitizeTmdbKey,
  defaultConfig,
  normalizeConfig,
  encodeConfig,
  decodeConfig,
};
