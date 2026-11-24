import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { sha256FontBytes, sha256FontBytesPure, sha256IsNative } from '../package/sha256.ts';

describe('sha256FontBytes', () => {
  test('matches the FIPS 180-4 vectors', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(sha256FontBytesPure(text(''))).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(sha256FontBytesPure(text('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256FontBytes(text('abc'))).toBe(sha256FontBytesPure(text('abc')));
  });

  test('the native path, when the host has one, agrees with the pure path byte for byte', () => {
    // Bun always has a native hasher, so this exercises the fast path in the test suite.
    expect(sha256IsNative).toBe(true);
    for (const length of [0, 1, 55, 56, 63, 64, 65, 1000, 4096, 70_000]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 7919 + length) & 0xff;
      expect(sha256FontBytes(bytes)).toBe(sha256FontBytesPure(bytes));
    }
    // A subarray view hashes the view, not the whole buffer beneath it.
    const buffer = new Uint8Array(200).fill(9);
    const view = buffer.subarray(50, 120);
    expect(sha256FontBytes(view)).toBe(sha256FontBytesPure(view));
    expect(sha256FontBytes(view)).not.toBe(sha256FontBytes(buffer));
  });
  test('the pure path agrees with node:crypto at every block boundary and on random input', () => {
    // A seeded generator, so a failure names input that reproduces.
    let seed = 0x9e3779b9;
    const next = (): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    const reference = (bytes: Uint8Array) =>
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const lengths: number[] = [];
    // Every length through three blocks covers each padding branch: the length field in the
    // last block, or pushed into a block of its own.
    for (let length = 0; length <= 192; length++) lengths.push(length);
    for (const blocks of [7, 8, 63, 64, 1023, 1024, 16_384]) {
      for (const delta of [-9, -8, -1, 0, 1, 55, 56]) lengths.push(blocks * 64 + delta);
    }
    for (const length of lengths) {
      for (const fill of ['random', 'zero', 'ones'] as const) {
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
          bytes[i] = fill === 'random' ? next() & 0xff : fill === 'ones' ? 0xff : 0;
        }
        expect(sha256FontBytesPure(bytes)).toBe(reference(bytes));
      }
    }
    // The block state is shared between calls: a hash between two equal ones changes nothing.
    const first = new Uint8Array(300).map(() => next() & 0xff);
    const second = new Uint8Array(77).map(() => next() & 0xff);
    const before = sha256FontBytesPure(first);
    expect(sha256FontBytesPure(second)).toBe(reference(second));
    expect(sha256FontBytesPure(first)).toBe(before);
  });

  test('large caller views require at most 128 bytes of padding storage', () => {
    const storage = new Uint8Array(1024 * 1024 + 80);
    for (let index = 0; index < storage.length; index++) storage[index] = (index * 7919) & 0xff;
    const original = storage.slice();
    const inputs = [0, 55, 56, 63].map((remainder) =>
      storage.subarray(7, 7 + 1024 * 1024 + remainder)
    );
    const expected = inputs.map((bytes) => sha256FontBytes(bytes));
    const allocations: number[] = [];
    const Constructor = globalThis.Uint8Array;
    const tracked = new Proxy(Constructor, {
      construct(target, args, newTarget) {
        const result = Reflect.construct(target, args, newTarget) as Uint8Array;
        allocations.push(result.byteLength);
        return result;
      },
    });
    let digests: string[];
    try {
      globalThis.Uint8Array = tracked;
      digests = inputs.map((bytes) => sha256FontBytesPure(bytes));
    } finally {
      globalThis.Uint8Array = Constructor;
    }
    expect(digests).toEqual(expected);
    // The padding uses shared scratch storage; nothing copies the caller's view.
    expect(allocations.every((size) => size <= 128)).toBe(true);
    expect(storage).toEqual(original);
  });
});
