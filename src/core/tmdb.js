import { fetchJson } from './http.js';
import { unique, yearOf } from './text.js';

function apiKey() {
  const key = globalThis.TMDB_API_KEY;
  if (!key) throw new Error('Nuvio no proporcionó TMDB_API_KEY.');
  return key;
}

function endpointType(mediaType) {
  return mediaType === 'movie' ? 'movie' : 'tv';
}

async function findByImdb(imdb) {
  const response = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdb)}`, {
    referer: 'https://www.themoviedb.org/',
    extraHeaders: { Accept: 'application/json' },
  });
  // La API exige api_key; se añade aquí para mantener una sola construcción de URL.
  return response.data;
}

export async function resolveMetadata(contentId, mediaType) {
  const type = endpointType(mediaType);
  let id = String(contentId || '').trim().replace(/^tmdb[:/]/i, '').split('/')[0];
  if (!id) throw new Error('ID de contenido vacío.');
  if (/^(?:imdb:)?tt\d+$/i.test(id)) {
    const imdb = id.replace(/^imdb:/i, '');
    const response = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdb)}?api_key=${encodeURIComponent(apiKey())}&external_source=imdb_id`);
    const found = type === 'movie' ? response.data.movie_results?.[0] : response.data.tv_results?.[0];
    if (!found?.id) throw new Error(`TMDB no encontró ${imdb}.`);
    id = String(found.id);
  }
  if (!/^\d+$/.test(id)) throw new Error(`Se esperaba un ID TMDB numérico; recibido: ${id}`);

  const languages = ['es-MX', 'en-US'];
  const responses = await Promise.all(languages.map((language) => fetchJson(
    `https://api.themoviedb.org/3/${type}/${id}?api_key=${encodeURIComponent(apiKey())}&language=${language}&append_to_response=alternative_titles,external_ids`,
    { referer: 'https://www.themoviedb.org/' },
  ).catch(() => null)));
  const es = responses[0]?.data;
  const en = responses[1]?.data;
  const primary = es || en;
  if (!primary || primary.success === false) throw new Error(`TMDB no devolvió metadatos para ${id}.`);

  const alternatives = [
    ...(primary.alternative_titles?.titles || primary.alternative_titles?.results || []),
    ...(en?.alternative_titles?.titles || en?.alternative_titles?.results || []),
  ].map((item) => item.title || item.name);
  const titles = unique([
    primary.title, primary.name, primary.original_title, primary.original_name,
    en?.title, en?.name, en?.original_title, en?.original_name,
    ...alternatives,
  ]);
  return {
    id,
    imdbId: primary.external_ids?.imdb_id || primary.imdb_id || en?.external_ids?.imdb_id || en?.imdb_id || '',
    title: primary.title || primary.name || en?.title || en?.name || '',
    originalTitle: primary.original_title || primary.original_name || en?.original_title || en?.original_name || '',
    titles,
    year: yearOf(primary.release_date || primary.first_air_date || en?.release_date || en?.first_air_date),
    mediaType: type,
  };
}
