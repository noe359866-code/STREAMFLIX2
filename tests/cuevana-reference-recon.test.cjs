'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectBody, inspect } = require('../scripts/cuevana-reference-recon.cjs');

test('diagnóstico: distingue catálogo, ficha, episodios e idiomas del HTML antiguo', () => {
  const sample = `<div id="aa-wp"><div class="TPost C"></div></div>
    <section id='top-single'><div id="season-2"></div>
      <div id="OptL1"><iframe data-src="//host/e/1"></iframe></div>
      <div id="OptE3"><iframe data-src="https://host/e/2"></iframe></div>
      <div id="OptS9"><iframe src="https://host/e/3"></iframe></div>
    </section>`;
  assert.deepEqual(inspectBody(sample, 'text/html'), {
    kind: 'html', legacyCatalog: true, legacyDetail: true, legacySeason: true,
    options: { L: 1, E: 1, S: 1 }, lazyIframes: 2,
  });
});

test('diagnóstico: HTML sin marcadores legacy no representa una ficha', () => {
  assert.deepEqual(inspectBody('<h1>Forbidden</h1>', 'text/html'), {
    kind: 'html', legacyCatalog: false, legacyDetail: false, legacySeason: false,
    options: { L: 0, E: 0, S: 0 }, lazyIframes: 0,
  });
  assert.deepEqual(inspectBody('not json', 'application/json'), { kind: 'json-invalid' });
  assert.deepEqual(inspectBody(JSON.stringify({ data: { posts: [
    { _id: 'example', title: 'Joker', type: 'movie' },
    { _id: 'example-2', title: 'Joker', type: 'tvshows' },
  ] } }), 'application/json'), {
    kind: 'json', posts: 2, types: ['movie', 'tvshows'], jokerMoviesWithId: 1,
  });
});

test('diagnóstico: un 403 de catálogo no se examina como HTML/medio ni sigue a un tercero', async () => {
  const previous = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url) => {
      calls.push(String(url));
      return new Response('<div id="OptL1"><iframe data-src="//host/player"></iframe></div>', {
        status: 403, headers: { 'Content-Type': 'text/html' },
      });
    };
    const blocked = await inspect('https://cuevana3.me/21711/joker');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body, null);
    assert.equal(blocked.host, 'cuevana3.me');

    global.fetch = async (url) => {
      calls.push(String(url));
      return new Response(null, { status: 302, headers: { Location: 'https://unrelated.example/player' } });
    };
    const redirected = await inspect('https://cuevana.gs/');
    assert.equal(redirected.stopped, 'outside-known-domains');
    assert.deepEqual(redirected.redirects, [{ status: 302, host: 'unrelated.example' }]);
    assert.equal(calls.length, 2, 'no debe seguir el redirect fuera de los dominios revisados');
  } finally { global.fetch = previous; }
});
