// Fonts the document carries with it (task 7.7).

import { describe, expect, test } from 'bun:test';
import { deobfuscateFont } from '../package/embedded-fonts.ts';

describe('embedded-font deobfuscation follows ECMA-376 Part 4 §2.8.1', () => {
  // The spec's own worked example. Byte order is the whole difficulty here: a GUID is
  // normally read per-group little-endian, and doing that produces a key that is wrong in
  // exactly the bytes that matter, so the font comes out looking damaged rather than
  // obfuscated — indistinguishable from a corrupt file at the point it fails.
  const GUID = '001B70DC-AA60-4AD5-90EC-18A0948E1EAE';
  const EXPECTED_KEY = [
    0xae, 0x1e, 0x8e, 0x94, 0xa0, 0x18, 0xec, 0x90, 0xd5, 0x4a, 0x60, 0xaa, 0xdc, 0x70, 0x1b, 0x00,
  ];

  test('the key is the GUID bytes REVERSED', () => {
    // Recovered by deobfuscating zeros: XOR with zero yields the key itself.
    const zeros = new Uint8Array(32);
    const out = deobfuscateFont(zeros, GUID)!;
    expect([...out.slice(0, 16)]).toEqual(EXPECTED_KEY);
  });

  test('the key is applied TWICE across the 32-byte header', () => {
    const zeros = new Uint8Array(32);
    const out = deobfuscateFont(zeros, GUID)!;
    expect([...out.slice(16, 32)]).toEqual(EXPECTED_KEY);
  });

  test('bytes past the header are untouched, since only the header is obfuscated', () => {
    const bytes = new Uint8Array(64);
    bytes.fill(0x7f, 32);
    const out = deobfuscateFont(bytes, GUID)!;
    expect([...out.slice(32)]).toEqual([...bytes.slice(32)]);
  });

  test('it is its own inverse, because the scheme is a pure XOR', () => {
    const original = new Uint8Array(48).map((_, index) => (index * 37) % 256);
    const round = deobfuscateFont(deobfuscateFont(original, GUID)!, GUID)!;
    expect([...round]).toEqual([...original]);
  });

  test('braces and hyphens are accepted, since Word writes both forms', () => {
    const zeros = new Uint8Array(32);
    const braced = deobfuscateFont(zeros, `{${GUID}}`)!;
    const bare = deobfuscateFont(zeros, GUID.replace(/-/g, ''))!;
    expect([...braced]).toEqual([...bare]);
  });

  test('a malformed key is refused rather than producing plausible garbage', () => {
    const zeros = new Uint8Array(32);
    expect(deobfuscateFont(zeros, 'not-a-guid')).toBeNull();
    expect(deobfuscateFont(zeros, '')).toBeNull();
    expect(deobfuscateFont(zeros, '00'.repeat(8))).toBeNull();
  });

  test('a font shorter than the header does not read past its end', () => {
    const short = new Uint8Array(8);
    expect(deobfuscateFont(short, GUID)!.length).toBe(8);
  });
});
