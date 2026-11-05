const cheerio = require("cheerio-without-node-native");

const BASE_URL = "https://www.animebum.net";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function absoluteUrl(value, base = BASE_URL) {
  if (!value || typeof value !== "string") return "";
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return base.replace(/\/$/, "") + value;
  return base.replace(/\/$/, "") + "/" + value;
}
function text(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function isHls(value) { return typeof value === "string" && /^https:\/\/[^?#]+\.m3u8?(?:[?#].*)?$/i.test(value); }
async function getHtml(url, referer = BASE_URL + "/") {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Referer": referer, "Accept": "text/html,application/xhtml+xml" } });
    return response && response.ok ? await response.text() : null;
  } catch (error) { console.warn("[AnimeBum] request failed", error); return null; }
}
function findPage(html, title) {
  const $ = cheerio.load(html || "");
  const query = text(title).toLowerCase();
  const matches = [];
  $("div.search-results__item, article.serie").each((_, el) => {
    const node = $(el);
    const a = node.find("a[href]").first();
    const name = text(node.find("h2, h3").first().text() || a.attr("title"));
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
  const found = [];
  const source = String(html || "");
  const patterns = [/https?:\\/\\/[^"'\\s<>]+?\\.m3u8(?:\\?[^"'\\s<>]*)?/gi];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      let url = match[0].replace(/\\\\\//g, "/").replace(/\\u0026/g, "&");
      if (isHls(url)) found.push(url);
    }
  }
  return [...new Set(found)];
}
async function getStreams(tmdbId, mediaType, season, episode, mediaInfo) {
  const title = text(mediaInfo && (mediaInfo.title || mediaInfo.name || mediaInfo.originalTitle) ||
    (typeof tmdbId === "string" && !/^\d+$/.test(tmdbId) ? tmdbId : ""));
  if (!title) return [];
  try {
    const searchHtml = await getHtml(BASE_URL + "/search?s=" + encodeURIComponent(title) + "&page=1");
    if (!searchHtml) return [];
    const match = findPage(searchHtml, title);
    if (!match) return [];
    let targetHtml = await getHtml(match.href);
    if (!targetHtml) return [];
    const isTv = ["tv", "series", "show"].includes(String(mediaType || "").toLowerCase());
    if (isTv) {
      const $ = cheerio.load(targetHtml);
      let episodeUrl = "";
      $("ul.list-episodies li a").each((_, el) => {
        const label = text($(el).text());
        const numbers = label.match(/\d+/g) || [];
        if (numbers.length && Number(numbers[numbers.length - 1]) === Number(episode)) episodeUrl = absoluteUrl($(el).attr("href"));
      });
      if (!episodeUrl) return [];
      targetHtml = await getHtml(episodeUrl, match.href);
      if (!targetHtml) return [];
    }
    return extractDirectHls(targetHtml).map((url) => ({
      name: "AnimeBum", title: "HLS directo", url, quality: "HLS",
      headers: { "Referer": match.href, "User-Agent": USER_AGENT }
    }));
  } catch (error) { console.error("[AnimeBum] provider error", error); return []; }
}
module.exports = { getStreams, _internals: { absoluteUrl, isHls, findPage, extractDirectHls } };
