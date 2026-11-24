import { expect, test } from 'bun:test';
import { composeFontOrigins, defineFontResolver } from '../font-resolver.ts';
import {
  FontResolutionError,
  boundedStructuralFontValidator,
  createFontResourceSnapshot,
  prepareFontResourceDefinitionAsync,
  sha256FontBytes,
} from '../font-resource.ts';

function source() {
  const bytes = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return {
    id: 'async-font',
    request: { family: 'Async Face', weight: 400, style: 'normal' as const },
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  };
}

test('async font preparation owns bytes and metadata before yielding', async () => {
  const input = source();
  const expected = input.bytes.slice();
  const pending = prepareFontResourceDefinitionAsync(input);
  input.bytes.fill(255);
  input.request.family = 'Changed';
  input.hash = 'changed';
  const prepared = await pending;
  expect(prepared.bytes).toEqual(expected);
  expect(prepared.request.family).toBe('Async Face');
  expect(prepared.actualHash).toBe(sha256FontBytes(expected));
  expect(prepared.hash).toBe(prepared.actualHash);
});

test('async preparation preserves hash mismatch refusals without hashing twice', async () => {
  const input = source();
  input.hash = sha256FontBytes(new Uint8Array([1]));
  const prepared = await prepareFontResourceDefinitionAsync(input);
  let hashes = 0;
  const fonts = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 1024,
    resources: [prepared],
    validateFont: boundedStructuralFontValidator,
    instrumentation: { onHash: () => hashes++ },
  });
  const result = fonts.resolve(input.request);
  expect(result).toBeInstanceOf(FontResolutionError);
  expect((result as FontResolutionError).code).toBe('hashMismatch');
  expect(hashes).toBe(0);
});

test('cancellation before origin commit releases reserved bytes and skips later origins', async () => {
  // Bun hashes synchronously. The await in origin validation exposes the abort boundary;
  // this test does not exercise a pending browser Web Crypto digest.
  const controller = new AbortController();
  const reason = new Error('document replaced');
  let reserved = 0;
  let released = 0;
  let fallbacks = 0;
  const pending = composeFontOrigins(
    [
      { sources: [source()] },
      defineFontResolver(() => {
        fallbacks += 1;
        return undefined;
      }),
    ],
    { families: ['Async Face'], defaultFamily: 'Async Face', signal: controller.signal },
    {
      reserveOwnedBytes: () => {
        reserved += 1;
        return () => released++;
      },
    }
  );
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(reserved).toBe(1);
  expect(released).toBe(1);
  expect(fallbacks).toBe(0);
});
