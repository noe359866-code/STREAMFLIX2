'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { renderConfigurePage } = require('../stremio/landing.cjs');
const { ACTIVE_IDS, decodeConfig } = require('../stremio/config.cjs');
const { createAddonServer } = require('../stremio/server.cjs');

function runPage(userConfig = {}) {
  const html = renderConfigurePage({ env: {}, userConfig, baseUrl: 'https://addon.example' });
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.classList = { toggle() {} }; }
    set innerHTML(value) { if (value === '') this.children = []; }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelectorAll(selector) { return selector === '.prov-item' ? this.children : []; }
    trigger(name) { return this.listeners[name]?.(); }
  }
  const ids = ['providersGrid', 'selectedCount', 'manifestUrlPreview', 'installDesktopBtn', 'installWebBtn', 'copyBtn', 'providerSearch', 'emptySearch', 'summaryCount', 'summaryLang', 'selectionStatus', 'lang', 'timeoutSec', 'tmdbKey'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.lang.options = [{ textContent: 'Todos · Priorizar Español Latino' }];
  elements.lang.selectedIndex = 0;
  const buttons = ['all', 'general', 'anime', 'series', 'movies', 'doramas', 'none'].map((filter) => { const button = new Element(); button.dataset.filter = filter; return button; });
  const document = { getElementById: (id) => elements[id], createElement: () => new Element(), querySelectorAll: () => buttons };
  let copied = '';
  vm.runInNewContext(source, { document, window: { location: { origin: 'https://addon.example' }, prompt() {} }, navigator: { clipboard: { async writeText(value) { copied = value; } } }, TextEncoder, btoa: (value) => Buffer.from(value, 'binary').toString('base64'), setTimeout() {} });
  return { html, elements, buttons, copied: () => copied };
}

test('la configuración conserva selección vacía, actualiza el enlace y permite buscar sin cambiar proveedores', async () => {
  const { elements: el, buttons, copied } = runPage({ providers: [] });
  assert.equal(el.selectedCount.textContent, '0');
  assert.equal(el.selectionStatus.textContent, 'Selecciona al menos un proveedor');
  assert.deepEqual(decodeConfig(new URL(el.manifestUrlPreview.textContent).pathname.split('/')[1], {}).providers, []);
  buttons.find((item) => item.dataset.filter === 'all').trigger('click');
  assert.equal(el.selectedCount.textContent, String(ACTIVE_IDS.length));
  assert.equal(el.manifestUrlPreview.textContent, 'https://addon.example/manifest.json');
  assert.equal(el.installDesktopBtn.href, 'stremio://addon.example/manifest.json');
  el.providerSearch.value = 'vixsrc';
  el.providerSearch.trigger('input');
  assert.equal(el.providersGrid.children.filter((item) => !item.hidden).length, 1);
  assert.equal(el.selectedCount.textContent, String(ACTIVE_IDS.length));
  el.providerSearch.value = 'no-existe';
  el.providerSearch.trigger('input');
  assert.equal(el.emptySearch.hidden, false);
  el.tmdbKey.value = 'clave-demo';
  el.tmdbKey.trigger('input');
  assert.equal(decodeConfig(new URL(el.manifestUrlPreview.textContent).pathname.split('/')[1], {}).tmdbKey, 'clave-demo');
  await el.copyBtn.trigger('click');
  assert.equal(copied(), el.manifestUrlPreview.textContent);
});

test('la web escapa datos insertados en el script y sirve la imagen de portada', async () => {
  const page = renderConfigurePage({ env: {}, userConfig: { tmdbKey: '</script><script>alert(1)</script>' } });
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
  const server = createAddonServer({ env: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/hero.jpg`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
