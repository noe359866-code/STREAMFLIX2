import { createSiteProvider } from '../../core/site.js';
import { fetchText, postJson } from '../../core/http.js';
import { resolveCandidates } from '../../core/extractors.js';
import { decodeBase64 } from '../../core/base64.js';
import { nextData } from '../../core/html.js';

const BASE = 'https://doramasflix.in';
const API = 'https://sv1.fluxcedene.net/api/gql';
const PLATFORM = 'RxARncfg1S_MdpSrCvreoLu_SikCGMzE1NzQzODc3NjE2MQ==';
const LANGS = { '36': 'en', '37': 'es-ES', '38': 'es-LAT', '192': 'es-SUB' };

async function gql(operationName, variables, query) {
  const response = await postJson(API, { operationName, variables, query }, {
    referer: `${BASE}/`,
    extraHeaders: {
      platform: 'doramasflix', authorization: 'Bear', 'x-access-jwt-token': '', 'x-access-platform': PLATFORM,
    },
  });
  if (response.data.errors?.length) throw new Error(response.data.errors[0].message || 'Error GraphQL');
  return response.data.data;
}

async function search(query, mediaType) {
  const data = await gql('searchAll', { input: query }, `query searchAll($input: String!) {
    searchDorama(input: $input, limit: 32) { _id slug name name_es }
    searchMovie(input: $input, limit: 32) { _id slug name name_es }
  }`);
  const source = mediaType === 'movie' ? data.searchMovie : data.searchDorama;
  return (source || []).map((item) => ({
    id: item._id, slug: item.slug, title: item.name_es || item.name, originalTitle: item.name,
    type: mediaType,
  }));
}

async function unwrapFkplayer(url) {
  if (!/fkplayer\.xyz/i.test(url)) return url;
  const page = await fetchText(url, { referer: `${BASE}/` });
  const token = nextData(page.text)?.props?.pageProps?.token;
  if (!token) return url;
  const decoded = await postJson('https://fkplayer.xyz/api/decoding', { token }, { referer: url });
  try { return decodeBase64(decoded.data.link || decoded.data.url || ''); } catch (_) { return url; }
}

async function streams(match, media) {
  let links = [];
  if (media.mediaType === 'movie') {
    const data = await gql('detailMovie', { filter: { slug: match.slug } }, `query detailMovie($filter: FilterFindOneMovieInput) {
      detailMovie(filter: $filter) { _id links_online }
    }`);
    links = data.detailMovie?.links_online || [];
  } else {
    const detail = await gql('detailDorama', { filter: { slug: match.slug } }, `query detailDorama($filter: FilterFindOneDoramaInput) {
      detailDorama(filter: $filter) { _id }
    }`);
    const doramaId = detail.detailDorama?._id;
    if (!doramaId) return [];
    const episodes = await gql('listEpisodes', { serie_id: doramaId, season_number: media.season }, `query listEpisodes($season_number: Float!, $serie_id: MongoID!) {
      listEpisodes(sort: NUMBER_ASC, filter: {type_serie: "dorama", serie_id: $serie_id, season_number: $season_number}) { _id slug episode_number season_number }
    }`);
    const episode = (episodes.listEpisodes || []).find((item) => Number(item.episode_number) === media.episode);
    if (!episode) return [];
    const data = await gql('detailEpisode', { filter: { slug: episode.slug } }, `query detailEpisode($filter: FilterFindOneEpisodeInput) {
      detailEpisode(filter: $filter) { _id links_online }
    }`);
    links = data.detailEpisode?.links_online || [];
    if (!links.length && episode._id) {
      const fallback = await gql('getEpisodeLinks', { id: episode._id }, `query getEpisodeLinks($id: MongoID!) {
        getEpisodeLinks(id: $id) { _id links_online }
      }`);
      links = fallback.getEpisodeLinks?.links_online || [];
    }
  }
  const candidates = [];
  for (const item of links) {
    const raw = item.embed || item.link;
    if (!raw || raw.endsWith('/e/')) continue;
    const url = await unwrapFkplayer(raw).catch(() => raw);
    candidates.push({ url, language: LANGS[String(item.lang)] || 'es-SUB', server: item.server || 'Doramasflix', referer: `${BASE}/` });
  }
  return resolveCandidates(candidates, { provider: 'Doramasflix', providerId: 'doramasflix', referer: `${BASE}/` });
}

module.exports = { getStreams: createSiteProvider({ name: 'Doramasflix', search, streams }) };
