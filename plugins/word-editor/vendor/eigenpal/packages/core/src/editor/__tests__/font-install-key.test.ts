import { expect, test } from 'bun:test';
import { fontInstallKey } from '../font-install-key.ts';
import type { FontConfiguration, FontSource } from '../../contracts/editor.ts';

const source = (family: string, hash: string): FontSource => ({
  request: { family, weight: 400, style: 'normal' },
  id: family,
  bytes: new Uint8Array([1]),
  hash,
  faceIndex: 0,
});
const config = (sources: FontSource[], substitutions: FontConfiguration['substitutions'] = []) =>
  ({ epoch: 1, maxFontBytes: 1000, sources, substitutions }) as FontConfiguration;

test('the same faces in another order and another epoch install the same fonts', () => {
  const a = config([source('A', 'a'), source('B', 'b')]);
  const b = { ...config([source('B', 'b'), source('A', 'a')]), epoch: 2 } as FontConfiguration;
  expect(fontInstallKey(a)).toBe(fontInstallKey(b));
});

test('a new face, new bytes, or a new substitution installs again', () => {
  const base = fontInstallKey(config([source('A', 'a')]));
  expect(fontInstallKey(config([source('A', 'a'), source('B', 'b')]))).not.toBe(base);
  expect(fontInstallKey(config([source('A', 'z')]))).not.toBe(base);
  expect(
    fontInstallKey(
      config(
        [source('A', 'a')],
        [
          {
            from: { family: 'X', weight: 400, style: 'normal' },
            to: { family: 'A', weight: 400, style: 'normal' },
          },
        ]
      )
    )
  ).not.toBe(base);
});
