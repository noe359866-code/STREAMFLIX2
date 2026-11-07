'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, provider } = require('./helpers.cjs');
const { ACTIVE_IDS } = require('../stremio/config.cjs');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ids = manifest.scrapers.map((item) => item.id);

test('el manifiesto no registra los dos proveedores retirados y conserva bundles válidos', () => {
  assert.equal(manifest.scrapers.length, 35);
  assert.equal(new Set(ids).size, 35);
  assert.ok(!ids.includes('cinehax') && !ids.includes('tukiplay'));
  assert.ok(manifest.name && manifest.version);
  for (const scraper of manifest.scrapers) {
    assert.ok(scraper.id && scraper.name && scraper.version && scraper.filename);
    assert.equal(scraper.filename, `providers/${scraper.id}.js`);
    assert.ok(fs.existsSync(path.join(ROOT, scraper.filename)), scraper.filename);
    assert.deepEqual(scraper.contentLanguage,
      scraper.id === 'tudorama' ? ['es', 'en'] : scraper.id === 'vixsrc' ? ['it', 'en']
        : scraper.id === 'warezcdn' ? ['und'] : ['es']);
    assert.ok(scraper.supportedTypes.every((type) => ['movie', 'tv'].includes(type)));
  }
});

test('los proveedores solo de series y los inactivos están marcados correctamente', () => {
  for (const id of ['animeav1', 'danimados', 'lacartoons', 'seriesflix', 'seriesturcas', 'tudorama']) {
    assert.deepEqual(manifest.scrapers.find((item) => item.id === id).supportedTypes, ['tv']);
  }
  for (const id of ['hdfull', 'gnulaone', 'repelis24', 'verpeliculasonline']) {
    assert.deepEqual(manifest.scrapers.find((item) => item.id === id).supportedTypes, ['movie']);
  }
  for (const id of ['pelisforte', 'pelisgo']) {
    assert.deepEqual(manifest.scrapers.find((item) => item.id === id).supportedTypes, ['movie', 'tv']);
  }
  for (const id of ['animebum', 'vixsrc', 'warezcdn']) {
    assert.equal(manifest.scrapers.find((item) => item.id === id).enabled, false);
    assert.ok(!ACTIVE_IDS.includes(id), `${id} no debe aparecer en la configuración de Stremio`);
  }
  for (const id of ['gnulaone', 'repelis24', 'tudorama']) {
    assert.equal(manifest.scrapers.find((item) => item.id === id).enabled, true);
    assert.ok(ACTIVE_IDS.includes(id), `${id} debe estar disponible en Stremio`);
  }
  assert.equal(manifest.scrapers.filter((item) => item.enabled).length, 32);
});

test('cada bundle exporta getStreams y no depende de builtins de Node', async () => {
  for (const scraper of manifest.scrapers) {
    const filename = path.join(ROOT, scraper.filename);
    const code = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(code, /require\(["'](?:node:|fs|path|http|https|net|tls|child_process)/, scraper.id);
    assert.doesNotMatch(code, /\bprocess\.(?:env|cwd|exit|platform)/, scraper.id);
    const exported = provider(scraper.id);
    assert.equal(typeof exported.getStreams, 'function', scraper.id);
    assert.deepEqual(await exported.getStreams('', 'movie'), [], scraper.id);
    assert.deepEqual(await exported.getStreams('123', 'tv', 0, 0), [], scraper.id);
  }
});

test('los bundles solo dejan crypto-js como require externo permitido por Nuvio', () => {
  for (const scraper of manifest.scrapers) {
    const code = fs.readFileSync(path.join(ROOT, scraper.filename), 'utf8');
    const requires = [...code.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1]);
    assert.ok(requires.every((name) => name === 'crypto-js'), `${scraper.id}: ${requires.join(', ')}`);
  }
});
