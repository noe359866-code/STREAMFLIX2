const cheerio = require("cheerio-without-node-native");
const BASE_URL = "https://sololatino.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
const isHls = (url) => typeof url === "string" && /^https:\/\/[^?#]+\.m3u8?(?:[?#].*)?$/i.test(url);
const abs = (url) => !url ? "" : /^https?:\/\//i.test(url) ? url : url.startsWith("//") ? "https:" + url : BASE_URL + (url.startsWith("/") ? url : "/" + url);
async function request(url, options = {}) {
  try {
    const res = await fetch(url, { ...options, headers: { "User-Agent": UA, "Accept": "text/html,application/json,*/*", "Referer": BASE_URL + "/", ...(options.headers || {}) } });
    return res && res.ok ? res : null;
  } catch (_) { return null; }
}
async function html(url, referer) { const r = await request(url, { headers: { Referer: referer || BASE_URL + "/" } }); return r ? r.text() : ""; }
function titleFrom(tmdbId, info) {
  return String((info && (info.title || info.name || info.originalTitle || info.original_name)) ||
    (typeof tmdbId === "string" && !/^\d+$/.test(tmdbId) ? tmdbId : "")).trim();
}
function findCardPage(source, title) {
  const $ = cheerio.load(source), q = title.toLowerCase(), found = [];
  $("div.card, article.card").each((_, el) => {
    const n = $(el), a = n.find("a[href]").first(), img = n.find("img").first();
    const name = (n.find(".card__title").text() || img.attr("alt") || a.attr("title") || "").trim();
    const href = abs(a.attr("href") || n.attr("href"));
    if (!href || !name) return;
    const v = name.toLowerCase(), score = v === q ? 3 : v.includes(q) || q.includes(v) ? 2 : 0;
    if (score) found.push({ href, score });
  });
  found.sort((a,b) => b.score-a.score);
  return found[0] || null;
}
function extractHls(source) {
  const found = new Set(), re = /https?:\/\/[^"'\s<>\\]+?\.m3u8?(?:\?[^"'\s<>]*)?/gi;
  let m; while ((m = re.exec(String(source || "")))) { const u = m[0].replace(/\\\//g, "/").replace(/&amp;/g, "&"); if (isHls(u)) found.add(u); }
  return [...found];
}
async function getStreams(tmdbId, mediaType, season, episode, mediaInfo) {
  const title = titleFrom(tmdbId, mediaInfo); if (!title) return [];
  try {
    const search = await html(BASE_URL + "/buscar?q=" + encodeURIComponent(title));
    if (!search) return [];
    const match = findCardPage(search, title); if (!match) return [];
    const page = await html(match.href); if (!page) return [];
    let source = page;
    const $ = cheerio.load(page), tokens = [];
    $("button.server-btn[data-player-token]").each((_, el) => { const token = $(el).attr("data-player-token"); if (token) tokens.push(token); });
    for (const token of tokens) {
      const r = await request(BASE_URL + "/api/player-url", { method: "POST", headers: { "Referer": match.href, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ t: token }) });
      if (!r) continue;
      try { const data = await r.json(); const candidate = data.url || data.embed || data.link; if (isHls(candidate)) source += "\n" + candidate; } catch (_) {}
    }
    return extractHls(source).map(url => ({ name: "SoloLatino", title: "HLS directo", url, quality: "HLS", headers: { Referer: match.href, "User-Agent": UA } }));
  } catch (e) { console.warn("[SoloLatino]", e && e.message || e); return []; }
}
module.exports = { getStreams, _internals: { isHls, abs, titleFrom, findCardPage, extractHls } };
