const cheerio = require("cheerio-without-node-native");

const BASE_URL = "https://animeav1.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function absoluteUrl(value, base) {
  if (!value || typeof value !== "string") return "";
  const origin = base || BASE_URL;
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return origin + value;
  return origin.replace(/\/+$/, "") + "/" + value;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isDirectHls(value) {
  return typeof value === "string" &&
    /^https:\/\/[^?#]+\.m3u8?(?:[?#].*)?$/i.test(value);
}

async function request(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": BASE_URL + "/",
        "Accept": "text/html,application/json,application/xhtml+xml"
      }
    });
    return response && response.ok ? response : null;
  } catch (error) {
    console.warn("[AnimeAV1] Request failed:", error && error.message ? error.message : error);
    return null;
  }
}

async function getHtml(url) {
  const response = await request(url);
  if (!response) return null;
  try {
    return await response.text();
  } catch (_) {
    return null;
  }
}

async function getJson(url) {
  const response = await request(url);
  if (!response) return null;
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

function getSearchTitle(tmdbId, mediaInfo) {
  if (mediaInfo && typeof mediaInfo === "object") {
    const title = mediaInfo.title || mediaInfo.name ||
      mediaInfo.originalTitle || mediaInfo.original_name;
    if (title) return cleanText(title);
  }

  // Some host integrations pass a title in the first argument.
  if (typeof tmdbId === "string" && !/^\d+$/.test(tmdbId.trim())) {
    return cleanText(tmdbId);
  }

  return "";
}

function findMediaPage(html, query) {
  const $ = cheerio.load(html || "");
  const normalizedQuery = cleanText(query).toLocaleLowerCase();
  const candidates = [];

  $("article").each((_, article) => {
    const node = $(article);
    const anchor = node.find("a[href]").first();
    const href = absoluteUrl(anchor.attr("href"));
    const title = cleanText(node.find("h3").first().text() || anchor.attr("title"));
    if (!href || !title) return;

    const normalizedTitle = title.toLocaleLowerCase();
    const score = normalizedTitle === normalizedQuery ? 3 :
      (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle) ? 2 : 0);
    candidates.push({ href, title, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length && candidates[0].score > 0 ? candidates[0] : null;
}

function resolveIndexed(data, index) {
  if (!Number.isInteger(index) || index < 0 || index >= data.length) return undefined;
  return data[index];
}

function extractEpisodeNumbers(payload) {
  const numbers = new Set();
  if (!payload || !Array.isArray(payload.nodes)) return [];

  for (const node of payload.nodes) {
    if (!node || !Array.isArray(node.data)) continue;
    const data = node.data;

    for (const item of data) {
      if (!item || typeof item !== "object" || !Number.isInteger(item.episodes)) continue;
      const episodeRefs = resolveIndexed(data, item.episodes);
      if (!Array.isArray(episodeRefs)) continue;

      episodeRefs.forEach((episodeRef, index) => {
        const episodeObject = resolveIndexed(data, episodeRef);
        if (!episodeObject || typeof episodeObject !== "object") return;

        const rawNumber = resolveIndexed(data, episodeObject.number);
        const number = Number.isInteger(rawNumber) ? rawNumber :
          (typeof rawNumber === "string" && /^\d+$/.test(rawNumber) ? Number(rawNumber) : index + 1);

        if (Number.isInteger(number) && number > 0) numbers.add(number);
      });
    }
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

function extractDirectHls(payload) {
  const found = [];
  if (!payload || !Array.isArray(payload.nodes)) return found;

  for (const node of payload.nodes) {
    if (!node || !Array.isArray(node.data)) continue;
    const data = node.data;

    for (const item of data) {
      if (!item || typeof item !== "object" || !Number.isInteger(item.embeds)) continue;
      const embeds = resolveIndexed(data, item.embeds);
      if (!embeds || typeof embeds !== "object") continue;

      for (const category of ["SUB", "DUB"]) {
        const refs = resolveIndexed(data, embeds[category]);
        if (!Array.isArray(refs)) continue;

        for (const ref of refs) {
          const server = resolveIndexed(data, ref);
          if (!server || typeof server !== "object") continue;

          const name = resolveIndexed(data, server.server);
          const url = resolveIndexed(data, server.url);
          if (typeof url !== "string" || !isDirectHls(url)) continue;
          if (String(name || "").toLowerCase().includes("mega")) continue;

          found.push({
            url,
            language: category === "DUB" ? "LAT/ES" : "SUB",
            server: cleanText(name) || "HLS"
          });
        }
      }
    }
  }

  const seen = new Set();
  return found.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function findAnimePage(title) {
  const searchUrl = BASE_URL + "/catalogo?search=" + encodeURIComponent(title) + "&page=1";
  const html = await getHtml(searchUrl);
  if (!html) return null;
  return findMediaPage(html, title);
}

async function getEpisodeList(mediaId) {
  return getJson(BASE_URL + "/media/" + encodeURIComponent(mediaId) + "/__data.json");
}

async function getStreams(tmdbId, mediaType, season, episode, mediaInfo) {
  try {
    const title = getSearchTitle(tmdbId, mediaInfo);
    if (!title) {
      console.warn("[AnimeAV1] No title available. A numeric TMDB ID cannot be searched without title metadata.");
      return [];
    }

    const media = await findAnimePage(title);
    if (!media) return [];

    const mediaId = media.href.replace(/\/+$/, "").split("/").pop();
    if (!mediaId) return [];

    const isTv = mediaType === "tv" || mediaType === "series" || mediaType === "show";
    let targetId = mediaId;

    if (isTv) {
      const showData = await getEpisodeList(mediaId);
      const episodeNumbers = extractEpisodeNumbers(showData);
      const requestedEpisode = Number(episode);
      if (!Number.isInteger(requestedEpisode) || requestedEpisode < 1) return [];
      if (episodeNumbers.length && !episodeNumbers.includes(requestedEpisode)) return [];
      targetId = mediaId + "/" + requestedEpisode;
    }

    const payload = await getJson(
      BASE_URL + "/media/" + targetId.split("/").map(encodeURIComponent).join("/") + "/__data.json"
    );
    const directStreams = extractDirectHls(payload);

    return directStreams.map((stream, index) => ({
      name: "AnimeAV1",
      title: "HLS • " + stream.language + (stream.server ? " • " + stream.server : ""),
      url: stream.url,
      quality: "HLS",
      headers: {
        "Referer": BASE_URL + "/",
        "User-Agent": USER_AGENT
      }
    }));
  } catch (error) {
    console.error("[AnimeAV1] Provider error:", error && error.message ? error.message : error);
    return [];
  }
}

module.exports = {
  getStreams,
  _internals: {
    absoluteUrl,
    cleanText,
    isDirectHls,
    getSearchTitle,
    extractEpisodeNumbers,
    extractDirectHls,
    findMediaPage
  }
};
