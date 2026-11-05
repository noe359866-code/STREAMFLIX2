'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
function fixture(name) {
  return fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');
}
function loadSource(relative) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, relative)], bundle: true, write: false,
    format: 'cjs', platform: 'node', target: 'node20', external: ['crypto-js'], logLevel: 'silent',
  });
  const filename = path.join(ROOT, relative).replace(/\.js$/, '.test-bundle.cjs');
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance._compile(result.outputFiles[0].text, filename);
  return instance.exports;
}
function provider(id) {
  const filename = path.join(ROOT, 'providers', `${id}.js`);
  delete require.cache[require.resolve(filename)];
  return require(filename);
}
function response(body, url = 'https://fixture.example/', options = {}) {
  const status = options.status || 200;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers(options.headers || {}),
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}
function matches(route, url, init) {
  if (typeof route === 'string') return url.includes(route);
  if (route instanceof RegExp) return route.test(url);
  return route(url, init);
}
function mockFetch(routes, metadata = {}) {
  const calls = [];
  const original = global.fetch;
  global.TMDB_API_KEY = 'offline-test-key';
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (/api\.themoviedb\.org\/3\/(?:movie|tv)\/123\?/.test(url)) {
      const tv = /\/tv\//.test(url);
      return response({
        id: 123,
        title: tv ? undefined : 'Contenido Demo', name: tv ? 'Contenido Demo' : undefined,
        original_title: tv ? undefined : 'Contenido Demo', original_name: tv ? 'Contenido Demo' : undefined,
        release_date: tv ? undefined : '2024-01-01', first_air_date: tv ? '2024-01-01' : undefined,
        external_ids: { imdb_id: 'tt1234567' }, alternative_titles: { titles: [] },
        ...metadata,
      }, url);
    }
    for (const [route, value] of routes) {
      if (!matches(route, url, init)) continue;
      const result = typeof value === 'function' ? await value(url, init, calls) : value;
      if (result && result.__response) return response(result.body, url, result);
      return response(result === undefined ? '' : result, url);
    }
    throw new Error(`Fixture sin ruta: ${url}`);
  };
  return {
    calls,
    restore() { global.fetch = original; delete global.TMDB_API_KEY; },
  };
}
function card(href, title = 'Contenido Demo') {
  return `<!doctype html><article><a href="${href}" title="${title}"><img alt="${title}"><h3>${title}</h3><span>2024</span></a></article>`;
}
function episodePage(base = 'https://sw.example/e/demo') {
  return `<!doctype html><ul><li><a href="/episodio/contenido-demo-2x3"><span class="numerando">2-3</span> Episodio 3</a></li></ul><iframe src="${base}"></iframe>`;
}
const HLS = 'https://cdn.example/video/playlist.m3u8';
const commonPlayerRoutes = () => [
  ['https://sw.example/e/demo', fixture('player-hls.html')],
  ['https://voe.example/e/demo', fixture('player-hls.html')],
  ['https://player.example/e/demo', fixture('player-hls.html')],
];
module.exports = { ROOT, fixture, loadSource, provider, response, mockFetch, card, episodePage, HLS, commonPlayerRoutes };
