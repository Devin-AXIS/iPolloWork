// Embedded document faces as shaping font sources (font-resolution-overhaul 2.1/2.2).
//
// `readEmbeddedFonts` hands back deobfuscated bytes and a CLAIMED family/style, asserting
// nothing about validity — admitting a face stays the font resource lane's job, behind its
// validator and caps. This module only reshapes that claim into a byte-backed source and
// applies the rules composition needs before the snapshot sees the bytes:
//
// - Request validity: the family is attacker-controlled, and a family the request
//   contract refuses (empty or whitespace-only) would THROW out of `fontRequestKey`
//   during composition — failing the whole resolution, explicit sources included, over
//   one crafted face. Such faces drop HERE, per-face, with a typed report.
// - Per-face bytes: a face larger than the configuration's `maxFontBytes` is dropped
//   HERE, because shaping treats an oversized source as a configuration error and fails
//   the WHOLE configuration — right for app-supplied bytes, wrong for a face an attacker
//   put in a file.
// - Aggregate: embedded faces admit oldest-first until the shared aggregate budget is
//   exhausted; the rest drop. A file must not be able to spend the whole budget explicit
//   sources also draw on.
// - Shadowed faces: a face whose (family, weight, style) an explicit source already
//   covers can never win composition, so it is skipped BEFORE it spends budget or
//   hashing time — silently, because being overridden is precedence, not failure.
//
// Lives in the layout lane so browser composition and headless export share one mapper.

import type { EmbeddedFont, FontStyleKey } from '../store/package/embedded-fonts.ts';
import {
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  fontRequestKey,
  sha256FontBytes,
  type FontRequest,
} from './font-resource.ts';

/** Word's four embed slots, in the vocabulary the resolver requests faces in. */
const STYLE_REQUESTS: Record<FontStyleKey, { weight: number; style: 'normal' | 'italic' }> = {
  regular: { weight: 400, style: 'normal' },
  bold: { weight: 700, style: 'normal' },
  italic: { weight: 400, style: 'italic' },
  boldItalic: { weight: 700, style: 'italic' },
};

/** Byte-backed face produced by the embedded mapper; structurally a layout font source. */
export interface EmbeddedMappedFontSource {
  readonly request: FontRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly availability?: 'available' | 'forbidden';
}

export interface DroppedEmbeddedFont {
  readonly request: FontRequest;
  readonly partName: string;
  readonly reason: 'overLimit' | 'malformed';
}

export interface EmbeddedFontSources {
  readonly sources: readonly EmbeddedMappedFontSource[];
  readonly dropped: readonly DroppedEmbeddedFont[];
}

/** Apply engine byte ceilings before explicit sources can reduce the document budget. */
export function boundedExplicitFontSources<T extends EmbeddedMappedFontSource>(
  sources: readonly T[],
  maxFontBytes: number
): { readonly sources: readonly T[]; readonly dropped: readonly T[] } {
  const admitted: T[] = [];
  const dropped: T[] = [];
  let aggregateBytes = 0;
  for (const source of sources) {
    const size = source.bytes.byteLength;
    if (
      !Number.isSafeInteger(size) ||
      size > maxFontBytes ||
      size > HARD_MAX_FONT_BYTES ||
      size > HARD_MAX_AGGREGATE_FONT_BYTES - aggregateBytes
    ) {
      dropped.push(source);
      continue;
    }
    aggregateBytes += size;
    admitted.push(source);
  }
  return { sources: admitted, dropped };
}

/** Map document fonts after admitted explicit sources take precedence and budget. */
export function embeddedFontSourcesAfterExplicit(
  embedded: readonly EmbeddedFont[],
  explicit: readonly EmbeddedMappedFontSource[],
  maxFontBytes: number
): EmbeddedFontSources {
  const explicitBytes = explicit.reduce((total, source) => total + source.bytes.byteLength, 0);
  const shadowedRequests = new Set(
    explicit
      .filter((source) => source.request.family.trim().length > 0)
      .map((source) => fontRequestKey(source.request))
  );
  return embeddedFontSources(embedded, {
    maxFontBytes,
    aggregateBudget: Math.max(0, HARD_MAX_AGGREGATE_FONT_BYTES - explicitBytes),
    shadowedRequests,
  });
}

/**
 * Map embedded faces to byte-backed sources under the given byte budgets.
 *
 * `aggregateBudget` is what remains AFTER explicit sources are counted, so a document
 * cannot starve the app's own fonts; `shadowedRequests` (request keys of explicit
 * sources) skips faces composition would discard anyway. Hashing happens here (the
 * contract requires it), which also means a face dropped or skipped is never hashed.
 */
export function embeddedFontSources(
  embedded: readonly EmbeddedFont[],
  budgets: {
    readonly maxFontBytes: number;
    readonly aggregateBudget: number;
    readonly shadowedRequests?: ReadonlySet<string>;
  }
): EmbeddedFontSources {
  const sources: EmbeddedMappedFontSource[] = [];
  const dropped: DroppedEmbeddedFont[] = [];
  let remaining = budgets.aggregateBudget;
  // A file may name the SAME face twice (two `w:font` elements of one family, each with
  // the same style slot). Composition keeps the first per request key, so emitting the
  // rest would produce sources that never reach validation while still looking admitted
  // to a caller that iterates this list. First-wins here, once, matching composition.
  const seen = new Set<string>();
  for (const font of embedded) {
    const mapped = STYLE_REQUESTS[font.style];
    const request: FontRequest = Object.freeze({
      family: font.family,
      weight: mapped.weight,
      style: mapped.style,
    });
    // The request contract refuses empty/whitespace families with a THROW; a file must
    // degrade this face, not detonate the composition that carries every other face.
    if (font.family.trim().length === 0) {
      dropped.push({ request, partName: font.partName, reason: 'malformed' });
      continue;
    }
    const key = fontRequestKey(request);
    if (budgets.shadowedRequests?.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (font.bytes.byteLength > budgets.maxFontBytes || font.bytes.byteLength > remaining) {
      dropped.push({ request, partName: font.partName, reason: 'overLimit' });
      continue;
    }
    remaining -= font.bytes.byteLength;
    sources.push({
      request,
      id: `embedded:${font.partName}#${font.style}`,
      bytes: font.bytes,
      hash: sha256FontBytes(font.bytes),
      faceIndex: 0,
    });
  }
  return { sources, dropped };
}
