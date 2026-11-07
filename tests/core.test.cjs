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

test('resuelve rutas relativas desde el origen, la ficha y el query sin inventar otro host', () => {
  assert.equal(text.absoluteUrl('player/1', 'https://site.example'), 'https://site.example/player/1');
  assert.equal(text.absoluteUrl('?trembed=2', 'https://site.example/movies/demo/?old=1'), 'https://site.example/movies/demo/?trembed=2');
  assert.equal(text.absoluteUrl('../episode/3', 'https://site.example/series/demo/'), 'https://site.example/series/episode/3');
  assert.equal(text.absoluteUrl('./video.mp4?token=abc', 'https://site.example/series/demo/'), 'https://site.example/series/demo/video.mp4?token=abc');
  assert.equal(text.absoluteUrl('/player/1', 'https://site.example/series/demo/'), 'https://site.example/player/1');
  assert.equal(text.absoluteUrl('javascript:alert(1)', 'https://site.example'), '');
});

test('las tarjetas duplicadas prefieren el título real al enlace genérico', () => {
  const page = '<a href="/pelicula/contenido-demo/">Película <span>2024</span></a>'
    + '<a href="/pelicula/contenido-demo/" title="Contenido Demo">Contenido Demo</a>';
  const cards = html.cardsFromAnchors(page, 'https://site.example/', { mediaType: 'movie' });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Contenido Demo');
  assert.equal(cards[0].year, '2024');
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

test('no inventa MP4 ni HLS recortando el nombre de un hoster', () => {
  const page = '<a href="https://www.mp4upload.com/e/demo">MP4Upload</a>'
    + '<iframe src="https://a4.mp4upload.com/embed/demo"></iframe>'
    + '<iframe src="https://cdn.m3u8host.com/watch/demo"></iframe>'
    + '<script>player.setup({file:"https://a4.mp4upload.com/video/real.mp4?token=abc"})</script>';
  assert.deepEqual(extractors.directMediaInHtml(page, 'https://site.example/movie'), [
    'https://a4.mp4upload.com/video/real.mp4?token=abc',
  ]);
});

test('el scraper sigue el iframe de la obra y no publica MP4/HLS de preroll ni URLs sueltas del padre', async () => {
  const page = fixture('ad-player.html');
  const base = 'https://catalog.example/movie/demo';
  const embed = 'https://streamwish.example/e/movie123';
  const actual = 'https://cdn.example/movie/master.m3u8';
  assert.deepEqual(extractors.directMediaInHtml(page, base), []);
  assert.deepEqual(extractors.directMediaInHtml(`<script>const src="https://cdn.example/creative-xyz.mp4";</script><iframe src="${embed}"></iframe>`,
    base), [], 'un src genérico no se atribuye al reproductor frente a un iframe');
  assert.deepEqual(extractors.embedCandidatesFromHtml(page, base).map((item) => item.url), [embed]);
  assert.deepEqual(extractors.embedCandidatesFromHtml('<div class="publicidad" data-server-url="https://streamwish.example/e/ad123"></div>', base), []);
  const mock = mockFetch([
    [base, page],
    [embed, `<script>player.setup({sources:[{src:"${actual}"}]})</script>`],
  ]);
  try {
    const result = await extractors.resolveCandidates([{ url: base }], { provider: 'Prueba' });
    assert.deepEqual(result.map((item) => item.url), [actual]);
    assert.deepEqual(mock.calls.map((call) => call.url), [base, embed], 'no visitar el iframe publicitario');
  } finally { mock.restore(); }
});

test('fuente declarada por el reproductor gana a publicidad adyacente sin bloquear títulos normales', () => {
  const actual = 'https://cdn.example/movie/about-advertising.m3u8?token=abc';
  const page = `<script>player.setup({advertising:{schedule:[{file:"https://cdn.example/a1b2c3.mp4"}]},`
    + `sources:[{file:"${actual}"}],preview:"https://cdn.example/preview.mp4"})</script>`;
  assert.deepEqual(extractors.directMediaInHtml(page, 'https://player.example/e/demo'), [actual]);
  assert.deepEqual(extractors.directMediaInHtml('<script>const ads = [{file:"https://cdn.example/a1b2c3.mp4"}];</script>',
    'https://player.example/e/demo'), []);
  assert.deepEqual(extractors.directMediaInHtml('<video src="/movie/real.mp4"></video>',
    'https://player.example/e/demo'), ['https://player.example/movie/real.mp4']);
  assert.deepEqual(extractors.directMediaInHtml('<script>const file="https://cdn.example/movie/real.m3u8";</script>',
    'https://player.example/e/demo'), ['https://cdn.example/movie/real.m3u8'], 'sin iframe, mantener el player heredado');
  assert.deepEqual(extractors.directMediaInHtml('<video class="preroll"><source src="https://cdn.example/creative-xyz.mp4"></video>',
    'https://player.example/e/demo'), []);
  for (const ad of ['preroll-15s.mp4', 'vast-ad.m3u8', 'ad-video.mp4']) {
    assert.equal(streams.isPlayableUrl(`https://cdn.example/${ad}`), false);
  }
  assert.equal(streams.isPlayableUrl(actual), true);
  assert.equal(streams.isPlayableUrl('https://cdn.example/ads/movie/real.mp4'), true);
  assert.equal(streams.isPlayableUrl('https://cdn.example/movie.mp4?ref=/pre-roll.mp4'), true);
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

test('Voe F7 desplaza un MP4 publicitario válido y el fallback antiguo no lee HLS de páginas ajenas', async () => {
  const base = 'https://voe.example/e/cast';
  const decoy = 'https://cdn.example/campaign/creative-xyz.mp4';
  const actual = extractors.voeUrls(fixture('voe-embed.html'))[0];
  const mock = mockFetch([[base, fixture('voe-embed.html').replace(
    'https://test-videos.co.uk/vids/bigbuckbunny/mp4/av1/1080/Big_Buck_Bunny_1080_10s_5MB.mp4', decoy,
  )]]);
  try {
    const found = await extractors.resolveCandidates([{ url: base }]);
    assert.deepEqual(found.map((item) => item.url), [actual]);
  } finally { mock.restore(); }
  const otherPage = 'https://catalog.example/movie/demo';
  const iframe = 'https://streamwish.example/e/movie123';
  const other = mockFetch([
    [otherPage, `<script>const ads = { source:"https://cdn.example/campaign/creative-xyz.m3u8" };</script><iframe src="${iframe}"></iframe>`],
    [iframe, '<script>player.setup({file:"https://cdn.example/movie/real.m3u8"})</script>'],
  ]);
  try {
    const found = await extractors.resolveCandidates([{ url: otherPage }]);
    assert.deepEqual(found.map((item) => item.url), ['https://cdn.example/movie/real.m3u8']);
  } finally { other.restore(); }
});

test('resuelve dataLink y omite servidores de descarga', () => {
  const source = '<script>var dataLink = [{"video_language":"LAT","sortedEmbeds":[{"servername":"download","link":"https://download.example/file.mp4"},{"servername":"StreamWish","link":"eyJhbGciOiJub25lIn0.eyJsaW5rIjoiaHR0cHM6Ly9zdy5leGFtcGxlL2UvZGVtbyJ9.signature"}]}];</script>';
  const result = extractors.dataLinkCandidates(source, 'https://embed.example/f/demo');
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://sw.example/e/demo');
  assert.equal(result[0].language, 'LAT');
  const withAd = source.replace('"sortedEmbeds":[', '"sortedEmbeds":[{"servername":"PreRoll","link":"https://cdn.example/creative.mp4"},');
  assert.deepEqual(extractors.dataLinkCandidates(withAd, 'https://embed.example/f/demo').map((item) => item.url),
    ['https://sw.example/e/demo']);
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
    '<script>player.setup({file:"https://cdn.example/video/master.m3u8"})</script>',
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

test('Zilla: conserva las cabeceras HLS del origen sin rehacer una playlist ya directa', async () => {
  const embed = 'https://player.zilla-networks.com/watch/episode123';
  const result = await extractors.resolveCandidates([{ url: embed }], { provider: 'AnimeAV1' });
  assert.equal(result[0].url, 'https://player.zilla-networks.com/m3u8/episode123');
  assert.equal(result[0].type, 'hls');
  assert.equal(result[0].headers.Referer, embed);
  assert.equal(result[0].headers.Origin, 'https://player.zilla-networks.com');
  assert.match(result[0].headers['User-Agent'], /Firefox\/148/);
  const nested = await extractors.resolveCandidates([{ url: 'https://player.zilla-networks.com/player/embed/episode456?lang=es' }]);
  assert.equal(nested[0].url, 'https://player.zilla-networks.com/m3u8/episode456', 'usar el ID final, no /m3u8/player');
  const direct = 'https://player.zilla-networks.com/m3u8/episode123';
  const directResult = await extractors.resolveCandidates([{ url: direct }]);
  assert.equal(directResult[0].url, direct);
});

test('Maxstream: descubre enlaces del catálogo y fallback castv si el embed responde 404', async () => {
  const embed = 'https://maxstream.video/emilpy0n/abc123';
  const castv = 'https://maxstream.video/castv/abc123';
  const html = `<a href="${embed}">Ver</a><button data-src="https://minochinos.com/e/episode01">VidHide</button>`;
  assert.deepEqual(extractors.embedCandidatesFromHtml(html, 'https://catalog.example/movie').map((item) => item.url), [
    embed, 'https://minochinos.com/e/episode01',
  ]);
  assert.deepEqual(extractors.embedCandidatesFromHtml('<a href="https://minochinos.com.evil/e/1">Falso VidHide</a>', 'https://catalog.example/'), []);

  const mock = mockFetch([
    [embed, { __response: true, body: 'Not Found', status: 404 }],
    [castv, '<script type="application/vnd.apple.mpegurl" id="m3u8">\nhttps://cdn.example/video/alternate.m3u8?token=fixture&amp;v=1#ignored\n</script>'],
  ]);
  try {
    const result = await extractors.resolveCandidates([{ url: embed, server: 'Maxstream' }], { provider: 'Prueba' });
    assert.equal(result.length, 1);
    assert.equal(result[0].url, 'https://cdn.example/video/alternate.m3u8?token=fixture&v=1');
    assert.equal(result[0].type, 'hls');
    assert.equal(result[0].headers.Referer, castv);
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[1].init.headers.Referer, embed);
  } finally { mock.restore(); }
});

test('Maxstream: usa sources si existen, o castv si el embed 200 está vacío', async () => {
  const embed = 'https://maxstream.video/e/abc123';
  const castv = 'https://maxstream.video/castv/abc123';
  const mock = mockFetch([
    [embed, '<script>player.setup({sources:[{src:"https://cdn.example/video/primary.m3u8"}]})</script>'],
    [castv, '<script id="m3u8">https://cdn.example/video/alternate.m3u8</script>'],
  ]);
  try {
    const result = await extractors.resolveCandidates([{ url: embed }], { provider: 'Prueba' });
    assert.equal(result[0].url, 'https://cdn.example/video/primary.m3u8');
    assert.equal(mock.calls.length, 1, 'no pedir castv cuando ya se encontró medio');
  } finally { mock.restore(); }
  const missing = mockFetch([[embed, '<h1>Sin sources</h1>'], [castv, '<script id="m3u8">https://cdn.example/video/alternate.m3u8</script>']]);
  try {
    const result = await extractors.resolveCandidates([{ url: embed }], { provider: 'Prueba' });
    assert.equal(result[0].url, 'https://cdn.example/video/alternate.m3u8');
    assert.equal(missing.calls.length, 2);
  } finally { missing.restore(); }
});

test('Maxstream: no inventa medios ni consulta castv en hosts parecidos o IDs inválidos', async () => {
  const cases = [
    ['<script id="m3u8">https://cdn.example/video/false.mp4</script>', []],
    ['<script id="m3u8">http://cdn.example/video/false.m3u8</script>', []],
    ['<script id="m3u8">https://cdn.example/video/false.m3u8.html</script>', []],
    ['<html>200 pero sin vídeo</html>', []],
  ];
  for (const [body, expected] of cases) {
    const mock = mockFetch([
      ['https://maxstream.video/e/abc123', '<h1>Vacío</h1>'],
      ['https://maxstream.video/castv/abc123', body],
    ]);
    try {
      assert.deepEqual(await extractors.resolveCandidates([{ url: 'https://maxstream.video/e/abc123' }]), expected);
    } finally { mock.restore(); }
  }
  const mock = mockFetch([
    ['https://maxstream.video.evil/e/abc123', '<h1>Vacío</h1>'],
    ['https://maxstream.video/e/%2e%2e', '<h1>Vacío</h1>'],
  ]);
  try {
    assert.deepEqual(await extractors.resolveCandidates([{ url: 'https://maxstream.video.evil/e/abc123' }]), []);
    assert.deepEqual(await extractors.resolveCandidates([{ url: 'https://maxstream.video/e/%2e%2e' }]), []);
    assert.equal(mock.calls.length, 2);
  } finally { mock.restore(); }
});
