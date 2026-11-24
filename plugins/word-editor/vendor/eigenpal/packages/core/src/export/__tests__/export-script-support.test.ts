import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ResolvedFont } from '../../layout/font-resource.ts';
import { fontDeclaresScript, orderFacesForScript } from '../export-script-support.ts';

const face = (bytes: Uint8Array, faceIndex = 0) =>
  ({ bytes, faceIndex }) as unknown as ResolvedFont;
const dejaVu = face(
  new Uint8Array(
    readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  )
);

test('reads the GSUB script list of a real face', () => {
  expect(fontDeclaresScript(dejaVu, 'Arab')).toBe(true);
  expect(fontDeclaresScript(dejaVu, 'Hebr')).toBe(true);
  expect(fontDeclaresScript(dejaVu, 'Deva')).toBe(false);
});

test('malformed or truncated bytes declare nothing and never throw', () => {
  for (const bytes of [
    new Uint8Array(0),
    new Uint8Array(12),
    dejaVu.bytes.slice(0, 40),
    new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0xff, 0xff, 0xff, 0xff]),
  ]) {
    expect(fontDeclaresScript(face(bytes), 'Arab')).toBe(false);
  }
});

test('faces that declare the script move first, and nothing moves when none does', () => {
  const plain = face(new Uint8Array(12));
  expect(orderFacesForScript([plain, dejaVu], 'Arab')).toEqual([dejaVu, plain]);
  const unchanged = [plain, dejaVu];
  expect(orderFacesForScript(unchanged, 'Deva')).toBe(unchanged);
});
