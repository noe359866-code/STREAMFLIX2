'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers.cjs');

const { probeStream, filterUnplayableStreams } = loadSource('src/core/media-filter.js');
const { providerGuard, makeStream } = loadSource('src/core/streams.js');
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(30)]);
const TS = Buffer.alloc(376);
TS[0] = TS[188] = 0x47;
const movie = (url, headers = {}) => ({ url, type: 'mp4', headers });
const hls = (url, headers = {}) => ({ url, type: 'hls', headers });

function mockFetch(routes) {
  const calls = [];
  return {
    calls,
    async fetchImpl(input, init) {
      const url = String(input);
      calls.push({ url, range: init.headers.Range, method: init.method, referer: init.headers.Referer });
      const value = routes[url];
      assert.ok(value, `Falta fixture ${url}`);
      const reply = typeof value === 'function' ? value(init) : value;
      return new Response(reply.body ?? '', {
        status: reply.status || 200,
        headers: { 'Content-Type': reply.mime || 'application/octet-stream', ...(reply.headers || {}) },
      });
    },
  };
}

test('MP4: descarta página HTML 200 y anuncio PNG 206; acepta ftyp con cabeceras del stream', async () => {
  const html = 'https://cdn.example/movie.mp4?token=abc';
  const png = 'https://cdn.example/ad.mp4';
  const good = 'https://cdn.example/good.mp4';
  const mock = mockFetch({
    [html]: { body: '<html>expired</html>', mime: 'text/html' },
    [png]: { body: Buffer.from('89504e470d0a1a0a', 'hex'), status: 206, mime: 'image/png' },
    [good]: { body: MP4, status: 206 },
  });
  assert.equal(await probeStream(movie(html), mock), 'bad');
  assert.equal(await probeStream(movie(png), mock), 'bad');
  assert.equal(await probeStream(movie(good, { Referer: 'https://site.example/obra' }), mock), 'good');
  assert.equal(mock.calls[2].referer, 'https://site.example/obra');
  assert.equal(mock.calls[2].range, 'bytes=0-2047');
});

test('addon Node cancela el cuerpo de un MP4 aunque el servidor ignore Range', async () => {
  let cancelled = false;
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.concat([Buffer.from('<html>'), Buffer.alloc(64 * 1024)])); },
    cancel() { cancelled = true; },
  }), { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Length': '99999999' } });
  assert.equal(await probeStream(movie('https://cdn.example/huge.mp4'), { fetchImpl }), 'bad');
  await Promise.resolve();
  assert.equal(cancelled, true, 'Node interrumpe la descarga tras la muestra');
});

test('MP4: GET normal rescata un 403 solo de Range; 403 confirmado descarta ese enlace', async () => {
  const url = 'https://cdn.example/video.mp4';
  const good = mockFetch({ [url]: (init) => init.headers.Range ? { status: 403 } : { body: MP4 } });
  assert.equal(await probeStream(movie(url), good), 'good');
  assert.deepEqual(good.calls.map((call) => call.range), ['bytes=0-2047', undefined]);
  const bad = mockFetch({ [url]: { status: 403 } });
  assert.equal(await probeStream(movie(url), bad), 'bad');
  assert.equal(bad.calls.length, 2);
  const uncertain = mockFetch({ [url]: { status: 503 } });
  assert.equal(await probeStream(movie(url), uncertain), 'unknown');
});

test('HLS: no entrega HTML como playlist ni segmentos HTML de un HLS 200', async () => {
  const master = 'https://cdn.example/master.m3u8';
  const seg1 = 'https://cdn.example/a.ts';
  const seg2 = 'https://cdn.example/b.ts';
  const html = mockFetch({ [master]: { body: '<html>no hay vídeo</html>', mime: 'text/html' } });
  assert.equal(await probeStream(hls(master), html), 'bad');
  const broken = mockFetch({
    [master]: { body: '#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n' },
    [seg1]: { body: '<html>blocked</html>', mime: 'text/html' },
    [seg2]: { body: '<html>blocked</html>', mime: 'text/html' },
  });
  assert.equal(await probeStream(hls(master), broken), 'bad');
  assert.equal(broken.calls.length, 3);
  const playable = mockFetch({
    [master]: { body: '#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n' },
    [seg1]: { body: TS, status: 206 },
  });
  assert.equal(await probeStream(hls(master), playable), 'good');
});

test('HLS: rechaza VOD compuesto solo por un corte publicitario, no una obra que contenga anuncios', async () => {
  const ad = 'https://cdn.example/only-ads.m3u8';
  const movieUrl = 'https://cdn.example/movie.m3u8';
  const live = 'https://cdn.example/live.m3u8';
  const master = 'https://cdn.example/master.m3u8';
  const scte = 'https://cdn.example/scte-ad.m3u8';
  const adBreak = '#EXTM3U\n#EXT-X-CUE-OUT:DURATION=10\n#EXTINF:5,\nad1.ts\n#EXTINF:5,\nad2.ts\n#EXT-X-CUE-IN\n';
  const movieBreak = `${adBreak}#EXTINF:180,\nmovie.ts\n#EXT-X-ENDLIST\n`;
  const mock = mockFetch({
    [ad]: { body: `${adBreak}#EXT-X-ENDLIST\n` },
    [scte]: { body: '#EXTM3U\n#EXT-X-SCTE35-OUT:abc\n#EXTINF:5,\nad1.ts\n#EXT-X-SCTE35-IN:abc\n#EXT-X-ENDLIST\n' },
    [movieUrl]: { body: movieBreak },
    [live]: { body: adBreak },
    [master]: { body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nonly-ads.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nmovie.m3u8\n' },
    'https://cdn.example/ad1.ts': { body: TS, status: 206 },
    'https://cdn.example/ad2.ts': { body: TS, status: 206 },
    'https://cdn.example/movie.ts': { body: TS, status: 206 },
  });
  assert.equal(await probeStream(hls(ad), mock), 'bad');
  assert.deepEqual(mock.calls.map((call) => call.url), [ad], 'no descargar segmentos de un anuncio confirmado');
  assert.equal(await probeStream(hls(scte), mock), 'bad');
  assert.equal(await probeStream(hls(movieUrl), mock), 'good');
  assert.equal(await probeStream(hls(live), mock), 'good', 'un preroll en un directo no prueba que todo sea publicidad');
  assert.equal(await probeStream(hls(master), mock), 'good', 'una variante publicitaria no oculta otra con la obra');
  assert.deepEqual((await filterUnplayableStreams([hls(ad), hls(movieUrl)], { fetchImpl: mock.fetchImpl }))
    .map((item) => item.url), [movieUrl]);
});

test('HLS AES-128: conservar bytes cifrados con MIME HTML engañoso, descartar HTML legible', async () => {
  const playlist = 'https://cdn.example/encrypted/master.m3u8';
  const key = 'https://cdn.example/encrypted/key.bin';
  const segment = 'https://cdn.example/encrypted/part.ts';
  const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\npart.ts\n';
  const cipher = Buffer.alloc(2048);
  for (let index = 0; index < cipher.length; index += 1) cipher[index] = (index * 149 + 31) % 256;
  const real = mockFetch({
    [playlist]: { body: manifest },
    [key]: { body: Buffer.alloc(16, 3) },
    [segment]: { body: cipher, mime: 'text/html', status: 206 },
  });
  assert.equal(await probeStream(hls(playlist), real), 'unknown', 'el filtro no puede descifrar en QuickJS');
  assert.equal((await filterUnplayableStreams([hls(playlist)], { fetchImpl: real.fetchImpl })).length, 1);
  const fake = mockFetch({
    [playlist]: { body: manifest },
    [key]: { body: Buffer.alloc(16, 3) },
    [segment]: { body: '<html>Bloqueado</html>'.repeat(20), mime: 'text/html', status: 206 },
  });
  assert.equal(await probeStream(hls(playlist), fake), 'bad');
});

test('HLS: variante accesible conserva el master, mientras clave o inicialización 403 verificadas lo descartan', async () => {
  const root = 'https://cdn.example/main.m3u8';
  const variant = 'https://cdn.example/valid.m3u8';
  const blocked = 'https://cdn.example/denied.m3u8';
  const fragment = 'https://cdn.example/part.m4s';
  const mock = mockFetch({
    [root]: { body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\ndenied.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nvalid.m3u8\n' },
    [blocked]: { status: 403 },
    [variant]: { body: '#EXTM3U\n#EXTINF:4,\npart.m4s\n' },
    [fragment]: { body: MP4, status: 206 },
  });
  assert.equal(await probeStream(hls(root), mock), 'good');

  for (const field of ['#EXT-X-KEY:METHOD=AES-128,URI="header.mp4"', '#EXT-X-MAP:URI="header.mp4"']) {
    const init = mockFetch({
      [root]: { body: `#EXTM3U\n${field}\n#EXTINF:4,\npart.m4s\n` },
      'https://cdn.example/header.mp4': { status: 403 },
    });
    assert.equal(await probeStream(hls(root), init), 'bad');
    assert.deepEqual(init.calls.map((call) => call.range), [
      'bytes=0-65535', field.includes('KEY') ? 'bytes=0-31' : 'bytes=0-2047', undefined,
    ]);
  }
});

test('HLS: mezcla de 403 y timeout/429 no elimina una fuente potencialmente reproducible', async () => {
  const root = 'https://cdn.example/main.m3u8';
  const mock = mockFetch({
    [root]: { body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nno.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nmaybe.m3u8\n' },
    'https://cdn.example/no.m3u8': { status: 403 },
    'https://cdn.example/maybe.m3u8': { status: 429 },
  });
  assert.equal(await probeStream(hls(root), mock), 'unknown');
  for (const url of ['http://127.0.0.1/admin.m3u8', 'http://127.1/admin.m3u8', 'http://192.168.1.1/admin.m3u8']) {
    assert.equal(await probeStream(hls(url), mock), 'unknown');
  }
  assert.equal(mock.calls.length, 4, 'no se consulta el host local');
});

test('la sonda no sigue redirects a IP privadas ni envía cookies a un hoster distinto', async () => {
  const from = 'https://cdn.example/video.mp4';
  const next = 'https://other.example/video.mp4';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return url === from
      ? new Response('', { status: 302, headers: { Location: next } })
      : new Response(MP4, { status: 206 });
  };
  assert.equal(await probeStream(movie(from, { Cookie: 'session=private', Authorization: 'Bearer private', Referer: 'https://site.example/' }), { fetchImpl }), 'good');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.Cookie, undefined);
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Referer, 'https://site.example/');
  const privateFetch = async (url) => {
    calls.push({ url });
    return new Response('', { status: 302, headers: { Location: 'http://192.168.1.1/admin' } });
  };
  assert.equal(await probeStream(movie(from), { fetchImpl: privateFetch }), 'unknown');
  assert.equal(calls.length, 3, 'no consultar la IP privada');
});

test('QuickJS: solo pide Range tras HEAD acotado, nunca GET completo de un MP4 grande o Range 403', async () => {
  const url = 'https://cdn.example/movie.mp4';
  const calls = [];
  const fetchImpl = async (_input, init) => {
    calls.push({ method: init.method, range: init.headers.Range });
    if (init.method === 'HEAD') return { status: 200, headers: new Headers({ 'Content-Length': '99999999' }) };
    throw new Error('No pedir la película');
  };
  assert.equal(await probeStream(movie(url), { fetchImpl, nativeBridge: true }), 'unknown');
  assert.deepEqual(calls, [{ method: 'HEAD', range: undefined }]);

  const blocked = async (_input, init) => {
    calls.push({ method: init.method, range: init.headers.Range });
    return init.method === 'HEAD'
      ? { status: 200, headers: new Headers({ 'Content-Length': '63' }) }
      : { status: 403, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  assert.equal(await probeStream(movie(url), { fetchImpl: blocked, nativeBridge: true }), 'unknown',
    'sin streaming no descargar MP4 entero para confirmar un 403 solo de Range');
  assert.deepEqual(calls.slice(1), [
    { method: 'HEAD', range: undefined },
    { method: 'GET', range: 'bytes=0-2047' },
  ]);
});

test('QuickJS: descarta HLS con playlist o segmentos HTML pequeños y MIME explícito', async () => {
  const root = 'https://cdn.example/media.m3u8';
  const segment = 'https://cdn.example/first.ts';
  const routes = {
    [root]: { body: '#EXTM3U\n#EXTINF:4,\nfirst.ts\n' },
    [segment]: { body: '<html>no video</html>', mime: 'text/html' },
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, range: init.headers.Range });
    const fixture = routes[url];
    assert.ok(fixture);
    const bytes = new TextEncoder().encode(fixture.body);
    const headers = new Headers({ 'Content-Length': String(bytes.length), 'Content-Type': fixture.mime || 'application/octet-stream' });
    return { status: 200, headers,
      arrayBuffer: async () => bytes.buffer,
    };
  };
  assert.equal(await probeStream(hls(root), { fetchImpl, nativeBridge: true }), 'bad');
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'GET', 'HEAD', 'GET']);
  assert.deepEqual(calls.filter((call) => call.method === 'GET').map((call) => call.range), ['bytes=0-65535', 'bytes=0-2047']);
});

test('plugin Nuvio y addon Stremio usan providerGuard: quitan solo el enlace malo y la auditoría conserva los originales', async () => {
  const bad = 'https://cdn.example/bad.mp4';
  const good = 'https://cdn.example/good.mp4';
  const originalFetch = global.fetch;
  const mock = mockFetch({
    [bad]: { body: '<html>error</html>', mime: 'text/html' },
    [good]: { body: MP4, status: 206 },
  });
  global.fetch = mock.fetchImpl;
  const guarded = providerGuard('Muestra', async () => [
    makeStream('Muestra', bad), makeStream('Muestra', good),
  ]);
  try {
    const filtered = await guarded('550', 'movie');
    assert.deepEqual(filtered.map((item) => item.url), [good]);
    global.__STREAMFLIX_AUDIT_RAW_MEDIA = true;
    assert.deepEqual((await guarded('550', 'movie')).map((item) => item.url), [bad, good]);
    assert.equal(mock.calls.length, 3, 'el fallo se confirma dos veces; la auditoría no hace sondas adicionales');
  } finally {
    delete global.__STREAMFLIX_AUDIT_RAW_MEDIA;
    global.fetch = originalFetch;
  }
});

test('un 403/HTML transitorio no elimina un HLS/MP4 que funciona al confirmar', async () => {
  const url = 'https://cdn.example/intermitente.mp4';
  let attempts = 0;
  const recovered = mockFetch({ [url]: () => (++attempts === 1)
    ? { body: '<html>rate limit</html>', mime: 'text/html' }
    : { body: MP4, status: 206 } });
  const kept = await filterUnplayableStreams([movie(url)], { fetchImpl: recovered.fetchImpl });
  assert.equal(kept.length, 1);
  assert.equal(attempts, 2);

  let blocked = 0;
  const failsThenTimesOut = mockFetch({ [url]: () => (++blocked === 1)
    ? { status: 403 }
    : blocked === 2 ? { status: 403 } : { status: 503 } });
  assert.equal((await filterUnplayableStreams([movie(url)], { fetchImpl: failsThenTimesOut.fetchImpl })).length, 1,
    'un segundo fallo de red incierto no confirma la primera denegación');
});

test('una variante HLS con segmentos transitoriamente inválidos se conserva al confirmar reproducción', async () => {
  const playlist = 'https://cdn.example/main.m3u8';
  const first = 'https://cdn.example/1.ts';
  const second = 'https://cdn.example/2.ts';
  let segmentRequests = 0;
  const mock = mockFetch({
    [playlist]: { body: '#EXTM3U\n#EXTINF:4,\n1.ts\n#EXTINF:4,\n2.ts\n' },
    [first]: () => (++segmentRequests === 1)
      ? { body: '<html>expirado</html>', mime: 'text/html' }
      : { body: TS, status: 206 },
    [second]: { body: '<html>expirado</html>', mime: 'text/html' },
  });
  assert.equal((await filterUnplayableStreams([hls(playlist)], { fetchImpl: mock.fetchImpl })).length, 1);
  assert.equal(segmentRequests, 2, 'la segunda comprobación descubre un segmento MPEG-TS real');
});

test('addon vía proxy no descarga películas completas si un host ignora Range', async () => {
  const { runWithProxy, installProxyFetchHook, uninstallProxyFetchHook } = require('../stremio/proxy-pool.cjs');
  const guarded = providerGuard('Proxy', async () => [makeStream('Proxy', 'https://cdn.example/movie.mp4')]);
  installProxyFetchHook();
  try {
    assert.equal((await runWithProxy({ host: 'proxy.example', port: 1234 }, guarded.bind(null, '550', 'movie'))).length, 1);
  } finally { uninstallProxyFetchHook(); }
});

test('el presupuesto de sonda no oculta fuentes inconclusas ni retrasa indefinidamente al addon', async () => {
  const response = await filterUnplayableStreams([movie('https://cdn.example/slow.mp4')], {
    fetchImpl: async () => new Promise(() => {}), budgetMs: 25,
  });
  assert.equal(response.length, 1);
});
