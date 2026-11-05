const cheerio = require("cheerio-without-node-native");
const BASE_URL = "https://cinehax.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
const isHls = u => typeof u === "string" && /^https:\/\/[^?#]+\.m3u8?(?:[?#].*)?$/i.test(u);
async function get(url, referer = BASE_URL + "/") {
  try { const r = await fetch(url, { headers: { "User-Agent": UA, Referer: referer, Accept: "text/html,application/json,*/*" } }); return r && r.ok ? await r.text() : ""; }
  catch (_) { return ""; }
}
function extractHls(source) {
  const out = new Set(), re = /https?:\/\/[^"'\s<>\\]+?\.m3u8?(?:\?[^"'\s<>]*)?/gi;
  let m; while ((m = re.exec(String(source || "")))) { const u = m[0].replace(/\\\//g, "/").replace(/&amp;/g, "&"); if (isHls(u)) out.add(u); }
  return [...out];
}
function titleFrom(id, info) { return String((info && (info.title || info.name || info.originalTitle || info.original_name)) || (typeof id === "string" && !/^\d+$/.test(id) ? id : "")).trim(); }
async function searchPage(title) {
  const q = encodeURIComponent(title);
  const live = await get(BASE_URL + "/ajax?action=tmdb_live_search&query=" + q);
  try {
    const data = JSON.parse(live);
    const items = Array.isArray(data.data) ? data.data : [];
    const exact = items.find(x => String(x.title_text || x.title || x.name || "").toLowerCase() === title.toLowerCase()) || items[0];
    if (exact) {
      const href = exact.link || exact.watch_link || "";
      const m = href.match(/\/(?:pelicula|serie)\/(\d+)/);
      if (m) return { id: m[1], type: href.includes("/serie/") ? "tv" : "movie" };
    }
  } catch (_) {}
  return null;
}
async function getStreams(tmdbId, mediaType, season, episode, mediaInfo) {
  const title = titleFrom(tmdbId, mediaInfo); if (!title) return [];
  try {
    const found = await searchPage(title); if (!found) return [];
    const kind = found.type === "tv" || ["tv","series","show"].includes(String(mediaType).toLowerCase()) ? "serie" : "pelicula";
    const pageUrl = BASE_URL + "/" + kind + "/" + found.id + "/";
    const page = await get(pageUrl); if (!page) return [];
    const sources = [page];
    // El endpoint puede devolver URLs de reproductor; solo aceptamos si ya son HLS directo.
    const ajax = await get(BASE_URL + "/ajax?action=get_movie_servers&id=" + encodeURIComponent(found.id), pageUrl);
    if (ajax) sources.push(ajax);
    return [...new Set(sources.flatMap(extractHls))].map(url => ({ name: "CineHax", title: "HLS directo", url, quality: "HLS", headers: { Referer: pageUrl, "User-Agent": UA } }));
  } catch (e) { console.warn("[CineHax]", e && e.message || e); return []; }
}
module.exports = { getStreams, _internals: { isHls, extractHls, titleFrom } };
