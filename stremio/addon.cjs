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
const {
  ensurePool,
  getHealthyProxy,
  proxyStatus,
  runWithProxy,
  installProxyFetchHook,
} = require('./proxy-pool.cjs');
const {
  resolveGatewayOptions,
  buildGatewayUrl,
  isPlaylistUrl,
} = require('./stream-gateway.cjs');
const {
  resolveMediaFlowOptions,
  buildMediaFlowUrl,
  canDelegate,
} = require('./mediaflow.cjs');

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

/**
 * Normaliza y valida una URL base pública. Si el valor recibido no tiene un
 * dominio real (por ejemplo `https://7e2a912be9c9-streamflix2`, sin
 * `.baby-beamup.club`) se descarta en lugar de publicar un `logo` roto en el
 * manifiesto que Stremio no puede cargar.
 */
function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const host = url.hostname;
    if (!host) return '';
    if (!host.includes('.') && host !== 'localhost') return '';
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return '';
  }
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

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (baseUrl) {
    manifest.logo = `${baseUrl}/logo.svg`;
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

/**
 * Decide quién se encarga del tráfico de vídeo. El orden de preferencia es el
 * más barato para el anfitrión y el más compatible para el reproductor:
 *
 *  1. `direct`          — el CDN no pide cabeceras: URL tal cual, sin coste.
 *  2. `proxy-headers`   — el CDN pide `Referer`/`Origin`/`Cookie`: se entregan
 *                         `notWebReady` + `proxyHeaders` y el *streaming
 *                         server* local del usuario pone las cabeceras.
 *                         Cero bytes por Beamup.
 *  3. `gateway`         — opt-in (`STREAM_GATEWAY=auto|on`): sólo HLS y sólo
 *                         cuando hay cabeceras que el cliente no puede mandar
 *                         (Stremio Web/iOS/TV). Se reescribe el playlist y los
 *                         segmentos se emiten en streaming con presupuesto.
 *
 * `transport` viaja en el diagnóstico para saber qué camino tomó cada enlace.
 */
function resolveTransport(stream, context = {}) {
  const gateway = context.gateway || { enabled: false, mode: 'off' };
  const mediaflow = context.mediaflow || { enabled: false };
  const headers = cleanRequestHeaders(stream.headers);
  const hasHeaders = Object.keys(headers).length > 0;
  const needsHeaders = needsHeaderProxy(stream);
  const hls = /\.m3u8(?:$|[?#])|\.m3u8?$|\/m3u8\//i.test(String(stream.url || ''))
    || stream.type === 'hls'
    || isPlaylistUrl(stream.url);

  if (!needsHeaders) return { gateway: false, headers, transport: hls ? 'direct-hls' : 'direct' };

  // MediaFlow (instancia propia, fuera de Beamup) es un motor completo: cuando
  // está configurado se prefiere a la pasarela interna, que queda como respaldo
  // sin infraestructura.
  if (mediaflow.enabled && canDelegate(stream, mediaflow)) {
    return { gateway: false, headers, transport: 'mediaflow' };
  }

  if (!gateway.enabled) return { gateway: false, headers, transport: 'proxy-headers' };

  const gatewayEligible = gateway.mode === 'on'
    ? (hls || stream.type === 'mp4')
    : hls; // `auto`: sólo HLS, que es lo que la pasarela sabe reescribir bien.
  if (!gatewayEligible) return { gateway: false, headers, transport: 'proxy-headers' };
  if (!context.baseUrl) return { gateway: false, headers, transport: 'proxy-headers' };
  if (!hasHeaders && gateway.mode !== 'on') {
    return { gateway: false, headers, transport: hls ? 'direct-hls' : 'direct' };
  }
  return { gateway: true, headers, transport: 'gateway' };
}

function toStremioStream(stream, context) {
  const route = resolveTransport(stream, context);
  const headers = route.headers;
  const requireProxyHeaders = route.transport === 'proxy-headers';
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

  let url = stream.url;
  if (route.transport === 'mediaflow') {
    // El reproductor pide a MediaFlow, que aplica las cabeceras y reescribe el
    // playlist. No hay `proxyHeaders`: las pone el proxy, no el cliente.
    url = buildMediaFlowUrl(stream.url, headers, context.mediaflow) || stream.url;
    behaviorHints.notWebReady = true;
    behaviorHints.streamflix2Transport = route.transport;
  } else if (route.gateway) {
    // HLS servido por nuestra pasarela: el reproductor no manda cabeceras, las
    // pone ella. Se mantiene `notWebReady` para que el servidor local no intente
    // un acceso directo al CDN (fallaría justo por las cabeceras).
    url = buildGatewayUrl(context.baseUrl, stream.url, headers);
    behaviorHints.notWebReady = true;
    behaviorHints.streamflix2Transport = route.transport;
  } else if (requireProxyHeaders && Object.keys(headers).length > 0) {
    behaviorHints.notWebReady = true;
    behaviorHints.proxyHeaders = { request: headers };
    behaviorHints.streamflix2Transport = route.transport;
  } else if (!isHttpsMp4) {
    behaviorHints.notWebReady = true;
    behaviorHints.streamflix2Transport = route.transport;
  }

  const serverDetail = String(stream.title || '').split('·')[0].trim() || stream.name;
  const transportNote = route.transport === 'gateway' ? ' · pasarela' : '';
  const description = [
    `🎬 ${stream.name}${serverDetail && serverDetail !== stream.name ? ` · ${serverDetail}` : ''}`,
    `${langLabel} · ${quality} · ${formatUpper}${transportNote}`,
  ].join('\n');

  const subtitles = mapSubtitles(stream.subtitles, providerSlug);

  return {
    name: `STREAMFLIX2\n${quality} · ${langBadge}`,
    title: description,
    description,
    url,
    ...(subtitles ? { subtitles } : {}),
    behaviorHints,
  };
}

const DEFAULT_DEADLINE_MS = 7000;
const MIN_DEADLINE_MS = 2500;
const MAX_DEADLINE_MS = 25000;
const RESULT_CACHE_MAX_ENTRIES = 400;
const RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const EMPTY_RESULT_TTL_MS = 60 * 1000;
const MAX_STREAMS = 60;

/**
 * Caché de resultados (por proceso) y trabajos en vuelo.
 *
 * Clave del problema real en Stremio: el cliente abandona las peticiones que
 * tardan demasiado y, al no recibir respuesta a tiempo, muestra la lista vacía.
 * Nuvio ejecuta los proveedores dentro de la app, así que nunca lo sufre. Aquí
 * devolvemos lo que haya antes de un plazo duro y seguimos raspando en segundo
 * plano para que la siguiente petición (Stremio recarga la lista al abrir el
 * título otra vez) llegue ya resuelta desde caché.
 */
const resultCache = new Map();
const inflightJobs = new Map();
const providerLatency = new Map();

function averageLatency(id) {
  const entry = providerLatency.get(id);
  return entry ? entry.ms : 1500;
}

function recordLatency(id, ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const prev = providerLatency.get(id);
  const alpha = 0.35;
  providerLatency.set(id, {
    ms: prev ? Math.round(prev.ms * (1 - alpha) + ms * alpha) : Math.round(ms),
    samples: (prev ? prev.samples : 0) + 1,
  });
  if (providerLatency.size > 200) {
    const oldest = providerLatency.keys().next();
    if (!oldest.done) providerLatency.delete(oldest.value);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * Plazo máximo de respuesta. Stremio corta la petición si el addon tarda
 * demasiado, por lo que el valor por defecto es deliberadamente bajo:
 * `ADDON_DEADLINE_MS` (2500–25000 ms, por defecto 7000).
 */
function resolveDeadlineMs(env = process.env) {
  const raw = Number(env.ADDON_DEADLINE_MS ?? env.ADDON_RESPONSE_DEADLINE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DEADLINE_MS;
  return Math.max(MIN_DEADLINE_MS, Math.min(MAX_DEADLINE_MS, Math.round(raw)));
}

function buildCacheKey(parsed, config, gatewayMode = 'off') {
  const id = parsed.imdbId || `tmdb:${parsed.tmdbId}`;
  const episode = parsed.mediaType === 'tv' ? `:${parsed.season}:${parsed.episode}` : '';
  const providers = [...config.providers].sort().join(',');
  // `gatewayMode` forma parte de la clave: al activar/desactivar la pasarela no
  // se deben reutilizar URLs del modo anterior.
  return `${parsed.mediaType}/${id}${episode}|${config.lang}|${providers}|g:${gatewayMode}`;
}

function readResultCache(key) {
  const entry = resultCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.at;
  if (age > entry.ttl) {
    resultCache.delete(key);
    return null;
  }
  // Refresca el orden LRU
  resultCache.delete(key);
  resultCache.set(key, entry);
  return { streams: entry.streams, age, ttl: entry.ttl };
}

function writeResultCache(key, streams, ttl) {
  if (!key) return;
  resultCache.set(key, { streams, at: Date.now(), ttl });
  while (resultCache.size > RESULT_CACHE_MAX_ENTRIES) {
    const oldest = resultCache.keys().next();
    if (oldest.done) break;
    resultCache.delete(oldest.value);
  }
}

function clearResultCache() {
  resultCache.clear();
  inflightJobs.clear();
  providerLatency.clear();
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

/**
 * Filtra, deduplica, ordena y transforma los streams acumulados al formato
 * de Stremio. Se puede invocar varias veces sobre el mismo acumulador
 * (parcial durante la petición, completo cuando termina el trabajo).
 */
function selectStreams(accumulator, context) {
  const langMode = context.config.lang;
  const seen = new Set();
  const flat = [];

  for (const item of accumulator.streams) {
    if (!item || !item.url) continue;
    if (!matchesLanguageFilter(item.language, langMode)) continue;
    const dedupeKey = `${item.url}|${item.language || 'es'}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    flat.push(item);
  }

  flat.sort((a, b) => {
    const langDiff = languageRank(b.language, langMode) - languageRank(a.language, langMode);
    if (langDiff !== 0) return langDiff;
    const qualDiff = (QUALITY_SCORE[b.quality] || 100) - (QUALITY_SCORE[a.quality] || 100);
    if (qualDiff !== 0) return qualDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return flat.slice(0, MAX_STREAMS).map((item) => toStremioStream(item, context));
}

/**
 * Modo de uso de proxies para el raspado:
 *  - `off`  nunca
 *  - `auto` (por defecto) segunda pasada solo con los proveedores que fallaron
 *  - `only` todos los proveedores salen por proxy desde el principio
 */
function proxyMode(env = process.env) {
  const raw = String(env.PROXY_SCRAPING || 'auto').trim().toLowerCase();
  if (['0', 'off', 'false', 'no', 'disabled', 'none'].includes(raw)) return 'off';
  if (['only', 'always', 'strict'].includes(raw)) return 'only';
  return 'auto';
}

function clampInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function pushFoundStreams(accumulator, found) {
  if (!Array.isArray(found)) return;
  for (const item of found) {
    if (!item || !item.url) continue;
    accumulator.streams.push(item);
  }
}

/**
 * Lanza todos los proveedores con concurrencia limitada y ordenados por
 * latencia histórica (los rápidos primero, para que el plazo duro alcance a
 * recoger el máximo de resultados). Cada proveedor terminado empuja sus
 * streams al acumulador, así una respuesta parcial siempre es útil.
 */
function runProviders(options) {
  const {
    eligible,
    providerInputId,
    parsed,
    getProvider,
    perProviderTimeoutMs,
    concurrency,
    accumulator,
    proxyFor,
    phase,
  } = options;

  const ordered = [...eligible].sort((a, b) => averageLatency(a.id) - averageLatency(b.id));
  let cursor = 0;

  const worker = async () => {
    while (cursor < ordered.length) {
      const scraper = ordered[cursor];
      cursor += 1;
      const startedAt = Date.now();
      let found = [];
      let error = '';
      const proxy = typeof proxyFor === 'function' ? proxyFor(scraper) : null;
      try {
        const mod = getProvider(scraper.id);
        if (!mod || typeof mod.getStreams !== 'function') {
          throw new Error('Proveedor no disponible');
        }
        const scrape = () => mod.getStreams(providerInputId, parsed.mediaType, parsed.season, parsed.episode);
        found = await withTimeout(
          proxy ? runWithProxy(proxy, scrape) : scrape(),
          perProviderTimeoutMs,
          proxy ? `${scraper.id} vía proxy` : scraper.id,
        );
        if (!Array.isArray(found)) found = [];
      } catch (err) {
        error = err && err.message ? err.message : 'Error desconocido';
        found = [];
      }
      const elapsed = Date.now() - startedAt;
      recordLatency(scraper.id, elapsed);
      pushFoundStreams(accumulator, found);
      accumulator.stats.push({
        id: scraper.id,
        ms: elapsed,
        count: found.length,
        error,
        via: proxy ? 'proxy' : 'direct',
        proxy: proxy ? proxy.id : '',
        phase: phase || 'direct',
      });
      accumulator.pending -= 1;
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, ordered.length)) },
    () => worker(),
  );
  return Promise.all(workers);
}

/**
 * Segunda pasada: reintenta por proxy solo los proveedores que no devolvieron
 * nada en la pasada directa. Se ejecuta en segundo plano (después de haber
 * respondido a Stremio) para que el resultado cacheado ya incluya lo rescatado.
 */
async function retryFailedWithProxy(params) {
  const { accumulator, eligible, providerInputId, parsed, getProvider, env, config } = params;
  const maxRetries = clampInt(env.PROXY_MAX_RETRIES, 8, 0, 31);
  if (maxRetries <= 0) return;

  const failedIds = [];
  for (const stat of accumulator.stats) {
    if (stat.count > 0 || stat.phase === 'proxy') continue;
    if (!failedIds.includes(stat.id)) failedIds.push(stat.id);
  }
  if (!failedIds.length) return;

  const proxies = await ensurePool(env);
  if (!proxies.length) return;

  const targets = failedIds
    .slice(0, maxRetries)
    .map((id) => eligible.find((scraper) => scraper.id === id))
    .filter(Boolean);
  if (!targets.length) return;

  const budgetMs = clampInt(env.PROXY_BUDGET_MS, 20000, 3000, 120000);
  const deadline = Date.now() + budgetMs;
  const perProviderTimeoutMs = clampInt(env.PROXY_TIMEOUT_MS, 8000, 2000, 25000);
  const concurrency = clampInt(env.PROXY_CONCURRENCY, 2, 1, 6);

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length && Date.now() < deadline) {
      const scraper = targets[cursor];
      cursor += 1;
      const proxy = getHealthyProxy();
      if (!proxy) return;
      const startedAt = Date.now();
      let found = [];
      let error = '';
      try {
        const mod = getProvider(scraper.id);
        if (!mod || typeof mod.getStreams !== 'function') throw new Error('Proveedor no disponible');
        const scrape = () => mod.getStreams(providerInputId, parsed.mediaType, parsed.season, parsed.episode);
        found = await withTimeout(runWithProxy(proxy, scrape), perProviderTimeoutMs, `${scraper.id} vía proxy`);
        if (!Array.isArray(found)) found = [];
      } catch (err) {
        error = err && err.message ? err.message : 'Error desconocido';
        found = [];
      }
      const elapsed = Date.now() - startedAt;
      recordLatency(scraper.id, elapsed);
      pushFoundStreams(accumulator, found);
      accumulator.stats.push({
        id: scraper.id,
        ms: elapsed,
        count: found.length,
        error,
        via: 'proxy',
        proxy: proxy.id,
        phase: 'proxy',
      });
    }
  };

  await Promise.all(Array.from(
    { length: Math.max(1, Math.min(concurrency, targets.length)) },
    () => worker(),
  ));
}

function startJob(options) {
  const {
    key,
    eligible,
    providerInputId,
    parsed,
    metadata,
    config,
    env,
    getProvider,
    accumulator,
    context,
  } = options;

  const concurrency = Math.max(1, Math.min(Number(env.ADDON_CONCURRENCY) || 10, 24));
  const perProviderTimeoutMs = config.timeoutSec * 1000;
  const startedAt = Date.now();

  const job = { accumulator, startedAt, done: null };

  job.done = runWithRequestContext(
    { tmdbApiKey: config.tmdbKey, metadata },
    async () => {
      const mode = proxyMode(env);
      if (mode !== 'off') installProxyFetchHook();

      if (mode === 'only') {
        await ensurePool(env);
        await runProviders({
          eligible,
          providerInputId,
          parsed,
          getProvider,
          perProviderTimeoutMs,
          concurrency,
          accumulator,
          proxyFor: () => getHealthyProxy(),
          phase: 'proxy',
        });
        return;
      }

      await runProviders({
        eligible,
        providerInputId,
        parsed,
        getProvider,
        perProviderTimeoutMs,
        concurrency,
        accumulator,
      });

      if (mode === 'auto') {
        await retryFailedWithProxy({
          accumulator,
          eligible,
          providerInputId,
          parsed,
          getProvider,
          env,
          config,
        });
      }
    },
  ).then(() => {
    // El trabajo terminó (puede ser después de haber respondido ya): guardamos
    // el resultado completo para que la siguiente petición sea instantánea.
    const streams = selectStreams(accumulator, context);
    const ttl = streams.length > 0 ? RESULT_CACHE_TTL_MS : EMPTY_RESULT_TTL_MS;
    writeResultCache(key, streams, ttl);
    return streams;
  }).catch(() => []);

  return job;
}

function resolveEligibleScrapers(config, parsed, metadata, numericTmdbId) {
  const selectedSet = new Set(config.providers);
  return ACTIVE_SCRAPERS.filter((scraper) => {
    if (!selectedSet.has(scraper.id)) return false;
    if (!scraper.supportedTypes.includes(parsed.mediaType)) return false;
    if (scraper.id === 'cinehax' && !numericTmdbId) return false;
    if (!metadata && scraper.id !== 'cinehax') return false;
    return true;
  });
}

async function resolveRequestContext(params) {
  const env = params.env || process.env;
  const config = normalizeConfig(params.config || {}, env);
  const parsed = parseStremioId(params.type, params.id);
  if (!parsed) return null;

  const metadata = await resolveStremioMetadata(parsed, {
    tmdbKey: config.tmdbKey,
    useCache: params.useMetadataCache !== false,
  });

  const numericTmdbId = metadata?.tmdbId || parsed.tmdbId || '';
  if (!metadata && !numericTmdbId) return null;

  const providerInputId = numericTmdbId ? `tmdb:${numericTmdbId}` : (parsed.imdbId || '');
  const eligible = resolveEligibleScrapers(config, parsed, metadata, numericTmdbId);
  if (!eligible.length) return null;

  const gateway = resolveGatewayOptions(env);
  const mediaflow = resolveMediaFlowOptions(env);
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  // `config.gateway` es la preferencia del usuario; la env del operador es el
  // techo de seguridad: si el servidor la apaga, `on` no la resucita.
  const gatewayPreference = config.gateway === 'off' ? 'off' : gateway.mode;

  return {
    env,
    config,
    parsed,
    metadata,
    eligible,
    providerInputId,
    context: {
      metadata,
      parsed,
      config,
      baseUrl,
      // Con la pasarela apagada (predeterminado) `enabled` es false y todos los
      // enlaces vuelven a la vía directa/`proxyHeaders`. Un usuario puede
      // apagarla para sí mismo con `gateway: 'off'` en `/configure`.
      gateway: {
        enabled: gateway.enabled && gatewayPreference !== 'off',
        mode: gatewayPreference,
        serverMode: gateway.mode,
      },
      // La instancia de MediaFlow es infraestructura del operador: el usuario
      // sólo puede desactivarla para sí (gatewayPreference === 'off').
      mediaflow: {
        ...mediaflow,
        enabled: mediaflow.enabled && gatewayPreference !== 'off',
      },
    },
  };
}

async function getStremioStreams(params = {}) {
  const request = await resolveRequestContext(params);
  if (!request) return { streams: [], cacheMaxAge: 60 };

  const { env, config, parsed, metadata, eligible, providerInputId, context } = request;
  const cacheKey = buildCacheKey(parsed, config, context.gateway.enabled ? context.gateway.mode : 'off');

  const cached = readResultCache(cacheKey);
  if (cached) {
    return {
      streams: cached.streams,
      cacheMaxAge: cached.streams.length > 0 ? 600 : 60,
      staleRevalidate: 300,
      staleError: 1800,
      cached: true,
    };
  }

  const getProvider = params.providerLoader || loadProviderModule;
  let job = inflightJobs.get(cacheKey);
  if (!job) {
    const accumulator = { streams: [], stats: [], pending: eligible.length };
    job = startJob({
      key: cacheKey,
      eligible,
      providerInputId,
      parsed,
      metadata,
      config,
      env,
      getProvider,
      accumulator,
      context,
    });
    inflightJobs.set(cacheKey, job);
    const clear = () => {
      if (inflightJobs.get(cacheKey) === job) inflightJobs.delete(cacheKey);
    };
    job.done.then(clear, clear);
  }

  // `deadlineMs` permite fijar el plazo por petición (pruebas y depuración).
  const requestedDeadline = Number(params.deadlineMs);
  const deadlineMs = Number.isFinite(requestedDeadline) && requestedDeadline > 0
    ? Math.max(50, Math.min(MAX_DEADLINE_MS, Math.round(requestedDeadline)))
    : resolveDeadlineMs(env);
  const finished = await Promise.race([
    job.done.then(() => true, () => true),
    delay(deadlineMs).then(() => false),
  ]);

  const streams = selectStreams(job.accumulator, context);

  if (streams.length > 0) {
    return {
      streams,
      cacheMaxAge: finished ? 600 : 90,
      staleRevalidate: 300,
      staleError: 1800,
      partial: !finished,
      elapsedMs: Date.now() - job.startedAt,
    };
  }

  return {
    streams: [],
    cacheMaxAge: 0,
    noStore: true,
    partial: !finished,
    elapsedMs: Date.now() - job.startedAt,
  };
}

/**
 * Diagnóstico sin plazo: ejecuta todos los proveedores y devuelve el tiempo y
 * el número de resultados de cada uno. Sirve para saber, desde el navegador,
 * qué proveedor está lento o bloqueado en el servidor (Beamup).
 */
async function diagnoseStremioStreams(params = {}) {
  const startedAt = Date.now();
  const request = await resolveRequestContext({
    ...params,
    useMetadataCache: false,
  });
  const metadataMs = Date.now() - startedAt;
  if (!request) {
    return {
      ok: false,
      error: 'No se pudo resolver el título: revisa el ID o que Cinemeta/TMDB sea accesible desde el servidor',
      metadataMs,
      elapsedMs: Date.now() - startedAt,
      providers: [],
      streams: 0,
    };
  }

  const { env, config, parsed, eligible, providerInputId, metadata, context } = request;
  const getProvider = params.providerLoader || loadProviderModule;
  const accumulator = { streams: [], stats: [], pending: eligible.length };
  const concurrency = Math.max(1, Math.min(Number(env.ADDON_CONCURRENCY) || 10, 24));

  const mode = proxyMode(env);
  if (mode !== 'off') installProxyFetchHook();

  await runWithRequestContext({ tmdbApiKey: config.tmdbKey, metadata }, () => runProviders({
    eligible,
    providerInputId,
    parsed,
    getProvider,
    perProviderTimeoutMs: config.timeoutSec * 1000,
    concurrency,
    accumulator,
    proxyFor: mode === 'only' ? () => getHealthyProxy() : undefined,
    phase: mode === 'only' ? 'proxy' : 'direct',
  }));

  if (mode === 'auto') {
    await retryFailedWithProxy({
      accumulator, eligible, providerInputId, parsed, getProvider, env, config,
    });
  }

  const streams = selectStreams(accumulator, context);
  accumulator.stats.sort((a, b) => b.ms - a.ms);

  return {
    ok: true,
    type: params.type,
    id: params.id,
    key: buildCacheKey(parsed, config, context.gateway.enabled ? context.gateway.mode : 'off'),
    mediaflow: {
      configured: context.mediaflow.enabled,
      baseUrl: context.mediaflow.baseUrl || '',
      includeMp4: Boolean(context.mediaflow.includeMp4),
    },
    streamGateway: {
      mode: context.gateway.mode,
      serverMode: context.gateway.serverMode,
      userPreference: config.gateway,
      enabled: context.gateway.enabled,
      baseUrl: context.baseUrl || '',
    },
    transports: streams.reduce((acc, item) => {
      const kind = (item.behaviorHints && item.behaviorHints.streamflix2Transport) || 'direct';
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {}),
    metadata: metadata
      ? { title: metadata.title, year: metadata.year, tmdbId: metadata.tmdbId || '' }
      : null,
    metadataMs,
    elapsedMs: Date.now() - startedAt,
    deadlineMs: resolveDeadlineMs(env),
    providerTimeoutSeconds: config.timeoutSec,
    proxyMode: proxyMode(env),
    proxy: proxyStatus(),
    providersQueried: eligible.length,
    providersWithResults: new Set(accumulator.stats.filter((s) => s.count > 0).map((s) => s.id)).size,
    providersRescuedByProxy: accumulator.stats.filter((s) => s.phase === 'proxy' && s.count > 0).length,
    providersFailed: new Set(accumulator.stats.filter((s) => s.count === 0).map((s) => s.id)).size,
    streams: streams.length,
    slowest: accumulator.stats.filter((s) => !s.error).slice(0, 5),
    failed: accumulator.stats.filter((s) => s.error).map(({ id, ms, error }) => ({ id, ms, error })),
    results: accumulator.stats,
  };
}

module.exports = {
  buildManifest,
  normalizeBaseUrl,
  resolveTransport,
  getStremioStreams,
  diagnoseStremioStreams,
  toStremioStream,
  cleanRequestHeaders,
  needsHeaderProxy,
  resolveDeadlineMs,
  clearResultCache,
};
