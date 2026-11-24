// Short, unambiguous keys for a shaper's result cache.

import {
  shapingEnvironmentFingerprint,
  type ShapeInput,
  type ShapingEnvironment,
} from './shaped-run.ts';

const MAX_INTERNED_ENVIRONMENTS = 4096;

/**
 * Interns environment fingerprints to small ids, so a cache key costs a concatenation instead
 * of a serialization of every shaping variable.
 *
 * A long-lived shared shaper sees every document's faces, so the ids are bounded. Starting them
 * over calls `onRestart`, which must drop every result keyed by an old id: otherwise a reused id
 * would find another environment's run.
 */
const typed = (value: unknown): string =>
  typeof value === 'number' ? String(value) : (JSON.stringify(value) ?? typeof value);

export class ShapeCacheKeys {
  readonly #ids = new Map<string, number>();

  constructor(private readonly onRestart: () => void) {}

  /**
   * The text goes last, so no split of the key is ambiguous. A size or level that is not a
   * number keeps its type in the key: `'24'` must miss the entry for `24` and reach the
   * validation that refuses it, as it did when the key was JSON.
   */
  keyOf(input: ShapeInput, environment: ShapingEnvironment): string {
    const fingerprint = shapingEnvironmentFingerprint(environment);
    let id = this.#ids.get(fingerprint);
    if (id === undefined) {
      if (this.#ids.size >= MAX_INTERNED_ENVIRONMENTS) {
        this.#ids.clear();
        this.onRestart();
      }
      id = this.#ids.size;
      this.#ids.set(fingerprint, id);
    }
    const base = `${id}\u0000${typed(input.fontSizeHalfPoints)}\u0000${typed(input.bidiLevel)}\u0000`;
    const context = input.context;
    // One tag character says which form follows, so no text can pose as a context key.
    if (!context || (context.before === '' && context.after === '')) return `${base}-${input.text}`;
    // The two lengths fix every split, so the text can still go last.
    return `${base}c${context.before.length},${context.after.length}\u0000${context.before}${context.after}${input.text}`;
  }

  clear(): void {
    this.#ids.clear();
  }
}
