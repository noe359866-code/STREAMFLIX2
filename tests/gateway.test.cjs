'use strict';

/**
 * Pruebas de la pasarela de vídeo (opt-in).
 *
 * Cubren las tres piezas que pueden romper la reproducción en producción:
 *  1. La reescritura del playlist HLS (variantes, segmentos, claves AES, MAP).
 *  2. La firma de tickets (nadie sin secreto puede usar el endpoint de proxy).
 *  3. El ciclo HTTP completo: playlist con `Referer` obligatorio, segmentos con
 *     `Range`/206, error del origen y presupuesto diario de bytes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  mintTicket,
  verifyTicket,
  decodeTarget,
  rewritePlaylist,
  buildGatewayUrl,
  isPlaylistUrl,
  routeForUrl,
  resolveGatewayOptions,
  gatewayStatus,
  resetGatewayState,
  handleGatewayRequest,
} = require('../stremio/stream-gateway.cjs');
const { resolveTransport, toStremioStream } = require('../stremio/addon.cjs');

const SECRET = 'secreto-de-pruebas-123';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Servidor de pasarela que se autodescubre la URL base tras escuchar. */
function gatewayServer(env) {
  const info = { baseUrl: '' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://gateway.local');
    handleGatewayRequest(req, res, { env, baseUrl: info.baseUrl, url }).catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    });
  });
  server.info = info;
  return server;
}

async function startGateway(env) {
  const server = gatewayServer(env);
  const port = await listen(server);
  server.info.baseUrl = `http://127.0.0.1:${port}`;
  return { server, base: server.info.baseUrl };
}

test('reescribe variantes, segmentos, EXT-X-KEY y EXT-X-MAP con URLs absolutas', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/a.key",IV=0x1',
    '#EXT-X-MAP:URI="/init/video.mp4"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000',
    'videos/720p.m3u8',
    '#EXTINF:6.006,',
    'https://cdn.example/seg-1.ts?token=a%2Bb',
    '#EXT-X-ENDLIST',
  ].join('\n');

  const minted = [];
  const output = rewritePlaylist(playlist, 'https://cdn.example/live/master.m3u8', (absolute) => {
    minted.push(absolute);
    return `https://gw.test/g/segment?t=${minted.length}`;
  });

  assert.deepEqual(minted, [
    'https://cdn.example/live/keys/a.key',
    'https://cdn.example/init/video.mp4',
    'https://cdn.example/live/videos/720p.m3u8',
    'https://cdn.example/seg-1.ts?token=a%2Bb',
  ]);
  assert.match(output, /URI="https:\/\/gw\.test\/g\/segment\?t=1"/);
  assert.match(output, /URI="https:\/\/gw\.test\/g\/segment\?t=2"/);
  assert.match(output, /^https:\/\/gw\.test\/g\/segment\?t=3$/m);
  assert.match(output, /^https:\/\/gw\.test\/g\/segment\?t=4$/m);
  // El IV y el resto de atributos no se tocan.
  assert.match(output, /IV=0x1/);
});

test('rewritePlaylist ignora data: y urn: pero conserva comentarios', () => {
  const output = rewritePlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:text/plain;base64,AA=="\n#EXT-X-SESSION-KEY:URI="skd://clave"\nsegmento.ts',
    'https://cdn.example/a/b/playlist.m3u8',
    (absolute) => `G(${absolute})`,
  );
  assert.match(output, /URI="data:text\/plain;base64,AA=="/);
  assert.match(output, /URI="skd:\/\/clave"/);
  assert.match(output, /^G\(https:\/\/cdn\.example\/a\/b\/segmento\.ts\)$/m);
});

test('los tickets firmados sólo autorizan la URL y cabeceras que se firmaron', () => {
  const url = 'https://cdn.example/master.m3u8?token=abc';
  const ticket = mintTicket(url, { Referer: 'https://voe.sx/', 'User-Agent': 'UA' }, { secret: SECRET });
  const verified = verifyTicket(ticket, { secret: SECRET });
  assert.equal(verified.url, url);
  assert.equal(verified.headers.referer, 'https://voe.sx/');
  assert.equal(verified.headers['user-agent'], 'UA');

  // Otro secreto no valida.
  assert.equal(verifyTicket(ticket, { secret: 'otro' }), null);
  // Manipular el payload invalida la firma.
  const [payload, signature] = ticket.split('.');
  const tampered = `${Buffer.from(JSON.stringify({ u: 'https://evil.example/x.ts', h: {}, e: Date.now() + 1000 })).toString('base64url')}.${signature}`;
  assert.equal(verifyTicket(tampered, { secret: SECRET }), null);
  assert.ok(payload.length > 10);
  // Ticket expirado.
  const expired = mintTicket(url, {}, { secret: SECRET, ttlMs: 2000 });
  assert.equal(verifyTicket(expired, { secret: SECRET, now: Date.now() + 60_000 }), null);
  assert.ok(verifyTicket(expired, { secret: SECRET }));
});

test('el endpoint no es un proxy abierto: rechaza URLs en claro y base64 no-http', () => {
  assert.equal(decodeTarget('', 'https://cdn.example/x.ts', { secret: SECRET }), null);
  assert.equal(decodeTarget('', 'ftp://cdn.example/x.ts', { secret: SECRET }), null);
  const encoded = Buffer.from('https://cdn.example/seg.ts', 'utf8').toString('base64url');
  assert.equal(decodeTarget('', encoded, { secret: SECRET }), null);
  assert.equal(decodeTarget('', encoded, { secret: SECRET, allowUnsigned: true }).url, 'https://cdn.example/seg.ts');
  assert.equal(decodeTarget('', Buffer.from('file:///etc/passwd').toString('base64url'), { secret: SECRET, allowUnsigned: true }), null);
  assert.equal(decodeTarget('ticket-falso', '', { secret: SECRET }), null);
});

test('buildGatewayUrl distingue playlists de segmentos y respeta el modo de la pasarela', () => {
  assert.equal(isPlaylistUrl('https://cdn.example/a/master.m3u8?x=1'), true);
  assert.equal(isPlaylistUrl('https://cdn.example/a/segment.ts'), false);
  assert.equal(routeForUrl('https://cdn.example/master.m3u8'), '/g/playlist.m3u8');
  assert.equal(routeForUrl('https://cdn.example/seg.ts'), '/g/segment');

  const minted = buildGatewayUrl('https://addon.test/', 'https://cdn.example/a/master.m3u8', { Referer: 'https://x/' }, { secret: SECRET });
  assert.match(minted, /^https:\/\/addon\.test\/g\/playlist\.m3u8\?t=/);
  const ticket = minted.split('t=')[1];
  assert.equal(verifyTicket(ticket, { secret: SECRET }).url, 'https://cdn.example/a/master.m3u8');

  assert.deepEqual(resolveGatewayOptions({}).mode, 'off');
  assert.equal(resolveGatewayOptions({}).enabled, false);
  assert.equal(resolveGatewayOptions({ STREAM_GATEWAY: 'auto' }).enabled, true);
  assert.equal(resolveGatewayOptions({ STREAM_GATEWAY: 'on', STREAM_GATEWAY_DAILY_MB: '0' }).enabled, false);
  assert.equal(resolveGatewayOptions({ STREAM_GATEWAY: 'off', STREAM_GATEWAY_DAILY_MB: '500' }).enabled, false);
});

test('resolveTransport elige directo, proxyHeaders o pasarela sin gastar tráfico de más', () => {
  const hls = { url: 'https://cdn.example/master.m3u8', type: 'hls', headers: { Referer: 'https://x/' } };
  const mp4 = { url: 'https://cdn.example/movie.mp4', type: 'mp4', headers: { Referer: 'https://x/' } };
  const abierto = { url: 'https://cdn.example/master.m3u8', type: 'hls' };
  const ctx = (mode, baseUrl = 'https://addon.test') => ({ baseUrl, gateway: { mode, enabled: mode !== 'off' } });

  assert.equal(resolveTransport(abierto, ctx('auto')).transport, 'direct-hls');
  assert.equal(resolveTransport(hls, ctx('off')).transport, 'proxy-headers');
  assert.equal(resolveTransport(hls, ctx('auto')).transport, 'gateway');
  assert.equal(resolveTransport(mp4, ctx('auto')).transport, 'proxy-headers');
  assert.equal(resolveTransport(mp4, ctx('on')).transport, 'gateway');
  // Sin URL base pública no se puede construir la pasarela: se degrada.
  assert.equal(resolveTransport(hls, ctx('auto', '')).transport, 'proxy-headers');
});

test('toStremioStream devuelve la pasarela sólo cuando está activa y conserva el resto', () => {
  const stream = {
    name: 'ProveedorFake',
    provider: 'voe',
    title: 'Voe · es-LAT · 1080p',
    url: 'https://cdn.example/master.m3u8',
    quality: '1080p',
    language: 'es-LAT',
    type: 'hls',
    headers: { Referer: 'https://voe.sx/' },
  };
  const context = { metadata: { title: 'Demo' }, parsed: { mediaType: 'movie' }, baseUrl: 'https://addon.test' };

  const off = toStremioStream(stream, { ...context, gateway: { mode: 'off', enabled: false } });
  assert.equal(off.url, 'https://cdn.example/master.m3u8');
  assert.equal(off.behaviorHints.proxyHeaders.request.Referer, 'https://voe.sx/');
  assert.equal(off.behaviorHints.streamflix2Transport, 'proxy-headers');

  const on = toStremioStream(stream, { ...context, gateway: { mode: 'auto', enabled: true } });
  assert.match(on.url, /^https:\/\/addon\.test\/g\/playlist\.m3u8\?t=/);
  assert.equal(on.behaviorHints.proxyHeaders, undefined);
  assert.equal(on.behaviorHints.notWebReady, true);
  assert.match(on.title, /pasarela/);
});

test('pasarela HTTP: reescribe el playlist del origen e inyecta el Referer exigido', async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/master.m3u8') {
      if (req.headers.referer !== 'https://voe.sx/') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Referer inválido');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n720p/index.m3u8\n');
      return;
    }
    if (req.url === '/720p/index.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:4,\n/720p/seg-1.ts\n');
      return;
    }
    if (req.url === '/720p/seg-1.ts') {
      const body = Buffer.from('0123456789');
      const range = req.headers.range;
      if (range) {
        const start = Number(range.replace(/bytes=(\d+)-.*/, '$1')) || 0;
        res.writeHead(206, {
          'Content-Type': 'video/mp2t',
          'Content-Range': `bytes ${start}-9/10`,
          'Accept-Ranges': 'bytes',
        });
        res.end(body.subarray(start));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': body.length });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  const upstreamPort = await listen(upstream);
  const upstreamBase = `http://127.0.0.1:${upstreamPort}`;

  const env = {
    STREAM_GATEWAY: 'auto',
    STREAM_GATEWAY_SECRET: SECRET,
    STREAM_GATEWAY_DAILY_MB: '64',
    STREAM_GATEWAY_ALLOW_PRIVATE: '1',
  };
  resetGatewayState();
  const { server: gw, base: gwBase } = await startGateway(env);

  try {
    const playlistUrl = buildGatewayUrl(gwBase, `${upstreamBase}/master.m3u8`, { Referer: 'https://voe.sx/' }, { env });
    const masterRes = await fetch(playlistUrl);
    assert.equal(masterRes.status, 200);
    assert.equal(masterRes.headers.get('access-control-allow-origin'), '*');
    assert.equal(masterRes.headers.get('content-type'), 'application/vnd.apple.mpegurl');
    const master = await masterRes.text();
    const variantUrl = master.split('\n').find((line) => line.startsWith('http'));
    assert.ok(variantUrl.includes('/g/playlist.m3u8?t='));

    const variant = await (await fetch(variantUrl)).text();
    const segmentUrl = variant.split('\n').find((line) => line.startsWith('http'));
    assert.ok(segmentUrl.includes('/g/segment?t='));

    const ranged = await fetch(segmentUrl, { headers: { Range: 'bytes=4-' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 4-9/10');
    assert.equal(await ranged.text(), '456789');

    const status = gatewayStatus(env);
    assert.ok(status.playlists >= 2);
    assert.ok(status.segments >= 1);
    assert.ok(status.bytesToday >= 6);

    // Un origen que rechaza la petición se traduce a 502 con pista clara.
    const badUrl = buildGatewayUrl(gwBase, `${upstreamBase}/master.m3u8`, {}, { env });
    const bad = await fetch(badUrl);
    assert.equal(bad.status, 502);
    const payload = await bad.json();
    assert.equal(payload.status, 403);
  } finally {
    await close(gw);
    await close(upstream);
  }
});

test('pasarela HTTP: el presupuesto diario de bytes corta la retransmisión', async () => {
  const chunk = Buffer.alloc(700 * 1024, 7); // 700 KB por petición
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': chunk.length });
    res.end(chunk);
  });
  const upstreamPort = await listen(upstream);

  const env = {
    STREAM_GATEWAY: 'on',
    STREAM_GATEWAY_SECRET: SECRET,
    STREAM_GATEWAY_DAILY_MB: '1',
    STREAM_GATEWAY_ALLOW_PRIVATE: '1',
  };
  resetGatewayState();
  const { server: gw, base: gwBase } = await startGateway(env);

  try {
    const target = `http://127.0.0.1:${upstreamPort}/seg.ts`;
    const first = await fetch(buildGatewayUrl(gwBase, target, {}, { env }));
    assert.equal(first.status, 200);
    await first.arrayBuffer();

    // La segunda petición se corta a mitad de segmento al agotarse el MB; desde
    // el cliente eso se ve como una descarga truncada (el reproductor reintenta).
    let received = 0;
    try {
      const second = await fetch(buildGatewayUrl(gwBase, target, {}, { env }));
      const body = Buffer.from(await second.arrayBuffer());
      received = body.length;
    } catch (_) {
      received = -1; // corte detectado por el cliente
    }
    assert.ok(received === -1 || received < chunk.length, 'el corte debe ocurrir antes del final del segmento');
    assert.ok(gatewayStatus(env).blockedByBudget >= 1);

    // Y a partir de ahí se rechaza sin abrir conexión al origen.
    const third = await fetch(buildGatewayUrl(gwBase, target, {}, { env }));
    assert.equal(third.status, 503);
    assert.match((await third.json()).error, /Presupuesto/);
  } finally {
    await close(gw);
    await close(upstream);
  }
});

test('pasarela desactivada responde 404 y no retransmite nada', async () => {
  resetGatewayState();
  const { server: gw, base: gwBase } = await startGateway({ STREAM_GATEWAY: 'off' });
  try {
    const res = await fetch(`${gwBase}/g/segment?t=x`);
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /desactivada/);
  } finally {
    await close(gw);
  }
});

test('defensa SSRF y anti-proxy-abierto: sin flag no hay destinos privados ni ?u=', () => {
  const { isPrivateHost } = require('../stremio/stream-gateway.cjs');
  for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.9',
    '169.254.169.254', '::1', 'fd00::1', 'metadata.google.internal', 'router.local']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['cdn.example', '8.8.8.8', 'baby-beamup.club', '172.32.0.1']) {
    assert.equal(isPrivateHost(host), false, host);
  }

  // El formato `?u=<base64>` sólo existe si se habilita expresamente.
  const encoded = Buffer.from('https://cdn.example/seg.ts', 'utf8').toString('base64url');
  assert.equal(decodeTarget('', encoded, { secret: SECRET }), null);
  assert.equal(decodeTarget('', encoded, { secret: SECRET, allowUnsigned: true }).url, 'https://cdn.example/seg.ts');
});
