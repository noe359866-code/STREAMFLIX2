import { fetchJson, fetchText, mapLimit, origin, requestHeaders, USER_AGENT } from './http.js';
import { absoluteUrl, anchors, attributes, decodeHtml, extractBalanced, hostName, unique } from './text.js';
import { decodeBase64, decodeBase64Binary, decodeBase64Url, decodeTokenLink } from './base64.js';
import { isPlayableUrl, makeStream } from './streams.js';
import { nuploadEndpointFromHtml, nuploadMediaRedirect } from './nupload.js';



export const MOVIEMASTER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeJsString(value) {
  return String(value || '').replace(/\\(u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, (_, escape) => {
    if (escape[0].toLowerCase() === 'u') return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (escape[0].toLowerCase() === 'x') return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' })[escape] ?? escape;
  });
}

function base62(value, alphabet) {
  let number = Number(value);
  if (number === 0) return alphabet[0];
  let output = '';
  while (number > 0) {
    output = alphabet[number % alphabet.length] + output;
    number = Math.floor(number / alphabet.length);
  }
  return output;
}


export function unpack(source) {
  const text = String(source || '');
  const pattern = /}\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/g;
  let output = text;
  let match;
  while ((match = pattern.exec(text))) {
    const payload = decodeJsString(match[1]);
    const radix = Number(match[2]);
    const dictionary = decodeJsString(match[4]).split('|');
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const tokens = new Map();
    for (let index = 0; index < dictionary.length; index += 1) {
      tokens.set(base62(index, alphabet.slice(0, Math.max(2, radix))), dictionary[index]);
    }
    const unpacked = payload.replace(/\b[a-zA-Z0-9]+\b/g, (token) => tokens.get(token) || token);
    output = output.replace(match[0], unpacked).replace(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/i, unpacked);
  }

  return output === text ? text : `${output}\n${text}`;
}

export function unpackAll(html) {
  const scripts = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?(?:<\/script>|$)/gi) || [];
  return [String(html || ''), ...scripts.map(unpack)].join('\n');
}

function cleanMediaUrl(value, base) {
  const url = absoluteUrl(decodeHtml(value).replace(/\\u0026/gi, '&'), base);
  return isPlayableUrl(url) ? url : '';
}

const AD_LABEL = /(?:^|[\s_-])(?:ad(?:s|frame|slot|video|player|container)?|advert(?:isement|ising)?|anuncio|publicidad|banner|vast|(?:pre|mid|post)[-_]?roll|promo|tr[aá]iler)(?=$|[\s_-])/i;

function adLabeledTag(tag) {
  const attrs = attributes(tag);
  const label = [attrs.id, attrs.class, attrs.title, attrs['aria-label'], attrs['data-role']].join(' ');
  return AD_LABEL.test(label);
}

function withoutAdContexts(html) {
  let text = unpackAll(html);


  text = text.replace(/<(script|video|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (block) =>
    adLabeledTag(block.slice(0, block.indexOf('>') + 1)) ? ' '.repeat(block.length) : block);
  text = text.replace(/<(?:iframe|video|source)\b[^>]*>/gi, (tag) =>
    adLabeledTag(tag) ? ' '.repeat(tag.length) : tag);




  const spans = [];
  const adKey = /\b(?:ads?|advertising|advertisement|anuncio|publicidad|ad(?:Tag|Src|Url|Video|Config|Schedule)(?:Url)?|vast(?:Url)?|(?:pre|mid|post)[-_]?roll(?:Url)?|promo(?:Url)?|trailer(?:Url)?)\b["']?\s*[:=]\s*([\[{"'])/gi;
  for (const match of text.matchAll(adKey)) {
    const start = match.index + match[0].length - 1;
    const open = text[start];
    if (open === '{' || open === '[') {
      const block = extractBalanced(text.slice(start), '', open, open === '{' ? '}' : ']');
      if (block) spans.push([match.index, start + block.length]);
    } else {
      let end = start + 1;
      for (; end < text.length; end += 1) {
        if (text[end] === '\\') { end += 1; continue; }
        if (text[end] === open) break;
      }
      if (end < text.length) spans.push([match.index, end + 1]);
    }
  }
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
  }
  return text;
}

export function directMediaInHtml(html, base) {
  const text = withoutAdContexts(html);
  const declared = [];
  const sourcePattern = /\b(?:file|src|source|hls[1-4]?|wurl)\s*[:=]\s*["']([^"']+)["']/gi;
  const addSources = (source, pattern, output) => {
    for (const match of source.matchAll(pattern)) {
      const raw = match[1].replace(/\\\//g, '/');
      const url = cleanMediaUrl(raw.startsWith('//') ? `https:${raw}` : raw, base);
      if (url) output.push(url);
    }
  };


  const setup = /\b(?:player\s*\.setup|jwplayer(?:\([^)]{0,300}\))?\s*\.setup|new\s+(?:Playerjs|Clappr\.Player))\s*\(\s*\{/gi;
  for (const match of text.matchAll(setup)) {
    const block = extractBalanced(text.slice(match.index + match[0].length - 1), '', '{', '}');
    if (block) addSources(block, sourcePattern, declared);
  }
  addSources(text, /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, declared);
  if (declared.length) return unique(declared);



  if (/<iframe\b[^>]*\b(?:src|data-src)\s*=/i.test(text)) return [];
  const weak = [];
  addSources(text, sourcePattern, weak);
  if (weak.length) return unique(weak);
  const output = [];
  const patterns = [


    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?(?![\w.-])/gi,
    /https?:\\?\/\\?\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?(?![\w.-])/gi,
    /["']([^"']*?\/m3u8\/[a-zA-Z0-9_-]+[^"']*)["']/g,
    /\bwurl\b[\s\S]{0,80}?["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] || match[0]).replace(/\\\//g, '/');
      const url = cleanMediaUrl(raw.startsWith('//') ? `https:${raw}` : raw, base);
      if (url) output.push(url);
    }
  }
  return unique(output);
}

function subtitlesInHtml(html, base) {
  const subtitles = [];
  const regex = /(?:file|src)\s*:\s*["']([^"']+\.(?:vtt|srt)(?:\?[^"']*)?)["'][\s\S]{0,160}?(?:label|kind|language)\s*:\s*["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(unpackAll(html)))) {
    subtitles.push({ url: absoluteUrl(match[1], base), language: match[2], name: match[2] });
  }
  return subtitles;
}

const PACKED_CAPTION_HOSTS = new Set(['luluvdo.com', 'luluvdoo.com', 'luluvid.com', 'lulust.com', 'dropload.tv', 'dropload.io', 'dropload.pro', 'dr0pstream.com']);

function packedCaptionHost(url) {
  const host = String(url || '').match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || '';
  return PACKED_CAPTION_HOSTS.has(host);
}

function packedCaptions(html, base) {
  const source = withoutAdContexts(html);
  const result = [];
  for (const match of source.matchAll(/\btracks\s*:\s*\[/gi)) {
    const raw = extractBalanced(source.slice(match.index + match[0].length - 1), '', '[', ']');
    if (!raw || raw.length > 100000) continue;
    for (const entry of raw.matchAll(/\{[^{}]{0,2000}\}/g)) {
      const file = entry[0].match(/\b(?:file|src)\s*:\s*["']([^"']+)["']/i)?.[1];
      const label = entry[0].match(/\b(?:label|language|srclang)\s*:\s*["']([^"']+)["']/i)?.[1];
      const kind = entry[0].match(/\bkind\s*:\s*["']([^"']+)["']/i)?.[1];
      if (!file || !label || /upload captions/i.test(label) || (kind && !/^(?:captions|subtitles)$/i.test(kind))) continue;
      const url = absoluteUrl(file, base);
      if (!/^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(url) || !/\.(?:vtt|srt)(?:$|[?#])/i.test(url)) continue;
      result.push({ url, language: label, name: label });
    }
  }
  return unique(result, (item) => item.url).slice(0, 20);
}

function streamtapeUrl(html, base) {
  const match = String(html || '').match(/document\.getElementById\(['"](?:bot|robot)link['"]\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('([^']+)'\)\.substring\((\d+)\)/i);
  if (!match) return '';
  const path = `${match[1]}${match[2].substring(Number(match[3]))}`.replace(/&amp;/g, '&');
  return absoluteUrl(path.startsWith('http') ? path : `https:${path.startsWith('//') ? path : `//streamtape.com/${path.replace(/^\/+/, '')}`}`, base);
}

function mixdropUrl(html, base) {
  const match = withoutAdContexts(html).match(/\bwurl\b[\s\S]{0,120}?=\s*["']([^"']+)["']/i);
  if (!match) return '';
  const value = match[1];
  return cleanMediaUrl(value.startsWith('//') ? `https:${value}` : value.startsWith('http') ? value : `https://${value}`, base);
}


const MIXDROP_HOSTS = new Set(['mixdrop.co', 'mixdrop.bz', 'mixdrop.ag', 'mixdrop.ch', 'mixdrop.to', 'mixdrop.cv', 'mxdrop.to', 'mixdrop.club', 'm1xdrop.net', 'miiixdrop.net', 'miixdrop.net', 'mxdrop.click', 'mixdrop.vip', 'mixdrop.si']);

function mixdropHost(url) {
  const host = String(url || '').match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || '';
  return MIXDROP_HOSTS.has(host) || /^md[3bfyz][a-z0-9]*\.[a-z0-9]+$/i.test(host);
}

function normalizeMixdrop(url) {
  if (!mixdropHost(url)) return url;
  return url.replace(/^(https?:\/\/)(mixdrop\.(?:vip|si))(?=\/)/i, '$1mxdrop.click')
    .replace(/^(https?:\/\/mixdrop\.club)(?=\/)/i, 'https://mixdrop.ag')
    .replace(/^(https?:\/\/[^/]+)\/(?:emb|f)\//i, '$1/e/');
}

function lamovieData(html, base) {
  if (!/^https?:\/\/(?:lamovie\.link|vimeos\.net)(?:[/:?#]|$)/i.test(base)) return null;
  const source = withoutAdContexts(html);
  function array(name) {
    const match = new RegExp(`(?:["']${name}["']|\\b${name})\\s*:\\s*\\[`, 'i').exec(source);
    if (!match) return [];
    const raw = extractBalanced(source.slice(match.index + match[0].length - 1), '', '[', ']');
    if (!raw || raw.length > 100000) return [];
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
  }
  const urls = array('stream_urls').filter((value) => typeof value === 'string').slice(0, 10)
    .map((value) => cleanMediaUrl(value, base)).filter(Boolean);
  const subtitles = array('default_subs').filter((sub) => sub && typeof sub.url === 'string').slice(0, 20)
    .map((sub) => ({ url: absoluteUrl(sub.url, base), language: String(sub.lang || sub.code || 'und').slice(0, 40) }))
    .filter((sub) => /^https?:\/\//i.test(sub.url) && /\.(?:vtt|srt)(?:$|[?#])/i.test(sub.url));
  return { urls, subtitles };
}

function rot13(value) {
  return value.replace(/[a-z]/gi, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode((char.charCodeAt(0) - base + 13) % 26 + base);
  });
}

function decodeVoeConfig(encoded) {
  try {
    let value = rot13(encoded);

    for (const pattern of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) value = value.split(pattern).join('_');
    value = value.replace(/_/g, '');
    const binary = decodeBase64Binary(value);
    const shifted = Array.from(binary, (char) => String.fromCharCode(char.charCodeAt(0) - 3)).reverse().join('');
    const config = JSON.parse(decodeBase64(shifted));
    return config && typeof config === 'object' ? config : null;
  } catch (_) {
    return null;
  }
}

function voeConfig(html) {
  const text = String(html || '');
  const scripts = text.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    const raw = script[1].trim();
    let encoded = '';
    try {
      const wrapper = JSON.parse(raw);
      if (Array.isArray(wrapper) && typeof wrapper[0] === 'string') encoded = wrapper[0];
    } catch (_) {                                            }
    if (!encoded) encoded = raw.match(/^\[\s*"([^"]+)"\s*\]$/)?.[1] || '';
    const config = encoded ? decodeVoeConfig(encoded) : null;
    if (!config) continue;

    if (isPlayableUrl(config.source)) return { ...config, urls: [config.source] };
    const fallback = (Array.isArray(config.fallback) ? config.fallback : [])
      .map((item) => item?.file).filter((url) => isPlayableUrl(url));
    if (fallback.length) return { ...config, urls: unique(fallback) };
  }
  return null;
}

function voeSubtitles(config, html, pageUrl) {
  if (!config || !Array.isArray(config.captions)) return [];
  const base = String(html || '').match(/\bvar\s+base\s*=\s*["']([^"']+)["']/i)?.[1] || pageUrl;
  const subtitleBase = absoluteUrl(base, pageUrl);
  if (!/^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(subtitleBase)) return [];
  return unique(config.captions.slice(0, 20).filter((item) => item && typeof item.file === 'string')
    .map((item) => ({
      url: absoluteUrl(item.file, subtitleBase),
      language: String(item.label || item.language || 'und').slice(0, 40),
    }))
    .filter((item) => /^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(item.url)
      && /\.(?:vtt|srt)(?:$|[?#])/i.test(item.url)), (item) => item.url);
}

export function voeUrls(html, allowLegacy = true) {
  const text = String(html || '');
  const config = voeConfig(text);
  if (config) return config.urls;



  if (!allowLegacy) return [];
  const output = [];

  const candidates = [...withoutAdContexts(text).matchAll(/(?:source|hls|file)\s*[:=]\s*["']([^"']+)["']/gi)];
  for (const match of candidates) {
    if (/\.m3u8/i.test(match[1]) && isPlayableUrl(match[1])) output.push(match[1]);
    else if (/^[a-zA-Z0-9+/=_-]{40,}$/.test(match[1])) {
      const decoded = decodeBase64Url(match[1]);
      if (decoded.includes('.m3u8') && isPlayableUrl(decoded)) output.push(decoded);
    }
  }
  return unique(output);
}


const VOE_ALIASES = new Set(['jilliandescribecompany.com', 'mikaylaarealike.com', 'christopheruntilpoint.com', 'walterprettytheir.com', 'crystaltreatmenteast.com', 'lauradaydo.com', 'lancewhosedifficult.com', 'dianaavoidthey.com', 'jefferycontrolmodel.com', 'charlestoughrace.com', 'richardquestionbuilding.com', 'jessicayeahcatch.com', 'juliewomanwish.com', 'rebeccapracticeloss.com', 'johnbeyondnation.com', 'jamesbornmain.com']);

function isVoeUrl(url) {
  const host = String(url || '').match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || '';
  return /^(?:[^.]+\.)?voe\.[a-z0-9-]+$/i.test(host) || VOE_ALIASES.has(host);
}

function jkplayerSource(html, pageUrl) {
  if (!/^https:\/\/jkanime\.net\/jkplayer\/(?:[^?#]*)?(?:[?#]|$)/i.test(pageUrl)) return '';
  const text = withoutAdContexts(html);
  const encoded = text.match(/\burl\s*:\s*atob\(\s*["']([A-Za-z0-9+/_=-]+)["']\s*\)/i)?.[1];
  let value = '';
  if (encoded) {
    try { value = decodeBase64(encoded).trim().replace(/\\\//g, '/'); } catch (_) { value = ''; }
  }
  if (!value) value = text.match(/(?:\burl\s*:\s*|\bloadSource\(\s*)["'](https?:\/\/[^"']+)["']/i)?.[1] || '';
  if (!/^https?:\/\/[^/@\s]+(?:[/?#]|$)/i.test(value) || !/\.m3u8(?:$|[?#])/i.test(value)) return '';
  return cleanMediaUrl(value, pageUrl);
}

export function dataLinkCandidates(html, base) {
  const output = [];
  const raw = extractBalanced(html, 'dataLink', '[', ']');
  if (raw) {
    try {
      const items = JSON.parse(raw);
      for (const item of items) {
        const language = item.video_language || item.language || item.lang || 'es';
        const embeds = item.sortedEmbeds || item.sorted_embeds || item.embeds || [];
        for (const embed of embeds) {
          const label = embed.servername || embed.server || hostName(embed.link || '');
          if (/download|1fichier/i.test(label) || AD_LABEL.test(label)) continue;
          const link = decodeTokenLink(embed.link) || (/^https?:\/\//i.test(embed.link || '') ? embed.link : '');
          if (link) output.push({ url: absoluteUrl(link, base), language, server: label });
        }
      }
    } catch (_) {                                                                    }
  }
  const onclick = /go_to_playerVast\(\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = onclick.exec(String(html || '')))) {
    const url = absoluteUrl(match[1], base);
    if (url) output.push({ url, language: 'es' });
  }
  return output;
}


export function protectedDataLinkCandidates(html, base) {
  const plain = dataLinkCandidates(html, base);
  const challenge = String(html || '').match(/(?:const|let|var)\s+POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  const difficulty = Number(String(html || '').match(/(?:const|let|var)\s+POW_DIFFICULTY\s*=\s*(\d+)/i)?.[1]);
  const salt = String(html || '').match(/(?:const|let|var)\s+POW_SALT\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (!challenge || !difficulty || difficulty > 6 || salt === undefined) return plain;
  try {
    const CryptoJS = require('crypto-js');
    const prefix = '0'.repeat(difficulty);
    let key;
    for (let nonce = 0; nonce < 2000000; nonce += 1) {
      if (CryptoJS.SHA256(challenge + nonce).toString().startsWith(prefix)) {
        key = CryptoJS.SHA256(challenge + nonce + salt);
        break;
      }
    }
    if (!key) return plain;
    const raw = extractBalanced(html, 'dataLink', '[', ']');
    const items = raw ? JSON.parse(raw) : [];
    const output = [...plain];
    for (const item of items) {
      for (const embed of item.sortedEmbeds || []) {
        if (/download|1fichier/i.test(embed.servername || '') || AD_LABEL.test(embed.servername || '')
          || String(embed.link || '').split('.').length === 3) continue;
        const decoded = CryptoJS.enc.Base64.parse(embed.link);
        const iv = CryptoJS.lib.WordArray.create(decoded.words.slice(0, 4), 16);
        const ciphertext = CryptoJS.lib.WordArray.create(decoded.words.slice(4), Math.max(0, decoded.sigBytes - 16));
        const url = CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext }), key, { iv }).toString(CryptoJS.enc.Utf8);
        if (/^https?:\/\//i.test(url)) output.push({ url: absoluteUrl(url, base), language: item.video_language || 'es', server: embed.servername });
      }
    }
    return output;
  } catch (_) {
    return plain;
  }
}

async function resolveMovieMaster(candidate) {
  if (!/moviemaster\.[^/]+\/video\?/i.test(candidate.url)) return null;
  const referer = candidate.referer || 'https://api.moviemaster.lat/';
  const response = await fetchJson(candidate.url, { referer, extraHeaders: { 'User-Agent': MOVIEMASTER_USER_AGENT } });
  const url = response.data.url || response.data.source || '';
  return isPlayableUrl(url) ? [{ ...candidate, url, headers: { 'User-Agent': MOVIEMASTER_USER_AGENT, Referer: referer } }] : [];
}




function maxstreamCastvUrl(embedUrl) {
  const match = String(embedUrl || '').match(/^https:\/\/(?:www\.)?maxstream\.video\/(?!castv(?:\/|$))[a-z0-9_-]+\/([a-z0-9_-]{4,128})(?:[/?#]|$)/i);
  return match ? `${origin(embedUrl)}/castv/${match[1]}` : '';
}

async function maxstreamCastv(candidate, context) {
  const castvUrl = maxstreamCastvUrl(candidate.url);
  if (!castvUrl) return [];
  try {
    const response = await fetchText(castvUrl, { referer: candidate.url, timeoutMs: context.timeoutMs || 10000 });
    const script = response.text.match(/<script\b(?=[^>]*\bid\s*=\s*["']m3u8["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    const url = decodeHtml(script || '').trim().split('#')[0].trim();

    if (!/^https:\/\//i.test(url) || !/\.m3u8(?:\?|$)/i.test(url) || !isPlayableUrl(url)) return [];
    return [{ ...candidate, url, referer: response.url || castvUrl }];
  } catch (_) { return []; }
}

function zilla(candidate) {

  if (/^https:\/\/player\.zilla-networks\.com\/m3u8\//i.test(candidate.url)) return null;


  const match = candidate.url.match(/^https:\/\/player\.zilla-networks\.com\/(?:[a-zA-Z0-9_-]+\/){0,3}([a-zA-Z0-9_-]{4,128})\/?(?:[?#]|$)/i);
  if (!match) return null;



  return [{
    ...candidate, url: `https://player.zilla-networks.com/m3u8/${match[1]}`, referer: candidate.url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0',
      Accept: '*/*', 'Accept-Language': 'es-MX,es-ES;q=0.9,es;q=0.8,en-US;q=0.7,en;q=0.6',
      Referer: candidate.url, Origin: 'https://player.zilla-networks.com',
      'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
    },
  }];
}

async function resolveUqload(candidate, context) {
  const match = String(candidate.url || '').match(/^(https:\/\/(?:uqload\.cx|uqload\.is|uqload\.vc))\/(?:e\/)?([a-z0-9_-]{1,128})\/?(?:[?#].*)?$/i);
  if (!match || /^embed-/i.test(match[2])) return null;
  const base = match[1];
  const referer = candidate.referer || `${base}/`;
  const body = `op=embed&file_code=${encodeURIComponent(match[2])}&auto=1&referer=${encodeURIComponent(referer)}`;
  try {
    const response = await fetchText(`${base}/dl`, {
      method: 'POST', body, referer, redirect: 'manual', timeoutMs: context.timeoutMs || 10000,
      extraHeaders: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    });
    if (!/eval\(function\(p,a,c,k,e,d\)/i.test(response.text)) return [];
    const unpacked = unpackAll(response.text);
    const matchFile = withoutAdContexts(unpacked).match(/\bfile\s*:\s*["']([^"']+)["']/i);
    const url = matchFile ? cleanMediaUrl(matchFile[1], base) : '';
    if (!url) return [];
    return [{ ...candidate, url, headers: { 'User-Agent': USER_AGENT, Referer: base } }];
  } catch (_) { return []; }
}

const GOODSTREAM_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VIDMOLY_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

function hosterProfile(url) {
  const host = String(url || '').match(/^https?:\/\/([^/:?#]+)(?:[/:?#]|$)/i)?.[1]?.toLowerCase() || '';
  if (host === 'goodstream.one') return { id: 'goodstream', headers: { 'User-Agent': GOODSTREAM_AGENT, 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://goodstream.one' } };
  if (['vidmoly.me', 'vidmoly.to', 'vidmoly.net', 'vidmoly.org'].includes(host)) {
    return { id: 'vidmoly', headers: { 'User-Agent': VIDMOLY_AGENT, Referer: 'https://vidmoly.to/' } };
  }
  return null;
}

async function resolveOne(candidate, context, depth) {
  candidate = { ...candidate, url: normalizeMixdrop(candidate.url).replace(/^(https?:\/\/)vidmoly\.me(?=\/)/i, '$1vidmoly.to') };
  const profile = hosterProfile(candidate.url);
  if (/u\.pcloud\.link\/publink\/show/i.test(candidate.url)) {
    const code = candidate.url.match(/[?&]code=([^&]+)/i)?.[1];
    if (code) {
      const response = await fetchJson(`https://api.pcloud.com/getpublinkdownload?code=${encodeURIComponent(code)}`, { referer: candidate.url });
      const host = response.data.hosts?.[0];
      const path = response.data.path;
      if (host && path && isPlayableUrl(`https://${host}${path}`)) return [{ ...candidate, url: `https://${host}${path}` }];
    }
  }
  const directZilla = zilla(candidate);
  if (directZilla) return directZilla;
  if (isPlayableUrl(candidate.url)) return [candidate];
  const movieMaster = await resolveMovieMaster(candidate);
  if (movieMaster) return movieMaster;
  if (depth > 2) return [];
  const uqload = await resolveUqload(candidate, context);
  if (uqload) return uqload;

  let response;
  try {
    response = await fetchText(candidate.url, {
      referer: /^https:\/\/jkanime\.net\/jkplayer\//i.test(candidate.url) ? 'https://jkanime.net/' : profile?.id === 'vidmoly' ? profile.headers.Referer : candidate.referer || context.referer,
      extraHeaders: profile ? { 'User-Agent': profile.headers['User-Agent'], ...(profile.id === 'goodstream' ? { 'Accept-Language': profile.headers['Accept-Language'] } : {}) } : {},
      timeoutMs: context.timeoutMs || 10000,
    });
  } catch (error) {
    if (error.response?.status === 404 && maxstreamCastvUrl(candidate.url)) return maxstreamCastv(candidate, context);
    throw error;
  }
  const html = response.text;
  const pageUrl = response.url || candidate.url;
  if (profile && hosterProfile(pageUrl)?.id !== profile.id) return [];
  const isVoe = isVoeUrl(pageUrl);
  const voe = voeUrls(html, isVoe);
  const config = isVoe ? voeConfig(html) : null;
  const jkplayer = jkplayerSource(html, pageUrl);
  if (jkplayer) return [{ ...candidate, url: jkplayer, referer: 'https://jkanime.net/', headers: { 'User-Agent': USER_AGENT, Origin: 'https://jkanime.net', Referer: 'https://jkanime.net/' } }];
  const lamovie = lamovieData(html, pageUrl);
  const direct = unique(voe.length ? voe : lamovie?.urls.length ? lamovie.urls : [
    ...directMediaInHtml(html, pageUrl),
    /^https?:\/\/(?:[^/]+\.)?streamtape\.[^/]+\//i.test(pageUrl) ? streamtapeUrl(html, pageUrl) : '',
    mixdropHost(pageUrl) ? mixdropUrl(html, pageUrl) : '',
  ].filter(Boolean));

  if (direct.length) return direct.map((url) => ({ ...candidate, url, referer: pageUrl, ...(profile ? { headers: profile.headers } : {}), subtitles: unique([...(lamovie?.subtitles || []), ...voeSubtitles(config, html, pageUrl), ...(packedCaptionHost(pageUrl) ? packedCaptions(html, pageUrl) : subtitlesInHtml(html, pageUrl))], (sub) => sub.url) }));
  if (maxstreamCastvUrl(candidate.url)) {
    const fallback = await maxstreamCastv(candidate, context);
    if (fallback.length) return fallback;
  }



  if (/^https:\/\/nupload\.(?:my|me)\/watch\/[^/?#]+/i.test(pageUrl)) {
    const endpoint = nuploadEndpointFromHtml(html);
    if (endpoint) {
      const url = await nuploadMediaRedirect(endpoint, pageUrl);
      if (url) return [{ ...candidate, url, referer: pageUrl }];
    }
  }


  const pass = html.match(/(?:\$\.get|fetch)\(\s*["'](\/pass_md5\/[^"']+)["']/i);
  if (pass) {
    const token = await fetchText(absoluteUrl(pass[1], pageUrl), { referer: pageUrl });
    const tokenText = token.text.trim();
    const directUrl = html.match(/\/pass_md5\/[^"']+[\s\S]{0,500}?["'](https?:\/\/[^"']+)["']/i)?.[1];
    if (directUrl && tokenText) return [{ ...candidate, url: `${directUrl}${tokenText}`, referer: pageUrl }];
  }


  const nestedServers = protectedDataLinkCandidates(html, pageUrl);
  if (nestedServers.length && depth < 2) {
    const nested = await resolveCandidates(nestedServers, { ...context, referer: pageUrl }, depth + 1);
    if (nested.length) return nested.map((item) => ({ ...item, language: item.language || candidate.language }));
  }



  const nested = embedCandidatesFromHtml(html, pageUrl, { ...candidate, referer: pageUrl })
    .map((item) => ({ ...candidate, ...item, referer: pageUrl }))
    .filter((item) => item.url && item.url !== candidate.url);
  const redirect = html.match(/var\s+url\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]
    || html.match(/window\.location\.replace\(["'](https?:\/\/[^"']+)["']\)/i)?.[1]
    || html.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]
    || (/window\.onload/i.test(html) ? html.match(/["'](https?:\/\/[^"']+)["']/i)?.[1] : '');
  const redirectUrl = absoluteUrl(redirect || '', pageUrl);
  if (redirectUrl && redirectUrl !== candidate.url) nested.push({ ...candidate, url: redirectUrl, referer: pageUrl });
  const nextCandidates = unique(nested, (item) => item.url).slice(0, context.maxNestedCandidates || 4);
  if (nextCandidates.length && depth < 2) {
    const resolved = await mapLimit(nextCandidates, context.parallel || 3, (item) => resolveOne(item, context, depth + 1));
    return resolved.flat();
  }
  return [];
}

export async function resolveCandidates(candidates, context = {}, depth = 0) {
  const list = (candidates || []).filter((candidate) => candidate && /^https?:\/\//i.test(candidate.url || ''))
    .slice(0, context.maxCandidates || 10);
  if (depth > 2) return [];
  const resolved = await mapLimit(list, context.parallel || 3, async (candidate) => {
    const items = await resolveOne({ ...candidate, referer: candidate.referer || context.referer }, context, depth);
    return (items || []).map((item) => makeStream(context.provider || 'Streamflix', item.url, {
      ...item,
      providerId: context.providerId,
      defaultLanguage: item.language || candidate.language || 'es',
      title: item.title || `${item.server || candidate.server || hostName(item.url)} · ${item.language || candidate.language || 'Español'}`,
      referer: item.referer || candidate.referer || context.referer,
      headers: item.headers || { 'User-Agent': USER_AGENT, Referer: item.referer || candidate.referer || context.referer || origin(item.url) + '/' },
    })).filter(Boolean);
  });
  return resolved.flat().filter(Boolean);
}

const SUPPORTED_EMBED_HOST = /streamwish|voe\.|filemoon|vidhide|mp4upload|streamtape|dood|yourupload|uqload|ok\.ru|vimeos?|zilla|vk\.com|mail\.ru|dropload|unlimplay|earnvids|streamhg|videoapp/i;


const VIDHIDE_ALIASES = /(?:^|\.)(?:minochinos\.com|moflix-stream\.click|filelions\.to|dhtpre\.com|peytonepre\.com|dingtezuni\.com|dintezuvio\.com|morencius\.com)$/i;

function isSupportedEmbedUrl(url) {
  const host = String(url || '').match(/^https?:\/\/([^/:?#]+)/i)?.[1] || '';
  return SUPPORTED_EMBED_HOST.test(host) || hosterProfile(url) || packedCaptionHost(url) || isVoeUrl(url) || mixdropHost(url) || /^(?:lamovie\.link|byselapuix\.com)$/i.test(host) || VIDHIDE_ALIASES.test(host) || /(?:^|\.)maxstream\.video$/i.test(host);
}

export function embedCandidatesFromHtml(html, base, defaults = {}) {
  const source = String(html || '');
  const output = dataLinkCandidates(source, base);

  for (const match of source.matchAll(/<iframe\b[^>]*>/gi)) {
    if (adLabeledTag(match[0])) continue;
    const attrs = attributes(match[0]);
    const raw = attrs.src || attrs['data-src'] || attrs['data-lazy-src'] || attrs['data-embed'] || attrs['data-url'];
    const url = absoluteUrl(raw || '', base);
    if (url) output.push({ ...defaults, url });
  }
  for (const anchor of anchors(source)) {
    if (adLabeledTag(anchor.raw.slice(0, anchor.raw.indexOf('>') + 1))) continue;
    const url = absoluteUrl(anchor.href, base);
    if (!url || !isSupportedEmbedUrl(url)) continue;
    output.push({ ...defaults, url, title: anchor.title || defaults.title });
  }

  for (const match of source.matchAll(/<(?:a|button|div|li)\b[^>]*>/gi)) {
    if (adLabeledTag(match[0])) continue;
    const attrs = attributes(match[0]);
    const raw = attrs['data-server-url'] || attrs['data-embed'] || attrs['data-src'] || attrs['data-link'] || attrs['data-url'];
    const url = absoluteUrl(raw || '', base);
    if (!url || (!isPlayableUrl(url) && !isSupportedEmbedUrl(url))) continue;
    output.push({ ...defaults, url, title: attrs.title || attrs['data-server'] || defaults.title });
  }
  return unique(output, (item) => item.url);
}
