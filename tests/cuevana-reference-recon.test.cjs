'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectBody } = require('../scripts/cuevana-reference-recon.cjs');

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

test('diagnóstico: HTML 403 o protección web no se interpreta como medio fallido', () => {
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
