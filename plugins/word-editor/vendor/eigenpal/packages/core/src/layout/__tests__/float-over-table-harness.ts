// A floating drawing parked over a table, for testing PROBE-VERSUS-PLACEMENT DIVERGENCE.
//
// Table pagination measures a row twice. `measureRowHeight` probes it at `y = 0` with
// `pageExclusionZones` stripped — deliberately, because a probe has no page position and a
// float near the top of the page would otherwise wrap text in a row that sits far below it.
// The placing pass then runs at the row's true top and applies whichever wrap bands really
// cross it. So a row can be TALLER when placed than anything measured it to be.
//
// Every decision table pagination takes from a measurement — will this row fit the band, may
// this merge be sized as a span, is this fragment complete — is one that divergence can
// invalidate after the fact. Four consecutive review rounds on the `w:vMerge` span work
// turned up a high or a medium whose trigger was exactly this, and none of them could be
// reproduced, because nothing in the repo could put a float over a table.
//
// This puts one there. The zone is synthesized rather than projected from a real `w:drawing`:
// the defects live in how LAYOUT reacts to a wrap band, not in how a band is derived from a
// picture, and a synthetic zone lets a test say "cover exactly this strip of the page".
//
// Reach for it when a change makes table layout depend on a measurement, and write the test
// that asks what happens when the measurement was wrong.

import type { ExclusionZone } from '../drawing-exclusion.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { PageGeometry, SemanticLayout } from '../semantic-records.ts';
import type { SemanticLayoutOptions } from '../semantic-layout-options.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** 80pt of content box and a 14pt line, so every height in a test is checkable by hand. */
export const TINY_PAGE: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

/** Content box of {@link TINY_PAGE}, in the page-content coordinates zones are stated in. */
export const TINY_CONTENT = Object.freeze({ width: 180, height: 80 });

export function loadBody(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * A square-wrap band covering `[left, left + width)` by `[top, top + height)` of the page
 * content box, anchored to `anchorParagraphId`.
 *
 * The anchor decides WHERE the band starts applying: layout drops a zone for any paragraph
 * that comes before its anchor in document order, so anchor it to something ahead of the
 * table (the first body paragraph) for the band to reach the table's cells.
 */
export function squareWrapZone(options: {
  readonly anchorParagraphId: string;
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly width: number;
  readonly contentWidth?: number;
  readonly drawingNodeId?: string;
}): ExclusionZone {
  const contentRight = options.contentWidth ?? TINY_CONTENT.width;
  const bounds = Object.freeze({
    x: options.left,
    y: options.top,
    width: options.width,
    height: options.height,
  });
  return Object.freeze({
    drawingNodeId: options.drawingNodeId ?? 'float-1',
    anchorParagraphId: options.anchorParagraphId,
    anchorModelStart: 0,
    sourceOrder: 0,
    paintLayer: 'inFront' as const,
    relativeHeight: 0,
    allowOverlap: true,
    columnIndex: 0,
    y: options.top,
    verticalBand: bounds,
    input: Object.freeze({
      mode: 'square' as const,
      contentBounds: bounds,
      polygon: null,
      clipPolygon: null,
      wrapDistances: NO_INSETS,
      effectInsets: NO_INSETS,
      textSide: 'bothSides' as const,
      contentLeft: 0,
      contentRight,
    }),
  });
}

/** Enough of a drawing context to turn the zone wiring on; no `w:drawing` is ever projected. */
const DRAWING_CONTEXT: InlineDrawingLayoutContext = {
  ownerPartName: '/word/document.xml',
  project: () => null,
  resourceOf: () => {
    throw new Error('the harness projects no drawings');
  },
};

/** Lay `part` out on {@link TINY_PAGE} with `zonesByPage` covering the given page (0-based). */
export function layoutUnderFloat(
  part: OoxmlPart,
  zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]>,
  geometry: PageGeometry = TINY_PAGE,
  options: Pick<SemanticLayoutOptions, 'styleCascade'> = {}
): SemanticLayout {
  return layoutSemanticDocument(part, 0, {
    ...options,
    measurer: createFixedMeasurer(),
    geometry,
    inlineDrawingLayout: DRAWING_CONTEXT,
    drawingExclusionZonesByPage: zonesByPage,
    // Skips the reflow driver, which would derive zones from the drawings on the laid-out
    // pages — there are none — and throw these away. Supplied zones ARE the converged set.
    drawingExclusionPass: 0,
  });
}

/** The same document with no float at all: the layout every assertion compares against. */
export function layoutWithoutFloat(
  part: OoxmlPart,
  geometry: PageGeometry = TINY_PAGE
): SemanticLayout {
  return layoutUnderFloat(part, new Map(), geometry);
}
