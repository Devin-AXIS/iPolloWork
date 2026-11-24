// How saved field results are addressed in paragraph offsets.
//
// `atomic` (the default): every closed field is one offset unit, whatever its result. This is
// the raw paragraph text that `paragraphTextOf`, collaboration, and the automation lane read.
//
// `editable`: a field that shows its SAVED result (DATE, MERGEFIELD, HYPERLINK display text,
// see `fieldResultAddressing`) addresses its result runs as ordinary text, and its markers and
// instruction take no offsets. Fields painted from a live value stay one unit.
//
// The mode is passed explicitly at every public boundary (`EditOptions.fieldResults`,
// `paragraphTextOf(..., { fieldResults })`). Inside one synchronous store call the boundary
// installs it with `withFieldResultsMode`, so the deep offset helpers it reaches read the same
// mode without each signature carrying it. Nothing outside such a call ever sees `editable`:
// store subscribers run in `atomic`.
//
// The editor enters `editable` only when a host asks for it (`fieldResults` on
// `createDocxEditor`), never with a collaboration module, and refuses a request for both
// (`editor/field-results-scope.ts`).

/**
 * How saved field results are addressed.
 *
 * - `atomic`: every closed field is one offset unit.
 * - `editable`: the results of CREATEDATE, DATE, FILENAME, FILLIN, HYPERLINK, MERGEFIELD,
 *   PRINTDATE, QUOTE, SAVEDATE, SEQ, and TIME fields are text when their results are unnested.
 *   Simple fields inside complex field results are not supported in this mode. Other nested
 *   results, other field types, and legacy FORMTEXT inputs keep their existing addressing.
 */
export type FieldResultsMode = 'atomic' | 'editable';

let current: FieldResultsMode = 'atomic';

/** The mode of the store call in progress; `atomic` outside any scoped call. */
export function currentFieldResultsMode(): FieldResultsMode {
  return current;
}

/**
 * Run `run` with `mode` installed for every offset helper it reaches, then restore the outer
 * mode, also when `run` throws. `undefined` keeps the outer mode.
 */
export function withFieldResultsMode<T>(mode: FieldResultsMode | undefined, run: () => T): T {
  if (mode === undefined || mode === current) return run();
  const outer = current;
  current = mode;
  try {
    return run();
  } finally {
    current = outer;
  }
}

let wholeFields = false;

/**
 * Whether a deletion whose edges are exactly a saved result's edges removes the whole field.
 *
 * Off by default: selecting a result's text and deleting it keeps the field with an empty
 * result. An editor turns it on while its selection is the whole FIELD (the selection a
 * Backspace after a field makes), where the same offsets mean the field and its markers.
 */
export function wholeFieldDeletion(): boolean {
  return wholeFields;
}

/** Run `run` with {@link wholeFieldDeletion} on, then restore it, also when `run` throws. */
export function withWholeFieldDeletion<T>(run: () => T): T {
  if (wholeFields) return run();
  wholeFields = true;
  try {
    return run();
  } finally {
    wholeFields = false;
  }
}

/**
 * A node-keyed memo that keeps one entry per mode: offsets computed in one mode never answer
 * a read in the other.
 */
export class FieldResultsModeMemo<K extends object, V> {
  readonly #atomic = new WeakMap<K, V>();
  readonly #editable = new WeakMap<K, V>();

  #map(): WeakMap<K, V> {
    return current === 'editable' ? this.#editable : this.#atomic;
  }

  has(key: K): boolean {
    return this.#map().has(key);
  }

  get(key: K): V | undefined {
    return this.#map().get(key);
  }

  set(key: K, value: V): void {
    this.#map().set(key, value);
  }

  delete(key: K): void {
    this.#map().delete(key);
  }
}
