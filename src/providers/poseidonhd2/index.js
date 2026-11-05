import { createSiteProvider } from '../../core/site.js';
import { fetchText, withQuery } from '../../core/http.js';
import { cardsFromAnchors, nextData } from '../../core/html.js';
import { resolveCandidates } from '../../core/extractors.js';

const BASE = 'https://www.poseidonhd2.co';
const LANGUAGES = { latino: 'es-LAT', spanish: 'es-ES', english: 'es-SUB' };

async function search(query, mediaType) {
  const page = await fetchText(withQuery(`${BASE}/search`, { q: query }), { referer: `${BASE}/` });
  return cardsFromAnchors(page.text, page.url, { mediaType, path: /\/(?:pelicula|serie)\//i });
}

function videoCandidates(videos) {
  const candidates = [];
  for (const [key, language] of Object.entries(LANGUAGES)) {
    for (const item of videos?.[key] || []) {
      if (item.result) candidates.push({ url: item.result, language, server: item.cyberlocker || 'PoseidonHD2' });
    }
  }
  return candidates;
}

async function streams(match, media) {
  let url = match.url;
  if (media.mediaType !== 'movie') {
    const show = await fetchText(match.url, { referer: `${BASE}/` });
    const props = nextData(show.text)?.props?.pageProps || {};
    const series = props.thisSerie || props.serie;
    const season = (series?.seasons || []).find((item) => Number(item.number) === media.season);
    const episode = (season?.episodes || []).find((item) => Number(item.number) === media.episode);
    const slug = episode?.url?.slug?.replace(/^series\//, '').replace('/seasons/', '/temporada/').replace('/episodes/', '/episodio/');
    if (!slug) return [];
    url = `${BASE}/serie/${slug}`;
  }
  const page = await fetchText(url, { referer: `${BASE}/` });
  const props = nextData(page.text)?.props?.pageProps || {};
  const videos = media.mediaType === 'movie'
    ? props.thisMovie?.videos
    : (props.episode || props.thisEpisode)?.videos;
  return resolveCandidates(videoCandidates(videos), { provider: 'PoseidonHD2', providerId: 'poseidonhd2', referer: page.url });
}
module.exports = { getStreams: createSiteProvider({ name: 'PoseidonHD2', search, streams }) };
