'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const zlib = require('node:zlib');

const {
  parseProxyList,
  proxyFetch,
  runWithProxy,
  ensurePool,
  getHealthyProxy,
  proxyStatus,
  resetProxyPool,
  installProxyFetchHook,
  uninstallProxyFetchHook,
  proxyContext,
} = require('../stremio/proxy-pool.cjs');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Proxy HTTP con soporte de túnel CONNECT, como los del listado público. */
function createTunnelProxy() {
  const seen = [];
  const server = http.createServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('solo CONNECT');
  });

  server.on('connect', (req, clientSocket, head) => {
    seen.push(req.url);
    const [host, port] = String(req.url).split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  return { server, seen };
}

/** Servidor destino con los casos que usan los proveedores. */
function createTargetServer(getProxyPort) {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, reached: true }));
      return;
    }

    if (url === '/chunked') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('uno-');
      setTimeout(() => {
        res.write('dos-');
        res.end('tres');
      }, 5);
      return;
    }

    if (url === '/gzip') {
      const body = zlib.gzipSync(Buffer.from('contenido-comprimido', 'utf8'));
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': body.length });
      res.end(body);
      return;
    }

    if (url === '/redirect') {
      res.writeHead(302, { Location: '/json' });
      res.end();
      return;
    }

    if (url === '/post') {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, body: data, ua: req.headers['user-agent'] || '' }));
      });
      return;
    }

    if (url === '/list-429') {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' });
      res.end('too many requests');
      return;
    }

    if (url === '/list-plain') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`10.0.0.9:8000\n127.0.0.1:${getProxyPort()}\n`);
      return;
    }

    if (url === '/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: [{
          alive: true,
          anonymity: 'elite',
          proxy: `127.0.0.1:${getProxyPort()}`,
          protocol: 'http',
          ssl: true,
          uptime: 99,
          average_timeout: 120,
          ip_data: { countryCode: 'XX', country: 'Test' },
        }],
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('no encontrado');
  });
}

test('parseProxyList entiende el JSON de ProxyScrape v4, arrays y texto plano', () => {
  const v4 = {
    proxies: [
      { proxy: '1.2.3.4:8080', protocol: 'http', ssl: true, uptime: 80, average_timeout: 900, ip_data: { countryCode: 'ES' } },
      { proxy: '5.6.7.8:3128', protocol: 'http', ssl: true, uptime: 95, average_timeout: 300 },
      { proxy: '9.9.9.9:1080', protocol: 'socks5', ssl: true },
      { proxy: '1.2.3.4:8080', protocol: 'http', ssl: true },
      { proxy: 'sin-puerto', protocol: 'http' },
    ],
  };
  const parsed = parseProxyList(v4);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, '5.6.7.8:3128', 'ordena por uptime y latencia');
  assert.equal(parsed[1].country, 'ES');

  const text = parseProxyList('10.0.0.1:8000\n10.0.0.2:8001\nbasura\n10.0.0.1:8000');
  assert.deepEqual(text.map((p) => p.id), ['10.0.0.1:8000', '10.0.0.2:8001']);

  assert.deepEqual(parseProxyList(null), []);
});

test('proxyFetch tuneliza por CONNECT: JSON, chunked, gzip, redirección y POST', async () => {
  let proxyPort = 0;
  const target = createTargetServer(() => proxyPort);
  await listen(target);
  const targetPort = target.address().port;

  const tunnel = createTunnelProxy();
  await listen(tunnel.server);
  proxyPort = tunnel.server.address().port;
  const proxy = { id: `127.0.0.1:${proxyPort}`, host: '127.0.0.1', port: proxyPort };
  const base = `http://127.0.0.1:${targetPort}`;

  try {
    const json = await proxyFetch(`${base}/json`, {}, proxy);
    assert.equal(json.status, 200);
    assert.match(json.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await json.json(), { ok: true, reached: true });

    const chunked = await proxyFetch(`${base}/chunked`, {}, proxy);
    assert.equal(await chunked.text(), 'uno-dos-tres');

    const gzip = await proxyFetch(`${base}/gzip`, {}, proxy);
    assert.equal(await gzip.text(), 'contenido-comprimido');

    const redirected = await proxyFetch(`${base}/redirect`, {}, proxy);
    assert.equal(redirected.status, 200);
    assert.deepEqual(await redirected.json(), { ok: true, reached: true });

    const posted = await proxyFetch(`${base}/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'STREAMFLIX2/1.0' },
      body: JSON.stringify({ q: 'inception' }),
    }, proxy);
    const echo = await posted.json();
    assert.equal(echo.method, 'POST');
    assert.equal(echo.body, '{"q":"inception"}');
    assert.equal(echo.ua, 'STREAMFLIX2/1.0');

    const missing = await proxyFetch(`${base}/no-existe`, {}, proxy);
    assert.equal(missing.status, 404);

    assert.ok(tunnel.seen.length >= 6, 'todas las peticiones pasaron por el túnel');
    await assert.rejects(() => proxyFetch(`${base}/json`, {}, { host: '127.0.0.1', port: 1 }), /Proxy|Timeout|ECONN/i);
  } finally {
    await close(tunnel.server);
    await close(target);
  }
});

test('el hook de fetch usa el proxy solo dentro de runWithProxy', async () => {
  let proxyPort = 0;
  const target = createTargetServer(() => proxyPort);
  await listen(target);
  const targetPort = target.address().port;

  const tunnel = createTunnelProxy();
  await listen(tunnel.server);
  proxyPort = tunnel.server.address().port;
  const proxy = { id: `127.0.0.1:${proxyPort}`, host: '127.0.0.1', port: proxyPort };
  const url = `http://127.0.0.1:${targetPort}/json`;

  installProxyFetchHook();
  try {
    const direct = await fetch(url);
    assert.equal(direct.status, 200);
    const before = tunnel.seen.length;

    const proxied = await runWithProxy(proxy, () => fetch(url));
    assert.equal(proxied.status, 200);
    assert.deepEqual(await proxied.json(), { ok: true, reached: true });
    assert.ok(tunnel.seen.length > before, 'la petición dentro del contexto salió por el túnel');

    assert.equal(proxyContext.getStore(), undefined, 'el contexto no se filtra fuera');
  } finally {
    uninstallProxyFetchHook();
    await close(tunnel.server);
    await close(target);
  }
});

test('ensurePool valida el listado real contra un canario y entrega proxies sanos', async () => {
  let proxyPort = 0;
  const target = createTargetServer(() => proxyPort);
  await listen(target);
  const targetPort = target.address().port;

  const tunnel = createTunnelProxy();
  await listen(tunnel.server);
  proxyPort = tunnel.server.address().port;

  resetProxyPool();
  const env = {
    PROXY_LIST_URL: `http://127.0.0.1:${targetPort}/list`,
    PROXY_CANARY_HOST: '127.0.0.1',
    PROXY_CANARY_PORT: String(targetPort),
    PROXY_CANARY_TLS: '0',
    PROXY_POOL_SIZE: '2',
  };

  try {
    const healthy = await ensurePool(env, { force: true });
    assert.equal(healthy.length, 1);
    assert.equal(healthy[0].id, `127.0.0.1:${proxyPort}`);
    assert.equal(typeof healthy[0].latencyMs, 'number');

    const status = proxyStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.healthy, 1);
    assert.equal(status.candidates, 1);
    assert.ok(getHealthyProxy(), 'round-robin devuelve un proxy');

    // Segunda llamada sin `force` reutiliza el pool (no vuelve a probar).
    const fresh = await ensurePool(env);
    assert.equal(fresh.length, 1);
  } finally {
    resetProxyPool();
    await close(tunnel.server);
    await close(target);
  }
});

test('el addon rescata por proxy los proveedores bloqueados en la IP del servidor', async () => {
  const { getStremioStreams, clearResultCache } = require('../stremio/addon.cjs');

  let proxyPort = 0;
  const target = createTargetServer(() => proxyPort);
  await listen(target);
  const targetPort = target.address().port;

  const tunnel = createTunnelProxy();
  await listen(tunnel.server);
  proxyPort = tunnel.server.address().port;

  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('v3-cinemeta.strem.io/meta/movie/tt3333333.json')) {
      return new Response(JSON.stringify({
        meta: { id: 'tt3333333', moviedb_id: 999, name: 'Proxy Test', releaseInfo: '2022' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };

  // Falla como los sitios reales desde la IP de Beamup; solo funciona por proxy.
  const blockedProvider = {
    async getStreams() {
      if (!proxyContext.getStore()) throw new Error('403 bloqueado por Cloudflare');
      return [{
        name: 'Rescatado', provider: 'cuevana', url: 'https://cdn.example/proxy/master.m3u8',
        quality: '1080p', language: 'es-LAT', type: 'hls',
      }];
    },
  };

  const env = {
    PROXY_LIST_URL: `http://127.0.0.1:${targetPort}/list`,
    PROXY_CANARY_HOST: '127.0.0.1',
    PROXY_CANARY_PORT: String(targetPort),
    PROXY_CANARY_TLS: '0',
    PROXY_SCRAPING: 'auto',
    PROXY_MAX_RETRIES: '3',
    PROXY_TIMEOUT_MS: '3000',
    PROXY_BUDGET_MS: '5000',
  };

  const params = {
    type: 'movie',
    id: 'tt3333333',
    config: { providers: ['cuevana'] },
    env,
    providerLoader: () => blockedProvider,
    useMetadataCache: false,
    deadlineMs: 120,
  };

  resetProxyPool();
  clearResultCache();
  try {
    const first = await getStremioStreams(params);
    assert.ok(first.elapsedMs <= 2000, 'responde dentro del plazo aunque el proveedor esté bloqueado');

    // La segunda pasada por proxy corre en segundo plano y deja el resultado en caché.
    let cached = null;
    for (let i = 0; i < 40 && !cached; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const attempt = await getStremioStreams(params);
      if (attempt.cached && attempt.streams.length > 0) cached = attempt;
    }

    assert.ok(cached, 'la caché acabó conteniendo el stream rescatado');
    assert.equal(cached.streams.length, 1);
    assert.equal(cached.streams[0].url, 'https://cdn.example/proxy/master.m3u8');
    assert.ok(tunnel.seen.length >= 1, 'el proveedor salió por el túnel CONNECT');
  } finally {
    global.fetch = originalFetch;
    uninstallProxyFetchHook();
    resetProxyPool();
    clearResultCache();
    await close(tunnel.server);
    await close(target);
  }
});

test('el listado tiene respaldo: si la primera fuente da 429 usa la siguiente', async () => {
  let proxyPort = 0;
  const target = createTargetServer(() => proxyPort);
  await listen(target);
  const targetPort = target.address().port;

  const tunnel = createTunnelProxy();
  await listen(tunnel.server);
  proxyPort = tunnel.server.address().port;

  resetProxyPool();
  const env = {
    // Primera fuente limitada (429), segunda en texto plano como TheSpeedX.
    PROXY_LIST_URL: `http://127.0.0.1:${targetPort}/list-429,http://127.0.0.1:${targetPort}/list-plain`,
    PROXY_CANARY_HOST: '127.0.0.1',
    PROXY_CANARY_PORT: String(targetPort),
    PROXY_CANARY_TLS: '0',
    PROXY_POOL_SIZE: '2',
    PROXY_CANDIDATES: '5',
  };

  const originalFetch = global.fetch;
  try {
    const healthy = await ensurePool(env, { force: true });
    assert.ok(healthy.length >= 1, 'el respaldo aportó candidatos');
    assert.ok(healthy.some((p) => p.id === `127.0.0.1:${proxyPort}`));
    assert.equal(proxyStatus().lastError, '');

    // Un refresco posterior que falla por completo conserva el pool anterior.
    const brokenEnv = { ...env, PROXY_LIST_URL: `http://127.0.0.1:${targetPort}/list-429` };
    const kept = await ensurePool(brokenEnv, { force: true });
    assert.ok(kept.length >= 1, 'no se pierde un pool que ya funcionaba');
    assert.match(proxyStatus().lastError, /conserva el pool anterior/);
  } finally {
    global.fetch = originalFetch;
    resetProxyPool();
    uninstallProxyFetchHook();
    await close(tunnel.server);
    await close(target);
  }
});
