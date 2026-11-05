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
  isPrivateOrReservedHost,
  buildNginxProxyUrl,
} = require('../stremio/proxy.cjs');
const {
  parseStremioId,
  resolveStremioMetadata,
  clearMetadataCache,
} = require('../stremio/metadata.cjs');
const {
  buildManifest,
  getStremioStreams,
} = require('../stremio/addon.cjs');
const { createAddonServer } = require('../stremio/server.cjs');
const {
  renderNginxConfig,
  validateRenderedNginxConfig,
} = require('../nginx/render-config.cjs');
const { ROOT, fixture, response } = require('./helpers.cjs');

test('Stremio manifest pasa stremio-addon-linter (validación check-deploy de Beamup) sin errores ni avisos', () => {
  const defaultManifest = buildManifest({}, { baseUrl: 'https://demo-streamflix2.baby-beamup.club' });
  const lintDefault = lintManifest(defaultManifest);
  assert.equal(lintDefault.valid, true, JSON.stringify(lintDefault.errors));
  assert.equal(lintDefault.errors.length, 0);
  assert.equal(lintDefault.warnings.length, 0);
  assert.equal(defaultManifest.logo, 'https://demo-streamflix2.baby-beamup.club/logo.svg');
  assert.deepEqual(defaultManifest.types, ['movie', 'series']);
  assert.equal(defaultManifest.behaviorHints.configurable, true);
  assert.equal(defaultManifest.behaviorHints.configurationRequired, false);

  const customManifest = buildManifest({
    providers: ['cinehax', 'cuevana'],
    lang: 'only-es-LAT',
    proxyMode: 'nginx',
    proxyUrl: 'https://proxy.example.com',
    proxyToken: 'super-secret-token',
    tmdbKey: 'secret-tmdb-key',
  });
  const lintCustom = lintManifest(customManifest);
  assert.equal(lintCustom.valid, true);
  assert.match(customManifest.description, /2 proveedores activos/);
  assert.match(customManifest.description, /Proxy Nginx externo activo/);
  // Nunca filtrar claves privadas en la descripción pública del manifiesto
  assert.doesNotMatch(customManifest.description, /super-secret-token|secret-tmdb-key/);
});

test('encodeConfig y decodeConfig preservan ajustes en formato URL-safe cfg_<base64url>', () => {
  assert.equal(encodeConfig({}), '');
  const input = {
    providers: ['cinehax', 'cuevana', 'sololatino'],
    lang: 'only-es-LAT',
    proxyMode: 'both',
    proxyAll: true,
    proxyUrl: 'https://proxy.midominio.com/hlsp/',
    proxyToken: 'mi_token-123',
    tmdbKey: 'tmdb_abc123',
    timeoutSec: 14,
  };
  const seg = encodeConfig(input);
  assert.match(seg, /^cfg_[A-Za-z0-9_-]+$/);
  const decoded = decodeConfig(seg, {});
  assert.deepEqual(decoded.providers, ['cinehax', 'cuevana', 'sololatino']);
  assert.equal(decoded.lang, 'only-es-LAT');
  assert.equal(decoded.proxyMode, 'both');
  assert.equal(decoded.proxyAll, true);
  assert.equal(decoded.proxyUrl, 'https://proxy.midominio.com');
  assert.equal(decoded.proxyToken, 'mi_token-123');
  assert.equal(decoded.tmdbKey, 'tmdb_abc123');
  assert.equal(decoded.timeoutSec, 14);

  const fromQuery = decodeConfig('providers=cinehax,cuevana&lang=prefer-es-ES&proxyMode=nginx', {});
  assert.deepEqual(fromQuery.providers, ['cinehax', 'cuevana']);
  assert.equal(fromQuery.lang, 'prefer-es-ES');
  assert.equal(fromQuery.proxyMode, 'nginx');
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

test('buildNginxProxyUrl conserva firmas %XX de query y bloquea objetivos SSRF', () => {
  const signedStream = 'https://cdn-edge.voe.example/hls/master.m3u8?sig=a%2Bb%3Dc&exp=1999999999';
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://voe.sx/e/abc123' };

  const openUrl = buildNginxProxyUrl(signedStream, headers, {
    proxyUrl: 'https://nginx.midominio.com/',
  });
  assert.equal(
    openUrl,
    'https://nginx.midominio.com/hlsp/https/voe.sx/https/cdn-edge.voe.example/hls/master.m3u8?sig=a%2Bb%3Dc&exp=1999999999',
  );

  const tokenUrl = buildNginxProxyUrl(signedStream, headers, {
    proxyUrl: 'https://nginx.midominio.com',
    proxyToken: 'clave.segura_1',
  });
  assert.equal(
    tokenUrl,
    'https://nginx.midominio.com/hlsp/t/clave.segura_1/https/voe.sx/https/cdn-edge.voe.example/hls/master.m3u8?sig=a%2Bb%3Dc&exp=1999999999',
  );

  const noRefererUrl = buildNginxProxyUrl('https://cdn.example/video.mp4', {}, {
    proxyUrl: 'https://nginx.midominio.com',
  });
  assert.equal(noRefererUrl, 'https://nginx.midominio.com/hlsp/https/_/https/cdn.example/video.mp4');

  for (const blocked of [
    'http://127.0.0.1/secret.m3u8',
    'http://localhost:8080/video.mp4',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.25/stream.m3u8',
    'http://10.0.0.5/stream.m3u8',
    'http://172.20.0.2/stream.m3u8',
    'http://[::1]/stream.m3u8',
    'https://cdn.example:9200/stream.m3u8',
  ]) {
    assert.equal(buildNginxProxyUrl(blocked, headers, { proxyUrl: 'https://nginx.midominio.com' }), null, blocked);
  }
  assert.equal(isPrivateOrReservedHost('cdn.voe.example'), false);
  assert.equal(isPrivateOrReservedHost('172.32.0.1'), false);
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
        proxyMode: 'both',
        proxyUrl: 'https://proxy.midominio.com',
        proxyToken: 'tok99',
      },
      env: {},
      useMetadataCache: false,
    });

    // Cinemeta se consultó exactamente 1 vez y ninguna llamada fue a api.themoviedb.org
    assert.equal(calls.filter((u) => u.includes('v3-cinemeta.strem.io')).length, 1);
    assert.equal(calls.filter((u) => u.includes('api.themoviedb.org')).length, 0);

    // 2 streams originales × modo 'both' (directo + proxy Nginx) = 4 entradas ordenadas (es-LAT antes de es-ES)
    assert.equal(result.streams.length, 4);
    assert.equal(result.streams[0].url, 'https://cdn.example/fightclub/master.m3u8?token=a%2Bb');
    assert.equal(result.streams[0].behaviorHints.notWebReady, true);
    assert.equal(result.streams[0].behaviorHints.proxyHeaders.request.Referer, 'https://api.moviemaster.lat/');

    assert.equal(
      result.streams[1].url,
      'https://proxy.midominio.com/hlsp/t/tok99/https/api.moviemaster.lat/https/cdn.example/fightclub/master.m3u8?token=a%2Bb',
    );
    assert.equal(result.streams[1].behaviorHints.proxyHeaders, undefined);
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

test('servidor HTTP Stremio sirve manifest, configure sin filtrar secretos, streams, CORS y /nuvio/manifest.json', async () => {
  const fakeProvider = {
    async getStreams(contentId, mediaType, season, episode) {
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
    TMDB_API_KEY: '',
    NGINX_PROXY_URL: 'https://edge-nginx.example.org',
    NGINX_PROXY_TOKEN: 'SERVER_SECRET_999',
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

    // 2. /manifest.json con cabeceras X-Forwarded-* (como detrás de Nginx externo)
    const manRes = await originalFetch(`${base}/manifest.json`, {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'addon.midominio.com',
      },
    });
    assert.equal(manRes.status, 200);
    const manJson = await manRes.json();
    assert.equal(lintManifest(manJson).valid, true);
    assert.equal(manJson.logo, 'https://addon.midominio.com/logo.svg');

    // 3. /configure nunca expone secretos del servidor en el HTML
    const cfgHtmlRes = await originalFetch(`${base}/configure`);
    assert.equal(cfgHtmlRes.status, 200);
    const cfgHtml = await cfgHtmlRes.text();
    assert.match(cfgHtml, /STREAMFLIX2/);
    assert.doesNotMatch(cfgHtml, /SERVER_SECRET_999/);

    // 4. /:config/stream/series/tt0903747%3A2%3A3.json en modo nginx usando token del servidor
    const seg = encodeConfig({ providers: ['cuevana'], proxyMode: 'nginx' });
    const streamRes = await originalFetch(`${base}/${seg}/stream/series/tt0903747%3A2%3A3.json`);
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get('cache-control') || '', /max-age=900/);
    const streamJson = await streamRes.json();
    assert.equal(streamJson.streams.length, 1);
    assert.equal(
      streamJson.streams[0].url,
      'https://edge-nginx.example.org/hlsp/t/SERVER_SECRET_999/https/voe.sx/https/cdn.example/s2e3/master.m3u8',
    );
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

test('plantilla Nginx externa renderiza válidamente con y sin token y conserva variables runtime de Nginx', () => {
  const openConf = renderNginxConfig({
    NGINX_PORT: '8080',
    SERVER_NAME: 'streamflix.midominio.com',
    BEAMUP_SCHEME: 'https',
    BEAMUP_HOST: 'abc123def456-streamflix2.baby-beamup.club',
    NGINX_PROXY_TOKEN: '',
  });
  assert.equal(validateRenderedNginxConfig(openConf), true);
  assert.match(openConf, /proxy_set_header Host abc123def456-streamflix2\.baby-beamup\.club;/);
  assert.match(openConf, /proxy_pass \$hlsp_target_scheme:\/\/\$hlsp_target_host\$hlsp_raw_tail;/);

  const tokenConf = renderNginxConfig({
    NGINX_PORT: '80',
    SERVER_NAME: '_',
    BEAMUP_SCHEME: 'https',
    BEAMUP_HOST: 'abc123def456-streamflix2.baby-beamup.club',
    NGINX_PROXY_TOKEN: 'Token_Seguro-2026',
  });
  assert.equal(validateRenderedNginxConfig(tokenConf), true);
  assert.match(tokenConf, /map "\$hlsp_req_token:Token_Seguro-2026" \$hlsp_auth_denied/);
});
