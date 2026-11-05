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
