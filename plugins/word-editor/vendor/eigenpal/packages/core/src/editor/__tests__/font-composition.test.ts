// Composition of font origins into one FontConfiguration (font-resolution-overhaul 1.1).
//
// What these pin down: first-wins precedence by (family, weight, style), the
// source-beats-substitution filter, first-wins substitution concatenation, defaults for
// the omitted base fields, and a frozen result — the invariants every origin (explicit
// bytes, embedded faces, substitute packages, fetched fonts) composes under.

import { describe, expect, test } from 'bun:test';
import type { FontSource } from '../../contracts/editor.ts';
import { DEFAULT_FONT, WORD_DEFAULT_FONT, composeFontConfiguration } from '../font-composition.ts';
import { HARD_MAX_FONT_BYTES } from '../../layout/index.ts';

const face = (
  family: string,
  weight: number,
  style: 'normal' | 'italic',
  marker: number
): FontSource => ({
  request: { family, weight, style },
  id: `${family}-${weight}-${style}-${marker}`,
  bytes: new Uint8Array([marker]),
  hash: `sha256:${marker}`,
  faceIndex: 0,
});

describe('composeFontConfiguration', () => {
  test('sources dedupe first-wins in argument order', () => {
    const explicit = face('Calibri', 400, 'normal', 1);
    const embedded = face('Calibri', 400, 'normal', 2);
    const other = face('Arial', 400, 'normal', 3);
    const composed = composeFontConfiguration(
      { sources: [explicit] },
      { sources: [embedded, other] }
    );
    expect(composed.sources).toHaveLength(2);
    expect(composed.sources[0]!.id).toBe(explicit.id);
    expect(composed.sources[1]!.id).toBe(other.id);
  });

  test('same family in a different weight or style is not a collision', () => {
    const composed = composeFontConfiguration(
      { sources: [face('Calibri', 400, 'normal', 1)] },
      { sources: [face('Calibri', 700, 'normal', 2), face('Calibri', 400, 'italic', 3)] }
    );
    expect(composed.sources).toHaveLength(3);
  });

  test('a substitution whose from-face has a direct source is dropped', () => {
    const composed = composeFontConfiguration(
      { sources: [face('Calibri', 400, 'normal', 1)] },
      {
        substitutions: [
          {
            from: { family: 'Calibri', weight: 400, style: 'normal' },
            to: { family: 'Carlito', weight: 400, style: 'normal' },
          },
          {
            from: { family: 'Cambria', weight: 400, style: 'normal' },
            to: { family: 'Caladea', weight: 400, style: 'normal' },
          },
        ],
      }
    );
    expect(composed.substitutions).toHaveLength(1);
    expect(composed.substitutions![0]!.from.family).toBe('Cambria');
  });

  test('the filter also applies when the source arrives in a LATER fragment', () => {
    // An embedded Calibri (later origin) must still beat a substitute package's
    // Calibri→Carlito mapping (earlier origin): a real face always wins.
    const composed = composeFontConfiguration(
      {},
      {
        substitutions: [
          {
            from: { family: 'Calibri', weight: 400, style: 'normal' },
            to: { family: 'Carlito', weight: 400, style: 'normal' },
          },
        ],
      },
      { sources: [face('Calibri', 400, 'normal', 1)] }
    );
    expect(composed.substitutions).toBeUndefined();
  });

  test('substitutions concatenate first-wins by from-face', () => {
    const composed = composeFontConfiguration(
      {
        substitutions: [
          {
            from: { family: 'Calibri', weight: 400, style: 'normal' },
            to: { family: 'MyBrand', weight: 400, style: 'normal' },
          },
        ],
      },
      {
        substitutions: [
          {
            from: { family: 'Calibri', weight: 400, style: 'normal' },
            to: { family: 'Carlito', weight: 400, style: 'normal' },
          },
        ],
      }
    );
    expect(composed.substitutions).toHaveLength(1);
    expect(composed.substitutions![0]!.to.family).toBe('MyBrand');
  });

  test('omitted base fields take the documented defaults', () => {
    const composed = composeFontConfiguration({});
    expect(composed.epoch).toBe(0);
    expect(composed.maxFontBytes).toBe(HARD_MAX_FONT_BYTES);
    expect(composed.defaultFont).toEqual(DEFAULT_FONT);
    expect(composed.language).toBeUndefined();
    expect(composed.substitutions).toBeUndefined();
  });

  test('the deprecated WORD_DEFAULT_FONT name is the same default', () => {
    expect(WORD_DEFAULT_FONT).toBe(DEFAULT_FONT);
  });

  test('base fields pass through when supplied', () => {
    const composed = composeFontConfiguration({
      epoch: 7,
      maxFontBytes: 1024,
      defaultFont: { family: 'Aptos', sizeHalfPoints: 24 },
      language: 'de',
    });
    expect(composed.epoch).toBe(7);
    expect(composed.maxFontBytes).toBe(1024);
    expect(composed.defaultFont).toEqual({ family: 'Aptos', sizeHalfPoints: 24 });
    expect(composed.language).toBe('de');
  });

  test('the result and its arrays are frozen', () => {
    const composed = composeFontConfiguration({ sources: [face('Calibri', 400, 'normal', 1)] });
    expect(Object.isFrozen(composed)).toBe(true);
    expect(Object.isFrozen(composed.sources)).toBe(true);
    expect(Object.isFrozen(composed.defaultFont)).toBe(true);
  });

  test('a malformed request key is refused rather than silently admitted', () => {
    expect(() => composeFontConfiguration({ sources: [face('', 400, 'normal', 1)] })).toThrow();
  });
});
