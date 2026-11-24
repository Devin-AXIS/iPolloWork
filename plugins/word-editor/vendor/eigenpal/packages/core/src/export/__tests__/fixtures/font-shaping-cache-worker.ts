import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_RUN_STYLE,
  prepareLayoutFontConfiguration,
  sha256FontBytes,
} from '../../../layout/index.ts';
import { acquireSharedExportShaping } from '../../shared-export-shaping.ts';

const regular = new Uint8Array(
  readFileSync(new URL('../../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
function configuration(index: number, bytes = regular) {
  const family = `Public Cache Face ${index}`;
  return prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 20 * 2 ** 20,
    sources: [
      {
        request: { family, weight: 400, style: 'normal' },
        id: `public-cache-face-${index}`,
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family, sizeHalfPoints: 24 },
  });
}

if (process.argv[2] === 'count') {
  const first = configuration(0);
  const firstView = await acquireSharedExportShaping(first);
  assert(
    firstView.createMeasurer().measure('office AV', {
      ...DEFAULT_RUN_STYLE,
      fontFamily: 'Public Cache Face 0',
    }) > 0
  );
  for (let index = 1; index < 32; index++) {
    await acquireSharedExportShaping(
      configuration(index),
      undefined,
      index % 2 ? { maxFontBytes: 20 * 2 ** 20 } : undefined
    );
  }
  await assert.rejects(
    acquireSharedExportShaping(configuration(32)),
    /limited to 32 process-wide configurations/
  );
  assert.equal(await acquireSharedExportShaping(first), firstView);
  console.log(JSON.stringify({ accepted: 32, refused: 33, existingViewRetained: true }));
} else if (process.argv[2] === 'bytes') {
  const large = new Uint8Array(16 * 2 ** 20 + 1);
  large.set(regular);
  for (let index = 0; index < 3; index++) {
    const prepared = configuration(index, large);
    const explicit = await acquireSharedExportShaping(prepared, undefined, {
      maxFontBytes: 20 * 2 ** 20,
    });
    const defaults = await acquireSharedExportShaping(prepared);
    assert.notEqual(explicit, defaults);
    const style = { ...DEFAULT_RUN_STYLE, fontFamily: `Public Cache Face ${index}` };
    assert(explicit.createMeasurer().measure('office AV', style) > 0);
    assert(defaults.createMeasurer().measure('office AV', style) > 0);
  }
  const final = configuration(3, large);
  await acquireSharedExportShaping(final, undefined, { maxFontBytes: 20 * 2 ** 20 });
  // Seven distinct policy/configuration substrates retain 112 MiB plus seven bytes.
  // An eighth would exceed the original 128 MiB process-wide ceiling.
  await assert.rejects(
    acquireSharedExportShaping(final),
    /font bytes are limited to 134217728 process-wide/
  );
  // A failed reservation leaves room for an independent small admitted configuration.
  const small = await acquireSharedExportShaping(configuration(4));
  assert(
    small.createMeasurer().measure('office', {
      ...DEFAULT_RUN_STYLE,
      fontFamily: 'Public Cache Face 4',
    }) > 0
  );
  console.log(JSON.stringify({ acceptedLarge: 7, refusedLarge: 8, smallAfterRefusal: true }));
} else {
  throw new Error('Unknown public cache scenario');
}
