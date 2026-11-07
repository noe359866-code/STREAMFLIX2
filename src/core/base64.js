export function decodeBase64Binary(value) {
  let input = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (input.length % 4) input += '=';
  return atob(input);
}

export function decodeBase64(value) {
  const binary = decodeBase64Binary(value);
  if (typeof TextDecoder !== 'undefined') {
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    try { return new TextDecoder('utf-8').decode(bytes); } catch (_) {                }
  }
  try { return decodeURIComponent(binary.split('').map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')); }
  catch (_) { return binary; }
}

export function decodeBase64Url(value) {
  try {
    const decoded = decodeBase64(value).trim();
    const match = decoded.match(/https?:\/\/[^\s<>"']+/i);
    return match ? match[0].replace(/\\\//g, '/') : '';
  } catch (_) { return ''; }
}

export function decodeTokenLink(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(decodeBase64(parts[1]));
    return payload.link || payload.url || '';
  } catch (_) { return ''; }
}
