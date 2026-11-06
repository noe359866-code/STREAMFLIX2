'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMedia, classifyProvider, playlistUris } = require('../scripts/media-audit-lib.cjs');

const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(30)]);

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
    [segment]: { status: 206, body: 'segmento-valido' },
  });
  const result = await checkMedia(hls(master), mock);
  assert.equal(result.outcome, 'ok', 'si una variante sirve, no retirar el proveedor');
  assert.equal(result.stage, 'segmento');
  assert.ok(mock.calls.some((call) => call.url === segment && call.range === 'bytes=0-4095'));
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
  assert.equal(blocked.calls.length, 5); // playlist y 2 * (Range + GET)

  const key = mockFetch({
    [base]: { body: '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nfirst.ts\n' },
    'https://cdn.example/key.bin': { status: 403 },
  });
  assert.deepEqual((await checkMedia(hls(base), key)).stage, 'clave');
  assert.equal(key.calls.length, 2);
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
