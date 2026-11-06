'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintManifest } = require('stremio-addon-linter');

const {
  ACTIVE_IDS,
  encodeConfig,
  decodeConfig,
} = require('../stremio/config.cjs');
const {
  parseStremioId,
  resolveStremioMetadata,
  clearMetadataCache,
} = require('../stremio/metadata.cjs');
const {
  buildManifest,
  getStremioStreams,
  diagnoseStremioStreams,
  clearResultCache,
  toStremioStream,
} = require('../stremio/addon.cjs');
const { createAddonServer } = require('../stremio/server.cjs');
const { ROOT, fixture, response } = require('./helpers.cjs');

test('Stremio manifest pasa stremio-addon-linter (validación check-deploy de Beamup) sin errores ni avisos', () => {
  const defaultManifest = buildManifest({}, { baseUrl: 'https://7e2a912be9c9-streamflix2.baby-beamup.club' });
  const lintDefault = lintManifest(defaultManifest);
  assert.equal(lintDefault.valid, true, JSON.stringify(lintDefault.errors));
  assert.equal(lintDefault.errors.length, 0);
  assert.equal(lintDefault.warnings.length, 0);
  assert.equal(defaultManifest.logo, 'https://7e2a912be9c9-streamflix2.baby-beamup.club/logo.svg');
  assert.deepEqual(defaultManifest.types, ['movie', 'series']);
  assert.equal(defaultManifest.behaviorHints.configurable, true);
  assert.equal(defaultManifest.behaviorHints.configurationRequired, false);

  const customManifest = buildManifest({
    providers: ['cinehax', 'cuevana'],
    lang: 'only-es-LAT',
    tmdbKey: 'secret-tmdb-key',
  });
  const lintCustom = lintManifest(customManifest);
  assert.equal(lintCustom.valid, true);
  assert.match(customManifest.description, /2 proveedores activos/);
  assert.match(customManifest.description, /Filtro LAT/);
  // Nunca filtrar claves privadas en la descripción pública del manifiesto
  assert.doesNotMatch(customManifest.description, /secret-tmdb-key/);
});

test('encodeConfig y decodeConfig preservan ajustes en formato URL-safe cfg_<base64url>', () => {
  assert.equal(encodeConfig({}), '');
  const input = {
    providers: ['cinehax', 'cuevana', 'sololatino'],
    lang: 'only-es-LAT',
    tmdbKey: 'tmdb_abc123',
    timeoutSec: 14,
  };
  const seg = encodeConfig(input);
  assert.match(seg, /^cfg_[A-Za-z0-9_-]+$/);
  const decoded = decodeConfig(seg, {});
  assert.deepEqual(decoded.providers, ['cinehax', 'cuevana', 'sololatino']);
  assert.equal(decoded.lang, 'only-es-LAT');
  assert.equal(decoded.tmdbKey, 'tmdb_abc123');
  assert.equal(decoded.timeoutSec, 14);

  const fromQuery = decodeConfig('providers=cinehax,cuevana&lang=prefer-es-ES', {});
  assert.deepEqual(fromQuery.providers, ['cinehax', 'cuevana']);
  assert.equal(fromQuery.lang, 'prefer-es-ES');
  assert.equal(decodeConfig('corrupt_segment_xyz', {}).providers.length, ACTIVE_IDS.length);
});

test('parseStremioId admite IMDb, TMDB y dos puntos codificados (%3A)', () => {
  assert.deepEqual(parseStremioId('movie', 'tt0137523'), {
    mediaType: 'movie', imdbId: 'tt0137523', tmdbId: '', season: null, episode: null,
  });
  assert.deepEqual(parseStremioId('series', 'tt0903747%3A2%3A3'), {
    mediaType: 'tv', imdbId: 'tt0903747', tmdbId: '', season: 2, episode: 3,
  });
  assert.deepEqual(parseStremioId('movie', 'tmdb:550'), {
    mediaType: 'movie', imdbId: '', tmdbId: '550', season: null, episode: null,
  });
  assert.deepEqual(parseStremioId('series', 'tmdb:1396:1:4'), {
    mediaType: 'tv', imdbId: '', tmdbId: '1396', season: 1, episode: 4,
  });
  assert.equal(parseStremioId('series', 'tt0903747'), null);
  assert.equal(parseStremioId('series', 'tt0903747:0:1'), null);
  assert.equal(parseStremioId('movie', 'tt0137523:1:1'), null);
  assert.equal(parseStremioId('channel', 'tt0137523'), null);
});

test('fallback Cinemeta sin TMDB_API_KEY alimenta tanto CineHax (moviedb_id) como proveedores de búsqueda', async () => {
  clearMetadataCache();
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://v3-cinemeta.strem.io/meta/movie/tt0137523.json') {
      return response({
        meta: {
          id: 'tt0137523',
          moviedb_id: 550,
          name: 'El club de la lucha',
          aliases: ['Fight Club'],
          releaseInfo: '1999',
        },
      }, url);
    }
    if (url.includes('api.moviemaster.lat/e/movie/550')) {
      return response('<script>window.PM_UI = "ui-demo";</script>', url);
    }
    if (url.includes('api.moviemaster.lat/servers?')) {
      return response({ servers: [{ id: 'lat-1', lang: 'LAT' }] }, url);
    }
    if (url.includes('api.moviemaster.lat/video?')) {
      return response({ url: 'https://cdn.example/fightclub/master.m3u8?token=a%2Bb' }, url);
    }
    if (url.includes('cuevana.gs/wp-api/v1/search?')) {
      return response({
        data: {
          posts: [{
            _id: 'm-550',
            slug: 'el-club-de-la-lucha',
            title: 'El club de la lucha',
            type: 'movies',
            release_date: '1999-10-15',
          }],
        },
      }, url);
    }
    if (url.includes('cuevana.gs/wp-api/v1/player?')) {
      return response({ data: { embeds: [{ url: 'https://voe.example/e/cast', lang: 'ESP', quality: '1080p' }] } }, url);
    }
    if (url === 'https://voe.example/e/cast') {
      return response(fixture('player-hls.html'), url);
    }
    throw new Error(`Ruta inesperada en test Cinemeta: ${url}`);
  };

  try {
    const result = await getStremioStreams({
      type: 'movie',
      id: 'tt0137523',
      config: {
        providers: ['cinehax', 'cuevana'],
      },
      env: {},
      useMetadataCache: false,
    });

    // Cinemeta se consultó exactamente 1 vez y ninguna llamada fue a api.themoviedb.org
    assert.equal(calls.filter((u) => u.includes('v3-cinemeta.strem.io')).length, 1);
    assert.equal(calls.filter((u) => u.includes('api.themoviedb.org')).length, 0);

    // 2 streams ordenados (es-LAT antes de es-ES) con behaviorHints.proxyHeaders
    assert.equal(result.streams.length, 2);
    assert.equal(result.streams[0].url, 'https://cdn.example/fightclub/master.m3u8?token=a%2Bb');
    assert.equal(result.streams[0].behaviorHints.notWebReady, true);
    assert.equal(result.streams[0].behaviorHints.proxyHeaders.request.Referer, 'https://api.moviemaster.lat/');
    assert.equal(result.streams[1].url, 'https://cdn.example/video/playlist.m3u8');
    assert.equal(result.streams[1].behaviorHints.notWebReady, true);
  } finally {
    global.fetch = originalFetch;
    clearMetadataCache();
  }
});

test('aislamiento concurrente AsyncLocalStorage entre dos usuarios con distintas TMDB_API_KEY', async () => {
  clearMetadataCache();
  const originalFetch = global.fetch;
  const seenApiKeys = new Map();

  global.fetch = async (input) => {
    const url = String(input);
    const keyMatch = url.match(/api_key=([^&]+)/);
    if (url.includes('api.themoviedb.org/3/movie/')) {
      const id = url.match(/\/movie\/(\d+)/)?.[1];
      seenApiKeys.set(`${id}:${keyMatch?.[1]}`, true);
      await new Promise((r) => setTimeout(r, id === '101' ? 25 : 5));
      return response({
        id: Number(id),
        title: `Pelicula ${id}`,
        original_title: `Movie ${id}`,
        release_date: '2024-05-01',
        external_ids: { imdb_id: `tt0000${id}` },
        alternative_titles: { titles: [] },
      }, url);
    }
    throw new Error(`Fetch inesperado: ${url}`);
  };

  try {
    const [metaA, metaB] = await Promise.all([
      resolveStremioMetadata(parseStremioId('movie', 'tmdb:101'), { tmdbKey: 'KEY_USER_A', useCache: false }),
      resolveStremioMetadata(parseStremioId('movie', 'tmdb:202'), { tmdbKey: 'KEY_USER_B', useCache: false }),
    ]);
    assert.equal(metaA.title, 'Pelicula 101');
    assert.equal(metaB.title, 'Pelicula 202');
    assert.equal(seenApiKeys.get('101:KEY_USER_A'), true);
    assert.equal(seenApiKeys.get('202:KEY_USER_B'), true);
    assert.equal(seenApiKeys.get('101:KEY_USER_B'), undefined);
    assert.equal(seenApiKeys.get('202:KEY_USER_A'), undefined);
  } finally {
    global.fetch = originalFetch;
    clearMetadataCache();
  }
});

test('servidor HTTP Stremio sirve manifest, configure sin filtrar secretos, streams con proxyHeaders, CORS y /nuvio/manifest.json', async () => {
  const fakeProvider = {
    async getStreams(_contentId, _mediaType, season, episode) {
      return [{
        name: 'ProveedorFake',
        provider: 'cuevana',
        title: 'Voe · es-LAT · 1080p',
        url: `https://cdn.example/s${season || 0}e${episode || 0}/master.m3u8`,
        quality: '1080p',
        language: 'es-LAT',
        type: 'hls',
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://voe.sx/' },
        subtitles: [{ url: 'https://cdn.example/subs/es.vtt', language: 'es-LAT', name: 'Español' }],
      }];
    },
  };

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/series/tt0903747.json')) {
      return response({
        meta: { id: 'tt0903747', moviedb_id: 1396, name: 'Breaking Bad', releaseInfo: '2008-2013' },
      }, url);
    }
    return originalFetch(input);
  };

  const env = {
    TMDB_API_KEY: 'SERVER_TMDB_SECRET_999',
  };

  const server = createAddonServer({
    env,
    providerLoader: () => fakeProvider,
    useMetadataCache: false,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. OPTIONS preflight CORS
    const optRes = await originalFetch(`${base}/manifest.json`, { method: 'OPTIONS' });
    assert.equal(optRes.status, 204);
    assert.equal(optRes.headers.get('access-control-allow-origin'), '*');

    // 2. /manifest.json con cabeceras X-Forwarded-* (como detrás del proxy de Beamup)
    const manRes = await originalFetch(`${base}/manifest.json`, {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': '7e2a912be9c9-streamflix2.baby-beamup.club',
      },
    });
    assert.equal(manRes.status, 200);
    const manJson = await manRes.json();
    assert.equal(lintManifest(manJson).valid, true);
    assert.equal(manJson.logo, 'https://7e2a912be9c9-streamflix2.baby-beamup.club/logo.svg');

    // 3. /configure nunca expone secretos del servidor en el HTML
    const cfgHtmlRes = await originalFetch(`${base}/configure`);
    assert.equal(cfgHtmlRes.status, 200);
    const cfgHtml = await cfgHtmlRes.text();
    assert.match(cfgHtml, /STREAMFLIX2/);
    assert.doesNotMatch(cfgHtml, /SERVER_TMDB_SECRET_999/);

    // 4. /:config/stream/series/tt0903747%3A2%3A3.json con behaviorHints.proxyHeaders
    const seg = encodeConfig({ providers: ['cuevana'] });
    const streamRes = await originalFetch(`${base}/${seg}/stream/series/tt0903747%3A2%3A3.json`);
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get('cache-control') || '', /max-age=600/);
    const streamJson = await streamRes.json();
    assert.equal(streamJson.streams.length, 1);
    assert.equal(streamJson.streams[0].url, 'https://cdn.example/s2e3/master.m3u8');
    assert.equal(streamJson.streams[0].behaviorHints.notWebReady, true);
    assert.equal(streamJson.streams[0].behaviorHints.proxyHeaders.request.Referer, 'https://voe.sx/');
    assert.deepEqual(streamJson.streams[0].subtitles, [
      { id: 'cuevana-sub-1', url: 'https://cdn.example/subs/es.vtt', lang: 'spa' },
    ]);

    // 5. Coexistencia con Nuvio bajo /nuvio/manifest.json y /nuvio/providers/cinehax.js
    const nuvioRes = await originalFetch(`${base}/nuvio/manifest.json`);
    assert.equal(nuvioRes.status, 200);
    const nuvioJson = await nuvioRes.json();
    const diskNuvio = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    assert.deepEqual(nuvioJson, diskNuvio);

    const bundleRes = await originalFetch(`${base}/nuvio/providers/cinehax.js`);
    assert.equal(bundleRes.status, 200);
    assert.match(await bundleRes.text(), /getStreams/);

    // Bloqueo de path traversal
    const blockedRes = await originalFetch(`${base}/nuvio/package.json`);
    assert.equal(blockedRes.status, 404);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('la preferencia `gateway` viaja en cfg_ y la env del servidor manda como techo', () => {
  // Codificar/decodificar la preferencia del usuario
  const seg = encodeConfig({ gateway: 'off' });
  assert.match(seg, /^cfg_/);
  assert.equal(decodeConfig(seg, {}).gateway, 'off');
  assert.equal(encodeConfig({ gateway: 'auto' }), '');
  assert.equal(decodeConfig(encodeConfig({ gateway: 'on' }), {}).gateway, 'on');
  // Un valor desconocido cae en `auto` en lugar de romper la configuración
  assert.equal(decodeConfig('cfg_' + Buffer.from(JSON.stringify({ g: 'raro' })).toString('base64url'), {}).gateway, 'auto');

  // Y el addon la aplica: servidor apagado + usuario pidiendo `on` → directo
  const stream = {
    name: 'P', provider: 'voe', url: 'https://cdn.example/master.m3u8', type: 'hls',
    quality: '1080p', language: 'es-LAT', headers: { Referer: 'https://voe.sx/' },
  };
  const context = { metadata: { title: 'Demo' }, parsed: { mediaType: 'movie' }, baseUrl: 'https://addon.test' };
  const userOff = toStremioStream(stream, {
    ...context, gateway: { enabled: false, mode: 'off', serverMode: 'auto' },
  });
  assert.equal(userOff.behaviorHints.streamflix2Transport, 'proxy-headers');
  assert.equal(userOff.url, 'https://cdn.example/master.m3u8');
});

test('el addon no activa la pasarela si el usuario la desactiva (config.gateway=off)', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt4444444.json')) {
      return response({ meta: { id: 'tt4444444', moviedb_id: 555, name: 'SinProxy', releaseInfo: '2023' } }, url);
    }
    return originalFetch(input);
  };
  const fakeProvider = {
    async getStreams() {
      return [{
        name: 'ProveedorFake', provider: 'voe', url: 'https://cdn.example/a/master.m3u8',
        type: 'hls', quality: '1080p', language: 'es-LAT', headers: { Referer: 'https://voe.sx/' },
      }];
    },
  };
  const server = createAddonServer({
    env: { STREAM_GATEWAY: 'auto' },
    providerLoader: () => fakeProvider,
    useMetadataCache: false,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const userSeg = encodeConfig({ providers: ACTIVE_IDS, gateway: 'off' });
    const res = await fetch(`${base}/${userSeg}/stream/movie/tt4444444.json`);
    const json = await res.json();
    assert.equal(json.streams.length, 1);
    assert.equal(json.streams[0].url, 'https://cdn.example/a/master.m3u8');
    assert.equal(json.streams[0].behaviorHints.streamflix2Transport, 'proxy-headers');
    assert.equal(json.streams[0].behaviorHints.proxyHeaders.request.Referer, 'https://voe.sx/');
  } finally {
    global.fetch = originalFetch;
    clearResultCache();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/health publica el estado de la pasarela y /g/ responde 404 con STREAM_GATEWAY=off (predeterminado)', async () => {
  clearResultCache();
  const server = createAddonServer({ env: {}, providerLoader: () => ({ async getStreams() { return []; } }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.gateway.mode, 'off');
    assert.equal(health.gateway.enabled, false);
    assert.equal(health.gateway.bytesToday, 0);

    const res = await fetch(`${base}/g/segment?t=invalido`);
    assert.equal(res.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('con STREAM_GATEWAY=auto los HLS con cabeceras salen firmados por la pasarela', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt3333333.json')) {
      return response({
        meta: { id: 'tt3333333', moviedb_id: 999, name: 'Pasarela', releaseInfo: '2022' },
      }, url);
    }
    return originalFetch(input);
  };

  const fakeProvider = {
    async getStreams() {
      return [{
        name: 'ProveedorFake',
        provider: 'sololatino',
        title: 'Voe · es-LAT · 1080p',
        url: 'https://cdn.example/pelicula/master.m3u8',
        quality: '1080p',
        language: 'es-LAT',
        type: 'hls',
        headers: { Referer: 'https://sololatino.test/' },
      }];
    },
  };

  const server = createAddonServer({
    env: { STREAM_GATEWAY: 'auto' },
    providerLoader: () => fakeProvider,
    useMetadataCache: false,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/stream/movie/tt3333333.json`);
    const json = await res.json();
    assert.equal(json.streams.length, 1);
    const [stream] = json.streams;
    assert.ok(stream.url.startsWith(`${base}/g/playlist.m3u8?t=`), stream.url);
    assert.equal(stream.behaviorHints.proxyHeaders, undefined);
    assert.equal(stream.behaviorHints.notWebReady, true);
    assert.equal(stream.behaviorHints.streamflix2Transport, 'gateway');
  } finally {
    global.fetch = originalFetch;
    clearResultCache();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('el manifiesto omite `logo` cuando la URL base no tiene dominio válido (caso Beamup truncado)', () => {
  const manifest = buildManifest({}, { baseUrl: 'https://7e2a912be9c9-streamflix2' });
  assert.equal(manifest.logo, undefined);
  assert.equal(lintManifest(manifest).valid, true);
  const good = buildManifest({}, { baseUrl: 'https://7e2a912be9c9-streamflix2.baby-beamup.club/' });
  assert.equal(good.logo, 'https://7e2a912be9c9-streamflix2.baby-beamup.club/logo.svg');
});

test('plazo duro: responde con resultados parciales y luego entrega el completo desde caché', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt1111111.json')) {
      return response({
        meta: { id: 'tt1111111', moviedb_id: 777, name: 'Rapida', releaseInfo: '2020' },
      }, url);
    }
    return originalFetch(input);
  };

  const fast = {
    async getStreams() {
      return [{
        name: 'Rapido', provider: 'cuevana', url: 'https://cdn.example/fast/master.m3u8',
        quality: '1080p', language: 'es-LAT', type: 'hls',
      }];
    },
  };
  const slow = {
    async getStreams() {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return [{
        name: 'Lento', provider: 'cinehax', url: 'https://cdn.example/slow/master.m3u8',
        quality: '1080p', language: 'es-LAT', type: 'hls',
      }];
    },
  };
  const providerLoader = (id) => (id === 'cinehax' ? slow : fast);
  const params = {
    type: 'movie',
    id: 'tt1111111',
    config: { providers: ['cinehax', 'cuevana'] },
    env: {},
    providerLoader,
    useMetadataCache: false,
    deadlineMs: 80,
  };

  try {
    const startedAt = Date.now();
    const partial = await getStremioStreams(params);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 240, `debe responder sin esperar al proveedor lento (${elapsed} ms)`);
    assert.equal(partial.streams.length, 1);
    assert.equal(partial.partial, true);

    // El trabajo continúa en segundo plano y deja el resultado completo en caché.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const cached = await getStremioStreams(params);
    assert.equal(cached.cached, true);
    assert.equal(cached.streams.length, 2);
    assert.equal(cached.partial, undefined);
  } finally {
    global.fetch = originalFetch;
    clearResultCache();
  }
});

test('streams vacíos se sirven con no-store y /diagnostico informa tiempo y resultado por proveedor', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt2222222.json')) {
      return response({
        meta: { id: 'tt2222222', moviedb_id: 888, name: 'Vacia', releaseInfo: '2021' },
      }, url);
    }
    return originalFetch(input);
  };

  const emptyProvider = { async getStreams() { return []; } };
  const server = createAddonServer({
    env: {},
    providerLoader: () => emptyProvider,
    useMetadataCache: false,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await originalFetch(`${base}/stream/movie/tt2222222.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0');
    assert.deepEqual(await res.json(), { streams: [] });

    const diagRes = await originalFetch(`${base}/diagnostico/stream/movie/tt2222222.json`);
    assert.equal(diagRes.status, 200);
    assert.equal(diagRes.headers.get('cache-control'), 'no-store');
    const diagJson = await diagRes.json();
    assert.equal(diagJson.ok, true);
    assert.equal(diagJson.streams, 0);
    assert.ok(diagJson.results.length >= 1);
    assert.equal(typeof diagJson.results[0].ms, 'number');
    assert.equal(typeof diagJson.deadlineMs, 'number');

    const helpRes = await originalFetch(`${base}/diagnostico`);
    const helpJson = await helpRes.json();
    assert.match(helpJson.uso, /diagnostico\/stream/);
  } finally {
    global.fetch = originalFetch;
    clearResultCache();
    await new Promise((resolve) => server.close(resolve));
  }
});
