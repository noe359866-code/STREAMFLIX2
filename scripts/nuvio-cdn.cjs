'use strict';

// Distribución estática del pack Nuvio por jsDelivr. No interviene en el addon
// Stremio ni ejecuta los bundles descargados durante la comprobación.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const REPOSITORY = 'noe359866-code/STREAMFLIX2';
const CDN_ORIGIN = 'https://cdn.jsdelivr.net';
const MAX_FILE_BYTES = 20_000_000;
const REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_CONCURRENCY = 4;

function resolveRef(value = 'main') {
  if (value === 'HEAD') {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }
  // Ramas con "/" se evitan: una referencia publicada e inmutable no depende de
  // cómo interprete el CDN una ruta de rama anidada ni de la caché de main.
  if (!/^(?:main|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|[a-f0-9]{7,40})$/i.test(value)) {
    throw new Error('Referencia no admitida. Usa main, HEAD, una etiqueta semver o un SHA de commit publicado.');
  }
  return value;
}

function manifestUrl(ref = 'main') {
  return `${CDN_ORIGIN}/gh/${REPOSITORY}@${encodeURIComponent(resolveRef(ref))}/manifest.json`;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('El manifiesto Nuvio debe ser un objeto JSON.');
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()
    || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('El manifiesto Nuvio necesita name y version.');
  }
  if (!Array.isArray(manifest.scrapers) || manifest.scrapers.length === 0) {
    throw new Error('El manifiesto Nuvio no contiene scrapers.');
  }
  const ids = new Set();
  for (const scraper of manifest.scrapers) {
    if (!scraper || typeof scraper.id !== 'string' || !/^[a-z0-9_-]+$/.test(scraper.id)) {
      throw new Error('Hay un scraper sin ID válido.');
    }
    if (typeof scraper.name !== 'string' || !scraper.name.trim()
      || typeof scraper.version !== 'string' || !scraper.version.trim()) {
      throw new Error(`${scraper.id}: faltan name o version.`);
    }
    if (ids.has(scraper.id)) throw new Error(`ID duplicado: ${scraper.id}`);
    ids.add(scraper.id);
    if (scraper.filename !== `providers/${scraper.id}.js`) {
      throw new Error(`${scraper.id}: se esperaba la ruta relativa providers/${scraper.id}.js`);
    }
  }
  return manifest.scrapers.map((scraper) => scraper.filename);
}

function validateLocalPackage(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = validateManifest(manifest);
  for (const filename of files) {
    const stat = fs.statSync(path.join(root, filename));
    if (!stat.isFile() || stat.size === 0) throw new Error(`Bundle vacío o no regular: ${filename}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`Bundle supera el límite de jsDelivr: ${filename}`);
  }
  return { manifest, files };
}

async function readText(response, mimePattern) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = response.headers.get('content-type') || '';
  if (!mimePattern.test(mime)) throw new Error(`Content-Type inesperado ${mime || '(vacío)'}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
    throw new Error('supera el límite de tamaño de jsDelivr');
  }
  if (!response.body) throw new Error('respuesta sin cuerpo');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error('supera el límite de tamaño de jsDelivr');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes };
}

async function fetchText(url, filename, mimePattern, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: filename.endsWith('.json') ? 'application/json' : 'text/javascript, application/javascript' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await readText(response, mimePattern);
  } catch (error) {
    throw new Error(`${filename}: ${error.name === 'TimeoutError' ? 'tiempo de espera agotado' : error.message}`);
  }
}

async function checkPublished(options = {}) {
  const {
    ref = 'main', fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS,
    concurrency = DOWNLOAD_CONCURRENCY,
  } = options;
  if (typeof fetchImpl !== 'function') throw new Error('Este comando necesita Node.js con fetch (Node 20+).');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('La concurrencia debe ser un entero positivo.');
  const url = manifestUrl(ref);
  const manifestResponse = await fetchText(url, 'manifest.json', /^application\/json\b/i, fetchImpl, timeoutMs);
  let manifest;
  try {
    manifest = JSON.parse(manifestResponse.text);
  } catch {
    throw new Error('manifest.json: el CDN no devolvió JSON válido.');
  }
  const files = validateManifest(manifest);
  let bytes = manifestResponse.bytes;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const filename = files[next++];
      const bundleUrl = new URL(filename, url).href;
      const result = await fetchText(bundleUrl, filename, /^(?:text|application)\/javascript\b/i, fetchImpl, timeoutMs);
      if (!/\bgetStreams\b/.test(result.text) || !/\bmodule\.exports\b/.test(result.text)) {
        throw new Error(`${filename}: no parece un bundle CommonJS de Nuvio.`);
      }
      bytes += result.bytes;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { url, version: manifest.version, providers: files.length, bytes };
}

async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      ref: { type: 'string', default: 'main' },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`Uso: npm run nuvio:cdn -- [--ref main|HEAD|etiqueta|SHA] [--check]

Sin --check valida el paquete local e imprime la URL de instalación.
Con --check descarga el manifiesto y sus bundles desde jsDelivr, sin ejecutarlos.
HEAD se convierte al SHA del commit actual; ese commit debe estar publicado.
Las pruebas offline no llaman a jsDelivr.`);
    return;
  }
  const ref = resolveRef(values.ref);
  const local = validateLocalPackage();
  const url = manifestUrl(ref);
  console.log(`Paquete local: ${local.files.length} bundles y manifest.json válidos.`);
  console.log(`Instalación Nuvio:\n${url}`);
  if (values.check) {
    const result = await checkPublished({ ref });
    console.log(`✓ jsDelivr sirvió manifest.json y ${result.providers} bundles (versión ${result.version}).`);
    console.log('Comprobación de descarga; no ejecuta plugins ni verifica reproducción de vídeo.');
  } else {
    console.log('No se ha consultado el CDN. Tras publicar los archivos: npm run nuvio:cdn -- --check');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`CDN Nuvio: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { CDN_ORIGIN, REPOSITORY, MAX_FILE_BYTES, resolveRef, manifestUrl, validateManifest, validateLocalPackage, checkPublished };
