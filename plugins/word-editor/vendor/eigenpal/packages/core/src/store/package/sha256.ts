// Synchronous platform-neutral SHA-256 over raw bytes.
//
// Lives in the store lane because both trust boundaries that fingerprint bytes sit here:
// media parts (image resources) and embedded fonts hash their payloads before anything
// downstream consumes them. The layout lane re-exports `sha256FontBytes` from
// `font-resource.ts`, which is the direction the lane DAG allows (layout → store).

// Signed 32-bit words throughout. The same bits as unsigned, but V8 keeps an int32 on its fast
// integer path, while an unsigned value past 2^31 (`>>> 0`) becomes a heap number in every
// round. The scratch state is shared: hashing is synchronous and never re-entered.
const SHA256_CONSTANTS = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_INITIAL = new Int32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

// Fixed-size byte encoding avoids eight callback/toString/padStart allocations per digest.
const HEX_BYTES = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'));

const words = new Int32Array(64);
const state = new Int32Array(8);
const tail = new Uint8Array(128);

/** One 64-byte block at `at` of `block` into {@link state}. */
function compress(block: Uint8Array, at: number): void {
  for (let index = 0; index < 16; index += 1) {
    const start = at + index * 4;
    words[index] =
      (block[start]! << 24) |
      (block[start + 1]! << 16) |
      (block[start + 2]! << 8) |
      block[start + 3]!;
  }
  for (let index = 16; index < 64; index += 1) {
    const left = words[index - 15]!;
    const right = words[index - 2]!;
    const sigma0 = ((left >>> 7) | (left << 25)) ^ ((left >>> 18) | (left << 14)) ^ (left >>> 3);
    const sigma1 =
      ((right >>> 17) | (right << 15)) ^ ((right >>> 19) | (right << 13)) ^ (right >>> 10);
    words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) | 0;
  }
  let a = state[0]!;
  let b = state[1]!;
  let c = state[2]!;
  let d = state[3]!;
  let e = state[4]!;
  let f = state[5]!;
  let g = state[6]!;
  let h = state[7]!;
  for (let index = 0; index < 64; index += 1) {
    const sum1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const choice = (e & f) ^ (~e & g);
    const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) | 0;
    const sum0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (sum0 + majority) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) | 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) | 0;
  }
  state[0] = (state[0]! + a) | 0;
  state[1] = (state[1]! + b) | 0;
  state[2] = (state[2]! + c) | 0;
  state[3] = (state[3]! + d) | 0;
  state[4] = (state[4]! + e) | 0;
  state[5] = (state[5]! + f) | 0;
  state[6] = (state[6]! + g) | 0;
  state[7] = (state[7]! + h) | 0;
}

/** Pure-JavaScript SHA-256, the reference every runtime agrees with. Exported for tests. */
export const sha256FontBytesPure = (bytes: Uint8Array): string => {
  state.set(SHA256_INITIAL);
  // Complete blocks hash from the caller's view; only the padding tail is copied.
  const length = bytes.byteLength;
  const fullLength = length - (length % 64);
  for (let offset = 0; offset < fullLength; offset += 64) compress(bytes, offset);
  const remainingLength = length - fullLength;
  const tailLength = remainingLength < 56 ? 64 : 128;
  tail.fill(0, 0, tailLength);
  for (let index = 0; index < remainingLength; index += 1) {
    tail[index] = bytes[fullLength + index]!;
  }
  tail[remainingLength] = 0x80;
  // The length in bits, big-endian, as two 32-bit halves.
  const high = Math.floor(length / 0x20000000);
  const low = length << 3;
  for (let index = 0; index < 4; index += 1) {
    tail[tailLength - 8 + index] = (high >>> (24 - index * 8)) & 0xff;
    tail[tailLength - 4 + index] = (low >>> (24 - index * 8)) & 0xff;
  }
  compress(tail, 0);
  if (tailLength === 128) compress(tail, 64);
  // Join once: retained cache digests must not retain a chain of concatenated strings.
  const result = new Array<string>(33);
  result[0] = 'sha256:';
  for (let index = 0; index < 8; index += 1) {
    const word = state[index]!;
    const start = 1 + index * 4;
    result[start] = HEX_BYTES[word >>> 24]!;
    result[start + 1] = HEX_BYTES[(word >>> 16) & 0xff]!;
    result[start + 2] = HEX_BYTES[(word >>> 8) & 0xff]!;
    result[start + 3] = HEX_BYTES[word & 0xff]!;
  }
  return result.join('');
};

type NativeSha256 = (bytes: Uint8Array) => string;

/**
 * A native SHA-256 when the host has one, or null.
 *
 * The pure-JavaScript block above is correct everywhere and 40 to 80 times slower than the
 * platform's implementation. Layout hashes a token for every node it keys, and font
 * admission hashes every face it trusts, so on a long document the pure path spends more
 * time hashing than shaping. Node exposes `crypto.createHash` synchronously through
 * `process.getBuiltinModule` (20.16+, 22.3+, the engine's own floor) with no import that a
 * browser bundler would have to resolve, and Bun exposes `Bun.CryptoHasher`. Browsers have
 * only the asynchronous `crypto.subtle`, so they keep the pure path. The native answer is
 * checked against a known vector once; a runtime whose hasher disagrees falls back.
 */
function detectNativeSha256(): NativeSha256 | null {
  const host = globalThis as {
    Bun?: {
      CryptoHasher?: new (algorithm: string) => {
        update(b: Uint8Array): { digest(e: 'hex'): string };
      };
    };
    process?: { getBuiltinModule?: (id: string) => unknown };
  };
  let candidate: NativeSha256 | null = null;
  try {
    const Hasher = host.Bun?.CryptoHasher;
    if (Hasher) {
      candidate = (bytes) => new Hasher('sha256').update(bytes).digest('hex');
    } else if (typeof host.process?.getBuiltinModule === 'function') {
      const crypto = host.process.getBuiltinModule('node:crypto') as
        | { createHash?: (a: string) => { update(b: Uint8Array): { digest(e: 'hex'): string } } }
        | undefined;
      const createHash = crypto?.createHash;
      if (typeof createHash === 'function')
        candidate = (bytes) => createHash('sha256').update(bytes).digest('hex');
    }
    if (!candidate) return null;
    // FIPS 180-4 test vector for "abc".
    const probe = candidate(new Uint8Array([0x61, 0x62, 0x63]));
    return probe === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      ? candidate
      : null;
  } catch {
    return null;
  }
}

const nativeSha256 = detectNativeSha256();

/** Whether this runtime hashes natively. Exported for tests and diagnostics. */
export const sha256IsNative = nativeSha256 !== null;

/** Synchronous platform-neutral SHA-256 used before font bytes cross into a shaping implementation. */
export const sha256FontBytes: (bytes: Uint8Array) => string = nativeSha256
  ? (bytes) => `sha256:${nativeSha256(bytes)}`
  : sha256FontBytesPure;

/** Hash owned bytes without blocking browser input when Web Crypto is available. @internal */
export async function sha256OwnedFontBytesAsync(bytes: Uint8Array): Promise<string> {
  if (nativeSha256) return sha256FontBytes(bytes);
  try {
    const host = globalThis as {
      crypto?: { subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
    };
    const subtle = host.crypto?.subtle;
    if (subtle) {
      const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
      const result = new Array<string>(digest.length + 1);
      result[0] = 'sha256:';
      for (let index = 0; index < digest.length; index += 1) {
        result[index + 1] = HEX_BYTES[digest[index]!]!;
      }
      return result.join('');
    }
  } catch {
    // An unavailable crypto provider keeps the synchronous verification path.
  }
  return sha256FontBytes(bytes);
}
