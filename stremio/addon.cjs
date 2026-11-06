'use strict';

const path = require('node:path');
const {
  ADDON_ID,
  ADDON_NAME,
  ADDON_VERSION,
  ACTIVE_SCRAPERS,
  normalizeConfig,
} = require('./config.cjs');
const {
  runWithRequestContext,
  parseStremioId,
  resolveStremioMetadata,
} = require('./metadata.cjs');

const ROOT = path.resolve(__dirname, '..');
const providerModules = new Map();

const LANGUAGE_LABELS = {
  'es-LAT': '🇲🇽 Español Latino',
  'es-ES': '🇪🇸 Castellano',
  'es-SUB': '💬 Subtitulado ES',
  es: '🌐 Español',
  en: '🇺🇸 Inglés',
};

const LANGUAGE_SHORT = {
  'es-LAT': 'LAT',
  'es-ES': 'CAST',
  'es-SUB': 'SUB',
  es: 'ES',
  en: 'EN',
};

const QUALITY_SCORE = {
  '2160p': 400,
  '1440p': 300,
  '1080p': 200,
  '720p': 150,
  Auto: 130,
  '576p': 110,
  '480p': 95,
  '360p': 75,
  '240p': 50,
  CAM: 20,
};

function loadProviderModule(id) {
  if (!providerModules.has(id)) {
    const file = path.join(ROOT, 'providers', `${id}.js`);
    providerModules.set(id, require(file));
  }
  return providerModules.get(id);
}

function cleanRequestHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const cleanVal = String(value).replace(/[\r\n]+/g, ' ').trim();
    if (!cleanVal) continue;
    output[key] = cleanVal;
  }
  return output;
}

function needsHeaderProxy(stream) {
  const headers = cleanRequestHeaders(stream && stream.headers);
  const keys = Object.keys(headers).map((key) => key.toLowerCase());
  return keys.some((key) => key === 'referer' || key === 'origin' || key === 'cookie' || key === 'authorization');
}

function buildManifest(rawConfig = {}, options = {}) {
  const config = normalizeConfig(rawConfig, options.env);
  const count = config.providers.length;
  const langNote = config.lang.startsWith('only-')
    ? ` · Filtro ${LANGUAGE_SHORT[config.lang.replace('only-', '')] || config.lang}`
    : '';

  const manifest = {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description: `Streams VOD en español latino, castellano y subtitulado (${count} proveedores activos${langNote}). Listo para Beamup.`,
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt', 'tmdb:'],
    resources: [
      {
        name: 'stream',
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
      },
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
  };

  if (options.baseUrl) {
    manifest.logo = `${options.baseUrl.replace(/\/+$/, '')}/logo.svg`;
  }

  return manifest;
}

function normalizeSubtitleLang(raw) {
  const text = String(raw || '').toLowerCase();
  if (/lat|es|spa|cast|sub/.test(text)) return 'spa';
  if (/en|eng|ing/.test(text)) return 'eng';
  if (/pt|por|bra/.test(text)) return 'por';
  if (/fr|fre|fra/.test(text)) return 'fra';
  return text.slice(0, 3) || 'spa';
}

function mapSubtitles(subtitles, providerId) {
  if (!Array.isArray(subtitles) || !subtitles.length) return undefined;
  const seen = new Set();
  const mapped = [];
  for (let i = 0; i < subtitles.length; i += 1) {
    const sub = subtitles[i];
    if (!sub || !/^https?:\/\//i.test(String(sub.url || ''))) continue;
    if (seen.has(sub.url)) continue;
    seen.add(sub.url);
    mapped.push({
      id: `${providerId || 'sf2'}-sub-${i + 1}`,
      url: sub.url,
      lang: normalizeSubtitleLang(sub.language || sub.lang || sub.name),
    });
  }
  return mapped.length ? mapped : undefined;
}

function inferFilename(stream, metadata, parsed) {
  try {
    const pathname = new URL(stream.url).pathname;
    const base = pathname.split('/').filter(Boolean).pop() || '';
    if (/\.(?:mp4|mkv|webm|m3u8)$/i.test(base) && base.length <= 120) {
      return decodeURIComponent(base);
    }
  } catch (_) { /* usar fallback sintético */ }
  const ext = stream.type === 'hls' ? 'm3u8' : (stream.type || 'mp4');
  const titleSlug = String(metadata?.title || 'streamflix2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'streamflix2';
  const ep = parsed?.mediaType === 'tv'
    ? `.S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')}`
    : '';
  return `${titleSlug}${ep}.${stream.quality || 'Auto'}.${ext}`;
}

function languageRank(language, langMode) {
  const orderMap = {
    all: ['es-LAT', 'es-ES', 'es-SUB', 'es', 'en'],
    'prefer-es-LAT': ['es-LAT', 'es-ES', 'es-SUB', 'es', 'en'],
    'prefer-es-ES': ['es-ES', 'es-LAT', 'es-SUB', 'es', 'en'],
    'prefer-es-SUB': ['es-SUB', 'es-LAT', 'es-ES', 'es', 'en'],
    'only-es-LAT': ['es-LAT'],
    'only-es-ES': ['es-ES'],
    'only-es-SUB': ['es-SUB'],
  };
  const order = orderMap[langMode] || orderMap.all;
  const idx = order.indexOf(language || 'es');
  return idx >= 0 ? order.length - idx : 0;
}

function matchesLanguageFilter(language, langMode) {
  if (!langMode || !langMode.startsWith('only-')) return true;
  const target = langMode.slice('only-'.length);
  return (language || 'es') === target;
}

function toStremioStream(stream, context) {
  const headers = cleanRequestHeaders(stream.headers);
  const requireProxyHeaders = needsHeaderProxy(stream);
  const isHttpsMp4 = /^https:\/\//i.test(stream.url) && stream.type === 'mp4' && !requireProxyHeaders;
  const langCode = stream.language || 'es';
  const langBadge = LANGUAGE_SHORT[langCode] || 'ES';
  const langLabel = LANGUAGE_LABELS[langCode] || langCode;
  const quality = stream.quality || 'Auto';
  const formatUpper = String(stream.type || 'hls').toUpperCase();
  const providerSlug = stream.provider || 'streamflix2';
  const bingeGroup = `streamflix2-${providerSlug}-${langCode}-${quality}`;
  const filename = inferFilename(stream, context.metadata, context.parsed);

  const behaviorHints = {
    bingeGroup,
    filename,
  };

  if (requireProxyHeaders && Object.keys(headers).length > 0) {
    behaviorHints.notWebReady = true;
    behaviorHints.proxyHeaders = { request: headers };
  } else if (!isHttpsMp4) {
    behaviorHints.notWebReady = true;
  }

  const serverDetail = String(stream.title || '').split('·')[0].trim() || stream.name;
  const description = [
    `🎬 ${stream.name}${serverDetail && serverDetail !== stream.name ? ` · ${serverDetail}` : ''}`,
    `${langLabel} · ${quality} · ${formatUpper}`,
  ].join('\n');

  const subtitles = mapSubtitles(stream.subtitles, providerSlug);

  return {
    name: `STREAMFLIX2\n${quality} · ${langBadge}`,
    title: description,
    description,
    url: stream.url,
    ...(subtitles ? { subtitles } : {}),
    behaviorHints,
  };
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout proveedor ${label} (${ms} ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (_) {
        results[idx] = [];
      }
    }
  }
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runner(),
  );
  await Promise.all(workers);
  return results;
}

async function getStremioStreams(params = {}) {
  const env = params.env || process.env;
  const config = normalizeConfig(params.config || {}, env);
  const parsed = parseStremioId(params.type, params.id);
  if (!parsed) return { streams: [], cacheMaxAge: 60 };

  const metadata = await resolveStremioMetadata(parsed, {
    tmdbKey: config.tmdbKey,
    useCache: params.useMetadataCache !== false,
  });

  const numericTmdbId = metadata?.tmdbId || parsed.tmdbId || '';
  if (!metadata && !numericTmdbId) {
    return { streams: [], cacheMaxAge: 60 };
  }

  const providerInputId = numericTmdbId
    ? `tmdb:${numericTmdbId}`
    : (parsed.imdbId || '');

  const selectedSet = new Set(config.providers);
  const eligible = ACTIVE_SCRAPERS.filter((scraper) => {
    if (!selectedSet.has(scraper.id)) return false;
    if (!scraper.supportedTypes.includes(parsed.mediaType)) return false;
    if (scraper.id === 'cinehax' && !numericTmdbId) return false;
    if (!metadata && scraper.id !== 'cinehax') return false;
    return true;
  });

  if (!eligible.length) {
    return { streams: [], cacheMaxAge: 120 };
  }

  const getProvider = params.providerLoader || loadProviderModule;
  const concurrency = Math.max(1, Math.min(Number(env.ADDON_CONCURRENCY) || 8, 16));
  const perProviderTimeoutMs = config.timeoutSec * 1000;

  const rawGroups = await runWithRequestContext(
    { tmdbApiKey: config.tmdbKey, metadata },
    () => runPool(eligible, concurrency, async (scraper) => {
      const mod = getProvider(scraper.id);
      if (!mod || typeof mod.getStreams !== 'function') return [];
      const found = await withTimeout(
        mod.getStreams(providerInputId, parsed.mediaType, parsed.season, parsed.episode),
        perProviderTimeoutMs,
        scraper.id,
      );
      return Array.isArray(found) ? found : [];
    }),
  );

  const flatStreams = [];
  const seenKeys = new Set();
  for (const group of rawGroups) {
    for (const item of group || []) {
      if (!item || !item.url) continue;
      if (!matchesLanguageFilter(item.language, config.lang)) continue;
      const dedupeKey = `${item.url}|${item.language || 'es'}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      flatStreams.push(item);
    }
  }

  flatStreams.sort((a, b) => {
    const langDiff = languageRank(b.language, config.lang) - languageRank(a.language, config.lang);
    if (langDiff !== 0) return langDiff;
    const qualDiff = (QUALITY_SCORE[b.quality] || 100) - (QUALITY_SCORE[a.quality] || 100);
    if (qualDiff !== 0) return qualDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const context = { metadata, parsed, config };
  const output = flatStreams.slice(0, 60).map((item) => toStremioStream(item, context));

  return {
    streams: output,
    cacheMaxAge: output.length > 0 ? 900 : 60,
    staleRevalidate: 300,
    staleError: 1800,
  };
}

module.exports = {
  buildManifest,
  getStremioStreams,
  toStremioStream,
  cleanRequestHeaders,
  needsHeaderProxy,
};
