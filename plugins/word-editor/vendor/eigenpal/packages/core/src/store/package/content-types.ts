// Authored content-type Default/Override records and resolution (document-engine
// task 2.6 / lossless-package-model "Relationship and content-type records are
// authored"). Records retain lexical form and significant order. Resolution:
// Override (by case-folded part name) beats Default (by ASCII case-insensitive
// extension). Conflicting Defaults on one extension, duplicate normalized
// Override names, and invalid MIME syntax fail closed. Identical duplicates are
// preserved inertly. Orphans never determine a part type. The package loader uses
// the tolerant variant, which drops an invalid-MIME record instead of failing.

import { partNameKey, asciiFold, type NameResult, normalizePartName } from './opc-names.ts';
import { BoundedCounter } from '../runtime/counter.ts';

/** One `<Default>`: a file extension mapped to a content type. */
export interface DefaultRecord {
  readonly extension: string; // authored lexical form
  readonly contentType: string;
  readonly order: number;
}
/** One `<Override>`: a specific part name mapped to a content type. Beats any Default. */
export interface OverrideRecord {
  readonly partName: string; // authored lexical form
  readonly contentType: string;
  readonly order: number;
}

/**
 * The authored `[Content_Types].xml` records, in significant order.
 *
 * Retained rather than collapsed into a lookup, because the file's lexical form and ordering are
 * part of what a lossless save re-emits.
 */
export interface ContentTypeRecords {
  readonly defaults: readonly DefaultRecord[];
  readonly overrides: readonly OverrideRecord[];
}

/**
 * Why content-type records could not be indexed.
 *
 * All fail CLOSED: conflicting Defaults on one extension, duplicate normalized Override names, or
 * invalid MIME syntax are refused rather than resolved by picking one.
 */
export type ContentTypeError =
  | { readonly code: 'invalid-mime'; readonly value: string }
  | { readonly code: 'conflicting-default'; readonly extension: string }
  | { readonly code: 'duplicate-override'; readonly partName: string }
  | { readonly code: 'invalid-override-name'; readonly partName: string }
  | { readonly code: 'too-many-records'; readonly limit: number };

// Media type per RFC 9110: type "/" subtype, each a non-empty token. Parameters are checked by
// hand below, NOT by a trailing `(\s*;\s*[^;]+)*` group: `\s*` and `[^;]+` both match
// whitespace, so a crafted `[Content_Types].xml` value like "a/b;" plus a long run of spaces
// made the engine backtrack exponentially. The essence pattern alone is unambiguous and linear.
const MIME_ESSENCE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
// The same essence, allowing the trailing whitespace a `;` may sit behind.
const MIME_ESSENCE_BEFORE_PARAMS_RE =
  /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+\s*$/;
// The conventional shape registered types use: each component starts with a letter or digit.
// A valid token outside it (`image/.jpg`) yields to any record it conflicts with.
const CONVENTIONAL_ESSENCE_RE =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\s*$/;

/** Whether a string is syntactically a MIME type. Syntax only — no registry lookup. */
export function isValidMime(value: string): boolean {
  const firstSemicolon = value.indexOf(';');
  if (firstSemicolon === -1) return MIME_ESSENCE_RE.test(value);
  if (!MIME_ESSENCE_BEFORE_PARAMS_RE.test(value.slice(0, firstSemicolon))) return false;
  // Every parameter segment must carry something; a bare or doubled `;` is not a parameter.
  return value
    .slice(firstSemicolon + 1)
    .split(';')
    .every((parameter) => parameter.length > 0);
}

/** Whether a valid MIME type also has the conventional shape: alphanumeric-led components. */
export function isConventionalMime(value: string): boolean {
  const firstSemicolon = value.indexOf(';');
  return CONVENTIONAL_ESSENCE_RE.test(
    firstSemicolon === -1 ? value : value.slice(0, firstSemicolon)
  );
}

/** The type an extension-style image subtype (`image/.jpg`, written by some producers) means. */
const EXTENSION_SUBTYPE_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['jpe', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['bmp', 'image/bmp'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['tif', 'image/tiff'],
  ['tiff', 'image/tiff'],
  ['emf', 'image/x-emf'],
  ['wmf', 'image/x-wmf'],
]);

/** The standard type for a known extension-style image type; any other type unchanged. */
export function standardImageType(type: string): string {
  if (!/^image\/\./i.test(type)) return type;
  return EXTENSION_SUBTYPE_IMAGE_TYPES.get(asciiFold(type.slice('image/.'.length))) ?? type;
}

/** ASCII-case-insensitive extension key (leading dot removed; ASCII-only fold). */
export function extensionKey(extension: string): string {
  return asciiFold(extension.replace(/^\./, ''));
}

/** The normalized, case-folded Override key, or null for an invalid part name. */
export function overrideKeyOf(partName: string): string | null {
  const norm = normalizePartName(partName);
  return norm.ok ? partNameKey(norm.partName) : null;
}

/** The resolved lookup: Override by case-folded part name, Default by case-insensitive extension. */
export interface ContentTypeIndex {
  /** ext key -> single MIME (identical duplicates collapsed). */
  readonly defaults: ReadonlyMap<string, string>;
  /** case-folded part name -> MIME. */
  readonly overrides: ReadonlyMap<string, string>;
}

/** The built index, or the conflict that made it impossible. */
export type IndexResult =
  | { readonly ok: true; readonly index: ContentTypeIndex }
  | { readonly ok: false; readonly error: ContentTypeError };

/**
 * Build a resolved content-type index, failing closed on conflict/duplicate/MIME
 * errors. `maxRecords` bounds the combined record count (N/N+1 gate).
 */
export function buildContentTypeIndex(
  records: ContentTypeRecords,
  maxRecords = 100_000
): IndexResult {
  const counter = new BoundedCounter('content-type-records', maxRecords);
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();

  for (const d of records.defaults) {
    try {
      counter.add(1);
    } catch {
      return { ok: false, error: { code: 'too-many-records', limit: maxRecords } };
    }
    if (!isValidMime(d.contentType))
      return { ok: false, error: { code: 'invalid-mime', value: d.contentType } };
    const key = extensionKey(d.extension);
    const existing = defaults.get(key);
    if (existing !== undefined && existing !== d.contentType) {
      return { ok: false, error: { code: 'conflicting-default', extension: key } };
    }
    defaults.set(key, d.contentType); // identical duplicate is a no-op
  }

  for (const o of records.overrides) {
    try {
      counter.add(1);
    } catch {
      return { ok: false, error: { code: 'too-many-records', limit: maxRecords } };
    }
    if (!isValidMime(o.contentType))
      return { ok: false, error: { code: 'invalid-mime', value: o.contentType } };
    const norm: NameResult = normalizePartName(o.partName);
    if (!norm.ok)
      return { ok: false, error: { code: 'invalid-override-name', partName: o.partName } };
    const key = partNameKey(norm.partName);
    const existing = overrides.get(key);
    if (existing !== undefined && existing !== o.contentType) {
      return { ok: false, error: { code: 'duplicate-override', partName: key } };
    }
    overrides.set(key, o.contentType);
  }

  return { ok: true, index: { defaults, overrides } };
}

/**
 * A part's content type, or why it has none.
 *
 * An orphan record never determines a part's type — a Default with no matching part is preserved
 * inertly rather than applied.
 */
export type ResolveResult =
  | { readonly ok: true; readonly contentType: string; readonly source: 'override' | 'default' }
  | { readonly ok: false; readonly reason: 'unknown' };

/** Resolve a part's content type: Override wins over Default; else unknown. */
export function resolveContentType(index: ContentTypeIndex, partName: string): ResolveResult {
  const override = index.overrides.get(partNameKey(partName));
  if (override !== undefined) return { ok: true, contentType: override, source: 'override' };
  const ext = partExtensionKey(partName);
  if (ext !== null) {
    const def = index.defaults.get(ext);
    if (def !== undefined) return { ok: true, contentType: def, source: 'default' };
  }
  return { ok: false, reason: 'unknown' };
}

/** The Default lookup key for a part: its folded extension after the last dot, or `null`. */
function partExtensionKey(partName: string): string | null {
  const dot = partName.lastIndexOf('.');
  return dot < 0 ? null : extensionKey(partName.slice(dot + 1));
}

/**
 * Records dropped by {@link buildTolerantContentTypeIndex}: an invalid MIME type, or an
 * unconventional one that could not be kept. Kept so the loader can refuse a package whose
 * REQUIRED part one governs.
 */
export interface IgnoredContentTypes {
  /** Case-folded part names of dropped Overrides. */
  readonly overrideKeys: ReadonlySet<string>;
  /** Extension keys of dropped Defaults. */
  readonly extensions: ReadonlySet<string>;
}

/**
 * Build the index while treating a record with an invalid MIME type as absent.
 *
 * One malformed record (`image/` on an image extension, say) does not make the other
 * records untrustworthy, so it is dropped rather than refusing the package. The dropped
 * record stays in the authored `[Content_Types].xml` bytes, which a save writes back
 * unchanged. Every other rule still fails closed: conflicting conventional Defaults,
 * conflicting conventional Overrides, an invalid Override name on a conventional record, and
 * the record budget. An Override whose name AND type are both invalid is dropped: it cannot
 * name a part.
 *
 * A valid but unconventional type (`image/.jpg`) is kept only where it is uncontested. It is
 * dropped like a malformed record when another record on the same extension or part disagrees,
 * or when its Override name is invalid, so it never turns a package that opens into one that
 * does not.
 */
export function buildTolerantContentTypeIndex(
  records: ContentTypeRecords,
  maxRecords = 100_000
):
  | { readonly ok: true; readonly index: ContentTypeIndex; readonly ignored: IgnoredContentTypes }
  | { readonly ok: false; readonly error: ContentTypeError } {
  // Dropped records still count, so the budget is the same with or without them.
  if (records.defaults.length + records.overrides.length > maxRecords)
    return { ok: false, error: { code: 'too-many-records', limit: maxRecords } };
  const extensions = new Set<string>();
  const overrideKeys = new Set<string>();
  const validDefaults = records.defaults.filter((record) => {
    if (isValidMime(record.contentType)) return true;
    extensions.add(extensionKey(record.extension));
    return false;
  });
  const validOverrides = records.overrides.filter((record) => {
    if (isValidMime(record.contentType)) return true;
    const key = overrideKeyOf(record.partName);
    if (key !== null) overrideKeys.add(key);
    return false;
  });
  const defaultTypes = distinctTypesByKey(validDefaults, (record) =>
    extensionKey(record.extension)
  );
  const overrideTypes = distinctTypesByKey(validOverrides, (record) =>
    overrideKeyOf(record.partName)
  );
  const defaults = validDefaults.filter((record) => {
    if (isConventionalMime(record.contentType)) return true;
    const key = extensionKey(record.extension);
    if (defaultTypes.get(key)!.size === 1) return true;
    extensions.add(key);
    return false;
  });
  const overrides = validOverrides.filter((record) => {
    if (isConventionalMime(record.contentType)) return true;
    const key = overrideKeyOf(record.partName);
    if (key !== null && overrideTypes.get(key)!.size === 1) return true;
    if (key !== null) overrideKeys.add(key);
    return false;
  });
  const built = buildContentTypeIndex({ defaults, overrides }, maxRecords);
  if (!built.ok) return built;
  return { ok: true, index: built.index, ignored: { overrideKeys, extensions } };
}

/** The distinct content types declared under each lookup key. A `null` key is not grouped. */
function distinctTypesByKey<T extends { readonly contentType: string }>(
  records: readonly T[],
  keyOf: (record: T) => string | null
): Map<string, Set<string>> {
  const types = new Map<string, Set<string>>();
  for (const record of records) {
    const key = keyOf(record);
    if (key === null) continue;
    let set = types.get(key);
    if (set === undefined) types.set(key, (set = new Set()));
    set.add(record.contentType);
  }
  return types;
}

/**
 * Whether a dropped record would have decided this part's content type. With no valid
 * Override for the part: a dropped Override names it, or a dropped Default names its
 * extension while no valid Default does. Mirrors {@link resolveContentType}.
 */
export function governedByIgnoredRecord(
  index: ContentTypeIndex,
  ignored: IgnoredContentTypes,
  partName: string
): boolean {
  const key = partNameKey(partName);
  if (index.overrides.has(key)) return false;
  if (ignored.overrideKeys.has(key)) return true;
  const ext = partExtensionKey(partName);
  return ext !== null && ignored.extensions.has(ext) && !index.defaults.has(ext);
}
