'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, loadSource, mockFetch } = require('./helpers.cjs');

const text = loadSource('src/core/text.js');
const html = loadSource('src/core/html.js');
const base64 = loadSource('src/core/base64.js');
const extractors = loadSource('src/core/extractors.js');
const streams = loadSource('src/core/streams.js');

test('normaliza títulos y penaliza un año/tipo incorrecto', () => {
  const metadata = { titles: ['Contenido Demo', 'Contenido Demo'], year: '2024' };
  assert.equal(text.normalizeTitle('Ver Contenido Demo (2024) Latino'), 'contenido demo');
  const valid = { title: 'Contenido Demo', year: '2024', type: 'tv' };
  const wrong = { title: 'Contenido Demo', year: '2020', type: 'movie' };
  assert.equal(text.bestTitleMatch([wrong, valid], metadata, 'tv'), valid);
  assert.equal(text.bestTitleMatch([wrong], metadata, 'tv'), null);
});

test('extrae exactamente temporada 2 episodio 3 y no otro par', () => {
  const source = '<a href="/episodio/demo-1x3">1x3</a><a href="/episodio/demo-2x3"><span>2-3</span></a><a href="/episodio/demo-2x4">2x4</a>';
  const found = html.episodeLinks(source, 'https://example.test/serie/demo', 2, 3);
  assert.equal(found.url, 'https://example.test/episodio/demo-2x3');
  assert.equal(html.episodeLinks(source, 'https://example.test/', 3, 3), null);
});

test('decodifica Base64URL y el payload de enlaces tipo JWT', () => {
  assert.equal(base64.decodeBase64Url('aHR0cHM6Ly9zdy5leGFtcGxlL2UvZGVtbw'), 'https://sw.example/e/demo');
  assert.equal(base64.decodeTokenLink('eyJhbGciOiJub25lIn0.eyJsaW5rIjoiaHR0cHM6Ly9zdy5leGFtcGxlL2UvZGVtbyJ9.signature'), 'https://sw.example/e/demo');
});

test('extrae HLS y descarta páginas embed, DASH, clip genérico y javascript:', () => {
  const found = extractors.directMediaInHtml(fixture('player-hls.html'), 'https://player.example/e/demo');
  assert.deepEqual(found, ['https://cdn.example/video/playlist.m3u8']);
  assert.equal(streams.isPlayableUrl('https://sw.example/e/demo'), false);
  assert.equal(streams.isPlayableUrl('https://cdn.zss90.pl/vod-video.mp4'), false);
  assert.equal(streams.isPlayableUrl('https://cdn.example/video/manifest.mpd'), false);
  assert.equal(streams.isPlayableUrl('javascript:alert(1)'), false);
  assert.equal(streams.mediaKind('https://cdn.example/video.m3u8'), 'hls');
});

test('Nupload: decodifica la expresión pública sin eval y solo sigue un Location de medio del mismo host', async () => {
  const nupload = loadSource('src/core/nupload.js');
  const base = 'https://sv4.ibra.lat/';
  const offset = 4828350;
  const values = [...base].map((char) => Buffer.from(String(offset + char.charCodeAt(0))).toString('base64'));
  const token = 'ejemplo_firmado_temporal_0123456789abcdefghijkl';
  const source = `<script>var valores=${JSON.stringify(values)}; var decoded=""; valores.forEach(function Oym(value) { decoded += String.fromCharCode(parseInt(atob(value).replace(/\\D/g,"")) - ${offset}); } ); var sesz="${token}"; player.setup({file:decoded+"?s="+sesz+""});</script>`;
  const endpoint = `${base}?s=${token}`;
  assert.equal(nupload.nuploadEndpointFromHtml(source), endpoint);
  assert.equal(streams.isPlayableUrl(endpoint), false, 'la puerta sin extensión no es un vídeo');
  const evilValues = [...'https://evil.example/'].map((char) => Buffer.from(String(offset + char.charCodeAt(0))).toString('base64'));
  assert.equal(nupload.nuploadEndpointFromHtml(source.replace(JSON.stringify(values), JSON.stringify(evilValues))), '', 'no aceptar otro origen');
  assert.equal(nupload.nuploadEndpointFromHtml(source.replace('file:decoded+', 'file:other+')), '');

  const mock = mockFetch([
    [endpoint, { __response: true, body: '', status: 301, headers: { Location: 'https://sv4.ibra.lat/79/9/playlist.m3u8' } }],
  ]);
  try {
    assert.equal(await nupload.nuploadMediaRedirect(endpoint, 'https://nupload.my/watch/abc'), 'https://sv4.ibra.lat/79/9/playlist.m3u8');
    assert.equal(mock.calls[0].init.redirect, 'manual');
    assert.equal(mock.calls[0].init.headers.Range, 'bytes=0-4095');
    assert.equal(mock.calls[0].init.headers.Referer, 'https://nupload.my/watch/abc');
  } finally { mock.restore(); }
  const malicious = mockFetch([[endpoint, { __response: true, body: '', status: 301, headers: { Location: 'https://another.example/stream.m3u8' } }]]);
  try { assert.equal(await nupload.nuploadMediaRedirect(endpoint, 'https://nupload.my/watch/abc'), ''); }
  finally { malicious.restore(); }
});

test('Voe F7 recupera el HLS del título y rechaza el MP4 Big Buck Bunny de muestra', () => {
  const source = fixture('voe-embed.html');
  const decoy = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/av1/1080/Big_Buck_Bunny_1080_10s_5MB.mp4';
  const found = extractors.voeUrls(source);
  assert.equal(found.length, 1);
  assert.match(found[0], /jfconahnwkyn_.*master\.m3u8\?/i);
  assert.ok(!found[0].includes('/download/'));
  assert.equal(streams.isPlayableUrl(decoy), false);
  assert.deepEqual(extractors.directMediaInHtml(source, 'https://voe.example/e/cast'), []);
});

test('resuelve dataLink y omite servidores de descarga', () => {
  const source = '<script>var dataLink = [{"video_language":"LAT","sortedEmbeds":[{"servername":"download","link":"https://download.example/file.mp4"},{"servername":"StreamWish","link":"eyJhbGciOiJub25lIn0.eyJsaW5rIjoiaHR0cHM6Ly9zdy5leGFtcGxlL2UvZGVtbyJ9.signature"}]}];</script>';
  const result = extractors.dataLinkCandidates(source, 'https://embed.example/f/demo');
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://sw.example/e/demo');
  assert.equal(result[0].language, 'LAT');
});

test('descifra AES-CBC después de resolver la prueba de trabajo', () => {
  const CryptoJS = require('crypto-js');
  const challenge = 'fixture';
  const difficulty = 1;
  const salt = 'salt';
  let nonce = 0;
  while (!CryptoJS.SHA256(challenge + nonce).toString().startsWith('0')) nonce += 1;
  const key = CryptoJS.SHA256(challenge + nonce + salt);
  const iv = CryptoJS.enc.Hex.parse('00112233445566778899aabbccddeeff');
  const encrypted = CryptoJS.AES.encrypt('https://sw.example/e/demo', key, { iv });
  const bytes = CryptoJS.lib.WordArray.create(iv.words.slice(), 16).concat(encrypted.ciphertext);
  const link = CryptoJS.enc.Base64.stringify(bytes);
  const source = `<script>const POW_CHALLENGE='${challenge}'; const POW_DIFFICULTY=${difficulty}; const POW_SALT='${salt}'; var dataLink = [{"video_language":"LAT","sortedEmbeds":[{"servername":"StreamWish","link":"${link}"}]}];</script>`;
  const result = extractors.protectedDataLinkCandidates(source, 'https://embed.example/f/demo');
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://sw.example/e/demo');
});

test('desempaqueta Dean Edwards sin ejecutar JavaScript', () => {
  const packed = `<script>eval(function(p,a,c,k,e,d){return p}('0("1://2.3/4.5");',6,6,'sources|https|cdn|example|playlist|m3u8'.split('|')))</script>`;
  const unpacked = extractors.unpackAll(packed);
  assert.match(unpacked, /https:\/\/cdn\.example\/playlist\.m3u8/);
});

test('nextData y playerOptions conservan metadatos del reproductor', () => {
  const next = html.nextData(fixture('poseidon-show.html'));
  assert.equal(next.props.pageProps.thisSerie.seasons[1].episodes[0].number, 3);
  const options = html.playerOptions(fixture('base64-player.html'), 'https://site.example/movie');
  assert.equal(options[0].server, 'aHR0cHM6Ly9zdy5leGFtcGxlL2UvZGVtbw==');
});

test('la cookie de sesión se limita al dominio y se reenvía', async () => {
  const http = loadSource('src/core/http.js');
  const mock = mockFetch([
    ['https://session.example/login', { __response: true, body: 'ok', headers: { 'Set-Cookie': 'session=abc; Path=/; HttpOnly' } }],
    [(url) => url === 'https://session.example/private', (url, init) => {
      assert.match(init.headers.Cookie, /session=abc/);
      return 'private';
    }],
    [(url) => url === 'https://other.example/private', (url, init) => {
      assert.equal(init.headers.Cookie, undefined);
      return 'other';
    }],
  ]);
  try {
    await http.fetchText('https://session.example/login');
    await http.fetchText('https://session.example/private');
    await http.fetchText('https://other.example/private');
  } finally { mock.restore(); }
});

test('candidates embed: descubre iframes lazy y hosts anunciados por los cinco proveedores', () => {
  const html = [
    '<iframe data-src="https://vid.example/e/demo"></iframe>',
    '<button data-server-url="https://streamhg.example/embed/abc">StreamHG</button>',
    '<a href="https://dropload.example/e/lat">Dropload</a>',
    '<a href="https://unlimplay.example/e/sub">UnlimPlay</a>',
    '<script>const file="https://cdn.example/video/master.m3u8";</script>',
  ].join('');
  const found = extractors.embedCandidatesFromHtml(html, 'https://catalog.example/movie/1');
  assert.deepEqual(found.map((item) => item.url).sort(), [
    'https://vid.example/e/demo',
    'https://streamhg.example/embed/abc',
    'https://dropload.example/e/lat',
    'https://unlimplay.example/e/sub',
  ].sort());
  assert.deepEqual(extractors.directMediaInHtml(html, 'https://catalog.example/movie/1'), [
    'https://cdn.example/video/master.m3u8',
  ]);
});
