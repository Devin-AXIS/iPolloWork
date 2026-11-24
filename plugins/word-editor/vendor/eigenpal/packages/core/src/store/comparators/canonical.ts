// Canonical serialization + stable fingerprinting for artifact comparators
// (document-engine task 0.4). Canonicalization sorts object keys, preserves
// array order (significant), and drops declared ephemera so equivalent artifacts
// hash identically across runtimes. The fingerprint is a pure-JS 64-bit FNV-1a
// (no crypto/DOM dependency) — a convenience over the canonical bytes, never a
// substitute for the byte comparison itself.

/** Any JSON value. The domain canonicalization and stable hashing operate over. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Produce a canonical string for `value`, dropping any object key whose name is
 * in `ephemera` at any depth. Numbers are emitted losslessly; -0 normalizes to 0;
 * non-finite numbers are rejected (they must never enter a comparator input).
 */
export function canonicalize(value: unknown, ephemera: ReadonlySet<string> = new Set()): string {
  const seen = new WeakSet<object>();
  // The path to the value being encoded, so a rejected input names the field at fault.
  const path: (string | number)[] = [];
  const enc = (v: unknown): string => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') {
      const n = v as number;
      if (!Number.isFinite(n)) throw new Error(`non-finite number is not comparable: ${n}`);
      return Object.is(n, -0) ? '0' : String(n);
    }
    if (t === 'string') return JSON.stringify(v);
    if (t === 'bigint') return `${(v as bigint).toString()}n`;
    if (Array.isArray(v)) {
      return `[${v
        .map((item, index) => {
          path.push(index);
          try {
            return enc(item);
          } finally {
            path.pop();
          }
        })
        .join(',')}]`;
    }
    if (t === 'object') {
      const obj = v as Record<string, unknown>;
      if (seen.has(obj)) throw new Error('cannot canonicalize a cyclic structure');
      seen.add(obj);
      const keys = Object.keys(obj)
        .filter((k) => !ephemera.has(k))
        .sort();
      const body = keys
        .map((k) => {
          path.push(k);
          try {
            return `${JSON.stringify(k)}:${enc(obj[k])}`;
          } finally {
            path.pop();
          }
        })
        .join(',');
      seen.delete(obj);
      return `{${body}}`;
    }
    const at = path.length > 0 ? ` at ${path.map(String).join('.')}` : '';
    throw new Error(`unsupported value type in comparator input: ${t}${at}`);
  };
  return enc(value);
}

/** 64-bit FNV-1a over the canonical form, returned as a 16-char hex string. */
export function stableHash(value: unknown, ephemera?: ReadonlySet<string>): string {
  return fnv1a64Hex(canonicalize(value, ephemera));
}

/**
 * 64-bit FNV-1a over UTF-16 code units, as two 32-bit halves.
 *
 * The same digest as the BigInt form `hash = ((hash ^ c) * 0x100000001b3) mod 2^64`, without
 * allocating a BigInt per character: layout keys hash whole documents' worth of text.
 * The prime is 2^40 + 0x1b3, so the product is `lo * 0x1b3` plus `hi * 0x1b3` and `lo << 8`
 * in the high word. Every intermediate stays below 2^53, so the double arithmetic is exact.
 */
export function fnv1a64Hex(s: string): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let i = 0; i < s.length; i++) {
    lo = (lo ^ s.charCodeAt(i)) >>> 0;
    const low = lo * 0x1b3;
    const carry = Math.floor(low / 0x100000000);
    hi = (Math.imul(hi, 0x1b3) + Math.imul(lo, 0x100) + carry) >>> 0;
    lo = low >>> 0;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}
