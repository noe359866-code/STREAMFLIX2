export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// El bridge de Nuvio no es un navegador: conservamos solo cookies de sesión por dominio.
const cookieJar = new Map();
function urlParts(url) {
  const match = String(url || '').match(/^https?:\/\/([^/]+)([^?#]*)/i);
  return match ? { host: match[1].toLowerCase(), path: match[2] || '/' } : { host: '', path: '/' };
}
export function cookieHeader(url) {
  const { host, path } = urlParts(url);
  const pairs = [];
  for (const [domain, cookies] of cookieJar) {
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    for (const [name, cookie] of cookies) {
      if (cookie.expires && cookie.expires < Date.now()) { cookies.delete(name); continue; }
      if (path.startsWith(cookie.path || '/')) pairs.push(`${name}=${cookie.value}`);
    }
  }
  return pairs.join('; ');
}
export function cookieValue(url, name) {
  const header = cookieHeader(url);
  return header.split(/;\s*/).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
function storeCookies(url, headers) {
  const { host, path } = urlParts(url);
  if (!host || !headers) return;
  const raw = typeof headers.get === 'function' ? headers.get('set-cookie') : (headers['set-cookie'] || headers['Set-Cookie']);
  if (!raw) return;
  for (const line of String(raw).split(/,(?=[^;,]+=)/)) {
    const parts = line.split(';').map((part) => part.trim());
    const separator = parts[0].indexOf('=');
    if (separator < 1) continue;
    const name = parts[0].slice(0, separator);
    const value = parts[0].slice(separator + 1);
    const attrs = Object.fromEntries(parts.slice(1).map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index < 0 ? part.length : index).toLowerCase(), index < 0 ? '' : part.slice(index + 1)];
    }));
    const domain = (attrs.domain || host).replace(/^\./, '').toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (!cookieJar.has(domain)) cookieJar.set(domain, new Map());
    const maxAge = Number(attrs['max-age']);
    const expires = Number.isFinite(maxAge) && attrs['max-age'] !== undefined
      ? Date.now() + maxAge * 1000
      : (attrs.expires ? Date.parse(attrs.expires) : 0);
    if (maxAge <= 0 && attrs['max-age'] !== undefined) cookieJar.get(domain).delete(name);
    else cookieJar.get(domain).set(name, { value, path: attrs.path || path.replace(/\/[^/]*$/, '/') || '/', expires });
  }
}

export function origin(url) {
  const match = String(url || '').match(/^https?:\/\/[^/]+/i);
  return match ? match[0] : '';
}

export function withQuery(url, params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

export function requestHeaders(referer, extra = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6',
    ...extra,
  };
  if (referer) headers.Referer = referer;
  return headers;
}

export async function request(url, options = {}) {
  const timeoutMs = Math.max(500, Math.min(options.timeoutMs || 12000, 45000));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo agotado (${timeoutMs} ms)`)), timeoutMs);
  });
  try {
    const headers = { ...(options.headers || requestHeaders(options.referer, options.extraHeaders)) };
    const hasCookie = Object.keys(headers).some((key) => key.toLowerCase() === 'cookie');
    const cookies = options.cookies === false ? '' : cookieHeader(url);
    if (cookies && !hasCookie) headers.Cookie = cookies;
    const response = await Promise.race([
      fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        redirect: 'follow',
      }),
      timeout,
    ]);
    storeCookies(response.url || url, response.headers);
    const text = await Promise.race([response.text(), timeout]);
    const result = {
      status: response.status || 0,
      ok: response.ok !== undefined ? response.ok : response.status >= 200 && response.status < 300,
      url: response.url || url,
      text,
      headers: response.headers,
    };
    if (!result.ok && !options.allowError) {
      const error = new Error(`HTTP ${result.status} en ${url}`);
      error.response = result;
      throw error;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchText(url, options = {}) {
  const response = await request(url, options);
  if (/just a moment|cf-browser-verification|challenge-running|attention required/i.test(response.text)
    && !/#[[]?EXTM3U|<article|<!doctype html[^>]*>[\s\S]{500,}/i.test(response.text)) {
    const error = new Error(`Protección anti-bot en ${url}`);
    error.response = response;
    throw error;
  }
  return response;
}

export async function fetchJson(url, options = {}) {
  const response = await request(url, {
    ...options,
    extraHeaders: { Accept: 'application/json, text/plain, */*', ...(options.extraHeaders || {}) },
  });
  try {
    return { ...response, data: JSON.parse(response.text) };
  } catch (_) {
    throw new Error(`JSON inválido en ${url}: ${response.text.slice(0, 120)}`);
  }
}

export async function postJson(url, payload, options = {}) {
  return fetchJson(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
    extraHeaders: { 'Content-Type': 'application/json', ...(options.extraHeaders || {}) },
  });
}

export async function postForm(url, payload, options = {}) {
  const body = Object.keys(payload || {}).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(payload[key]))}`).join('&');
  return fetchJson(url, {
    ...options,
    method: 'POST',
    body,
    extraHeaders: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(options.extraHeaders || {}) },
  });
}

export function settled(promises) {
  return Promise.all(promises.map((promise) => Promise.resolve(promise).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  )));
}

export async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try { output[index] = await mapper(items[index], index); } catch (_) { output[index] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return output;
}
