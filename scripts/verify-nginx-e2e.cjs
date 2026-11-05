'use strict';

/**
 * Prueba E2E real contra un proceso Nginx verdadero:
 * 1) Arranca el Addon Stremio en un puerto local y un servidor CDN HLS simulado que exige Referer y query firmada (%2B).
 * 2) Verifica que un proxy Nginx real delante de ambos:
 *    - Pasa salud (/nginx-health) y sirve /manifest.json válido según stremio-addon-linter.
 *    - Cachea /manifest.json (MISS -> HIT en X-Streamflix2-Cache).
 *    - En /hlsp/t/<token>/..., inyecta Referer y Origin, preserva %2B sin decodificar,
 *      añade CORS y reescribe URLs absolutas, URI="/..." y rutas relativas a raíz dentro del .m3u8.
 *    - Rechaza con 403 peticiones sin token válido y objetivos SSRF (127.0.0.1, 169.254.169.254).
 */

const http = require('node:http');
const assert = require('node:assert/strict');
const { lintManifest } = require('stremio-addon-linter');
const { createAddonServer } = require('../stremio/server.cjs');
const { renderNginxConfig, validateRenderedNginxConfig } = require('../nginx/render-config.cjs');

async function startMockCdn(port) {
  const seenRequests = [];
  const server = http.createServer((req, res) => {
    seenRequests.push({
      url: req.url,
      headers: req.headers,
    });
    if (req.headers.referer !== 'https://voe.sx/') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Missing or wrong Referer');
      return;
    }
    if (req.url === '/hls/master.m3u8?sig=a%2Bb&exp=999') {
      const playlist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-KEY:METHOD=AES-128,URI="/keys/enc.key?sig=1"',
        '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080',
        '1080p/index.m3u8?sig=rel',
        '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720',
        '/hls/720p/index.m3u8?sig=root',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480',
        'https://edge2.cdn.example/hls/480p/index.m3u8?sig=abs',
        '',
      ].join('\n');
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': 'https://voe.sx',
      });
      res.end(playlist);
      return;
    }
    if (req.url === '/video/sample.mp4') {
      const data = Buffer.from('0123456789ABCDEF0123456789ABCDEF');
      if (req.headers.range === 'bytes=0-7') {
        res.writeHead(206, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes 0-7/${data.length}`,
          'Content-Length': 8,
        });
        res.end(data.subarray(0, 8));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': data.length });
      res.end(data);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
  return { server, seenRequests };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--render-ci-conf')) {
    const outPath = args[args.indexOf('--render-ci-conf') + 1];
    const fs = require('node:fs');
    const conf = renderNginxConfig({
      NGINX_PORT: process.env.NGINX_PORT || '8088',
      SERVER_NAME: '_',
      BEAMUP_SCHEME: 'http',
      BEAMUP_HOST: process.env.BEAMUP_HOST || '127.0.0.1:7001',
      NGINX_PROXY_TOKEN: process.env.NGINX_PROXY_TOKEN || 'ci_tok_2026',
      DNS_RESOLVER: process.env.DNS_RESOLVER || '127.0.0.53 1.1.1.1',
    });
    validateRenderedNginxConfig(conf);
    fs.writeFileSync(outPath, conf, 'utf8');
    return;
  }

  const addonPort = Number(process.env.ADDON_PORT || 7001);
  const cdnPort = Number(process.env.CDN_PORT || 8080);
  const nginxBase = process.env.NGINX_URL || 'http://127.0.0.1:8088';
  const cdnHostForNginx = process.env.CDN_HOST_FOR_NGINX || `cdn.streamflix2.test:${cdnPort}`;
  const token = process.env.NGINX_PROXY_TOKEN || 'ci_tok_2026';

  const addonServer = createAddonServer({
    env: {
      NGINX_PROXY_URL: nginxBase,
      NGINX_PROXY_TOKEN: token,
    },
  });
  await new Promise((resolve) => addonServer.listen(addonPort, '0.0.0.0', resolve));
  const cdn = await startMockCdn(cdnPort);

  try {
    // 1. Salud del propio Nginx
    const healthRes = await fetch(`${nginxBase}/nginx-health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');

    // 2. Reverse proxy a /manifest.json + comprobación de caché MISS -> HIT
    const m1 = await fetch(`${nginxBase}/manifest.json`);
    assert.equal(m1.status, 200);
    const cache1 = m1.headers.get('x-streamflix2-cache');
    const manifest = await m1.json();
    assert.equal(lintManifest(manifest).valid, true);

    const m2 = await fetch(`${nginxBase}/manifest.json`);
    assert.equal(m2.status, 200);
    const cache2 = m2.headers.get('x-streamflix2-cache');
    assert.ok(cache1 === 'MISS' || cache1 === 'HIT', `Cache1 inesperado: ${cache1}`);
    assert.equal(cache2, 'HIT');

    // 3. Proxy HLS autenticado con preservación de %2B y reescritura de .m3u8
    const hlsUrl = `${nginxBase}/hlsp/t/${token}/https/voe.sx/http/${cdnHostForNginx}/hls/master.m3u8?sig=a%2Bb&exp=999`;
    const hlsRes = await fetch(hlsUrl);
    assert.equal(hlsRes.status, 200);
    assert.equal(hlsRes.headers.get('access-control-allow-origin'), '*');
    const m3u8 = await hlsRes.text();

    assert.match(m3u8, new RegExp(`URI="/hlsp/t/${token}/https/voe\\.sx/http/${cdnHostForNginx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/keys/enc\\.key\\?sig=1"`));
    assert.match(m3u8, /\n1080p\/index\.m3u8\?sig=rel\n/);
    assert.match(m3u8, new RegExp(`\\n/hlsp/t/${token}/https/voe\\.sx/http/${cdnHostForNginx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/hls/720p/index\\.m3u8\\?sig=root\\n`));
    assert.match(m3u8, new RegExp(`/hlsp/t/${token}/https/voe\\.sx/https/edge2\\.cdn\\.example/hls/480p/index\\.m3u8\\?sig=abs`));
    assert.equal(cdn.seenRequests[0].headers.origin, 'https://voe.sx');

    // 4. Rango HTTP 206 Partial Content en MP4
    const mp4Res = await fetch(`${nginxBase}/hlsp/t/${token}/https/voe.sx/http/${cdnHostForNginx}/video/sample.mp4`, {
      headers: { Range: 'bytes=0-7' },
    });
    assert.equal(mp4Res.status, 206);
    assert.equal(await mp4Res.text(), '01234567');

    // 5. Rechazo sin token o con token erróneo (403)
    const noTok = await fetch(`${nginxBase}/hlsp/https/voe.sx/http/${cdnHostForNginx}/video/sample.mp4`);
    assert.equal(noTok.status, 403);
    const badTok = await fetch(`${nginxBase}/hlsp/t/incorrecto/https/voe.sx/http/${cdnHostForNginx}/video/sample.mp4`);
    assert.equal(badTok.status, 403);

    // 6. Bloqueo SSRF (403) incluso presentando el token válido
    for (const ssrfHost of ['127.0.0.1:8080', '169.254.169.254', '192.168.1.1', 'localhost:8080']) {
      const ssrfRes = await fetch(`${nginxBase}/hlsp/t/${token}/https/voe.sx/http/${ssrfHost}/secret`);
      assert.equal(ssrfRes.status, 403, `SSRF no bloqueado para ${ssrfHost}`);
    }

    console.log('✓ Prueba E2E real con Nginx superada (caché, HLS sub_filter, Range 206, token y SSRF)');
  } finally {
    await new Promise((resolve) => addonServer.close(resolve));
    await new Promise((resolve) => cdn.server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
