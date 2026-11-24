import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function scenario(name: 'count' | 'bytes') {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./fixtures/font-shaping-cache-worker.ts', import.meta.url)), name],
    { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true }
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

test('default and explicit hosts share the actual 32-configuration ceiling', () => {
  expect(scenario('count')).toEqual({ accepted: 32, refused: 33, existingViewRetained: true });
}, 20_000);

test('execution-policy views retain the actual aggregate font-byte ceiling and release failed reservations', () => {
  expect(scenario('bytes')).toEqual({ acceptedLarge: 7, refusedLarge: 8, smallAfterRefusal: true });
}, 20_000);
