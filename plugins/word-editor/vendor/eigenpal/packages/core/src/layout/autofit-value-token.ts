import type { SemanticTableCell } from './semantic-table.ts';
import { sha256FontBytes } from '../store/package/sha256.ts';

const mapsAsEntries = (_key: string, value: unknown) => (value instanceof Map ? [...value] : value);

/**
 * A fixed-width digest of a value object, once per object. File-controlled property text can
 * run to kilobytes, and the token joins every paragraph's cache key.
 */
const valueDigests = new WeakMap<object, string>();
const digestEncoder = new TextEncoder();
export function valueDigest(value: object | undefined): string {
  if (!value) return '';
  let digest = valueDigests.get(value);
  if (digest === undefined) {
    digest = sha256FontBytes(digestEncoder.encode(JSON.stringify(value, mapsAsEntries)));
    valueDigests.set(value, digest);
  }
  return digest;
}

/**
 * A table style's cell formatting, by content. A structure read builds new formatting objects
 * for every cell, so identity would miss the cache on every edit of a styled table.
 */
const cellStyleKeys = new WeakMap<object, string>();
export function cellStyleKey(style: SemanticTableCell['styleFormatting'] | undefined): string {
  if (!style) return '';
  let key = cellStyleKeys.get(style);
  if (key === undefined) {
    key = JSON.stringify([style.paragraphProperties, style.runProperties]);
    cellStyleKeys.set(style, key);
  }
  return key;
}
