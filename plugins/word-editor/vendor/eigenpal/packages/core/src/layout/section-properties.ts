// The page the document actually asks for (task 11.1 follow-through).
//
// Layout had been paginating every document onto US Letter with one-inch margins, because
// the geometry was a constant and nothing read `w:sectPr`. That is not a chrome detail: a
// document authored A4, or landscape, or with narrow margins, broke its lines and its pages
// in the wrong places, so the page count was wrong before anything was painted.
//
// It is also what a ruler is: the tick marks and the indent handles are the section's
// margins, so the chrome cannot be assembled without this either.
//
// Twips throughout, because that is what the file stores — a twentieth of a point. Converting
// early would round twice, once here and once into layout units.
//
// Multi-section documents: a paragraph-level `w:pPr/w:sectPr` ends the section that contains
// that paragraph; the body-level `w:sectPr` ends the final section (ECMA-376 §17.6). Absent
// `w:type` defaults to `nextPage`.

import {
  readOnOffChild,
  readTwipsMeasure,
  // Aliased: this file's own `twips` is the bounded attribute parser below.
  twips as asTwips,
  twipsToPoints,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createRecentRootCache } from '../store/store/recent-root-cache.ts';
import { parsePageBorders, type SectionPageBorders } from './page-borders.ts';
import { DEFAULT_PAGE_GEOMETRY, type PageGeometry } from './semantic-records.ts';
import { storyBlocks } from './story-roots.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';

/**
 * Hard ceiling on sections enumerated from a document (matches write-path
 * `MAX_SECTIONS` in note/hf lifecycle). Hostile packages with unbounded `w:sectPr`
 * marks fail closed here rather than amplifying layout props arrays.
 */
export const MAX_DOCUMENT_SECTIONS = 4_096;

/** A section's margins in twips, including the header and footer reserve bands. */
export interface SectionMargins {
  readonly topTwips: number;
  readonly rightTwips: number;
  readonly bottomTwips: number;
  readonly leftTwips: number;
  readonly headerTwips: number;
  readonly footerTwips: number;
  readonly gutterTwips: number;
}

/** One explicit `w:col`: its width and the gap after it. */
export interface SectionColumnDefinition {
  readonly widthTwips: number;
  /** Space after this column; zero on the final column. */
  readonly gapTwips: number;
}

/**
 * A section's column layout.
 *
 * Equal-width and explicit-width columns are one type because a file may declare `w:num` with no
 * `w:col` children at all, and layout must handle both without branching at every use site.
 */
export interface SectionColumns {
  readonly count: number;
  /** Shared gap for equal-width columns and fallback gap for incomplete explicit definitions. */
  readonly gapTwips: number;
  readonly equalWidth?: boolean;
  readonly separator?: boolean;
  /** Authored `w:col` geometry when `equalWidth` is false. */
  readonly definitions?: readonly SectionColumnDefinition[];
  /** A right-to-left section (`w:bidi`): the first column is the rightmost. */
  readonly rightToLeft?: true;
}

/**
 * How this section is placed relative to the previous one (ECMA-376 17.6.22,
 * `ST_SectionMark`).
 *
 * All five schema values are read. `nextColumn` paginates like `nextPage` for now: in a
 * single-column section that IS Word's behaviour, and multi-column flow is not modelled,
 * so collapsing it at the parse boundary would only hide the authored value from a
 * consumer that asks.
 */
export type SectionBreakType = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn';

/**
 * Authored `w:pgNumType` (ECMA-376 CT_PageNumber).
 *
 * Distinguishes three states via {@link SectionProperties.pageNumbering}:
 * - element absent → `undefined` (Word defaults; no empty element to re-emit)
 * - empty `<w:pgNumType/>` → `{}` (present, no authored attrs; must round-trip empty)
 * - attributes set → only those keys appear (never invent schema defaults like `fmt=decimal`)
 *
 * `chapStyle` / `chapSep` are preserved for consumers; PAGE projection does not yet compose
 * chapter numbers (heading outline resolution is out of this slice).
 */
export interface SectionPageNumbering {
  /** Authored `@w:start` when present and in range; otherwise omitted. */
  readonly start?: number;
  /** Authored `@w:fmt` (ST_NumberFormat) when present; otherwise omitted. */
  readonly fmt?: string;
  /** Authored `@w:chapStyle` outline level when present and in range. */
  readonly chapStyle?: number;
  /** Authored `@w:chapSep` when present (hyphen / period / colon / emDash / enDash). */
  readonly chapSep?: string;
}

/**
 * One section's resolved `w:sectPr`, as layout needs it.
 *
 * Resolved, not raw: defaults the file omitted are filled in here (an absent `w:type` is
 * `nextPage`), so layout never has to know which attributes were authored and which were
 * inherited.
 */
export interface SectionProperties {
  /** Active document grid line pitch: line-unit paragraph margins and line snapping. */
  readonly gridLinePitchTwips?: number;
  readonly pageSize: { readonly widthTwips: number; readonly heightTwips: number };
  readonly margins: SectionMargins;
  readonly columns: SectionColumns;
  readonly landscape: boolean;
  readonly titlePage: boolean;
  /** Absent `w:type` defaults to `nextPage`. */
  readonly breakType: SectionBreakType;
  /**
   * Authored page-number type. Absent when `w:pgNumType` is missing; empty object when the
   * element is present with no attributes (comprehensive-fixture shape).
   */
  readonly pageNumbering?: SectionPageNumbering;
  /**
   * Resolved `w:pgBorders` (§17.6.10). Absent when the section declares none, or when every
   * edge it declares is off or an art border — see {@link parsePageBorders}.
   */
  readonly pageBorders?: SectionPageBorders;
  /**
   * Authored `w:vAlign` (§17.6.23) other than `top`: where the body sits between the top and
   * bottom of the text area. Absent means top alignment.
   */
  readonly verticalAlign?: SectionVerticalAlign;
}

/** `w:sectPr/w:vAlign` values other than the default `top`. */
export type SectionVerticalAlign = 'center' | 'bottom' | 'both';

/**
 * One section of the body story: contiguous top-level blocks plus the properties that end it.
 *
 * `blockStart` / `blockEndExclusive` index into `storyBlocks(part)`.
 */
export interface DocumentSection {
  readonly index: number;
  readonly properties: SectionProperties;
  readonly blockStart: number;
  readonly blockEndExclusive: number;
}

/** US Letter, portrait, one-inch margins: Word's own default when a section says nothing. */
export const DEFAULT_SECTION_PROPERTIES: SectionProperties = Object.freeze({
  pageSize: Object.freeze({ widthTwips: 12240, heightTwips: 15840 }),
  margins: Object.freeze({
    topTwips: 1440,
    rightTwips: 1440,
    bottomTwips: 1440,
    leftTwips: 1440,
    headerTwips: 720,
    footerTwips: 720,
    gutterTwips: 0,
  }),
  columns: Object.freeze({
    count: 1,
    gapTwips: 720,
    equalWidth: true,
    separator: false,
    definitions: Object.freeze([]),
  }),
  landscape: false,
  titlePage: false,
  breakType: 'nextPage',
});

/**
 * A measurement from an attacker-controlled attribute.
 *
 * Bounded, not merely parsed: these become page dimensions, and a document is free to claim
 * a page a million inches tall. A page that large would paginate into a number of pages
 * bounded only by memory, so an out-of-range value falls back rather than being honoured.
 */
function twips(raw: string | undefined, fallback: number, max = 31680 * 2): number {
  const value = readTwipsMeasure(raw);
  if (value === null || value <= 0 || value > max) return fallback;
  return value;
}

/** Margins may legitimately be negative (content bleeding into the margin) but not absurd. */
function marginTwips(raw: string | undefined, fallback: number): number {
  const value = readTwipsMeasure(raw);
  if (value === null || Math.abs(value) > 31680) return fallback;
  return value;
}

/** Column gaps may be zero; unlike page dimensions they are not required to be positive. */
function nonNegativeTwips(raw: string | undefined, fallback: number, max = 31680): number {
  const value = readTwipsMeasure(raw);
  if (value === null || value < 0 || value > max) return fallback;
  return value;
}

const attribute = (node: OoxmlNode, name: string): string | undefined => {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === name) return entry.value;
  }
  return undefined;
};

const childNamed = (node: OoxmlNode, localName: string): OoxmlNode | undefined => {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children ?? []) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === localName) {
      return child;
    }
  }
  return undefined;
};

function onOffAttribute(node: OoxmlNode, name: string, fallback: boolean): boolean {
  const value = attribute(node, name);
  if (value === undefined) return fallback;
  if (value === '0' || value === 'false' || value === 'off' || value === 'no') return false;
  if (value === '1' || value === 'true' || value === 'on' || value === 'yes') return true;
  return fallback;
}

function columnCount(cols: OoxmlNode | undefined): number {
  if (!cols) return 1;
  const raw = attribute(cols, 'num');
  if (!raw || !/^\d{1,7}$/.test(raw)) return 1;
  return Math.max(1, Math.min(12, Number(raw)));
}

/**
 * Explicit `w:col` geometry, or no definitions when the set cannot be used.
 *
 * - Only the first `count` children count; extra children are ignored.
 * - An absent `w:w` spans the section's content width, so the next column starts past it.
 * - An absent `w:space` is no gap. It does NOT inherit `w:cols/@w:space`, which applies only
 *   to equal-width columns.
 * - The final column's `w:space` is ignored.
 * - A zero or very narrow width is kept: the column is that narrow.
 *
 * A width or gap that is not a measurement, is negative, or is out of range makes the whole set
 * unusable, and so does a set with fewer children than `count`. Layout then falls back to equal
 * columns. Keeping the readable widths and inventing the rest would move every later column to
 * an arbitrary position.
 */
function columnDefinitions(
  cols: OoxmlNode | undefined,
  count: number,
  contentWidthTwips: number
): readonly SectionColumnDefinition[] {
  if (!cols || cols.kind === 'textValue') return [];
  const definitions: SectionColumnDefinition[] = [];
  for (const child of cols.children ?? []) {
    if (definitions.length >= count) break;
    if (child.kind === 'textValue' || !('localName' in child) || child.localName !== 'col') {
      continue;
    }
    const rawWidth = attribute(child, 'w');
    const widthTwips =
      rawWidth === undefined ? contentWidthTwips : nonNegativeTwips(rawWidth, -1, 31680);
    const last = definitions.length === count - 1;
    const rawGap = attribute(child, 'space');
    const gapTwips = last || rawGap === undefined ? 0 : nonNegativeTwips(rawGap, -1);
    if (widthTwips < 0 || gapTwips < 0) return [];
    definitions.push({ widthTwips, gapTwips });
  }
  return definitions.length === count ? definitions : [];
}

function breakTypeOf(sectPr: OoxmlNode | undefined): SectionBreakType {
  const type = sectPr ? childNamed(sectPr, 'type') : undefined;
  const value = type ? attribute(type, 'val') : undefined;
  if (
    value === 'continuous' ||
    value === 'evenPage' ||
    value === 'oddPage' ||
    value === 'nextColumn'
  ) {
    return value;
  }
  // Absent or unknown → nextPage (ECMA-376 §17.6.22).
  return 'nextPage';
}

const CHAPTER_SEPS = new Set(['hyphen', 'period', 'colon', 'emDash', 'enDash']);

/**
 * Parse authored `w:pgNumType` without inventing schema defaults.
 *
 * Returns `undefined` when the element is absent. An empty element yields `{}` so callers
 * can tell "present but unauthored" from "missing" and serialization can re-emit empty.
 * Hostile / out-of-range attribute values are dropped rather than clamped into meaning.
 */
export function parsePageNumbering(sectPr: OoxmlNode): SectionPageNumbering | undefined {
  const pgNumType = childNamed(sectPr, 'pgNumType');
  if (!pgNumType || pgNumType.kind === 'textValue') return undefined;

  const numbering: {
    start?: number;
    fmt?: string;
    chapStyle?: number;
    chapSep?: string;
  } = {};

  const startRaw = attribute(pgNumType, 'start');
  if (startRaw !== undefined && /^-?\d{1,7}$/.test(startRaw)) {
    const start = Number(startRaw);
    // Page starts are positive; Word rejects 0 / negative in practice. Cap hostile sizes.
    if (Number.isFinite(start) && start >= 0 && start <= 9999) numbering.start = start;
  }

  const fmt = attribute(pgNumType, 'fmt');
  if (fmt !== undefined && fmt.length > 0 && fmt.length <= 64 && !/[<>&"']/.test(fmt)) {
    numbering.fmt = fmt;
  }

  const chapStyleRaw = attribute(pgNumType, 'chapStyle');
  if (chapStyleRaw !== undefined && /^\d{1,2}$/.test(chapStyleRaw)) {
    const chapStyle = Number(chapStyleRaw);
    // Outline levels are 0…9 in WordprocessingML heading practice.
    if (Number.isFinite(chapStyle) && chapStyle >= 0 && chapStyle <= 9) {
      numbering.chapStyle = chapStyle;
    }
  }

  const chapSep = attribute(pgNumType, 'chapSep');
  if (chapSep !== undefined && CHAPTER_SEPS.has(chapSep)) numbering.chapSep = chapSep;

  return numbering;
}

/**
 * Memoized on the immutable `w:sectPr` node. Every layout pass re-enumerates sections over
 * the fresh part, and re-parsing each unchanged sectPr allocated a new properties object per
 * pass — which also broke identity-keyed memos downstream (geometry, structure keys).
 */
const parsedSectionProperties = new WeakMap<object, SectionProperties>();

/** Parse one `w:sectPr` into geometry/break properties (null reads as Word's defaults). */
export function parseSectionProperties(sectPr: OoxmlNode | null | undefined): SectionProperties {
  if (!sectPr) return DEFAULT_SECTION_PROPERTIES;
  const cached = parsedSectionProperties.get(sectPr);
  if (cached !== undefined) return cached;
  const parsed = parseSectionPropertiesUncached(sectPr);
  parsedSectionProperties.set(sectPr, parsed);
  return parsed;
}

function parseSectionPropertiesUncached(sectPr: OoxmlNode): SectionProperties {
  const pgSz = childNamed(sectPr, 'pgSz');
  const pgMar = childNamed(sectPr, 'pgMar');
  const cols = childNamed(sectPr, 'cols');
  const defaults = DEFAULT_SECTION_PROPERTIES;
  const grid = childNamed(sectPr, 'docGrid');
  const gridType = grid ? attribute(grid, 'type') : undefined;
  // `w:linePitch` is `ST_DecimalNumber`, not a twips measure: only an integer is a pitch.
  const rawPitch = grid ? attribute(grid, 'linePitch') : undefined;
  const gridPitch =
    rawPitch !== undefined && /^\d{1,7}$/.test(rawPitch) && Number(rawPitch) <= 31680
      ? Number(rawPitch)
      : 0;

  const orientation = pgSz ? attribute(pgSz, 'orient') : undefined;
  const width = pgSz
    ? twips(attribute(pgSz, 'w'), defaults.pageSize.widthTwips)
    : defaults.pageSize.widthTwips;
  const height = pgSz
    ? twips(attribute(pgSz, 'h'), defaults.pageSize.heightTwips)
    : defaults.pageSize.heightTwips;

  const pageNumbering = parsePageNumbering(sectPr);
  const pageBorders = parsePageBorders(sectPr);
  const verticalAlign = verticalAlignOf(sectPr);
  const count = columnCount(cols);
  const gapTwips = cols
    ? nonNegativeTwips(attribute(cols, 'space'), defaults.columns.gapTwips)
    : defaults.columns.gapTwips;
  const equalWidth = cols ? onOffAttribute(cols, 'equalWidth', true) : true;

  const margins: SectionMargins = {
    topTwips: pgMar ? marginTwips(attribute(pgMar, 'top'), 1440) : defaults.margins.topTwips,
    rightTwips: pgMar ? marginTwips(attribute(pgMar, 'right'), 1440) : defaults.margins.rightTwips,
    bottomTwips: pgMar
      ? marginTwips(attribute(pgMar, 'bottom'), 1440)
      : defaults.margins.bottomTwips,
    leftTwips: pgMar ? marginTwips(attribute(pgMar, 'left'), 1440) : defaults.margins.leftTwips,
    headerTwips: pgMar
      ? marginTwips(attribute(pgMar, 'header'), 720)
      : defaults.margins.headerTwips,
    footerTwips: pgMar
      ? marginTwips(attribute(pgMar, 'footer'), 720)
      : defaults.margins.footerTwips,
    gutterTwips: pgMar ? marginTwips(attribute(pgMar, 'gutter'), 0) : defaults.margins.gutterTwips,
  };
  const contentWidthTwips = width - margins.leftTwips - margins.rightTwips - margins.gutterTwips;

  return {
    // Every grid type but `default` has a line pitch (ST_DocGrid); an absent type is no grid.
    ...((gridType === 'lines' || gridType === 'linesAndChars' || gridType === 'snapToChars') &&
    gridPitch > 0
      ? { gridLinePitchTwips: gridPitch }
      : {}),
    pageSize: { widthTwips: width, heightTwips: height },
    margins,
    columns: {
      // A column count of zero or a hostile number would divide the content width to nothing.
      count,
      gapTwips,
      equalWidth,
      separator: cols ? onOffAttribute(cols, 'sep', false) : false,
      definitions: equalWidth ? [] : columnDefinitions(cols, count, contentWidthTwips),
      ...(count > 1 && readOnOffChild(sectPr, 'bidi') ? { rightToLeft: true as const } : {}),
    },
    // Render-truthful: Word writes swapped dimensions AND the attribute, but a file may
    // carry only one. Width exceeding height IS a landscape page whatever the attribute
    // says, because layout paginates against the dimensions.
    landscape: orientation === 'landscape' || width > height,
    titlePage: readOnOffChild(sectPr, 'titlePg'),
    breakType: breakTypeOf(sectPr),
    ...(pageNumbering !== undefined ? { pageNumbering } : {}),
    ...(pageBorders !== undefined ? { pageBorders } : {}),
    ...(verticalAlign !== undefined ? { verticalAlign } : {}),
  };
}

function verticalAlignOf(sectPr: OoxmlNode): SectionVerticalAlign | undefined {
  const vAlign = childNamed(sectPr, 'vAlign');
  const value = vAlign ? attribute(vAlign, 'val') : undefined;
  return value === 'center' || value === 'bottom' || value === 'both' ? value : undefined;
}

/** A section's active line-grid pitch in points, or `undefined` when it has no line grid. */
export function sectionLineGridPt(section: SectionProperties | undefined): number | undefined {
  const pitch = section?.gridLinePitchTwips;
  return pitch === undefined ? undefined : pitch / 20;
}

/**
 * The body-level `w:sectPr`, which governs the FINAL section.
 *
 * Exported because the last section's properties live nowhere else: every earlier section is
 * closed by a paragraph-level mark, and a caller that collects only those has no node at all
 * for the last one — including the whole of a single-section document.
 */
export function bodySectionNode(part: OoxmlPart): OoxmlNode | undefined {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'body') return childNamed(node, 'sectPr');
    for (const child of node.children ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  return find(part.root);
}

/**
 * Each section's own `w:sectPr`: the one in the paragraph that closes it, or the body-level
 * one for the last section. A section closed by anything else has none.
 */
export function sectionPropertiesNodes(
  part: OoxmlPart,
  blocks: readonly OoxmlElement[],
  sections: readonly { readonly blockStart: number; readonly blockEndExclusive: number }[]
): readonly (OoxmlElement | undefined)[] {
  const body = bodySectionNode(part);
  const final =
    body !== undefined && body.kind !== 'textValue' ? (body as OoxmlElement) : undefined;
  return sections.map((section, index) => {
    const closing =
      section.blockStart < section.blockEndExclusive
        ? blocks[section.blockEndExclusive - 1]
        : undefined;
    const own = closing?.kind === 'paragraph' ? paragraphSectionNode(closing) : undefined;
    return own ?? (index === sections.length - 1 ? final : undefined);
  });
}

/**
 * Memoized on the immutable paragraph: an edit replaces the paragraph object, so the answer
 * holds for as long as the node does. Section enumeration asks this of EVERY body paragraph
 * on every fresh part, which made the per-keystroke scan O(document).
 */
const paragraphSectionNodes = new WeakMap<OoxmlElement, OoxmlElement | null>();

/** `w:sectPr` nested under a paragraph's `w:pPr`, if present. */
export function paragraphSectionNode(paragraph: OoxmlElement): OoxmlElement | undefined {
  const cached = paragraphSectionNodes.get(paragraph);
  if (cached !== undefined) return cached ?? undefined;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const sectPr = pPr ? childNamed(pPr, 'sectPr') : undefined;
  const result = sectPr && sectPr.kind !== 'textValue' ? (sectPr as OoxmlElement) : undefined;
  paragraphSectionNodes.set(paragraph, result ?? null);
  return result;
}

/**
 * The section properties a part declares, or Word's defaults where it says nothing.
 *
 * Returns the FINAL section (body-level `w:sectPr`, else the last paragraph-level one).
 * Multi-section geometry belongs to `enumerateDocumentSections`; chrome that needs "the
 * document's page" still reads the last section, which is what Word's body-level sectPr is.
 */
export function readSectionProperties(part: OoxmlPart): SectionProperties {
  const sections = enumerateDocumentSections(part);
  return sections[sections.length - 1]?.properties ?? DEFAULT_SECTION_PROPERTIES;
}

/**
 * Split the body story into sections.
 *
 * A paragraph carrying `w:pPr/w:sectPr` ends the current section (that paragraph is IN the
 * section being ended). The body-level `w:sectPr` ends the final section. A document with
 * neither yields one section of Word defaults covering every block.
 *
 * Enumeration is capped at {@link MAX_DOCUMENT_SECTIONS}. Further paragraph-level section
 * breaks are ignored and remaining blocks fold into the last accepted section (fail closed).
 *
 * `displayMode` MUST match the one the caller passes to `storyBlocks`. `blockStart` /
 * `blockEndExclusive` are indices into that list, and the list changes shape with the mode:
 * the proposed view drops a paragraph whose mark and content a revision both removed. Slicing
 * a filtered list with indices counted over an unfiltered one puts body text under another
 * section's page geometry — the wrong paper size, the wrong margins, the wrong header.
 */
export function enumerateDocumentSections(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): DocumentSection[] {
  return enumerateDocumentSectionsBounded(part, displayMode, authorFilter).sections;
}

/**
 * Canonical section index behind each section in a revision-projected body.
 *
 * A removed paragraph mark can collapse an entire section. The projected section keeps the
 * surviving paragraph's geometry, while package APIs such as header/footer resolution remain
 * indexed over the canonical tree. This bridge prevents those two index spaces from being
 * paired positionally.
 */
export function projectedSectionSourceIndexes(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): readonly number[] {
  const projectedBlocks = storyBlocks(part, displayMode, authorFilter);
  const projected = enumerateDocumentSectionsFromBlocks(part, projectedBlocks).sections;
  const canonicalBlocks = storyBlocks(part, 'all-markup');
  const canonical = enumerateDocumentSectionsFromBlocks(part, canonicalBlocks).sections;
  const finalCanonicalIndex = Math.max(0, canonical.length - 1);
  const canonicalIndexByClosingParagraph = new Map<string, number>();

  for (const section of canonical) {
    if (section.blockStart === section.blockEndExclusive) continue;
    const closing = canonicalBlocks[section.blockEndExclusive - 1];
    if (closing?.kind === 'paragraph' && paragraphSectionNode(closing)) {
      canonicalIndexByClosingParagraph.set(closing.id, section.index);
    }
  }

  return projected.map((section) => {
    if (section.blockStart === section.blockEndExclusive) return finalCanonicalIndex;
    const closing = projectedBlocks[section.blockEndExclusive - 1];
    if (closing?.kind !== 'paragraph' || !paragraphSectionNode(closing)) {
      return finalCanonicalIndex;
    }
    return canonicalIndexByClosingParagraph.get(closing.id) ?? finalCanonicalIndex;
  });
}

/**
 * Every section in a document, with a flag saying whether the list was cut short.
 *
 * `truncated` is reported rather than silent: section count comes from a file, so a crafted
 * document declaring thousands of paragraph-level `w:sectPr` marks is bounded, and a reader
 * should be able to tell that happened.
 */
export interface DocumentSectionsEnumeration {
  readonly sections: DocumentSection[];
  /** True when paragraph-level sectPr marks beyond {@link MAX_DOCUMENT_SECTIONS} were dropped. */
  readonly truncated: boolean;
}

/**
 * Like {@link enumerateDocumentSections}, but reports whether the section bound clipped
 * hostile input. Prefer the plain enumerator for normal layout; use this when a caller
 * needs a named fail-closed diagnostic.
 */
export function enumerateDocumentSectionsBounded(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): DocumentSectionsEnumeration {
  return enumerateDocumentSectionsFromBlocks(part, storyBlocks(part, displayMode, authorFilter));
}

/**
 * Memoized on the blocks array identity (stable per `(part, displayMode)` thanks to the
 * `storyBlocks` memo), validated against the part: parts are immutable, so an identical
 * `(part, blocks)` pair proves the enumeration cannot differ. One flush enumerates
 * sections from several callers — layout geometry, furniture, note pagination, snapshot
 * derivation — and each paid the full per-paragraph `w:sectPr` scan. Callers treat the
 * result as read-only; a shared array is safe. Bounded WeakRef ring, not a WeakMap,
 * because undo history retains snapshots by reference.
 */
const sectionsCache = createRecentRootCache<{
  readonly part: OoxmlPart;
  readonly result: DocumentSectionsEnumeration;
}>(16);

/** Internal shared-list variant for callers that already enumerated the story blocks. */
export function enumerateDocumentSectionsFromBlocks(
  part: OoxmlPart,
  blocks: readonly OoxmlElement[]
): DocumentSectionsEnumeration {
  const cached = sectionsCache.get(blocks);
  if (cached && cached.part === part) return cached.result;
  const result = enumerateSectionsUncached(part, blocks);
  sectionsCache.set(blocks, { part, result });
  return result;
}

function enumerateSectionsUncached(
  part: OoxmlPart,
  blocks: readonly OoxmlElement[]
): DocumentSectionsEnumeration {
  const sections: DocumentSection[] = [];
  let blockStart = 0;
  let truncated = false;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind !== 'paragraph') continue;
    const sectPr = paragraphSectionNode(block);
    if (!sectPr) continue;
    if (sections.length >= MAX_DOCUMENT_SECTIONS) {
      truncated = true;
      continue;
    }
    sections.push({
      index: sections.length,
      properties: parseSectionProperties(sectPr),
      blockStart,
      blockEndExclusive: index + 1,
    });
    blockStart = index + 1;
  }

  if (truncated) {
    // Hostile extra breaks ignored: extend the last accepted section over remaining blocks.
    if (sections.length > 0) {
      const last = sections[sections.length - 1]!;
      sections[sections.length - 1] = {
        ...last,
        blockEndExclusive: blocks.length,
      };
    }
    return { sections, truncated: true };
  }

  const bodySectPr = bodySectionNode(part);
  // Final section: remaining blocks governed by the body-level `w:sectPr`. When every block
  // already closed a paragraph-level section, still honour a trailing body-level `sectPr` as
  // an empty final section (common in multi-section packages). A document with neither yields
  // one default section covering every block.
  if (blockStart < blocks.length || sections.length === 0) {
    if (sections.length >= MAX_DOCUMENT_SECTIONS) {
      const last = sections[sections.length - 1]!;
      sections[sections.length - 1] = { ...last, blockEndExclusive: blocks.length };
      return { sections, truncated: true };
    }
    sections.push({
      index: sections.length,
      properties: parseSectionProperties(bodySectPr),
      blockStart,
      blockEndExclusive: blocks.length,
    });
  } else if (bodySectPr) {
    if (sections.length >= MAX_DOCUMENT_SECTIONS) {
      return { sections, truncated: true };
    }
    sections.push({
      index: sections.length,
      properties: parseSectionProperties(bodySectPr),
      blockStart,
      blockEndExclusive: blocks.length,
    });
  }

  return { sections, truncated };
}

/**
 * Section properties as the geometry layout paginates against.
 *
 * The gutter is added to the LEFT margin: it is binding allowance, extra space on the inner
 * edge, and folding it into the content width instead would silently narrow every line.
 *
 * Top and bottom keep the authored sign of `w:pgMar`: a negative value is an exact inset that
 * header and footer height never moves. Read them through `page-body-margins.ts`.
 */
export function geometryOfSection(section: SectionProperties): PageGeometry {
  const width = twipsToPoints(asTwips(section.pageSize.widthTwips));
  const height = twipsToPoints(asTwips(section.pageSize.heightTwips));
  const left = twipsToPoints(asTwips(section.margins.leftTwips + section.margins.gutterTwips));
  const right = twipsToPoints(asTwips(section.margins.rightTwips));
  const top = twipsToPoints(asTwips(section.margins.topTwips));
  const bottom = twipsToPoints(asTwips(section.margins.bottomTwips));

  // A page whose side margins exceed it has no content width at all. Fall back rather than
  // lay out into it. Top and bottom margins that together pass the sheet height stay as
  // authored (§17.6.11): the body starts at the top margin and the content box keeps one
  // point of column there (`page-furniture-insets.ts`), so each page holds one line.
  if (width - left - right <= 0) return DEFAULT_PAGE_GEOMETRY;
  return {
    width,
    height,
    margin: { top, right, bottom, left },
    headerDistance: twipsToPoints(asTwips(Math.max(0, section.margins.headerTwips))),
    footerDistance: twipsToPoints(asTwips(Math.max(0, section.margins.footerTwips))),
  };
}
