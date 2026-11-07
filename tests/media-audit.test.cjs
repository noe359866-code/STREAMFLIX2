'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMedia, classifyProvider, playlistUris, discoveryStage } = require('../scripts/media-audit-lib.cjs');

const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(30)]);
const TS = Buffer.alloc(376);
TS[0] = TS[188] = 0x47;

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    calls.push({ url, range: init.headers.get('Range') });
    const reply = routes[url];
    assert.ok(reply, `Falta fixture para ${url}`);
    const response = typeof reply === 'function' ? reply(init) : reply;
    return new Response(response.body || '', {
      status: response.status || 200,
      headers: { 'Content-Type': response.contentType || 'application/octet-stream' },
    });
  };
  return { fetchImpl, calls };
}

const movie = (url, headers = {}) => ({ type: 'mp4', url, headers });
const hls = (url, headers = {}) => ({ type: 'hls', url, headers });

test('clasifica el descubrimiento sin guardar rutas ni parámetros firmados', () => {
  assert.equal(discoveryStage('https://site.example/?s=Película'), 'busqueda');
  assert.equal(discoveryStage('https://site.example/search-route'), 'busqueda');
  assert.equal(discoveryStage('https://site.example/busqueda/episodio'), 'busqueda');
  assert.equal(discoveryStage('https://site.example/catalogo?search=serie'), 'busqueda');
  assert.equal(discoveryStage('https://site.example/pelicula/slug-secreto/'), 'ficha');
  assert.equal(discoveryStage('https://site.example/wp-json/dooplayer/v2/123/movie/1'), 'player-api');
  assert.equal(discoveryStage('https://site.example/custom/movie/tt123'), 'player-api');
  assert.equal(discoveryStage('https://cdn.example/path/playlist.m3u8?token=privado'), 'posible-medio');
  assert.equal(discoveryStage('https://sv4.ibra.lat/?s=firmado'), 'posible-medio');
  assert.equal(discoveryStage('no es una URL'), 'otro');
});

test('MP4: GET acotado con Range y firma; 403 en Range + GET es bloqueo del medio', async () => {
  const url = 'https://cdn.example/movie.mp4?token=privado';
  const good = mockFetch({ [url]: { body: MP4, status: 206 } });
  const playable = await checkMedia(movie(url, { Referer: 'https://pagina.example/' }), good);
  assert.equal(playable.outcome, 'ok');
  assert.equal(playable.status, 206);
  assert.equal(playable.host, 'cdn.example');
  assert.equal(playable.signature, 'mp4');
  assert.equal(playable.bytesRead, MP4.length);
  assert.equal(playable.mime, 'application/octet-stream');
  assert.ok(!JSON.stringify(playable).includes('token=privado'), 'el informe no filtra URLs firmadas');
  assert.equal(good.calls[0].range, 'bytes=0-4095');

  const denied = mockFetch({ [url]: { status: 403 } });
  const blocked = await checkMedia(movie(url), denied);
  assert.equal(blocked.outcome, 'http403');
  assert.equal(blocked.stage, 'mp4');
  assert.equal(denied.calls.length, 2);
  assert.equal(denied.calls[1].range, null, 'el 403 de Range se contrasta con GET sin Range');
});

test('Range rechazado no retira un MP4 que sí permite GET sin Range', async () => {
  const url = 'https://cdn.example/movie.mp4';
  const mock = mockFetch({ [url]: (init) => init.headers.has('Range')
    ? { status: 403 }
    : { status: 200, body: MP4 } });
  const result = await checkMedia(movie(url), mock);
  assert.equal(result.outcome, 'ok');
  assert.equal(mock.calls.length, 2);
});

test('HLS: sigue playlist master + variante + segmentos, detecta 403 de segmento y alternativa sana', async () => {
  const master = 'https://cdn.example/main.m3u8?token=privado';
  const blocked = 'https://cdn.example/blocked/index.m3u8';
  const available = 'https://cdn.example/good/index.m3u8';
  const segment = 'https://cdn.example/good/part.ts';
  const mock = mockFetch({
    [master]: { body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nblocked/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200\ngood/index.m3u8\n' },
    [blocked]: { status: 403 },
    [available]: { body: '#EXTM3U\n#EXTINF:4,\npart.ts\n' },
    [segment]: { status: 206, body: TS, contentType: 'video/mp2t' },
  });
  const result = await checkMedia(hls(master), mock);
  assert.equal(result.outcome, 'ok', 'si una variante sirve, no retirar el proveedor');
  assert.equal(result.stage, 'segmento');
  assert.ok(mock.calls.some((call) => call.url === segment && call.range === 'bytes=0-4095'));
});

test('HLS: un JSON 200 no es vídeo, pero un segmento MPEG-TS sí lo es', async () => {
  const url = 'https://cdn.example/media.m3u8';
  const segment = 'https://cdn.example/first.ts';
  const playlist = '#EXTM3U\n#EXTINF:4,\nfirst.ts\n';
  const error = mockFetch({
    [url]: { body: playlist }, [segment]: { body: '{"error":"expired"}', contentType: 'application/json' },
  });
  const rejected = await checkMedia(hls(url), error);
  assert.equal(rejected.outcome, 'otro');
  assert.equal(rejected.signature, 'desconocida');
  const valid = mockFetch({ [url]: { body: playlist }, [segment]: { body: TS, status: 206 } });
  assert.equal((await checkMedia(hls(url), valid)).outcome, 'ok');
});

test('la auditoría no llama medio accesible a un HLS que solo contiene anuncios', async () => {
  const root = 'https://cdn.example/only-ads.m3u8';
  const playlist = '#EXTM3U\n#EXT-X-CUE-OUT:DURATION=15\n#EXTINF:5,\nad.ts\n#EXT-X-CUE-IN\n#EXT-X-ENDLIST\n';
  const mock = mockFetch({ [root]: { body: playlist } });
  const result = await checkMedia(hls(root), mock);
  assert.equal(result.outcome, 'otro');
  assert.equal(result.stage, 'playlist-solo-anuncios');
  assert.equal(mock.calls.length, 1);
  assert.equal(classifyProvider([{ mediaCount: 1, media: [result] }]), 'no-concluyente');
});

test('HLS: sonda el prefijo de una playlist larga, sin concluir retirada por un 403 parcial', async () => {
  const url = 'https://cdn.example/large.m3u8';
  const segment = 'https://cdn.example/first.ts';
  const huge = '#EXTM3U\n#EXTINF:4,\nfirst.ts\n' + '# comentario\n'.repeat(12000);
  assert.ok(Buffer.byteLength(huge) > 128 * 1024);
  const valid = mockFetch({ [url]: { body: huge }, [segment]: { body: TS, status: 206 } });
  const playable = await checkMedia(hls(url), valid);
  assert.equal(playable.outcome, 'ok');
  assert.equal(playable.signature, 'mpeg-ts');
  assert.equal(valid.calls.length, 2);

  const denied = mockFetch({ [url]: { body: huge }, [segment]: { status: 403 } });
  const partial = await checkMedia(hls(url), denied);
  assert.equal(partial.outcome, 'otro');
  assert.equal(partial.stage, 'segmentos-sin-verificar');
  assert.equal(denied.calls.length, 3);

  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nblocked.m3u8\n' + '# comentario\n'.repeat(12000);
  const blocked = mockFetch({ [url]: { body: master }, 'https://cdn.example/blocked.m3u8': { status: 403 } });
  assert.equal((await checkMedia(hls(url), blocked)).outcome, 'otro');
});

test('HLS: detecta 403 en las dos muestras del segmento o la clave AES-128', async () => {
  const base = 'https://cdn.example/playlist.m3u8';
  const blocked = mockFetch({
    [base]: { body: '#EXTM3U\n#EXTINF:4,\nfirst.ts\n#EXTINF:4,\nsecond.ts\n' },
    'https://cdn.example/first.ts': { status: 403 },
    'https://cdn.example/second.ts': { status: 403 },
  });
  const result = await checkMedia(hls(base), blocked);
  assert.equal(result.outcome, 'http403');
  assert.equal(result.stage, 'segmento');
  assert.equal(blocked.calls.length, 5);

  const key = mockFetch({
    [base]: { body: '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nfirst.ts\n' },
    'https://cdn.example/key.bin': { status: 403 },
  });
  assert.deepEqual((await checkMedia(hls(base), key)).stage, 'clave');
  assert.equal(key.calls.length, 2);
});

test('HLS Zilla: un mapa de inicialización 403 bloquea esa fuente, no otra fuente accesible', async () => {
  const playlist = 'https://player.zilla-networks.com/m3u8/episode123';
  const init = 'https://player.zilla-networks.com/m3u8/header.mp4';
  const mock = mockFetch({
    [playlist]: { body: '#EXTM3U\n#EXT-X-MAP:URI="header.mp4"\n#EXTINF:4,\npart.m4s\n' },
    [init]: { status: 403 },
  });
  const blocked = await checkMedia(hls(playlist), mock);
  assert.equal(blocked.outcome, 'http403');
  assert.equal(blocked.stage, 'inicializacion');
  assert.equal(blocked.host, 'player.zilla-networks.com');
  assert.equal(mock.calls.length, 3, 'Range y GET normal confirmaron el 403 del recurso indispensable');

  const available = { outcome: 'ok', stage: 'segmento', status: 206 };
  const attempt = { mediaCount: 2, otherFormats: 0, media: [blocked, available] };
  assert.equal(classifyProvider([attempt, attempt, attempt]), 'medio-accesible',
    'un hoster bloqueado no justifica retirar todo AnimeAV1 si otro medio funciona');
});

test('no considera válida playlist HTML ni retira por 403 de una variante si otra devuelve 404', async () => {
  const url = 'https://cdn.example/master.m3u8';
  const html = mockFetch({ [url]: { body: '<html>no video</html>', contentType: 'text/html' } });
  assert.equal((await checkMedia(hls(url), html)).outcome, 'otro');
  const mixed = mockFetch({
    [url]: { body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n403.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\n404.m3u8\n' },
    'https://cdn.example/403.m3u8': { status: 403 },
    'https://cdn.example/404.m3u8': { status: 404 },
  });
  assert.equal((await checkMedia(hls(url), mixed)).outcome, 'otro');
  assert.deepEqual(playlistUris('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n# comentario\nvideo.m3u8').variants, ['video.m3u8']);
});

test('solo propone retirada con 3 intentos y TODOS los HLS/MP4 encontrados a 403', () => {
  const fail = { mediaCount: 2, otherFormats: 0, media: [{ outcome: 'http403' }, { outcome: 'http403' }] };
  assert.equal(classifyProvider([fail, fail, fail]), 'retirar-403');
  assert.equal(classifyProvider([fail, fail]), 'no-concluyente');
  assert.equal(classifyProvider([fail, fail, { ...fail, mediaCount: 0, media: [], discovery403: ['catalog.example'] }]), 'no-concluyente');
  assert.equal(classifyProvider([fail, fail, { ...fail, media: [{ outcome: 'ok' }, { outcome: 'http403' }] }]), 'medio-accesible');
  assert.equal(classifyProvider([fail, fail, { ...fail, mediaCount: 3 }]), 'no-concluyente');
  assert.equal(classifyProvider([fail, fail, { ...fail, otherFormats: 1 }]), 'no-concluyente');
  assert.equal(classifyProvider([fail, fail, { ...fail, media: [{ outcome: 'otro' }, { outcome: 'http403' }] }]), 'no-concluyente');
});

test('auditoría selectiva solo acepta proveedores activos y elimina duplicados', () => {
  const { selectProviders } = require('../scripts/media-audit-lib.cjs');
  const scrapers = [{ id: 'videoapi', enabled: true }, { id: 'jkanime', enabled: true }, { id: 'inactivo', enabled: false }];
  assert.deepEqual(selectProviders(scrapers).map((item) => item.id), ['videoapi', 'jkanime']);
  assert.deepEqual(selectProviders(scrapers, ' jkanime,videoapi,jkanime ').map((item) => item.id), ['videoapi', 'jkanime']);
  assert.throws(() => selectProviders(scrapers, 'videoapi,inactivo'), /inactivos/);
  assert.throws(() => selectProviders(scrapers, 'videoapi,desconocido'), /desconocidos/);
  assert.throws(() => selectProviders(scrapers, 'videoapi;echo error'), /inválida/);
  assert.throws(() => selectProviders(scrapers, 'videoapi,'), /inválida/);
});

test('el CLI rechaza una selección vacía o desconocida antes de iniciar la auditoría', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const script = path.join(__dirname, '../scripts/media-audit.cjs');
  for (const args of [['--all', '--providers'], ['--all', '--providers', 'no-existe']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Auditoría no completada/);
    assert.equal(result.stdout, '');
  }
});
