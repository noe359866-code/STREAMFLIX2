'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('./helpers.cjs');
const {
  CDN_ORIGIN, REPOSITORY, MAX_FILE_BYTES, resolveRef, manifestUrl,
  validateManifest, validateLocalPackage, checkPublished,
} = require('../scripts/nuvio-cdn.cjs');

const INSTALL_URL = `${CDN_ORIGIN}/gh/${REPOSITORY}@main/manifest.json`;
const remoteManifest = {
  name: 'STREAMFLIX2 de prueba',
  version: '1.0.0',
  scrapers: [
    { id: 'demo', name: 'Demo', version: '1.0.0', filename: 'providers/demo.js' },
    { id: 'demo2', name: 'Demo 2', version: '1.0.0', filename: 'providers/demo2.js' },
  ],
};
const bundle = 'module.exports.getStreams = async () => [];';

function cdnFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const pathname = new URL(url).pathname;
    const filename = pathname.endsWith('/manifest.json') ? 'manifest.json' : pathname.split('/').slice(-2).join('/');
    if (overrides[filename]) return overrides[filename](url, init);
    if (filename === 'manifest.json') return Response.json(remoteManifest);
    if (filename.startsWith('providers/')) {
      return new Response(bundle, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
    }
    throw new Error(`Fixture CDN sin ruta: ${url}`);
  };
  return { calls, fetchImpl };
}

test('jsDelivr usa la URL del manifiesto, no la portada www.jsdelivr.com', () => {
  assert.equal(manifestUrl(), INSTALL_URL);
  assert.equal(manifestUrl('main'), INSTALL_URL);
  assert.equal(manifestUrl('v1.2.3'), `${CDN_ORIGIN}/gh/${REPOSITORY}@v1.2.3/manifest.json`);
  const sha = 'd06a85adbc31cbf8ff4d8681da96f851693f7a23';
  assert.equal(manifestUrl(sha), `${CDN_ORIGIN}/gh/${REPOSITORY}@${sha}/manifest.json`);
  assert.match(resolveRef('HEAD'), /^[a-f0-9]{40}$/);
  for (const ref of ['', '../main', 'main?token=secreto', 'main#fragment', 'feature/demo', 'https://example.com']) {
    assert.throws(() => manifestUrl(ref), /Referencia no admitida/);
  }
});

test('el paquete local conserva rutas relativas que jsDelivr puede resolver', () => {
  const { manifest, files } = validateLocalPackage();
  assert.equal(files.length, manifest.scrapers.length);
  assert.equal(new URL(files[0], INSTALL_URL).href,
    `${CDN_ORIGIN}/gh/${REPOSITORY}@main/${files[0]}`);
  assert.throws(() => validateManifest({ ...remoteManifest, scrapers: [{ ...remoteManifest.scrapers[0], filename: '../secreto.js' }] }), /ruta relativa/);
  assert.throws(() => validateManifest({ ...remoteManifest, scrapers: [{ id: 'demo', filename: 'providers/demo.js' }] }), /faltan name o version/);
  assert.throws(() => validateManifest({ ...remoteManifest, scrapers: [remoteManifest.scrapers[0], remoteManifest.scrapers[0]] }), /duplicado/);
  assert.throws(() => validateManifest({ ...remoteManifest, scrapers: [] }), /no contiene scrapers/);
});

test('la validación local detecta un bundle ausente sin consultar la red', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamflix2-cdn-'));
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(remoteManifest));
    assert.throws(() => validateLocalPackage(dir), /ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la comprobación publicada descarga el manifiesto y todos sus bundles sin ejecutarlos', async () => {
  const { calls, fetchImpl } = cdnFetch();
  const result = await checkPublished({ fetchImpl });
  assert.equal(result.url, INSTALL_URL);
  assert.equal(result.providers, 2);
  assert.equal(result.version, '1.0.0');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.url).sort(), [
    INSTALL_URL,
    `${CDN_ORIGIN}/gh/${REPOSITORY}@main/providers/demo.js`,
    `${CDN_ORIGIN}/gh/${REPOSITORY}@main/providers/demo2.js`,
  ].sort());
  for (const call of calls) {
    assert.ok(call.init.signal);
    assert.equal(call.init.redirect, 'follow');
  }
});

test('la comprobación publicada rechaza 404, JSON inválido y HTML servido como bundle', async () => {
  await assert.rejects(checkPublished({
    fetchImpl: cdnFetch({ 'manifest.json': () => new Response('No encontrado', { status: 404 }) }).fetchImpl,
  }), /manifest\.json: HTTP 404/);
  await assert.rejects(checkPublished({
    fetchImpl: cdnFetch({ 'manifest.json': () => new Response('<html></html>', { headers: { 'Content-Type': 'application/json' } }) }).fetchImpl,
  }), /no devolvió JSON válido/);
  await assert.rejects(checkPublished({
    fetchImpl: cdnFetch({ 'providers/demo.js': () => new Response('<html></html>', { headers: { 'Content-Type': 'text/plain' } }) }).fetchImpl,
  }), /Content-Type inesperado/);
  await assert.rejects(checkPublished({
    fetchImpl: cdnFetch({ 'providers/demo.js': () => new Response('module.exports = {};', { headers: { 'Content-Type': 'text/javascript' } }) }).fetchImpl,
  }), /no parece un bundle CommonJS/);
});

test('la comprobación publicada limita el tamaño aunque falte Content-Length', async () => {
  const oversized = () => new Response('x', {
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_FILE_BYTES + 1) },
  });
  await assert.rejects(checkPublished({ fetchImpl: cdnFetch({ 'manifest.json': oversized }).fetchImpl }), /límite de tamaño/);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_FILE_BYTES + 1));
      controller.close();
    },
  });
  await assert.rejects(checkPublished({
    fetchImpl: cdnFetch({
      'manifest.json': () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }),
    }).fetchImpl,
  }), /límite de tamaño/);
});

test('el CLI imprime la URL sin red y rechaza opciones desconocidas', () => {
  const script = path.join(ROOT, 'scripts/nuvio-cdn.cjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Instalación Nuvio:/);
  assert.ok(result.stdout.includes(INSTALL_URL));
  assert.match(result.stdout, /No se ha consultado el CDN/);
  const invalid = spawnSync(process.execPath, [script, '--publicar'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /CDN Nuvio:/);
  const missing = spawnSync(process.execPath, [script, '--ref'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(missing.status, 1);
});
