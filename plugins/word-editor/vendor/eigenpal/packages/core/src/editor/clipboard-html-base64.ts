const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * ONE strict bounded base64 decoder for the whole clipboard lane: the size cap
 * applies BEFORE any allocation, `=` only in final positions, and unpadded input
 * (browsers accept it) is normalized to padded form first.
 */
export function clipboardDecodeBase64(raw: string, maxBytes: number): Uint8Array | null {
  if (raw.length === 0) return null;
  const remainder = raw.length % 4;
  if (remainder === 1) return null;
  const data = remainder === 0 ? raw : raw + '='.repeat(4 - remainder);
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const byteLength = (data.length / 4) * 3 - padding;
  if (byteLength <= 0 || byteLength > maxBytes) return null;
  const out = new Uint8Array(byteLength);
  let at = 0;
  for (let i = 0; i < data.length; i += 4) {
    let chunk = 0;
    let bits = 0;
    for (let j = 0; j < 4; j += 1) {
      const code = data.charCodeAt(i + j);
      if (code === 0x3d) {
        // `=` only in the final positions.
        if (i + j < data.length - padding) return null;
        continue;
      }
      const value = code < 128 ? BASE64_LOOKUP[code]! : -1;
      if (value < 0) return null;
      chunk = (chunk << 6) | value;
      bits += 6;
    }
    chunk <<= 24 - bits;
    if (bits >= 12) out[at++] = (chunk >>> 16) & 0xff;
    if (bits >= 18) out[at++] = (chunk >>> 8) & 0xff;
    if (bits >= 24) out[at++] = chunk & 0xff;
  }
  return at === byteLength ? out : null;
}

/** Chunked base64 over raw bytes, identical in browser and test hosts. */
export function clipboardBase64Of(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let piece = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    piece += BASE64_ALPHABET[a >> 2]! + BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)]!;
    piece += index + 1 < bytes.length ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)]! : '=';
    piece += index + 2 < bytes.length ? BASE64_ALPHABET[c & 63]! : '=';
    if (piece.length >= 0x8000) {
      chunks.push(piece);
      piece = '';
    }
  }
  chunks.push(piece);
  return chunks.join('');
}
