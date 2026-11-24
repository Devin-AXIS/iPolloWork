import { expect, test } from 'bun:test';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// An isolated browser-like global keeps native Bun and Node hashing out of these tests.
// This harness requires sha256.ts to remain import-free. If it gains imports, replace
// this single-file transform with an isolated module loader that resolves its dependencies.
const source = new Bun.Transpiler({ loader: 'ts' })
  .transformSync(readFileSync(new URL('../package/sha256.ts', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');
function browserHash(crypto?: unknown): (bytes: Uint8Array) => Promise<string> {
  return runInNewContext(`${source}\nsha256OwnedFontBytesAsync`, { crypto });
}
const reference = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('browser async hashing uses Web Crypto for exact byte views', async () => {
  let calls = 0;
  const hash = browserHash({
    subtle: {
      digest(algorithm: string, bytes: Uint8Array) {
        calls += 1;
        return webcrypto.subtle.digest(algorithm, bytes);
      },
    },
  });
  for (const length of [0, 1, 55, 56, 63, 64, 65, 4096, 70_000]) {
    const storage = new Uint8Array(length + 17);
    for (let index = 0; index < storage.length; index += 1) storage[index] = index % 251;
    const view = storage.subarray(7, length + 7);
    expect(await hash(view)).toBe(reference(view));
  }
  expect(calls).toBe(9);
});

test('missing or rejected Web Crypto retains SHA-256 verification', async () => {
  const bytes = new TextEncoder().encode('abc');
  const rejected = browserHash({
    subtle: { digest: () => Promise.reject(new Error('unavailable')) },
  });
  expect(await rejected(bytes)).toBe(reference(bytes));
  expect(await browserHash()(bytes)).toBe(reference(bytes));
});
