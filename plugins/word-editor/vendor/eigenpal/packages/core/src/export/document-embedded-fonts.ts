// Bounded document-embedded faces as a last, first-wins export origin.

import type { EmbeddedFont } from '../store/package/embedded-fonts.ts';
import { readEmbeddedFonts } from '../store/package/embedded-fonts.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { resolveRelationship } from '../store/package/relationships.ts';
import type { HeadlessDocumentView } from '../store/headless-document-view.ts';
import {
  defineFontResolver,
  type FontOrigin,
  type FontOriginCompositionRequest,
} from '../layout/font-resolver.ts';
import {
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  fontRequestKey,
} from '../layout/font-resource.ts';
import { embeddedFontSources, type DroppedEmbeddedFont } from '../layout/embedded-font-sources.ts';
import { MAX_EXPORT_DROPPED_EMBEDDED_FONTS } from './document-export-font-resolution.ts';

const FONT_TABLE_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';

/** Collects embedded-font drop evidence while the document origin resolves. @internal */
export interface DocumentEmbeddedFontDiagnostics {
  readonly dropped: DroppedEmbeddedFont[];
}

/** Read deobfuscated package fonts through the same store reader the editor uses. */
export function readDocumentEmbeddedFonts(view: HeadlessDocumentView): readonly EmbeddedFont[] {
  const live = view.currentPackage();
  const record = (live.relationships.get(live.mainDocumentPart) ?? []).find(
    (rel) => rel.type === FONT_TABLE_REL_TYPE
  );
  let part: OoxmlPart | undefined;
  if (record) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      part = live.parts.get(resolved.target.partName);
    }
  }
  part ??= live.parts.get('/word/fontTable.xml');
  return readEmbeddedFonts(live, part);
}

/**
 * Last-wins-never: explicit origins stay first. This origin maps remaining document faces
 * after earlier origins publish `resolvedFaces`, using the shared embedded mapper budgets
 * minus bytes those origins already committed.
 */
export function documentEmbeddedFontOrigin(
  view: HeadlessDocumentView,
  diagnostics?: DocumentEmbeddedFontDiagnostics
): FontOrigin | undefined {
  const embedded = readDocumentEmbeddedFonts(view);
  if (embedded.length === 0) return undefined;
  return defineFontResolver((request: FontOriginCompositionRequest) => {
    const shadowedRequests = new Set(
      (request.resolvedFaces ?? []).map((face) => fontRequestKey(face))
    );
    const mapped = embeddedFontSources(embedded, {
      maxFontBytes: HARD_MAX_FONT_BYTES,
      aggregateBudget: remainingEmbeddedAggregateBudget(request),
      shadowedRequests,
    });
    if (diagnostics) {
      for (const drop of mapped.dropped) {
        if (diagnostics.dropped.length >= MAX_EXPORT_DROPPED_EMBEDDED_FONTS) break;
        diagnostics.dropped.push(drop);
      }
    }
    return { sources: mapped.sources };
  });
}

function remainingEmbeddedAggregateBudget(request: FontOriginCompositionRequest): number {
  const committed = request.committedSourceBytes;
  if (committed === undefined || !Number.isSafeInteger(committed) || committed <= 0) {
    return HARD_MAX_AGGREGATE_FONT_BYTES;
  }
  return Math.max(0, HARD_MAX_AGGREGATE_FONT_BYTES - committed);
}
