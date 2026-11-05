const cheerio = require("cheerio-without-node-native");

const BASE_URL = "https://flixlatam.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function absoluteUrl(value, base = BASE_URL) {
  if (!value || typeof value !== "string") return "";
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return base.replace(/\/$/, "") + value;
  return base.replace(/\/$/, "") + "/" + value;
}
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function isHls(value) { return typeof value === "string" && /^https:\/\/[^?#]+\.m3u8?(?:[?#].*)?$/i.test(value); }
async function getHtml(url, referer = BASE_URL + "/") {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Referer": referer, "Accept": "text/html,application/xhtml+xml" } });
    return response && response.ok ? await response.text() : null;
  } catch (error) { console.warn("[FlixLatam] request failed", error); return null; }
}
function findPage(html, title) {
  const $ = cheerio.load(html || "");
  const query = clean(title).toLowerCase();
  const matches = [];
  $("div.items article, .items article, article.item, div.result-item article, .search-results article").each((_, el) => {
    const node = $(el), a = node.find("a[href]").first();
    const name = clean(node.find("h3, .title, h2").first().text() || a.attr("title"));
    const href = absoluteUrl(a.attr("href"));
    if (!name || !href) return;
    const normalized = name.toLowerCase();
    const score = normalized === query ? 3 : (normalized.includes(query) || query.includes(normalized) ? 2 : 0);
    matches.push({ name, href, score });
  });
  matches.sort((a,b) => b.score-a.score);
  return matches[0] && matches[0].score > 0 ? matches[0] : null;
}
function extractDirectHls(html) {
  const source = String(html || ""), found = [];
  const patterns = [/https?:\\?\/\\?\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?/gi, /https?:\/\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?/gi];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const url = match[0].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
      if (isHls(url)) found.push(url);
    }
  }
  return [...new Set(found)];
}
async function getEpisodePage(showHtml, season, episode) {
  const $ = cheerio.load(showHtml || "");
  let seasonNode = null;
  $("#seasons .se-c").each((_, el) => {
    const label = clean($(el).find(".se-q span.se-t").text());
    const n = Number((label.match(/\d+/) || [])[0]);
    if (n === Number(season)) seasonNode = $(el);
  });
  if (!seasonNode) return "";
  let target = "";
  seasonNode.find(".se-a ul.episodios li").each((_, el) => {
    const row = $(el), a = row.find(".episodiotitle a").first();
    const numerando = clean(row.find(".numerando").text());
    const parts = numerando.split("-");
    const n = Number(clean(parts[1] || parts[0]).match(/\d+/)?.[0]);
    if (n === Number(episode)) target = absoluteUrl(a.attr("href"));
  });
  return target;
}
async function getStreams(tmdbId, mediaType, season, episode, mediaInfo) {
  const title = clean(mediaInfo && (mediaInfo.title || mediaInfo.name || mediaInfo.originalTitle) ||
    (typeof tmdbId === "string" && !/^\d+$/.test(tmdbId) ? tmdbId : ""));
  if (!title) return [];
  try {
    const searchHtml = await getHtml(BASE_URL + "/search?s=" + encodeURIComponent(title));
    if (!searchHtml) return [];
    const match = findPage(searchHtml, title);
    if (!match) return [];
    let pageHtml = await getHtml(match.href);
    if (!pageHtml) return [];
    const isTv = ["tv", "series", "show"].includes(String(mediaType || "").toLowerCase());
    if (isTv) {
      const episodeUrl = await getEpisodePage(pageHtml, season, episode);
      if (!episodeUrl) return [];
      pageHtml = await getHtml(episodeUrl, match.href);
      if (!pageHtml) return [];
    }
    return extractDirectHls(pageHtml).map((url) => ({
      name: "FlixLatam", title: "HLS directo", url, quality: "HLS",
      headers: { "Referer": match.href, "User-Agent": USER_AGENT }
    }));
  } catch (error) { console.error("[FlixLatam] provider error", error); return []; }
}
module.exports = { getStreams, _internals: { absoluteUrl, clean, isHls, findPage, extractDirectHls, getEpisodePage } };
