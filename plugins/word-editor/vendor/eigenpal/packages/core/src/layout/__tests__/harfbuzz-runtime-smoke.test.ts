import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  harfBuzzFontValidator,
  sha256FontBytes,
  type FontRequest,
} from '../index.ts';
import {
  createHarfBuzzParityValue,
  type HarfBuzzParityValue,
} from './fixtures/harfbuzz-parity-fixture.ts';
import { HARFBUZZ_PARITY_GOLDEN_JSON } from './fixtures/harfbuzz-parity-golden.ts';

const REQUEST: FontRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' };

test('matches the canonical server golden in a module worker', async () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: REQUEST,
        id: 'dejavu-sans-regular',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const font = snapshot.resolve(REQUEST);
  if (font instanceof FontResolutionError) throw font;
  const serverValue = createHarfBuzzParityValue(font);
  const worker = new Worker(new URL('./fixtures/harfbuzz-browser-worker.ts', import.meta.url), {
    type: 'module',
  });
  const result = await new Promise<{
    status: 'complete';
    parity: HarfBuzzParityValue | null;
    error: string | null;
  }>((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data.status === 'ready') {
        const transferred = bytes.slice();
        worker.postMessage(transferred.buffer, [transferred.buffer]);
      } else resolve(event.data);
    };
    worker.onerror = reject;
  });
  worker.terminate();

  expect(result.error).toBeNull();
  expect(JSON.stringify(serverValue)).toBe(HARFBUZZ_PARITY_GOLDEN_JSON);
  expect(JSON.stringify(result.parity)).toBe(HARFBUZZ_PARITY_GOLDEN_JSON);
  expect(serverValue).toMatchObject({
    schemaVersion: 1,
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  });
  expect(serverValue.cases.ltr.environmentFingerprint).toContain(
    `"shapingLibrary":{"name":"HarfBuzz","version":"${HARFBUZZ_SHAPING_LIBRARY.version}"}`
  );
  expect(serverValue.cases.ltr.comparator).toMatchObject({
    text: 'office x\u0301',
    direction: 'ltr',
    script: 'Latn',
    language: 'en',
    bidiLevel: 0,
    fontSpans: [
      {
        glyphStart: 0,
        glyphEnd: 7,
        fallbackIndex: null,
        font: {
          identity: font.identity,
          id: 'dejavu-sans-regular',
          family: 'DejaVu Sans',
          request: REQUEST,
          hash: font.hash,
          faceIndex: 0,
          byteLength: font.byteLength,
          substitution: null,
        },
      },
    ],
    metrics: { ascent: 713, descent: 181, lineGap: 0 },
  });
  expect(serverValue.cases.ltr.comparator.glyphs.find(({ id }) => id === 690)).toMatchObject({
    id: 690,
    cluster: 8,
    advanceX: 0,
    advanceY: 0,
    offsetX: -34,
    offsetY: 0,
    originX: 2807,
    originY: 0,
    outline: { unitsPerEm: 2048, path: expect.stringContaining('M-375,1638') },
  });
  expect(
    serverValue.cases.ltr.comparator.clusters.find(({ textStart }) => textStart === 8)
  ).toEqual({
    textStart: 8,
    textEnd: 9,
    glyphStart: 6,
    glyphEnd: 7,
    advance: 0,
    caretEdges: [0, 0],
    fontSpan: 0,
  });
  expect(serverValue.cases.rtl.comparator).toMatchObject({
    text: 'سلام',
    direction: 'rtl',
    script: 'Arab',
    language: 'ar',
    bidiLevel: 1,
  });
});
