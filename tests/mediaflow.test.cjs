'use strict';

/**
 * Delegación en MediaFlow Proxy.
 *
 * Lo que se prueba aquí es el contrato con una instancia externa: cómo se
 * construye la URL (`/proxy/hls/manifest.m3u8?d=…&h_referer=…`), cuándo se
 * delega y cuándo no, y que el addon siga funcionando si MediaFlow no está.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  resolveMediaFlowOptions,
  buildMediaFlowUrl,
  canDelegate,
  probeMediaFlow,
  mediaflowStatus,
  resetMediaflowState,
} = require('../stremio/mediaflow.cjs');
const { resolveTransport, toStremioStream } = require('../stremio/addon.cjs');

const HLS_STREAM = {
  name: 'ProveedorFake',
  provider: 'voe',
  url: 'https://cdn.example/pelicula/master.m3u8?token=a%2Bb',
  type: 'hls',
  quality: '1080p',
  language: 'es-LAT',
  headers: { Referer: 'https://voe.sx/', Origin: 'https://voe.sx', 'X-Weird': 'no-se-reenvía' },
};

test('sin MEDIAFLOW_URL o sin contraseña no hay delegación', () => {
  assert.equal(resolveMediaFlowOptions({}).enabled, false);
  assert.equal(resolveMediaFlowOptions({ MEDIAFLOW_URL: 'https://mf.test' }).enabled, false);
  assert.equal(resolveMediaFlowOptions({ MEDIAFLOW_PASSWORD: 'x' }).enabled, false);
  const ok = resolveMediaFlowOptions({ MEDIAFLOW_URL: 'https://mf.test/', MEDIAFLOW_PASSWORD: 'secreto' });
  assert.equal(ok.enabled, true);
  assert.equal(ok.baseUrl, 'https://mf.test');
  assert.equal(ok.includeMp4, false);
  assert.equal(resolveMediaFlowOptions({ MEDIAFLOW_URL: 'ftp://mf.test', MEDIAFLOW_PASSWORD: 'x' }).enabled, false);
});

test('construye la URL de MediaFlow con destino, cabeceras h_* y contraseña', () => {
  const options = resolveMediaFlowOptions({ MEDIAFLOW_URL: 'https://mf.test', MEDIAFLOW_PASSWORD: 'clave' });
  const url = buildMediaFlowUrl(HLS_STREAM.url, HLS_STREAM.headers, options);
  const parsed = new URL(url);

  assert.equal(parsed.origin, 'https://mf.test');
  assert.equal(parsed.pathname, '/proxy/hls/manifest.m3u8');
  assert.equal(parsed.searchParams.get('d'), HLS_STREAM.url);
  assert.equal(parsed.searchParams.get('h_referer'), 'https://voe.sx/');
  assert.equal(parsed.searchParams.get('h_origin'), 'https://voe.sx');
  assert.equal(parsed.searchParams.get('api_password'), 'clave');
  // Cabeceras no reenviables no se filtran al proxy
  assert.equal(parsed.searchParams.get('h_x-weird'), null);

  // MP4 usa /proxy/stream y conserva el nombre de fichero para los reproductores
  const mp4 = buildMediaFlowUrl('https://cdn.example/pelicula/Peli.2024.mp4', {}, options);
  const mp4Url = new URL(mp4);
  assert.equal(mp4Url.pathname, '/proxy/stream');
  assert.equal(mp4Url.searchParams.get('filename'), 'Peli.2024.mp4');

  // Sin base configurada no se inventan URLs
  assert.equal(buildMediaFlowUrl(HLS_STREAM.url, {}, resolveMediaFlowOptions({})), '');
});

test('canDelegate sólo acepta HLS (y MP4 si se pide) y streams con URL', () => {
  const options = resolveMediaFlowOptions({ MEDIAFLOW_URL: 'https://mf.test', MEDIAFLOW_PASSWORD: 'x' });
  assert.equal(canDelegate(HLS_STREAM, options), true);
  assert.equal(canDelegate({ url: 'https://cdn.example/a/master.m3u8' }, options), true);
  assert.equal(canDelegate({ url: 'https://cdn.example/movie.mp4', type: 'mp4' }, options), false);
  const withMp4 = resolveMediaFlowOptions({
    MEDIAFLOW_URL: 'https://mf.test', MEDIAFLOW_PASSWORD: 'x', MEDIAFLOW_INCLUDE_MP4: '1',
  });
  assert.equal(canDelegate({ url: 'https://cdn.example/movie.mp4', type: 'mp4' }, withMp4), true);
  assert.equal(canDelegate({ url: '' }, options), false);
  assert.equal(canDelegate(HLS_STREAM, resolveMediaFlowOptions({})), false);
  assert.equal(canDelegate(null, options), false);
});

test('MediaFlow gana a la pasarela interna, y sin él se usa proxyHeaders o la pasarela', () => {
  const mediaflow = { enabled: true, ...resolveMediaFlowOptions({ MEDIAFLOW_URL: 'https://mf.test', MEDIAFLOW_PASSWORD: 'x' }) };
  const context = { baseUrl: 'https://addon.test' };

  const withMediaflow = resolveTransport(HLS_STREAM, {
    ...context, gateway: { enabled: true, mode: 'auto' }, mediaflow,
  });
  assert.equal(withMediaflow.transport, 'mediaflow');

  const withoutMediaflow = resolveTransport(HLS_STREAM, {
    ...context, gateway: { enabled: false, mode: 'off' }, mediaflow: { enabled: false },
  });
  assert.equal(withoutMediaflow.transport, 'proxy-headers');

  const withGateway = resolveTransport(HLS_STREAM, {
    ...context, gateway: { enabled: true, mode: 'auto' }, mediaflow: { enabled: false },
  });
  assert.equal(withGateway.transport, 'gateway');

  // Un MP4 con cabeceras no se delega por defecto ni se reescribe como HLS
  const mp4 = resolveTransport({ url: 'https://cdn.example/x.mp4', type: 'mp4', headers: { Referer: 'https://x/' } }, {
    ...context, gateway: { enabled: true, mode: 'auto' }, mediaflow,
  });
  assert.equal(mp4.transport, 'proxy-headers');
});

test('toStremioStream entrega la URL de MediaFlow sin proxyHeaders', () => {
  const mediaflow = { enabled: true, ...resolveMediaFlowOptions({ MEDIAFLOW_URL: 'https://mf.test', MEDIAFLOW_PASSWORD: 'x' }) };
  const stream = toStremioStream(HLS_STREAM, {
    metadata: { title: 'Demo' },
    parsed: { mediaType: 'movie' },
    baseUrl: 'https://addon.test',
    gateway: { enabled: true, mode: 'auto' },
    mediaflow,
  });
  assert.ok(stream.url.startsWith('https://mf.test/proxy/hls/manifest.m3u8?'));
  assert.equal(stream.behaviorHints.proxyHeaders, undefined);
  assert.equal(stream.behaviorHints.notWebReady, true);
  assert.equal(stream.behaviorHints.streamflix2Transport, 'mediaflow');
});

test('probeMediaFlow consulta /proxy/ip, cachea y reporta el error sin romper el addon', async () => {
  resetMediaflowState();
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls += 1;
    const url = new URL(req.url, 'http://mf.local');
    if (url.pathname !== '/proxy/ip') {
      res.writeHead(404);
      res.end('no');
      return;
    }
    if (url.searchParams.get('api_password') !== 'clave') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Contraseña incorrecta' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip: '203.0.113.7' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const env = { MEDIAFLOW_URL: base, MEDIAFLOW_PASSWORD: 'clave' };
    const first = await probeMediaFlow(env, { force: true });
    assert.equal(first.configured, true);
    assert.equal(first.ok, true);
    assert.equal(first.ip, '203.0.113.7');

    // La segunda lectura viene de caché (no vuelve a llamar)
    const before = calls;
    const second = await probeMediaFlow(env);
    assert.equal(second.cached, true);
    assert.equal(calls, before);

    const status = mediaflowStatus(env);
    assert.equal(status.configured, true);
    assert.equal(status.password, 'configured');
    assert.equal(status.lastProbe.ip, '203.0.113.7');

    // Contraseña incorrecta → 401, se refleja como error y no lanza
    resetMediaflowState();
    const bad = await probeMediaFlow({ MEDIAFLOW_URL: base, MEDIAFLOW_PASSWORD: 'otra' }, { force: true });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'HTTP 401');

    // Instancia inalcanzable → error legible
    resetMediaflowState();
    const down = await probeMediaFlow({ MEDIAFLOW_URL: 'http://127.0.0.1:1', MEDIAFLOW_PASSWORD: 'x' }, { force: true });
    assert.equal(down.configured, true);
    assert.equal(down.ok, false);
    assert.ok(down.error.length > 0);

    // Sin configurar: no se intenta nada
    assert.deepEqual(await probeMediaFlow({}), { configured: false, ok: false });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetMediaflowState();
  }
});
