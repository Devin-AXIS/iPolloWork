// A refused embedded face must not disable a working substitute for the same family.
//
// `composeFontConfiguration` drops a substitution whenever a DIRECT source exists for
// that family — correct on its own terms, since a real face beats a stand-in. But it
// runs BEFORE validation, so it cannot know the direct source is garbage. Left alone, a
// damaged or crafted embedded "Calibri" makes every Calibri run measure on the fixed
// estimator even though validated, metric-compatible bytes are loaded: strictly worse
// than the file embedding nothing at all.
//
// The editor's answer is to recompose once without the faces the validator refused.
// These tests pin both halves of that: the hazard, and that dropping the refused source
// brings the substitution back.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FontResolutionError, sha256FontBytes } from '../../layout/index.ts';
import { createLayoutShaping } from '../font-configuration.ts';
import { composeFontConfiguration } from '../font-composition.ts';
import type { FontSource } from '../../contracts/editor.ts';

const realBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);

/** The app's own admitted stand-in, plus Calibri mapped onto it. */
const APP_FRAGMENT = {
  sources: [
    {
      request: { family: 'Substitute Sans', weight: 400, style: 'normal' },
      id: 'app:substitute',
      bytes: realBytes,
      hash: sha256FontBytes(realBytes),
      faceIndex: 0,
    },
  ] as readonly FontSource[],
  substitutions: [
    {
      from: { family: 'Calibri', weight: 400, style: 'normal' },
      to: { family: 'Substitute Sans', weight: 400, style: 'normal' },
    },
  ],
};

const garbage = new Uint8Array(4096).fill(0x42);
const REFUSED_EMBED: readonly FontSource[] = [
  {
    request: { family: 'Calibri', weight: 400, style: 'normal' },
    id: 'embedded:/word/fonts/font1.odttf#regular',
    bytes: garbage,
    hash: sha256FontBytes(garbage),
    faceIndex: 0,
  },
];

const CALIBRI = { family: 'Calibri', weight: 400, style: 'normal' } as const;

describe('refused embedded face vs configured substitution', () => {
  test('the hazard: composing WITH the refused face strands Calibri on the fallback', async () => {
    const fonts = composeFontConfiguration(APP_FRAGMENT, { sources: REFUSED_EMBED });
    // The substitution was dropped because a direct Calibri source existed…
    expect(fonts.substitutions ?? []).toHaveLength(0);
    const shaping = await createLayoutShaping(fonts);
    // …and that direct source does not survive validation, so Calibri resolves to nothing.
    expect(shaping.fonts.resolve(CALIBRI)).toBeInstanceOf(FontResolutionError);
  });

  test('the fix: recomposing without the refused face restores the substitution', async () => {
    const fonts = composeFontConfiguration(APP_FRAGMENT, { sources: [] });
    expect(fonts.substitutions ?? []).toHaveLength(1);
    const shaping = await createLayoutShaping(fonts);
    const resolved = shaping.fonts.resolve(CALIBRI);
    expect(resolved).not.toBeInstanceOf(FontResolutionError);
    // Resolved through to the stand-in's actual bytes.
    expect((resolved as { hash: string }).hash).toBe(sha256FontBytes(realBytes));
  });
});
