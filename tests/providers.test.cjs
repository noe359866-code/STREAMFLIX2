'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, provider, mockFetch, card, HLS, commonPlayerRoutes } = require('./helpers.cjs');

async function run(id, options = {}) {
  const mock = mockFetch([...(options.routes || []), ...commonPlayerRoutes(), ['https://streamwish.example/e/demo', fixture('player-hls.html')]], options.metadata);
  try {
    const streams = await provider(id).getStreams(options.contentId || 'tmdb:123', options.mediaType || 'tv', options.season ?? 2, options.episode ?? 3);
    return { streams, calls: mock.calls };
  } finally { mock.restore(); }
}
function assertStream(result, count = 1) {
  assert.equal(result.streams.length, count);
  for (const stream of result.streams) {
    assert.match(stream.url, /\.(?:m3u8|mp4)(?:$|\?)/);
    assert.ok(stream.title && stream.name && stream.language);
    assert.ok(stream.headers['User-Agent']);
  }
}

test('CineHax: PM_UI, servidores y vídeo MovieMaster', async () => {
  const result = await run('cinehax', {
    contentId: '550', mediaType: 'movie',
    routes: [
      ['api.moviemaster.lat/e/movie/550', '<script>window.PM_UI = "ui-demo";</script>'],
      ['api.moviemaster.lat/servers?', { servers: [{ id: 'lat-1', lang: 'LAT' }] }],
      ['api.moviemaster.lat/video?', { url: HLS }],
    ],
  });
  assertStream(result);
  assert.equal(result.streams[0].language, 'es-LAT');
});

test('AnimeAV1: índices Svelte SUB/DUB y episodio solicitado', async () => {
  const result = await run('animeav1', {
    season: 1,
    routes: [
      ['animeav1.com/catalogo?', fixture('search-card.html')],
      ['animeav1.com/media/contenido-demo/3/__data.json', fixture('animeav1-data.json')],
    ],
  });
  assertStream(result);
  assert.equal(result.streams[0].language, 'es-SUB');
  assert.ok(result.calls.some((call) => call.url.includes('/media/contenido-demo/3/__data.json')));
});

test('TioAnime: var episodes/var videos y solo Voe/YourUpload', async () => {
  const routes = [
    ['tioanime.com/directorio?', card('/anime/contenido-demo')],
    ['tioanime.com/anime/contenido-demo', fixture('tioanime-detail.html')],
    ['tioanime.com/ver/contenido-demo-3', fixture('tioanime-episode.html')],
  ];
  const result = await run('tioanime', { season: 1, routes });
  assertStream(result);
  const missing = await run('tioanime', { season: 1, episode: 4, routes });
  assert.deepEqual(missing.streams, []);
  assert.ok(!missing.calls.some((call) => call.url.includes('/ver/contenido-demo-4')));
});

test('PoseidonHD2: selecciona S02E03 en __NEXT_DATA__', async () => {
  const result = await run('poseidonhd2', {
    routes: [
      ['poseidonhd2.co/search?', card('/serie/contenido-demo')],
      ['poseidonhd2.co/serie/contenido-demo/seasons', fixture('poseidon-episode.html')],
      ['poseidonhd2.co/serie/contenido-demo/temporada/2/episodio/3', fixture('poseidon-episode.html')],
      ['poseidonhd2.co/serie/contenido-demo', fixture('poseidon-show.html')],
      ['player.poseidonhd2.co/e/demo', fixture('player-bridge.html')],
    ],
  });
  assertStream(result);
  assert.equal(result.streams[0].language, 'es-LAT');
});

test('TioPlus: servidor Base64 y película', async () => {
  const result = await run('tioplus', {
    mediaType: 'movie',
    routes: [
      ['tioplus.app/search/', card('/pelicula/contenido-demo')],
      ['tioplus.app/pelicula/contenido-demo', fixture('base64-player.html')],
    ],
  });
  assertStream(result);
});

test('TioPlus: valida seasonsJson antes de solicitar S02E03', async () => {
  const episodeUrl = 'https://tioplus.app/serie/contenido-demo/season/2/episode/3';
  const routes = [
    ['tioplus.app/search/', card('/serie/contenido-demo')],
    [episodeUrl, fixture('base64-player.html')],
    ['tioplus.app/serie/contenido-demo', fixture('tioplus-seasons.html')],
  ];
  const result = await run('tioplus', { routes });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === episodeUrl));

  const missingUrl = 'https://tioplus.app/serie/contenido-demo/season/2/episode/4';
  const missing = await run('tioplus', { routes, episode: 4 });
  assert.deepEqual(missing.streams, []);
  assert.ok(!missing.calls.some((call) => call.url === missingUrl));
});

test('SoloLatino: dataLink con enlace tipo JWT', async () => {
  const result = await run('sololatino', {
    mediaType: 'movie',
    routes: [
      ['sololatino.net/buscar?', card('/pelicula/contenido-demo')],
      ['sololatino.net/pelicula/contenido-demo', '<button class="server-btn" data-server-url="https://embed69.org/f/tt1234567">Latino</button>'],
      ['embed69.org/f/tt1234567', fixture('datalink-player.html')],
    ],
  });
  assertStream(result);
  assert.equal(result.streams[0].language, 'es-LAT');
});

test('LaCartoons: selecciona el capítulo dentro del panel de temporada', async () => {
  const result = await run('lacartoons', {
    season: 2, episode: 2,
    routes: [
      ['lacartoons.com/?Titulo=', card('/serie/contenido-demo')],
      ['lacartoons.com/serie/contenido-demo', fixture('lacartoons-show.html')],
      ['lacartoons.com/capitulo/demo-2-2', '<iframe src="https://player.example/e/demo"></iframe>'],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url.includes('/capitulo/demo-2-2')));
});

test('JKAnime: CSRF/cookies, AJAX de episodios y dos reproductores', async () => {
  const result = await run('jkanime', {
    season: 1,
    routes: [
      ['jkanime.net/ajax_search', (url, init) => {
        assert.match(init.body, /query=Contenido/);
        return [{ slug: 'contenido-demo', title: 'Contenido Demo', type: 'Serie' }];
      }],
      ['jkanime.net/ajax/episodes/42/1', (url, init) => {
        assert.match(init.headers.Cookie, /session=abc/);
        return { data: [{ number: 3, title: 'Episodio 3' }] };
      }],
      ['jkanime.net/contenido-demo/3/', fixture('jkanime-episode.html')],
      ['jkanime.net/contenido-demo/', '<meta name="csrf-token" content="token-demo"><div class="guardar_anime" data-anime="42"></div>'],
      ['jkanime.net/', { __response: true, body: '<meta name="csrf-token" content="token-demo">', headers: { 'Set-Cookie': 'session=abc; Path=/' } }],
      ['jkplayer.example/e/demo', '<script>file:"https://cdn.example/video/jk.mp4"</script>'],
    ],
  });
  assertStream(result, 2);
});

test('Anime Online Ninja: DooPlayer y S02E03', async () => {
  const result = await run('animeonlineninja', {
    routes: [
      ['animeonline.ninja/?s=', card('/online/contenido-demo')],
      ['animeonline.ninja/online/contenido-demo', '<a href="/episodio/contenido-demo-2x3"><span class="numerando">2-3</span></a>'],
      ['animeonline.ninja/episodio/contenido-demo-2x3', '<ul><li data-post="77" data-type="tv" data-nume="1"></li></ul>'],
      ['animeonline.ninja/wp-json/dooplayer/v1/post/77?type=tv&source=1', { embed_url: 'https://sw.example/e/demo' }],
    ],
  });
  assertStream(result);
});

test('Latanime: enlace data-player Base64', async () => {
  const result = await run('latanime', {
    season: 1,
    routes: [
      ['latanime.org/buscar?', card('/anime/contenido-demo')],
      ['latanime.org/anime/contenido-demo', '<a href="/ver/contenido-demo-episodio-3">Episodio 3</a>'],
      ['latanime.org/ver/contenido-demo-episodio-3', '<a data-player="aHR0cHM6Ly9zdy5leGFtcGxlL2UvZGVtbw==" title="StreamWish">Ver</a>'],
    ],
  });
  assertStream(result);
});

test('AnimeBum: porte inactivo mantiene parseo de video[]', async () => {
  const result = await run('animebum', {
    season: 1,
    routes: [
      ['animebum.net/search?', card('/series/contenido-demo')],
      ['animebum.net/series/contenido-demo', '<a href="/ver/contenido-demo-3">Episodio 3</a>'],
      ['animebum.net/ver/contenido-demo-3', `<script>video[1] = '<iframe src="https://sw.example/e/demo"></iframe>';</script>`],
    ],
  });
  assertStream(result);
});

test('Fanpelis: search, episodes y player REST', async () => {
  const result = await run('fanpelis', {
    routes: [
      ['fanpelis.to/api/rest/search?', { data: { posts: [{ _id: 'show-1', slug: 'contenido-demo', title: 'Contenido Demo', type: 'tvshows', release_date: '2024-01-01' }] } }],
      ['fanpelis.to/api/rest/episodes?', { data: [{ _id: 'episode-3', season_number: 2, episode_number: 3 }] }],
      ['fanpelis.to/api/rest/player?', { data: { embeds: [{ url: 'https://sw.example/e/demo', lang: 'LAT' }] } }],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url.includes('post_id=episode-3')));
});

test('Cuevana: wp-api search, lista de episodios y player', async () => {
  const result = await run('cuevana', {
    routes: [
      ['cuevana.gs/wp-api/v1/search?', { data: { posts: [{ _id: 'show-1', slug: 'contenido-demo', title: 'Contenido Demo', type: 'tvshows', release_date: '2024-01-01' }] } }],
      ['cuevana.gs/wp-api/v1/single/episodes/list?', { data: { posts: [{ _id: 'episode-3', season_number: 2, episode_number: 3 }] } }],
      ['cuevana.gs/wp-api/v1/player?', { data: { embeds: [{ url: 'https://sw.example/e/demo', lang: 'LAT' }] } }],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url.includes('postId=episode-3')));
});

test('Doramasflix: GraphQL detail/listEpisodes/links_online', async () => {
  function gql(data) {
    return (url, init) => ({ data });
  }
  const result = await run('doramasflix', {
    routes: [
      [(url, init) => url.includes('sv1.fluxcedene.net/api/gql') && init.body.includes('searchAll'), gql({ searchDorama: [{ _id: 'd1', slug: 'contenido-demo', name: 'Contenido Demo', name_es: 'Contenido Demo' }] })],
      [(url, init) => url.includes('sv1.fluxcedene.net/api/gql') && init.body.includes('detailDorama'), gql({ detailDorama: { _id: 'd1' } })],
      [(url, init) => url.includes('sv1.fluxcedene.net/api/gql') && init.body.includes('listEpisodes'), gql({ listEpisodes: [{ _id: 'e3', slug: 'contenido-demo-2x3', season_number: 2, episode_number: 3 }] })],
      [(url, init) => url.includes('sv1.fluxcedene.net/api/gql') && init.body.includes('detailEpisode'), gql({ detailEpisode: { _id: 'e3', links_online: [{ lang: '38', server: 'StreamWish', embed: 'https://sw.example/e/demo' }] } })],
    ],
  });
  assertStream(result);
});

test('SeriesFlix: carga temporada 2, desenvuelve data-url y conserva LAT', async () => {
  const seasonUrl = 'https://seriesflixhd.lol/serie/contenido-demo/temporada-2/';
  const result = await run('seriesflix', {
    routes: [
      ['seriesflixhd.lol/?s=', card('/serie/contenido-demo')],
      ['seriesflixhd.lol/episodio/contenido-demo-2x3', fixture('seriesflix-episode.html')],
      [seasonUrl, fixture('seriesflix-season.html')],
      ['seriesflixhd.lol/serie/contenido-demo', fixture('seriesflix-show.html')],
    ],
  });
  assertStream(result);
  assert.equal(result.streams[0].language, 'es-LAT');
  assert.ok(result.calls.some((call) => call.url === seasonUrl));
});

test('VerPeliculasOnline: DooPlayer AJAX conserva ESP/LAT/SUB y omite el tráiler', async () => {
  const ids = { 1: 'cast', 2: 'lat', 3: 'sub' };
  const result = await run('verpeliculasonline', {
    mediaType: 'movie',
    routes: [
      ['verpeliculasonline.net/?s=', fixture('verpeliculasonline-search.html')],
      ['verpeliculasonline.net/pelicula/contenido-demo/', fixture('verpeliculasonline-movie.html')],
      ['verpeliculasonline.net/wp-admin/admin-ajax.php', (url, init) => {
        assert.equal(init.method, 'POST');
        const number = init.body.match(/(?:^|&)nume=(\d+)/)?.[1];
        assert.match(init.body, /action=doo_player_ajax/);
        assert.match(init.body, /post=56924/);
        return { embed_url: `https://voe.example/e/${ids[number]}` };
      }],
      ['https://voe.example/e/cast', fixture('voe-embed.html')],
      ['https://voe.example/e/lat', fixture('player-hls.html')],
      ['https://voe.example/e/sub', fixture('player-hls.html')],
    ],
  });
  assertStream(result, 3);
  assert.deepEqual(result.streams.map((stream) => stream.language), ['es-ES', 'es-LAT', 'es-SUB']);
  assert.match(result.streams[0].url, /jfconahnwkyn_.*master\.m3u8\?/i);
  assert.ok(result.streams.every((stream) => !/test-videos\.co\.uk|Big_Buck_Bunny/i.test(stream.url)));
  assert.equal(result.calls.filter((call) => call.url.includes('/wp-admin/admin-ajax.php')).length, 3);
  assert.ok(!result.calls.some((call) => call.init.body?.includes('nume=trailer')));
});

test('PelisForte: fixture sintético ToroFilm/r.php conserva idiomas y no devuelve embeds', async () => {
  const byse = 'https://byseraguci.example/e/0albi51inneu/movie.mp4';
  const nested = 'https://n1mwq.example/6vd4p/0albi51inneu';
  const result = await run('pelisforte', {
    mediaType: 'movie',
    routes: [
      ['www2.pelisforte.se/?s=', fixture('pelisforte-search.html')],
      ['www2.pelisforte.se/pelicula/contenido-demo-2024-1711083273', fixture('pelisforte-movie.html')],
      ['mp4.nu/r.php?h=TOKEN-LATINO', (url, init) => {
        assert.match(init.headers.Referer, /mp4\.nu\/\?h=TOKEN-LATINO/);
        return { __response: true, url: byse, body: '<!doctype html><title>Byse</title>' };
      }],
      [byse, `<!doctype html><iframe src="${nested}"></iframe>`],
      [nested, fixture('player-hls.html')],
    ],
  });
  assertStream(result, 2);
  assert.deepEqual(result.streams.map((stream) => stream.language), ['es-LAT', 'es-SUB']);
  assert.ok(result.calls.some((call) => call.url.includes('mp4.nu/r.php?h=TOKEN-LATINO')));
  assert.ok(result.calls.some((call) => call.url === nested));
  assert.ok(!result.streams.some((stream) => stream.url.includes('byseraguci')));
  assert.ok(!result.calls.some((call) => call.url.includes('download.php')));
});

test('PelisForte: carga la temporada AJAX y nunca inventa un episodio ausente', async () => {
  const routes = [
    ['www2.pelisforte.se/?s=', fixture('pelisforte-search.html')],
    ['www2.pelisforte.se/serie/contenido-demo-2024-1746483016', fixture('pelisforte-series.html')],
    ['www2.pelisforte.se/wp-admin/admin-ajax.php', (url, init) => {
      assert.equal(init.method, 'POST');
      assert.match(init.body, /action=action_select_season/);
      assert.match(init.body, /nonce=nonce-demo/);
      assert.match(init.body, /season=1/);
      assert.match(init.body, /post=28341/);
      return fixture('pelisforte-season1.html');
    }],
    ['www2.pelisforte.se/episodio/contenido-demo-1x2', fixture('pelisforte-episode.html')],
  ];
  const result = await run('pelisforte', { season: 1, episode: 2, routes });
  assertStream(result);
  assert.equal(result.streams[0].language, 'es-ES');
  assert.ok(result.calls.some((call) => call.url.endsWith('/episodio/contenido-demo-1x2')));

  const missing = await run('pelisforte', { season: 1, episode: 3, routes });
  assert.deepEqual(missing.streams, []);
  assert.ok(!missing.calls.some((call) => call.url.includes('/episodio/contenido-demo-1x3')));
});

test('HDFull: search-route y contentUrl de la ficha, nunca el clip genérico del player', async () => {
  const routes = [
    ['hdfull.company/search-route', (url, init) => {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { host: 'hdfull.company', locale: 'es', searchTerm: 'Weapons' });
      return { data: [{ type: 'movie', slug: 'weapons', title: 'Weapons', title_with_prefix: 'Weapons Película Completa', release_date: '2025-08-04' }] };
    }],
    ['hdfull.company/peliculas/weapons', fixture('hdfull-movie.html')],
  ];
  const metadata = { title: 'Weapons', original_title: 'Weapons', release_date: '2025-08-04' };
  const result = await run('hdfull', { mediaType: 'movie', metadata, routes });
  assertStream(result);
  assert.equal(result.streams[0].url, 'https://hdfull.company/vod-movie/v1/weapons.mp4?d=7722&q=1080&title=Weapons');
  assert.equal(result.streams[0].quality, '1080p');
  assert.ok(!result.streams.some((stream) => /zss90\.pl|vod-video\.mp4/i.test(stream.url)));

  const mismatched = await run('hdfull', {
    mediaType: 'movie', metadata,
    routes: [routes[0], ['hdfull.company/peliculas/weapons', fixture('hdfull-movie.html').replaceAll('/weapons.mp4?', '/otro-titulo.mp4?')]],
  });
  assert.deepEqual(mismatched.streams, []);
});

test('HDFull TV: no inventa una fuente de episodio ni devuelve el player publicitario', async () => {
  const result = await run('hdfull', {
    mediaType: 'tv', season: 2, episode: 3,
    metadata: { name: 'Slow Horses', original_name: 'Slow Horses', first_air_date: '2022-04-01' },
    routes: [['hdfull.company/search-route', { data: [{ type: 'serie', slug: 'slow-horses', title: 'Slow Horses', release_date: '2022-04-01' }] }]],
  });
  assert.deepEqual(result.streams, []);
  assert.ok(!result.calls.some((call) => /temporada\/2\/episodio\/3|zss90\.pl|vod-video\.mp4/i.test(call.url)));
});

test('Danimados: S02E03 exacto, cuatro opciones AJAX y banderas latino', async () => {
  const embeds = {
    1: 'https://minochinos.com/embed/crvaxdrygaex',
    2: 'https://bysedikamoum.com/e/54huk1933cpp',
    3: 'https://voe.sx/e/wy5cn8e52mmd',
    4: 'https://hglink.to/e/5p1x7p87m3j1',
  };
  const routes = [
    ['danimados.cc/?s=', fixture('danimados-search.html')],
    ['danimados.cc/series/contenido-demo/', fixture('danimados-show.html')],
    ['danimados.cc/episodios/contenido-demo-2x3/', fixture('danimados-episode.html')],
    ['danimados.cc/wp-admin/admin-ajax.php', (url, init) => {
      assert.equal(init.method, 'POST');
      assert.match(init.body, /action=doo_player_ajax/);
      assert.match(init.body, /post=8165/);
      assert.match(init.body, /type=tv/);
      assert.match(init.headers.Referer, /contenido-demo-2x3/);
      assert.equal(init.headers['X-Requested-With'], 'XMLHttpRequest');
      return { embed_url: embeds[init.body.match(/(?:^|&)nume=(\d+)/)?.[1]] };
    }],
    ...Object.entries(embeds).filter(([number]) => number !== '3').map(([number, url]) => [url,
      `<script>file:"https://cdn.example/video/danimados-${number}.m3u8"</script>`]),
    [embeds[3], fixture('voe-embed.html')],
  ];
  const result = await run('danimados', { routes });
  assertStream(result, 4);
  assert.deepEqual(result.streams.map((stream) => stream.language), ['es-LAT', 'es-LAT', 'es-LAT', 'es-LAT']);
  assert.equal(result.calls.filter((call) => call.url.includes('/wp-admin/admin-ajax.php')).length, 4);
  assert.ok(result.streams.every((stream) => !Object.values(embeds).includes(stream.url)));
  assert.ok(result.streams.every((stream) => !/test-videos\.co\.uk|Big_Buck_Bunny|\/descargar\//i.test(stream.url)));

  const missing = await run('danimados', { routes, episode: 9 });
  assert.deepEqual(missing.streams, []);
  assert.ok(!missing.calls.some((call) => call.url.includes('/contenido-demo-2x9')));
  assert.ok(!missing.calls.some((call) => call.url.includes('/wp-admin/admin-ajax.php')));
});

function pelisgoPlayerRoutes() {
  return [
    ['https://magi.example/e/lat', '<script>file:"https://cdn.example/video/pelisgo-lat.m3u8"</script>'],
    ['https://filemoon.example/e/cast', '<script>file:"https://cdn.example/video/pelisgo-cast.m3u8"</script>'],
    ['https://voe.example/e/sub', '<script>file:"https://cdn.example/video/pelisgo-sub.m3u8"</script>'],
  ];
}

test('PelisGo: objetos normales/RSC conservan LAT/ESP/SUB y excluyen descargas', async () => {
  const result = await run('pelisgo', {
    mediaType: 'movie',
    routes: [
      ['pelisgo.online/search?q=', card('/movies/contenido-demo')],
      ['pelisgo.online/movies/contenido-demo', fixture('pelisgo-player.html')],
      ...pelisgoPlayerRoutes(),
    ],
  });
  assertStream(result, 3);
  assert.deepEqual(result.streams.map((stream) => stream.language), ['es-LAT', 'es-ES', 'es-SUB']);
  assert.deepEqual(result.streams.map((stream) => stream.quality), ['1080p', '720p', '720p']);
  assert.ok(result.streams.every((stream) => !/magi\.example|filemoon\.example|voe\.example\/e\//i.test(stream.url)));
  assert.ok(!result.calls.some((call) => /\/api\/download\/|pixeldrain/i.test(call.url)));
});

test('PelisGo TV: usa el slug encontrado y valida el episodio sin cambiar de temporada', async () => {
  const episodeUrl = 'https://pelisgo.online/series/contenido-demo/temporada/2/episodio/3';
  const routes = [
    ['pelisgo.online/search?q=', card('/series/contenido-demo')],
    [episodeUrl, fixture('pelisgo-player.html')],
    ...pelisgoPlayerRoutes(),
  ];
  const result = await run('pelisgo', { routes });
  assertStream(result, 3);
  assert.ok(result.calls.some((call) => call.url === episodeUrl));
  assert.ok(!result.calls.some((call) => call.url.includes('/api/source/')));

  const missingUrl = 'https://pelisgo.online/series/contenido-demo/temporada/2/episodio/9';
  const missing = await run('pelisgo', {
    episode: 9,
    routes: [
      ['pelisgo.online/search?q=', card('/series/contenido-demo')],
      [missingUrl, { __response: true, status: 404, body: '<title>404</title><h1>Escena no encontrada</h1>' }],
    ],
  });
  assert.deepEqual(missing.streams, []);
  assert.ok(missing.calls.some((call) => call.url === missingUrl));
  assert.ok(!missing.calls.some((call) => /temporada\/3\/episodio\/3|magi\.example|filemoon\.example/.test(call.url)));
});

const wordpressCases = [
  { id: 'cinecalidad', base: 'https://www.cinecalidad.am', search: '/?s=', show: '/ver-serie/contenido-demo', player: '<li data-option="https://sw.example/e/demo" data-nume="1"></li>' },
  { id: 'cine24h', base: 'https://cine24h.online', search: '/?s=', show: '/series/contenido-demo', player: '<li data-src="aHR0cHM6Ly9zdy5leGFtcGxlL2UvZGVtbw==" data-nume="1"></li>' },
  { id: 'pelisflixhd', base: 'https://pelisflixhd.win', search: '/busqueda/', show: '/serie/contenido-demo', player: fixture('base64-player.html') },
  { id: 'seriesturcas', base: 'https://tbg.seriesturcastv.to', search: '/?s=', show: '/series/contenido-demo', player: '<div class="dl-contenti"><a href="https://streamwish.example/e/demo">StreamWish</a></div>' },
  { id: 'flixlatam', base: 'https://flixlatam.com', search: '/search?s=', show: '/serie/contenido-demo', player: fixture('datalink-player.html') },
];
for (const item of wordpressCases) {
  test(`${item.id}: búsqueda, S02E03 y reproductor`, async () => {
    const episode = `${item.base}/episodio/contenido-demo-2x3`;
    const result = await run(item.id, {
      routes: [
        [item.base + item.search, card(item.show)],
        [item.base + item.show, `<a href="${episode}"><span>2-3</span> Episodio 3</a>`],
        [episode, item.player],
      ],
    });
    assertStream(result);
  });
}

test('Embed69: IMDb de TMDB, dataLink y resolución a un medio directo', async () => {
  const result = await run('embed69', {
    mediaType: 'movie',
    routes: [
      ['embed69.org/f/tt1234567', fixture('datalink-player.html')],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === 'https://embed69.org/f/tt1234567'));
  assert.equal(result.streams[0].language, 'es-LAT');
});

test('TukiPlay: usa el endpoint público de embed y solo entrega el hoster resuelto', async () => {
  const result = await run('tukiplay', {
    mediaType: 'movie',
    routes: [
      ['tukiplay.com/embed/movie/123', '<iframe data-src="https://sw.example/e/demo"></iframe>'],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === 'https://tukiplay.com/embed/movie/123'));
  assert.ok(!result.streams.some((stream) => /tukiplay\.com\/embed/.test(stream.url)));
});

test('VideoAPI: consulta exists, valida la ruta interna y extrae solo el stream', async () => {
  const result = await run('videoapi', {
    mediaType: 'movie',
    routes: [
      ['videoapi.la/api/v1/public/exists/movie/123', { exists: true, path: '/e/movie/123' }],
      ['videoapi.la/e/movie/123', '<script>const source = { file: "https://cdn.example/video/playlist.m3u8", type: "application/x-mpegURL" };</script>'],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url.endsWith('/api/v1/public/exists/movie/123')));
  assert.ok(!result.streams.some((stream) => /videoapi\.la\/e\//.test(stream.url)));

  const rejected = await run('videoapi', {
    mediaType: 'movie',
    routes: [['videoapi.la/api/v1/public/exists/movie/123', { exists: true, path: 'https://evil.example/e/movie/123' }]],
  });
  assert.deepEqual(rejected.streams, []);
  assert.equal(rejected.calls.length, 1);
});

test('PlayLatinSRC: usa IMDb y la ruta de reproductor personalizado sin devolver el iframe', async () => {
  const result = await run('playlatinsrc', {
    mediaType: 'movie',
    routes: [
      ['playlatinsrc.co/custom/movie/tt1234567', '<a href="https://dropload.example/e/demo">Servidor Dropload</a>'],
      ['dropload.example/e/demo', fixture('player-hls.html')],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === 'https://playlatinsrc.co/custom/movie/tt1234567'));
  assert.ok(!result.streams.some((stream) => /playlatinsrc\.co\/custom/.test(stream.url)));
});

test('Repelis24: busca la película real, usa wp_json y desenvuelve el Waaw explícito', async () => {
  const detail = '<script>var dtAjax = {"play_method":"wp_json"};</script>'
    + '<li class="dooplay_player_option" data-type="movie" data-post="186263" data-nume="1"><span class="title">Nupload</span></li>'
    + '<li class="dooplay_player_option" data-type="movie" data-post="186263" data-nume="2"><span class="title">Waaw</span></li>';
  const result = await run('repelis24', {
    mediaType: 'movie', routes: [
      ['repelis24.de/?s=Contenido%20Demo', '<a href="/pelicula/%3Cid%3E/">Contenido Demo</a><a href="/pelicula/contenido-demo/">Película</a><a href="/pelicula/contenido-demo/" title="Contenido Demo">Contenido Demo</a>'],
      ['repelis24.de/pelicula/contenido-demo/', detail],
      ['repelis24.de/wp-json/dooplayer/v2/186263/movie/1', { embed_url: '<iframe src="https://nupload.me/watch/abc"></iframe>' }],
      ['repelis24.de/wp-json/dooplayer/v2/186263/movie/2', { embed_url: '<iframe src="https://nupload.me/iframe/?url=https%3A%2F%2Fwaaw.tv%2Fwatch_video.php%3Fv%3Dabc"></iframe>' }],
      ['https://nupload.me/watch/abc', '<script>file:"https://cdn.example/video/nupload.mp4"</script>'],
      ['https://waaw.tv/watch_video.php?v=abc', '<iframe src="https://sw.example/e/demo"></iframe>'],
    ],
  });
  assertStream(result, 2);
  assert.ok(result.calls.some((call) => call.url.endsWith('/wp-json/dooplayer/v2/186263/movie/2')));
  assert.ok(!result.calls.some((call) => call.url.includes('/pelicula/%3Cid%3E/') || call.url.includes('/iframe/?url=')));
  assert.ok(result.streams.every((stream) => stream.provider === 'repelis24'));
  assert.ok(result.streams.every((stream) => !/nupload\.me|waaw\.tv/.test(stream.url)));
});

test('Repelis24: Nupload solo entrega HLS tras descifrar la puerta y observar su redirección', async () => {
  const base = 'https://sv4.ibra.lat/';
  const offset = 4828350;
  const values = [...base].map((char) => Buffer.from(String(offset + char.charCodeAt(0))).toString('base64'));
  const token = 'ejemplo_firmado_temporal_0123456789abcdefghijkl';
  const html = `<script>var datos=${JSON.stringify(values)}; var decoded=""; datos.forEach(function Oym(value) { decoded += String.fromCharCode(parseInt(atob(value).replace(/\\D/g,"")) - ${offset}); } ); var sesz="${token}"; player.setup({file:decoded+"?s="+sesz+""});</script>`;
  const result = await run('repelis24', {
    mediaType: 'movie', routes: [
      ['repelis24.de/?s=Contenido%20Demo', card('/pelicula/contenido-demo/')],
      ['repelis24.de/pelicula/contenido-demo/', '<script>var dtAjax={"play_method":"wp_json"}</script><li class="dooplay_player_option" data-type="movie" data-post="186263" data-nume="1"><span class="title">Nupload</span></li>'],
      ['repelis24.de/wp-json/dooplayer/v2/186263/movie/1', { embed_url: 'https://nupload.me/watch/test' }],
      ['nupload.me/watch/test', { __response: true, body: html, url: 'https://nupload.my/watch/test' }],
      [`${base}?s=${token}`, { __response: true, body: '', status: 301, headers: { Location: `${base}79/9/demo.m3u8` } }],
    ],
  });
  assertStream(result);
  assert.equal(result.streams[0].url, `${base}79/9/demo.m3u8`);
  assert.equal(result.streams[0].headers.Referer, 'https://nupload.my/watch/test');
  assert.ok(result.calls.some((call) => call.url.startsWith(`${base}?s=`) && call.init.redirect === 'manual'));
});

test('Repelis24: TV no fabrica episodios de una ficha /serie/ sin enlaces comprobados', async () => {
  const result = await run('repelis24', {
    routes: [['repelis24.de/?s=', card('/serie/contenido-demo/')]],
  });
  assert.deepEqual(result.streams, []);
  assert.ok(!result.calls.some((call) => call.url.includes('repelis24.de/')));
});

test('Gnula One: /search/<título> y ?trembed resuelven solo un iframe de la película', async () => {
  const result = await run('gnulaone', {
    mediaType: 'movie', routes: [
      ['ver.gnula.one/search/Contenido%20Demo', card('/movies/contenido-demo/')],
      ['ver.gnula.one/movies/contenido-demo/', '<a href="/?trembed=1">Subtitulado · Voe</a><a href="/download/file.mp4">Descargar</a>'],
      ['ver.gnula.one/?trembed=1', '<title>Reproductor</title><iframe src="https://sw.example/e/demo"></iframe>'],
    ],
  });
  assertStream(result);
  assert.equal(result.streams[0].language, 'es-SUB');
  assert.equal(result.streams[0].provider, 'gnulaone');
  assert.ok(result.calls.some((call) => call.url === 'https://ver.gnula.one/search/Contenido%20Demo'));
  assert.ok(!result.calls.some((call) => call.url.includes('ver.gnula.one/?s=')));
});

test('Gnula One: ignora la portada devuelta por ?trembed y no mezcla vídeos ajenos', async () => {
  const result = await run('gnulaone', {
    mediaType: 'movie', routes: [
      ['ver.gnula.one/search/Contenido%20Demo', card('/movies/contenido-demo/')],
      ['ver.gnula.one/movies/contenido-demo/', '<a href="/?trembed=1">Subtitulado · Voe</a>'],
      ['ver.gnula.one/?trembed=1', '<title>G Nula - G Nula es un blog para ver películas online</title><iframe src="https://sw.example/e/demo"></iframe>'],
    ],
  });
  assert.deepEqual(result.streams, []);
  assert.ok(!result.calls.some((call) => call.url.includes('sw.example')));
  const tv = await run('gnulaone');
  assert.deepEqual(tv.streams, []);
  assert.ok(!tv.calls.some((call) => call.url.includes('ver.gnula.one/')));
});

test('RepelisPlus: búsqueda y selección del episodio solicitado antes de resolver el player', async () => {
  const result = await run('repelisplus', {
    routes: [
      ['repelisplus.asia/buscar?', card('/series/contenido-demo')],
      [/https:\/\/repelisplus\.asia\/series\/contenido-demo$/, '<a href="/series/contenido-demo/temporada/2/episodio/3">S02E03</a>'],
      ['repelisplus.asia/series/contenido-demo/temporada/2/episodio/3', '<iframe data-src="https://sw.example/e/demo"></iframe>'],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url.endsWith('/series/contenido-demo/temporada/2/episodio/3')));
  const missing = await run('repelisplus', {
    episode: 4,
    routes: [
      ['repelisplus.asia/buscar?', card('/series/contenido-demo')],
      [/https:\/\/repelisplus\.asia\/series\/contenido-demo$/, '<a href="/series/contenido-demo/temporada/2/episodio/3">S02E03</a>'],
    ],
  });
  assert.deepEqual(missing.streams, []);
  assert.ok(!missing.calls.some((call) => call.url.includes('/episodio/4')));
});

test('Pelis Juanita: búsqueda de películas y resolución de iframe a HLS', async () => {
  const result = await run('pelisjuanita', {
    mediaType: 'movie',
    routes: [
      ['pelisjuanita.org/?s=Contenido%20Demo', card('/pelicula/contenido-demo-2024')],
      ['pelisjuanita.org/pelicula/contenido-demo-2024', '<iframe data-src="https://sw.example/e/demo"></iframe>'],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === 'https://pelisjuanita.org/?s=Contenido%20Demo'));
  assert.ok(!result.streams.some((stream) => /pelisjuanita\.org\/pelicula\//.test(stream.url)));
});

test('Pelis Juanita: selecciona solo el episodio solicitado antes de resolver el player', async () => {
  const episodeUrl = 'https://pelisjuanita.org/serie/contenido-demo-2024/episodio/3';
  const routes = [
    ['pelisjuanita.org/?s=Contenido%20Demo', card('/serie/contenido-demo-2024')],
    [/https:\/\/pelisjuanita\.org\/serie\/contenido-demo-2024$/, `<a href="${episodeUrl}">T2 · E3</a>`],
    [episodeUrl, '<iframe src="https://sw.example/e/demo"></iframe>'],
  ];
  const result = await run('pelisjuanita', { routes });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === episodeUrl));

  const missing = await run('pelisjuanita', { episode: 4, routes: routes.slice(0, 2) });
  assert.deepEqual(missing.streams, []);
  assert.ok(!missing.calls.some((call) => call.url.includes('/episodio/4')));
});

test('Pelispedia: busca películas y extrae el reproductor, no enlaces de descarga', async () => {
  const result = await run('pelispedia', {
    mediaType: 'movie',
    routes: [
      ['pelispedia.is/?s=Contenido%20Demo', card('/pelicula/contenido-demo-2024/')],
      ['pelispedia.is/pelicula/contenido-demo-2024/', '<a href="https://cdn.example/download.mp4" download>Descargar</a><iframe data-src="https://sw.example/e/demo"></iframe>'],
    ],
  });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === 'https://pelispedia.is/?s=Contenido%20Demo'));
  assert.ok(!result.streams.some((stream) => /pelispedia\.is|download\.mp4/.test(stream.url)));
});

test('Pelispedia: no mezcla episodios de otra temporada', async () => {
  const episodeUrl = 'https://pelispedia.is/serie/contenido-demo/temporada/2/episodio/3/';
  const routes = [
    ['pelispedia.is/?s=Contenido%20Demo', card('/serie/contenido-demo/')],
    [/https:\/\/pelispedia\.is\/serie\/contenido-demo\/$/, `<a href="${episodeUrl}">S02E03</a>`],
    [episodeUrl, '<iframe src="https://sw.example/e/demo"></iframe>'],
  ];
  const result = await run('pelispedia', { routes });
  assertStream(result);
  assert.ok(result.calls.some((call) => call.url === episodeUrl));

  const missing = await run('pelispedia', { episode: 4, routes: routes.slice(0, 2) });
  assert.deepEqual(missing.streams, []);
  assert.ok(!missing.calls.some((call) => call.url.includes('/episodio/4')));
});
