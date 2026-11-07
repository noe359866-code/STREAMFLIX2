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
} = require('../stremio/addon.cjs');
const { createAddonServer } = require('../stremio/server.cjs');
const { ROOT, fixture, response, loadSource } = require('./helpers.cjs');

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
  assert.match(defaultManifest.description, /34 proveedores activos/);
  assert.ok(ACTIVE_IDS.includes('gnulaone'));
  assert.ok(ACTIVE_IDS.includes('repelis24'));
  assert.ok(!ACTIVE_IDS.includes('tukiplay'));
  assert.ok(!ACTIVE_IDS.includes('cinehax'));
  assert.ok(ACTIVE_IDS.includes('tudorama'));
  assert.ok(ACTIVE_IDS.includes('vixsrc'));
  assert.ok(!ACTIVE_IDS.includes('warezcdn'));

  const customManifest = buildManifest({
    providers: ['videoapi', 'cuevana'],
    lang: 'only-es-LAT',
    tmdbKey: 'secret-tmdb-key',
  });
  const lintCustom = lintManifest(customManifest);
  assert.equal(lintCustom.valid, true);
  assert.match(customManifest.description, /2 proveedores activos/);
  assert.match(customManifest.description, /Filtro LAT/);

  assert.doesNotMatch(customManifest.description, /secret-tmdb-key/);
});

test('encodeConfig y decodeConfig preservan ajustes en formato URL-safe cfg_<base64url>', () => {
  assert.equal(encodeConfig({}), '');
  const input = {
    providers: ['videoapi', 'cuevana', 'sololatino'],
    lang: 'only-es-LAT',
    tmdbKey: 'tmdb_abc123',
    timeoutSec: 14,
  };
  const seg = encodeConfig(input);
  assert.match(seg, /^cfg_[A-Za-z0-9_-]+$/);
  const decoded = decodeConfig(seg, {});
  assert.deepEqual(decoded.providers, ['videoapi', 'cuevana', 'sololatino']);
  assert.equal(decoded.lang, 'only-es-LAT');
  assert.equal(decoded.tmdbKey, 'tmdb_abc123');
  assert.equal(decoded.timeoutSec, 14);

  const fromQuery = decodeConfig('providers=videoapi,cuevana&lang=prefer-es-ES', {});
  assert.deepEqual(fromQuery.providers, ['videoapi', 'cuevana']);
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

test('fallback Cinemeta sin TMDB_API_KEY alimenta tanto VideoAPI (moviedb_id) como proveedores de búsqueda', async () => {
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
    if (url.includes('videoapi.la/api/v1/public/exists/movie/550')) {
      return response({ exists: true, path: '/e/movie/550' }, url);
    }
    if (url.includes('videoapi.la/e/movie/550')) {
      return response('<script>const source = { file: "https://cdn.example/fightclub/master.m3u8?token=a%2Bb", type: "application/x-mpegURL" };</script>', url);
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
        providers: ['videoapi', 'cuevana'],
      },
      env: {},
      useMetadataCache: false,
    });


    assert.equal(calls.filter((u) => u.includes('v3-cinemeta.strem.io')).length, 1);
    assert.equal(calls.filter((u) => u.includes('api.themoviedb.org')).length, 0);



    assert.equal(result.streams.length, 2);
    const direct = result.streams.find((stream) => stream.url.includes('/fightclub/master.m3u8'));
    const searched = result.streams.find((stream) => stream.url.includes('/video/playlist.m3u8'));
    assert.ok(direct && searched);
    assert.equal(direct.url, 'https://cdn.example/fightclub/master.m3u8?token=a%2Bb');
    assert.equal(direct.behaviorHints.notWebReady, true);
    assert.equal(direct.behaviorHints.proxyHeaders.request.Referer, 'https://videoapi.la/e/movie/550');
    assert.equal(searched.behaviorHints.notWebReady, true);
  } finally {
    global.fetch = originalFetch;
    clearMetadataCache();
  }
});

test('el addon Stremio no publica el MP4 HTML que el plugin filtró y conserva otro medio válido', async () => {
  clearResultCache();
  clearMetadataCache();
  const originalFetch = global.fetch;
  const { providerGuard, makeStream } = loadSource('src/core/streams.js');
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt0137523.json')) {
      return response({ meta: { id: 'tt0137523', moviedb_id: 550, name: 'Fight Club', releaseInfo: '1999' } }, url);
    }
    if (url === 'https://cdn.example/bad.mp4') {
      return new Response('<html>No es vídeo</html>', { headers: { 'Content-Type': 'text/html' } });
    }
    if (url === 'https://cdn.example/good.mp4') {
      return new Response(Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109]), { status: 206 });
    }
    throw new Error(`Petición inesperada: ${url}`);
  };
  const testProvider = { getStreams: providerGuard('VideoAPI', async () => [
    makeStream('VideoAPI', 'https://cdn.example/bad.mp4', { providerId: 'videoapi' }),
    makeStream('VideoAPI', 'https://cdn.example/good.mp4', { providerId: 'videoapi' }),
  ]) };
  try {
    const params = {
      type: 'movie', id: 'tt0137523', config: { providers: ['videoapi'] },
      env: { PROXY_SCRAPING: 'off' }, providerLoader: () => testProvider, useMetadataCache: false,
    };
    const result = await getStremioStreams(params);
    assert.deepEqual(result.streams.map((item) => item.url), ['https://cdn.example/good.mp4']);
    assert.ok(calls.some((item) => item.url.endsWith('/bad.mp4') && item.init.headers?.Range));
    assert.equal((await getStremioStreams(params)).streams.length, 1, 'no cachear el medio inválido');
  } finally {
    global.fetch = originalFetch;
    clearResultCache();
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

    const optRes = await originalFetch(`${base}/manifest.json`, { method: 'OPTIONS' });
    assert.equal(optRes.status, 204);
    assert.equal(optRes.headers.get('access-control-allow-origin'), '*');


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


    const cfgHtmlRes = await originalFetch(`${base}/configure`);
    assert.equal(cfgHtmlRes.status, 200);
    const cfgHtml = await cfgHtmlRes.text();
    assert.match(cfgHtml, /STREAMFLIX2/);
    assert.doesNotMatch(cfgHtml, /SERVER_TMDB_SECRET_999/);


    const seg = encodeConfig({ providers: ['cuevana'] });
    const streamRes = await originalFetch(`${base}/${seg}/stream/series/tt0903747%3A2%3A3.json`);
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get('cache-control') || '', /max-age=60/);
    const streamJson = await streamRes.json();
    assert.equal(streamJson.streams.length, 1);
    assert.equal(streamJson.streams[0].url, 'https://cdn.example/s2e3/master.m3u8');
    assert.equal(streamJson.streams[0].behaviorHints.notWebReady, true);
    assert.equal(streamJson.streams[0].behaviorHints.proxyHeaders.request.Referer, 'https://voe.sx/');
    assert.deepEqual(streamJson.streams[0].subtitles, [
      { id: 'cuevana-sub-1', url: 'https://cdn.example/subs/es.vtt', lang: 'spa' },
    ]);


    const nuvioRes = await originalFetch(`${base}/nuvio/manifest.json`);
    assert.equal(nuvioRes.status, 200);
    const nuvioJson = await nuvioRes.json();
    const diskNuvio = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    assert.deepEqual(nuvioJson, diskNuvio);

    const bundleRes = await originalFetch(`${base}/nuvio/providers/videoapi.js`);
    assert.equal(bundleRes.status, 200);
    assert.match(await bundleRes.text(), /getStreams/);


    const blockedRes = await originalFetch(`${base}/nuvio/package.json`);
    assert.equal(blockedRes.status, 404);
  } finally {
    global.fetch = originalFetch;
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
        name: 'Lento', provider: 'videoapi', url: 'https://cdn.example/slow/master.m3u8',
        quality: '1080p', language: 'es-LAT', type: 'hls',
      }];
    },
  };
  const providerLoader = (id) => (id === 'videoapi' ? slow : fast);
  const params = {
    type: 'movie',
    id: 'tt1111111',
    config: { providers: ['videoapi', 'cuevana'] },
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

test('PelisJuanita y PelisGo inician antes de la cola del addon sin cambiar el plugin', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt3333333.json')) {
      return response({ meta: { id: 'tt3333333', moviedb_id: 999, name: 'Prueba', releaseInfo: '2020' } }, url);
    }
    return originalFetch(input);
  };
  const started = [];
  try {
    const result = await getStremioStreams({
      type: 'movie', id: 'tt3333333',
      config: { providers: ['cuevana', 'videoapi', 'pelisjuanita', 'pelisgo'] },
      env: { ADDON_CONCURRENCY: '2', PROXY_SCRAPING: 'off' },
      providerLoader: (id) => ({ async getStreams() {
        started.push(id);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [{ name: id, provider: id, url: `https://cdn.example/${id}.m3u8`, quality: '720p', language: 'es-LAT' }];
      } }),
      useMetadataCache: false,
      deadlineMs: 50,
    });
    assert.deepEqual(new Set(started.slice(0, 2)), new Set(['pelisjuanita', 'pelisgo']));
    assert.equal(result.streams.length, 2);
  } finally {
    global.fetch = originalFetch;
    clearResultCache();
  }
});

test('el plazo incluye los metadatos y no cachea una respuesta agotada', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return response({ meta: { id: 'tt4444444', name: 'Prueba' } }, String(input));
  };
  try {
    const start = Date.now();
    const result = await getStremioStreams({ type: 'movie', id: 'tt4444444', env: {}, useMetadataCache: false, deadlineMs: 50 });
    assert.ok(Date.now() - start < 140);
    assert.deepEqual(result.streams, []);
    assert.equal(result.noStore, true);
    assert.equal(result.partial, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('el plazo del addon por defecto y su máximo son 60 segundos', () => {
  const { resolveDeadlineMs } = require('../stremio/addon.cjs');
  assert.equal(resolveDeadlineMs({}), 60000);
  assert.equal(resolveDeadlineMs({ ADDON_DEADLINE_MS: '90000' }), 60000);
  assert.equal(resolveDeadlineMs({ ADDON_DEADLINE_MS: '15000' }), 15000);
});

test('el addon consulta Videoapp a través del proveedor compartido VideoAPI', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt5555555.json')) {
      return response({ meta: { id: 'tt5555555', moviedb_id: 12345, name: 'Prueba', releaseInfo: '2020' } }, url);
    }
    if (url === 'https://videoapp.zip/e/movie/12345') return new Response('<iframe id="frame" src="https://lamovie.link/embed/test"></iframe>');
    if (url === 'https://lamovie.link/embed/test') return new Response('<script>const data={"stream_urls":["https://cdn.example/test.m3u8"],"default_subs":[{"url":"https://cdn.example/es.vtt","lang":"es"}]};</script>');
    return new Response('', { status: 503 });
  };
  try {
    const result = await getStremioStreams({
      type: 'movie', id: 'tt5555555', config: { providers: ['videoapi'] },
      env: { PROXY_SCRAPING: 'off' }, useMetadataCache: false,
    });
    assert.ok(calls.includes('https://videoapp.zip/e/movie/12345'));
    const stream = result.streams.find((item) => item.url === 'https://cdn.example/test.m3u8');
    assert.ok(stream);
    assert.equal(stream.subtitles[0].lang, 'spa');
  } finally { global.fetch = originalFetch; clearResultCache(); }
});

test('el addon conserva los subtítulos extraídos del proveedor', () => {
  const { toStremioStream } = require('../stremio/addon.cjs');
  const stream = toStremioStream({
    name: 'Voe', provider: 'cuevana', url: 'https://cdn.example/master.m3u8', type: 'hls', language: 'es-SUB',
    subtitles: [{ url: 'https://cdn.example/es.vtt', language: 'Español' }, { url: 'https://cdn.example/en.srt', language: 'English' }],
  }, { metadata: { title: 'Prueba' }, parsed: { mediaType: 'movie' }, config: { lang: 'all' } });
  assert.deepEqual(stream.subtitles.map(({ url, lang }) => ({ url, lang })), [
    { url: 'https://cdn.example/es.vtt', lang: 'spa' },
    { url: 'https://cdn.example/en.srt', lang: 'eng' },
  ]);
});

test('el addon transmite al reproductor las cabeceras específicas de VidMoly', () => {
  const { toStremioStream } = require('../stremio/addon.cjs');
  const headers = { 'User-Agent': 'Chrome/91.0.4472.124', Referer: 'https://vidmoly.to/' };
  const stream = toStremioStream({ name: 'VidMoly', provider: 'seriesturcas', url: 'https://cdn.example/master.m3u8', type: 'hls', headers }, {
    metadata: { title: 'Prueba' }, parsed: { mediaType: 'movie' }, config: { lang: 'all' },
  });
  assert.deepEqual(stream.behaviorHints.proxyHeaders.request, headers);
});

test('la caché de respuestas no sobrepasa la caducidad de URLs firmadas', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt6666666.json')) return response({ meta: { id: 'tt6666666', moviedb_id: 666, name: 'Prueba' } }, url);
    return originalFetch(input);
  };
  const expiry = Math.floor(Date.now() / 1000) + 45;
  const loader = () => ({ async getStreams() { return [{ name: 'Prueba', provider: 'videoapi', url: `https://cdn.example/master.m3u8?expires=${expiry}`, type: 'hls', language: 'es' }]; } });
  const params = { type: 'movie', id: 'tt6666666', config: { providers: ['videoapi'] }, env: { PROXY_SCRAPING: 'off' }, providerLoader: loader, useMetadataCache: false };
  try {
    const result = await getStremioStreams(params);
    assert.equal(result.streams.length, 1);
    assert.ok(result.cacheMaxAge > 0 && result.cacheMaxAge <= 15);
    assert.equal(result.staleError, undefined);
    const cached = await getStremioStreams(params);
    assert.equal(cached.cached, true);
    assert.ok(cached.cacheMaxAge <= result.cacheMaxAge);
  } finally { global.fetch = originalFetch; clearResultCache(); }
});

test('descarta enlaces con caducidad conocida ya vencida', async () => {
  clearResultCache();
  const originalFetch = global.fetch;
  global.fetch = async (input) => response({ meta: { id: 'tt7777777', moviedb_id: 777, name: 'Prueba' } }, String(input));
  try {
    const result = await getStremioStreams({ type: 'movie', id: 'tt7777777', config: { providers: ['videoapi'] }, env: { PROXY_SCRAPING: 'off' }, useMetadataCache: false,
      providerLoader: () => ({ async getStreams() { return [{ name: 'Prueba', provider: 'videoapi', url: `https://cdn.example/master.m3u8?expires=${Math.floor(Date.now() / 1000) - 1}`, type: 'hls' }]; } }) });
    assert.deepEqual(result.streams, []);
    assert.equal(result.noStore, true);
  } finally { global.fetch = originalFetch; clearResultCache(); }
});
