// Sections and page setup.
//
// A SECTION IS A `w:sectPr`, and a document always has at least one — the body-level properties,
// which Word writes even for a file that has never been sectioned. A `w:sectPr` on a paragraph's
// mark ENDS a section, so the marks come first in document order and the body-level one governs
// what is left. That is the order `collectSectionPropertyNodes` reports and the order the header
// lifecycle ops index by, so nothing here renumbers: a section index means the same thing to a
// read here and to a `createHeaderFooter` op.
//
// PAGE SETUP IS IN POINTS, because that is the unit the object model states and the unit the rest
// of this lane already converts to at the property boundary. OOXML stores twips; the conversion is
// exactly twenty to a point and happens here, once, in both directions. A page size read back and
// written unchanged has to produce the same twips it came from, which is why the write rounds
// rather than truncates.
//
// EVERY NUMBER IS FILE-DERIVED. `metricsOfSection` clamps what it reads — a page 400 metres wide,
// a negative margin — so a read answers something a layout can use; a write is bounded here for
// the same reason in the other direction, because a caller behind this protocol is as untrusted as
// a file. Neither ever becomes an allocation size or a loop bound.

import type { HeaderFooterSectionResolution } from '../store/package/hf-references.ts';
import { collectSectionPropertyNodes } from '../store/package/hf-references.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { metricsOfSection } from '../store/store/tree-op-section-address.ts';
import {
  points as asPoints,
  pointsToTwips,
  twips as asTwips,
  twipsToPoints,
  type Twips,
} from '../store/units.ts';

/** The largest page or margin this lane will write, in twips — `w:pgSz`'s own ceiling. */
const MAX_TWIPS = 63360;

/**
 * Which way round a page is, in OOXML's own lower-case spelling.
 *
 * The public object model capitalises it; the mapping between the two lives at that boundary and
 * nowhere else.
 */
export type AutomationPageOrientation = 'portrait' | 'landscape';

/** One section's page geometry, in points. */
export interface AutomationPageSetupRead {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly orientation: AutomationPageOrientation;
  readonly topMargin: number;
  readonly rightMargin: number;
  readonly bottomMargin: number;
  readonly leftMargin: number;
  readonly headerDistance: number;
  readonly footerDistance: number;
  readonly gutter: number;
}

/** What a caller may author on a section. Only the fields present are written. */
export interface AutomationPageSetupWrite {
  readonly pageWidth?: number;
  readonly pageHeight?: number;
  readonly orientation?: AutomationPageOrientation;
  readonly topMargin?: number;
  readonly rightMargin?: number;
  readonly bottomMargin?: number;
  readonly leftMargin?: number;
  readonly headerDistance?: number;
  readonly footerDistance?: number;
}

export interface AutomationSectionRead {
  /** Position in the document, from zero. The index the lifecycle ops take. */
  readonly index: number;
  /**
   * The paragraph whose mark ends this section, or null for the section the body-level
   * `w:sectPr` governs — the last one, which no paragraph mark closes.
   */
  readonly markParagraphId: string | null;
  readonly pageSetup: AutomationPageSetupRead;
  /** `w:titlePg` — whether this section has its own first-page furniture. */
  readonly titlePage: boolean;
  /** `w:evenAndOddHeaders` from settings; without it the `even` variant is not rendered. */
  readonly evenAndOddHeaders: boolean;
}

/** Points from twips, rounded to the hundredth so a read is stable and legible. */
function points(value: number): number {
  return Math.round(twipsToPoints(asTwips(value)) * 100) / 100;
}

/**
 * Twips from points, or null when the value is not one this lane writes.
 *
 * Bounded and integral. A non-finite number, a negative page size or a value past `w:pgSz`'s
 * ceiling is refused rather than clamped: clamping would report a page set to a size it was not
 * set to, and the caller has no way to notice.
 */
export function twipsFromPoints(value: unknown, allowZero: boolean): Twips | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const authored = pointsToTwips(asPoints(value));
  if (authored > MAX_TWIPS) return null;
  if (authored < 0) return null;
  if (authored === 0 && !allowZero) return null;
  return authored;
}

/** The `setSectionProperties` fields a page-setup write turns into. */
export interface AutomationPageSetupFields {
  pageWidthTwips?: number;
  pageHeightTwips?: number;
  orientation?: AutomationPageOrientation;
  marginTopTwips?: number;
  marginRightTwips?: number;
  marginBottomTwips?: number;
  marginLeftTwips?: number;
}

export type AutomationPageSetupPlan =
  | { readonly ok: true; readonly value: AutomationPageSetupFields }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

/** The page-setup fields, paired with the op field each becomes and whether zero is a value. */
const PAGE_SETUP_FIELDS = [
  ['pageWidth', 'pageWidthTwips', false],
  ['pageHeight', 'pageHeightTwips', false],
  ['topMargin', 'marginTopTwips', true],
  ['rightMargin', 'marginRightTwips', true],
  ['bottomMargin', 'marginBottomTwips', true],
  ['leftMargin', 'marginLeftTwips', true],
] as const satisfies readonly (readonly [
  keyof AutomationPageSetupWrite,
  keyof AutomationPageSetupFields,
  boolean,
])[];

/**
 * Turn a caller's page setup into op fields, refusing anything a page cannot be.
 *
 * EVERY NUMBER HERE IS UNTRUSTED, exactly as a file's is: a script behind this protocol is not
 * more trustworthy than a `.docx`. A negative page, a non-finite one or one past `w:pgSz`'s
 * ceiling is refused rather than clamped — a clamp reports a page set to a size it was not set to
 * and the caller has no way to notice — and a setup naming nothing at all is refused too, because
 * committing a transaction that writes nothing would move the revision for no change.
 */
export function pageSetupProperties(request: unknown): AutomationPageSetupPlan {
  if (typeof request !== 'object' || request === null) {
    return { ok: false, reason: 'that is not a page setup', detail: 'not-an-object' };
  }
  const source = request as Record<string, unknown>;
  const value: AutomationPageSetupFields = {};
  let named = 0;

  for (const [field, op, allowZero] of PAGE_SETUP_FIELDS) {
    const given = source[field];
    if (given === undefined) continue;
    const twips = twipsFromPoints(given, allowZero);
    if (twips === null) {
      return { ok: false, reason: `that is not a value for ${field}`, detail: String(given) };
    }
    value[op] = twips;
    named += 1;
  }

  const orientation = source['orientation'];
  if (orientation !== undefined) {
    if (orientation !== 'portrait' && orientation !== 'landscape') {
      return { ok: false, reason: 'that is not an orientation', detail: String(orientation) };
    }
    value.orientation = orientation;
    named += 1;
  }

  if (named === 0) {
    return { ok: false, reason: 'that page setup names nothing to write', detail: 'empty' };
  }
  return { ok: true, value };
}

/** How a section's `w:sectPr` reads as page setup. */
export function pageSetupOf(sectPr: OoxmlNode | null): AutomationPageSetupRead {
  const metrics = metricsOfSection(sectPr);
  // `w:orient` is advisory in OOXML — the SIZE is what paginates — so the orientation reported is
  // the one the dimensions describe. A file claiming portrait on a landscape page renders
  // landscape, and answering its claim would describe a document nobody sees.
  const orientation: AutomationPageOrientation =
    metrics.widthTwips > metrics.heightTwips ? 'landscape' : 'portrait';
  return Object.freeze({
    pageWidth: points(metrics.widthTwips),
    pageHeight: points(metrics.heightTwips),
    orientation,
    topMargin: points(metrics.topTwips),
    rightMargin: points(metrics.rightTwips),
    bottomMargin: points(metrics.bottomTwips),
    leftMargin: points(metrics.leftTwips),
    headerDistance: points(metrics.headerTwips),
    footerDistance: points(metrics.footerTwips),
    gutter: points(metrics.gutterTwips),
  });
}

/** The paragraph a `w:sectPr` mark belongs to, or null when it is the body-level one. */
function markParagraphOf(part: OoxmlPart, sectPr: OoxmlNode | null): string | null {
  if (!sectPr) return null;
  let found: string | null = null;
  const walk = (node: OoxmlNode, paragraphId: string | null, depth: number): void => {
    if (found !== null || node.kind === 'textValue' || depth > 64) return;
    const within = node.kind === 'paragraph' ? node.id : paragraphId;
    if (node.id === sectPr.id) {
      found = within;
      return;
    }
    for (const child of node.children) walk(child, within, depth + 1);
  };
  walk(part.root, null, 0);
  return found;
}

/**
 * The document's sections, in document order.
 *
 * `collectSectionPropertyNodes` is the authority for what a section INDEX means, shared with the
 * header/footer lifecycle: a read here and a `createHeaderFooter` op must count sections the same
 * way, or a script would put a header on the section beside the one it read.
 */
export function sectionReads(
  pkg: OoxmlPackage,
  main: OoxmlPart,
  furniture: readonly HeaderFooterSectionResolution[]
): readonly AutomationSectionRead[] {
  void pkg;
  const nodes = collectSectionPropertyNodes(main.root);
  return Object.freeze(
    nodes.map((sectPr, index) => {
      const resolved = furniture[index];
      return Object.freeze({
        index,
        markParagraphId: markParagraphOf(main, sectPr),
        pageSetup: pageSetupOf(sectPr),
        titlePage: resolved?.titlePage ?? false,
        evenAndOddHeaders: resolved?.evenAndOddHeaders ?? false,
      }) as AutomationSectionRead;
    })
  );
}
