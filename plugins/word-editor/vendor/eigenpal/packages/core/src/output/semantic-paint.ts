import {
  applySyntheticBoldSpacing,
  fieldAnchorStart,
  paintUnspacedBlanks,
  followingGapPaint,
  paintedGapBetween,
  letterGapSpacing,
  syntheticBoldSpacingPt,
} from './semantic-paint-letter-gap.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { paintUnsupportedContent } from './unsupported-elements.ts';
import {
  reflowTableFragment,
  rememberPaintedCell,
  rememberPaintedTable,
  previousTableElement,
} from './semantic-paint-table-retention.ts';
import type { TableRowFragmentRecord } from '../layout/semantic-records.ts';
import { applyRevisionPresentation } from './semantic-paint-revisions.ts';
import type { ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
import { appendEmptyLineAnchor } from './semantic-paint-empty-line.ts';
import { paintListMarkerPicture } from './semantic-paint-list-marker-picture.ts';
import { paintNoteSeparatorSpan } from './semantic-paint-note-rule.ts';
import { paintRunBorders } from './semantic-paint-run-borders.ts';
import { isRunKerningEnabled, kernsText } from '../layout/run-kerning.ts';
import { paintLegacyDropdown } from './semantic-paint-legacy-dropdown.ts';
import { paintLegacyCheckbox } from './semantic-paint-legacy-checkbox.ts';
import { paragraphIsRtl } from '../layout/rtl-paragraph.ts';
import { DEFAULT_RUN_STYLE } from '../layout/run-style.ts';

import { paintedSpanText } from '../layout/optional-hyphen-break.ts';
import { paintManualLineBreak } from './semantic-paragraph-marks.ts';
import {
  DEFAULT_BREAK_MARK_STRINGS,
  breakMarkStringsCacheToken,
  breakMarksOfLayout,
  paintParagraphEndFurniture,
  type BreakMarkPaint,
  type BreakMarkStrings,
} from './semantic-break-marks.ts';
// Non-authoritative semantic DOM paint: position elements from the numbers layout already
// published and never measures anything back: no `getBoundingClientRect`, no `offsetWidth`,
// no `getComputedStyle`, no canvas text metrics. If this file could measure, the DOM would
// become a second source of geometry and the two would drift — which is exactly the
// separation task 7.6 guards.
//
// It is also a trust boundary. Every string here is file-derived, so the DOM is built with
// `createElement` plus `textContent` and never from an HTML string, and every style value
// comes from the RESOLVED style rather than from raw authored text.

/* eslint-disable max-lines -- paint seam; note areas live in semantic-paint-notes.ts */

import {
  baselineShiftPtOf,
  glyphSizeFactorOf,
  TAB_LEADER_GLYPH,
} from '@docx-editor.dev/core/layout';
import { fallbackStackForFamily } from '../layout/canvas-measurer.ts';
import { isolatePageFromHost } from './page-host-isolation.ts';
import { styleForFontSlot } from '../layout/script-itemization.ts';
import { automaticTextColor } from '../layout/ooxml-shading.ts';
import {
  reviewAuthorSlotColor,
  revisionStyleContextKey,
  revisionStyleContextOf,
  type RevisionStyleContext,
  type RevisionStyles,
} from './revision-presentation.ts';
import { formatRevisionOf } from '@docx-editor.dev/core/layout';
import { applyParagraphFormatAnchor } from './paragraph-format-anchor.ts';
import type {
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  LineRecord,
  PageRecord,
  ParagraphBorderStrokeRecord,
  ParagraphFragmentRecord,
  ResolvedRunStyle,
  SemanticLayout,
  SpanLinkRecord,
  StyleSpanRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { paintPageNoteAreas } from './semantic-paint-notes.ts';
import { paintContentControlChrome } from './semantic-paint-content-controls.ts';
import {
  paintPageChangeBars,
  reconcilePageChangeBars,
  type ChangeBarsMode,
} from './semantic-paint-change-bars.ts';
import { applyHeaderFooterPaintChrome } from './semantic-paint-hf-chrome.ts';
import {
  paintHeaderFooterLayer,
  type HeaderFooterLayerPainter,
} from './semantic-paint-hf-layer.ts';
import { anchoredDrawingsOf } from '../layout/semantic-records.ts';
import { lineSegments } from '../layout/line-segments.ts';
import { pictureIsRtl } from '../layout/inline-picture-caret.ts';
import { type AnchoredDrawingRecord } from '../layout/drawing-layout.ts';
import {
  collectUsedDrawingElementKeys,
  collectUsedDrawingResourceKeys,
  DEFAULT_DRAWING_PAINT_STRINGS,
  drawingPaintStringsCacheToken,
  drawingUrlRegistryFor,
  paintAnchoredDrawingsLayer,
  paintInlineDrawingsOnLine,
  type DrawingPaintContext,
  type DrawingPaintStrings,
  type PaintImageUrlPort,
} from './semantic-paint-drawings.ts';
import {
  captureUnsupportedElementFocus,
  notifyUnsupportedElementsPaint,
} from './unsupported-elements.ts';
import { mountEquationForSpan } from './semantic-paint-equation.ts';
import { applyEquationRevision } from './semantic-paint-equation.ts';
import { prepareTextPaintHost } from './semantic-paint-line-end-whitespace.ts';
import { applyTextOutline } from './semantic-paint-text-outline.ts';

/**
 * When a field's result is drawn on its grey block, following Word's own View option.
 *
 * `when-selected` is Word's default and the reason the option exists at all: a document dense
 * with cross-references turns largely grey under `always`, and under `never` a reader cannot
 * tell computed text from typed text at all.
 */
export type FieldShadingMode = 'never' | 'when-selected' | 'always';

/** Word's default: shaded only while the caret is inside the field. */
export const DEFAULT_FIELD_SHADING: FieldShadingMode = 'when-selected';

/**
 * What the run painters need beyond the records: the pixel scale, and the optional
 * family-alias lookup that lets embedded fonts paint without their file-declared family
 * name entering the page-global CSS font namespace.
 */
export interface PaintContext {
  readonly unsupportedOwnerPartName?: (nodeId: string) => string;
  readonly includePartial?: boolean;
  readonly unsupportedSource?: (nodeId: string, ownerPartName?: string) => OoxmlElement | null;
  readonly scale: number;
  readonly paragraphFormatRevision?: import('../layout/revision-projection.ts').RevisionAttribution;
  /** Story's horizontal origin relative to its paper or containing textbox frame. */
  readonly tabLeaderOriginXPt?: number;
  /** Generated paragraphs that paint as non-editable navigation surfaces. */
  readonly readOnlyParagraphIds?: ReadonlySet<string>;
  /**
   * Paint without selection and editing bindings (`data-paragraph-id`, `data-start`, the
   * drawing position and node attributes): a story no caret, selection or drawing command may
   * reach, such as the text of a group's text box member.
   */
  readonly unbound?: boolean;
  /**
   * Empty-TOC begin paragraphs that paint subtle identifiable furniture. Paint-only — never
   * serialised into the document.
   */
  readonly emptyTocPlaceholderIds?: ReadonlySet<string>;
  /**
   * Maps a document-declared family to the alias the host registered its bytes under, or
   * `undefined` when that family has no aliased face. Engine-minted values only.
   */
  readonly fontAlias?: (family: string) => string | undefined;
  /** See {@link PaintOptions.serifHangulFace}. */
  readonly serifHangulFace?: (family: string) => boolean;
  /**
   * The family painted for a run whose cascade authors no font — the SAME face the
   * measurer falls back to. Without it such a run inherits the page's CSS font, and the
   * browser draws one face over geometry measured for another: wrap points, caret and
   * selection rectangles all drift from the visible glyphs.
   */
  readonly defaultFontFamily?: string;
  /**
   * Paint hyperlinks without an `href` and out of the tab order.
   *
   * Set while painting page furniture: headers and footers are read-only in this slice, so
   * a live link there would be the one thing in the furniture that answers a gesture.
   */
  readonly inertLinks?: boolean;
  /** Localized drawing refusal labels (defaults to English fallbacks). */
  readonly drawingStrings?: DrawingPaintStrings;
  /** Host port for ready-image blob URLs; omitted means ready images paint as placeholders. */
  readonly imageUrlPort?: PaintImageUrlPort;
  /**
   * How field results are shaded, mirroring what Word draws.
   *
   * Word keeps two independent rules, and this is the one for ORDINARY fields (PAGE, REF, TOC):
   * an application preference, defaulting to `when-selected`, that never reaches the file.
   * LEGACY FORM FIELDS follow the document's own `w:doNotShadeFormData` instead, which is why
   * {@link shadeFormFields} is separate — a form's blanks stay findable whatever this says.
   *
   * `when-selected` is finished in CSS off a class the surface toggles from the caret, never
   * here: shading decided at paint time from a caret position would rebuild spans on every
   * arrow key, and deciding it in layout would do far worse.
   */
  readonly fieldShading?: FieldShadingMode;
  /** Paint paragraph-end and manual-line-break furniture. Tracked marks also follow Show/Hide. */
  readonly showParagraphMarks?: boolean;
  /** Labeled page, column and section break furniture, present only with paragraph marks. */
  readonly breakMarks?: BreakMarkPaint;
  /**
   * Whether legacy form fields (`w:ffData`) are shaded — the document's `w:doNotShadeFormData`,
   * inverted at the read so this states what to DO rather than what to skip.
   */
  readonly shadeFormFields?: boolean;
  /**
   * Resolved per-author colouring for tracked changes, or absent for the default kind
   * colouring. Resolved once per paint from {@link PaintOptions.revisionStyles} so every
   * page shares one author→slot map.
   */
  readonly revisionStyles?: RevisionStyleContext;
  /** Author palette for explicit cell colors, independent of text color mode. */
  readonly revisionCellStyles?: RevisionStyleContext;
  readonly revisionMarkup?: ResolvedRevisionMarkup;
  readonly revisionKindColors?: boolean;
  readonly facingPages?: boolean;
}

/**
 * A stable per-function token so the paint-reuse key can tell one font lookup from
 * another. Identity is what matters (a new lookup means new fonts); the value is opaque.
 */
const aliasTokens = new WeakMap<object, string>();
let nextAliasToken = 0;
function aliasIdentity(alias: (family: string) => unknown): string {
  let token = aliasTokens.get(alias);
  if (!token) {
    nextAliasToken += 1;
    token = `alias${nextAliasToken}`;
    aliasTokens.set(alias, token);
  }
  return token;
}

/**
 * How a layout is painted into DOM. Every field is optional.
 *
 * The painted pages ARE the editable surface, so everything here is presentation-only — nothing
 * set through these options is ever serialised back into the document.
 */
export interface PaintOptions {
  readonly unsupportedOwnerPartName?: (nodeId: string) => string;
  readonly includePartial?: boolean;
  readonly unsupportedSource?: (nodeId: string, ownerPartName?: string) => OoxmlElement | null;
  /** Points to CSS pixels. 96/72 renders a point as a CSS point at 100% zoom. */
  readonly scale?: number;
  /** Generated paragraphs that paint as non-editable navigation surfaces. */
  readonly readOnlyParagraphIds?: ReadonlySet<string>;
  /**
   * Empty-TOC begin paragraphs that paint subtle identifiable furniture. Paint-only — never
   * serialised into the document.
   */
  readonly emptyTocPlaceholderIds?: ReadonlySet<string>;
  /** Marks painted pages as presentational, so assistive tech reads the editable projection. */
  readonly ariaHidden?: boolean;
  /**
   * Page indices to build in detail (task 9.4).
   *
   * Omitted means all of them. A page left out keeps its size and position but no content,
   * so the document's height and page count are unchanged and scrolling to it reveals it
   * instead of reflowing everything underneath.
   */
  readonly materialize?: ReadonlySet<number>;
  /**
   * Family-alias lookup for fonts the host registered on behalf of THIS document (see
   * {@link PaintContext.fontAlias}). Painted runs emit the alias ahead of the declared
   * family, so a file can never shadow a family name the host page uses.
   */
  readonly fontAlias?: (family: string) => string | undefined;
  /**
   * Whether the document's font table records a family as a serif Korean face. The glyphs
   * that such a face lacks then paint in a serif Hangul face. Give the canvas measurer the
   * same lookup.
   * @internal
   */
  readonly serifHangulFace?: (family: string) => boolean;
  /** See {@link PaintContext.defaultFontFamily}. */
  readonly defaultFontFamily?: string;
  /** See {@link PaintContext.fieldShading}. */
  readonly fieldShading?: FieldShadingMode;
  /** Paint paragraph-end and manual-line-break furniture. Tracked marks also follow Show/Hide. */
  readonly showParagraphMarks?: boolean;
  /** Localized labels for the break furniture paragraph marks show (defaults to English). */
  readonly breakMarkStrings?: BreakMarkStrings;
  /** See {@link PaintContext.shadeFormFields}. */
  readonly shadeFormFields?: boolean;
  /**
   * How tracked changes are coloured: by AUTHOR through the `--doc-review-author-N`
   * ramp (the default, as in Word), by kind, or by author with host-pinned colours.
   * See {@link RevisionStyles}.
   */
  readonly revisionStyles?: RevisionStyles;
  readonly revisionMarkup?: ResolvedRevisionMarkup;
  readonly revisionKindColors?: boolean;
  readonly facingPages?: boolean;
  /**
   * Which change bars the margin draws: All Markup's neutral rule beside attributed lines
   * (the default, whatever the layout's projection — a layout that carries attribution gets
   * its bars), Simple Markup's red rule beside the change sites a resolved layout published,
   * or none, which the review chrome names for its resolved views.
   */
  readonly changeBars?: ChangeBarsMode;
  /**
   * Whether a change bar takes the pointer as Word's does — a click swaps Simple and All
   * Markup. Only a host that can act on the press should set it; the bars stay inert
   * furniture otherwise.
   */
  readonly changeBarsToggle?: boolean;
  /**
   * Relationship id of the header/footer story currently open for editing.
   *
   * When set, the matching `[data-docx-hf]` container is editable and every body
   * `.docx-page-content` box is inert; all other furniture stays read-only.
   *
   * Deliberately OUTSIDE the paint-reuse key: entering a header must not rebuild
   * body sheets. Chrome is applied to already-painted nodes in place, the way TOC
   * hover is.
   */
  readonly activeHeaderFooterRId?: string;
  /**
   * Sheet that hosts the active visual occurrence of a shared furniture part.
   *
   * Required with {@link activeHeaderFooterRId} so only one painted copy receives
   * `data-docx-hf-active` / the engine caret when the same rId appears on many pages.
   * Also outside the paint-reuse key — moving the caret across shared copies retints
   * markers in place rather than replacing every page.
   */
  readonly activeHeaderFooterPageIndex?: number;
  /**
   * On-demand content-control boundary chrome (show-all and/or caret-entry).
   *
   * Furniture only — never contributes layout records or changes page geometry. Omitted or
   * empty means no control chrome is painted. Folded into the paint-reuse key so a toggle
   * rebuilds furniture without a layout pass.
   */
  readonly contentControlChrome?: {
    readonly showAll?: boolean;
    /** Control ids whose boundaries are visible because the caret is inside them. */
    readonly activeIds?: ReadonlySet<string>;
    /**
     * Control ids whose boundaries are visible because the pointer is over them.
     * Used for TOC hover chrome without projecting a persistent caret-active state.
     *
     * Deliberately OUTSIDE the paint-reuse key: hover must never rebuild a page. The
     * surface toggles `data-hover` / `data-boundary-visible` on the painted chrome it
     * already has, and this set only tells a page that rebuilds for some OTHER reason
     * which of its controls is currently under the pointer.
     */
    readonly hoverIds?: ReadonlySet<string>;
    /**
     * Control ids whose boundary furniture is painted by something else.
     *
     * An empty TOC paints its own placeholder box on the begin paragraph, so drawing the
     * control boundary as well left two rounded rectangles (of different heights) plus a
     * label chip stacked over one empty region.
     */
    readonly suppressedIds?: ReadonlySet<string>;
    /** Checkbox control ids whose canonical `w14:checked` state is on. */
    readonly checkedIds?: ReadonlySet<string>;
    /** Non-SDT structured regions that intentionally reuse content-control chrome. */
    readonly additionalBoundaries?: readonly ContentControlBoundaryRecord[];
    /** Control ids that represent TOC regions (hover-only chrome; never caret-sticky). */
    readonly tocControlIds?: ReadonlySet<string>;
    /**
     * No control may be written right now — viewing mode, or a protected document.
     *
     * The widget is a `<button>` the ENGINE paints, and a click on it commits a tree op, so
     * an enabled-looking checkbox on a read-only document is not a cosmetic lie: it is the
     * write itself. Disabling it here also stops the pointer lane, which already skips a
     * widget carrying `data-disabled-reason`.
     */
    readonly readOnly?: boolean;
  };
  readonly drawingStrings?: DrawingPaintStrings;
  readonly imageUrlPort?: PaintImageUrlPort;
}

export type { DrawingPaintStrings, PaintImageUrlPort } from './semantic-paint-drawings.ts';

type DrawingUrlRegistry = ReturnType<typeof drawingUrlRegistryFor>;

type DrawingPaintHostContext = PaintContext & {
  readonly drawingStrings?: DrawingPaintStrings;
  readonly urlRegistry?: DrawingUrlRegistry | null;
  readonly changeBars?: ChangeBarsMode;
  readonly changeBarsToggle?: boolean;
  /** Per-page discriminator for drawing element reuse (see DrawingPaintContext). */
  readonly paintInstance?: string;
};

interface ResolvedPaintContext extends DrawingPaintHostContext {
  readonly drawingStrings: DrawingPaintStrings;
  readonly urlRegistry: DrawingUrlRegistry | null;
  readonly changeBars: ChangeBarsMode;
  readonly changeBarsToggle: boolean;
}

function asResolvedPaintContext(ctx: DrawingPaintHostContext): ResolvedPaintContext {
  return {
    ...ctx,
    drawingStrings: ctx.drawingStrings ?? DEFAULT_DRAWING_PAINT_STRINGS,
    urlRegistry: ctx.urlRegistry ?? null,
    changeBars: ctx.changeBars ?? 'none',
    changeBarsToggle: ctx.changeBarsToggle ?? false,
  };
}

function resolvedDrawingPaint(ctx: ResolvedPaintContext): DrawingPaintContext {
  // Textbox stories are furniture wherever they paint: links inert, no editable bindings.
  const storyCtx: ResolvedPaintContext = { ...ctx, inertLinks: true, tabLeaderOriginXPt: 0 };
  return Object.freeze({
    scale: ctx.scale,
    includePartial: ctx.includePartial,
    ...(ctx.unsupportedSource ? { unsupportedSource: ctx.unsupportedSource } : {}),
    strings: ctx.drawingStrings,
    ...(ctx.imageUrlPort ? { imageUrlPort: ctx.imageUrlPort } : {}),
    ...(ctx.inertLinks ? { inertLinks: true } : {}),
    ...(ctx.paintInstance ? { paintInstance: ctx.paintInstance } : {}),
    ...(ctx.revisionStyles ? { revisionStyles: ctx.revisionStyles } : {}),
    ...(ctx.unbound ? { unbound: true } : {}),
    paintStoryFragment: (
      document: Document,
      fragment: ParagraphFragmentRecord | TableFragmentRecord,
      options?: { readonly readOnly?: boolean }
    ) => {
      const paintCtx = options?.readOnly ? { ...storyCtx, unbound: true } : storyCtx;
      return fragment.kind === 'table'
        ? paintTableFragment(document, fragment, paintCtx)
        : paintFragment(document, fragment, paintCtx);
    },
  });
}

function drawingContextOf(ctx: ResolvedPaintContext): {
  readonly ctx: DrawingPaintContext;
  readonly urlRegistry: DrawingUrlRegistry | null;
} {
  return Object.freeze({
    ctx: resolvedDrawingPaint(ctx),
    urlRegistry: ctx.urlRegistry,
  });
}

function appendAnchoredDrawingLayer(
  document: Document,
  parent: HTMLElement,
  page: PageRecord,
  ctx: ResolvedPaintContext,
  pageOrigin: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  layer: 'behind' | 'inFront'
): void {
  appendAnchoredDrawingsForRecords(
    document,
    parent,
    anchoredDrawingsOf(page),
    ctx,
    pageOrigin,
    layer
  );
}

function appendAnchoredDrawingsForRecords(
  document: Document,
  parent: HTMLElement,
  drawings: readonly AnchoredDrawingRecord[],
  ctx: ResolvedPaintContext,
  origin: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  layer: 'behind' | 'inFront',
  // Inert drawings paint but never take a click. Header/footer bands pass `false` while
  // the band is not being edited: their box overflows are VISIBLE (header ink reaches into
  // the margins and under the body), so a shape hanging past the band must not swallow
  // clicks meant for the document (#856).
  interactive = true,
  /** Marks a page-relative furniture layer so in-place chrome can retint hit-testing. */
  hfFrontKind?: 'header' | 'footer'
): void {
  if (drawings.length === 0) return;
  const drawing = drawingContextOf(ctx);

  const layerElement = document.createElement('div');
  layerElement.className =
    layer === 'behind'
      ? 'docx-drawing-layer docx-drawing-layer-behind'
      : 'docx-drawing-layer docx-drawing-layer-front';
  layerElement.style.position = 'absolute';
  layerElement.style.inset = '0';
  layerElement.style.pointerEvents = 'none';
  if (hfFrontKind) layerElement.dataset.docxHfFront = hfFrontKind;
  for (const element of paintAnchoredDrawingsLayer(
    document,
    drawings,
    layer,
    drawing.ctx,
    drawing.urlRegistry,
    origin
  )) {
    // Inline, not a stylesheet rule: this `auto` would beat any CSS guard.
    element.style.pointerEvents = interactive ? 'auto' : 'none';
    if (!interactive) {
      // DESCENDANTS TOO. `pointer-events: none` on an ancestor is undone by an explicit
      // `auto` on a child, and every nested drawing gets one — inline, from
      // `positionedBox`, and from the `.docx-drawing` rule. A letterhead authored as a
      // text box with a picture inside would still have swallowed the click underneath it.
      for (const nested of element.querySelectorAll<HTMLElement>('.docx-drawing')) {
        nested.style.pointerEvents = 'none';
      }
    }
    layerElement.append(element);
  }
  if (layerElement.childElementCount > 0) parent.append(layerElement);
}

const HEX = /^[0-9A-Fa-f]{6}$/;
// Unicode-aware: `\w` is ASCII-only, so every CJK family name — 游ゴシック, 맑은 고딕 — failed
// validation and the run silently fell back to the inherited face, losing the typeface of an
// entire document. Comma and semicolon are part of one family name: the sink always writes
// the name as a double-quoted CSS string through the `fontFamily` style property, so neither
// can split the family list or end the declaration. Quote, backslash and control characters
// stay excluded, which is what keeps that quoted string unbreakable.
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

/** ST_Underline to the nearest CSS decoration style. */
// MAPS, not object literals. These are indexed by a value that came out of a document, so
// an object literal would answer `constructor` and `__proto__` with something inherited —
// `?? 'solid'` never fires for `constructor`, because a function is not nullish.
const UNDERLINE_STYLE = new Map<string, string>(
  Object.entries({
    single: 'solid',
    words: 'solid',
    thick: 'solid',
    double: 'double',
    dotted: 'dotted',
    dottedHeavy: 'dotted',
    dash: 'dashed',
    dashedHeavy: 'dashed',
    dashLong: 'dashed',
    dashLongHeavy: 'dashed',
    dotDash: 'dashed',
    dashDotHeavy: 'dashed',
    dotDotDash: 'dashed',
    dashDotDotHeavy: 'dashed',
    wave: 'wavy',
    wavyHeavy: 'wavy',
    wavyDouble: 'wavy',
  })
);

export const HIGHLIGHT_COLOR_HEX = new Map<string, string>(
  Object.entries({
    black: '#000000',
    blue: '#0000ff',
    cyan: '#00ffff',
    darkBlue: '#000080',
    darkCyan: '#008080',
    darkGray: '#808080',
    darkGreen: '#008000',
    darkMagenta: '#800080',
    darkRed: '#800000',
    darkYellow: '#808000',
    green: '#00ff00',
    lightGray: '#c0c0c0',
    magenta: '#ff00ff',
    red: '#ff0000',
    yellow: '#ffff00',
    white: '#ffffff',
  })
);

type StrikeKind = 'none' | 'single' | 'double';

interface UnderlineDecoration {
  readonly cssStyle: string;
  /** Validated RRGGBB, or null when the underline follows the text colour. */
  readonly color: string | null;
  readonly heavy: boolean;
}

/** `w:dstrike` wins when both strike toggles are present (Word's Font dialog exclusivity). */
function strikeKindOf(style: ResolvedRunStyle): StrikeKind {
  if (style.doubleStrike) return 'double';
  if (style.strike) return 'single';
  return 'none';
}

function underlineHeavy(variant: string): boolean {
  return variant === 'thick' || variant.endsWith('Heavy');
}

function underlineDecorationOf(style: ResolvedRunStyle): UnderlineDecoration | null {
  if (!style.underline) return null;
  const color =
    style.underline.color && HEX.test(style.underline.color) ? style.underline.color : null;
  return {
    cssStyle: UNDERLINE_STYLE.get(style.underline.variant) ?? 'solid',
    color,
    heavy: underlineHeavy(style.underline.variant),
  };
}

/**
 * Apply one CSS text-decoration family to an element.
 *
 * Underline and strike must never share a single `text-decoration-*` declaration when their
 * style, colour or thickness differ — CSS applies those properties to every line on the
 * element. Callers nest independent layers when both families are present.
 */
function applyTextDecoration(
  css: CSSStyleDeclaration,
  line: 'underline' | 'line-through',
  decorationStyle: string,
  options: { color?: string | null; heavy?: boolean; scale: number }
): void {
  css.textDecorationLine = line;
  css.textDecorationStyle = decorationStyle;
  if (options.color) css.textDecorationColor = `#${options.color}`;
  if (options.heavy) {
    // Word's thick / *Heavy underlines are roughly twice a single rule. Floor scales with
    // paint zoom so a 200% surface does not keep a 100%-thin heavy line.
    css.textDecorationThickness = `max(${2 * options.scale}px, 0.12em)`;
  }
}

function applyStrikeDecoration(css: CSSStyleDeclaration, strike: StrikeKind, scale: number): void {
  if (strike === 'none') return;
  applyTextDecoration(css, 'line-through', strike === 'double' ? 'double' : 'solid', { scale });
}

function applyUnderlineDecoration(
  css: CSSStyleDeclaration,
  underline: UnderlineDecoration,
  scale: number
): void {
  applyTextDecoration(css, 'underline', underline.cssStyle, {
    color: underline.color,
    heavy: underline.heavy,
    scale,
  });
}

/**
 * Underline a tab's reserved ADVANCE, not its invisible `\t` glyph.
 *
 * Form blanks are often authored as `w:u` on a bare `w:tab` (thick/single). Word draws the
 * rule across the distance to the stop. CSS `text-decoration` on a clipped `\t` paints no
 * visible ink over that width, so the advance box itself carries a bottom border instead.
 * `wavy` is not a border style — fall back to solid rather than inventing a wave path.
 */
function applyTabAdvanceUnderline(
  css: CSSStyleDeclaration,
  underline: UnderlineDecoration,
  scale: number
): void {
  const color = underline.color ? `#${underline.color}` : 'currentColor';
  // Plain px widths — `max()` is fine on `text-decoration-thickness` but happy-dom (and
  // some engines) drop it on `border-*-width`, which would erase the whole form blank.
  css.borderBottomWidth = `${(underline.heavy ? 2 : 1) * scale}px`;
  css.borderBottomStyle = underline.cssStyle === 'wavy' ? 'solid' : underline.cssStyle;
  css.borderBottomColor = color;
}

/**
 * Face / box styles only — decorations are applied separately so underline and strike can
 * live on independent nested layers without sharing style/colour/thickness.
 */
function applyRunFaceStyle(element: HTMLElement, style: ResolvedRunStyle, ctx: PaintContext): void {
  const css = element.style;
  const scale = ctx.scale;
  applyTextOutline(css, style, scale);
  // Super/subscript draw at the shared reduced size — the same reduction the measurer applies, so
  // the painted glyphs match the advance layout reserved. Painting them full size while
  // measuring them small made every line containing one slightly too wide.
  const sizeFactor = glyphSizeFactorOf(style);
  css.fontSize = `${style.fontSizePt * sizeFactor * scale}px`;
  if (style.bold) css.fontWeight = 'bold';
  if (style.italic) css.fontStyle = 'italic';
  // Re-validated here even though the resolver already checked: this is the sink, and a
  // sink that trusts its caller is one refactor away from being the hole. A run with no
  // resolved family paints in the surface's default face — the face it was MEASURED in —
  // never in whatever font the page happens to inherit.
  const family =
    style.fontFamily && FONT_NAME.test(style.fontFamily)
      ? style.fontFamily
      : ctx.defaultFontFamily && FONT_NAME.test(ctx.defaultFontFamily)
        ? ctx.defaultFontFamily
        : null;
  if (family) {
    // An alias names bytes the host registered for THIS document under a family a file
    // cannot collide with. It leads, with the declared family behind it: document text
    // gets the embedded glyphs while the page-global CSS font namespace keeps its own
    // meaning for the declared name. `FONT_NAME` gates the declared family; the alias is
    // engine-minted, never file-derived.
    const alias = ctx.fontAlias?.(family);
    // The measurer's fallback stack trails the family so an unresolvable name falls
    // back to the SAME face measurement fell back to — not to the inherited font.
    const stack = fallbackStackForFamily(family, undefined, ctx.serifHangulFace);
    css.fontFamily = alias ? `"${alias}", "${family}", ${stack}` : `"${family}", ${stack}`;
  }
  if (style.color && HEX.test(style.color)) css.color = `#${style.color}`;
  const highlight = style.highlight ? HIGHLIGHT_COLOR_HEX.get(style.highlight) : undefined;
  if (highlight) {
    css.backgroundColor = highlight;
    // Marked so dark mode can counter-invert it: a highlight keeps its authored colour in
    // Word, and the lightness inversion turns yellow into a near-black bar.
    element.dataset.highlight = style.highlight ?? '';
  } else if (style.shading && HEX.test(style.shading)) {
    // Highlight overrides character shading; only paint `w:shd` when no recognised highlight.
    css.backgroundColor = `#${style.shading}`;
    // Automatic text takes white on dark shading and black on light, over any paragraph's.
    if (!css.color) css.color = automaticTextColor(style.shading) ? '#FFFFFF' : '#000000';
  }
  if (style.caps) css.textTransform = 'uppercase';
  css.fontKerning = isRunKerningEnabled(style) ? 'normal' : 'none';
  if (style.smallCaps) css.fontVariant = 'small-caps';
  // Super/subscript shift with a RELATIVE offset, not `vertical-align`. Vertical alignment
  // grows the line box to contain the raised glyph, which pushes a line's selection band
  // past the line layout published and over its neighbour. A relative offset moves the
  // glyph without touching the box, so the band still tiles.
  const shiftPt = baselineShiftPtOf(style);
  if (shiftPt !== 0) {
    css.position = 'relative';
    css.top = `${-shiftPt * scale}px`;
  }
  if (style.characterSpacingPt !== 0) {
    css.letterSpacing = `${style.characterSpacingPt * scale}px`;
  }
  if (style.horizontalScalePercent !== 100) {
    // `w:w` stretches glyphs horizontally, and a transform does not change the space the
    // element occupies — so the stretched glyphs, and the selection band drawn over them,
    // spilled across the following run. The reserved advance is given explicitly (layout
    // already scaled it) and the transform fills it.
    css.transformOrigin = 'left';
    css.transform = `scaleX(${style.horizontalScalePercent / 100})`;
  }
}

/**
 * Mount glyph text under the correct decoration layer(s).
 *
 * The outer layout-run keeps geometry, model range, highlight and shading. When underline
 * and strike both apply, nested inert spans each own one decoration family so CSS cannot
 * leak `text-decoration-style` / colour / thickness across them.
 *
 * Tab advances apply underline via {@link applyTabAdvanceUnderline} on the outer run; this
 * path must not also set `text-decoration` on `\t` or the two mechanisms fight.
 *
 * Returns the element that holds the text.
 */
function mountRunText(
  document: Document,
  run: HTMLElement,
  text: string,
  style: ResolvedRunStyle,
  scale: number
): HTMLElement {
  const underline = text === '\t' ? null : underlineDecorationOf(style);
  const strike = strikeKindOf(style);
  let host: HTMLElement = run;

  if (underline && strike !== 'none') {
    const underlineLayer = document.createElement('span');
    underlineLayer.dataset.docxDeco = 'underline';
    applyUnderlineDecoration(underlineLayer.style, underline, scale);
    const strikeLayer = document.createElement('span');
    strikeLayer.dataset.docxDeco = 'strike';
    applyStrikeDecoration(strikeLayer.style, strike, scale);
    underlineLayer.append(strikeLayer);
    run.append(underlineLayer);
    host = strikeLayer;
  } else if (underline) {
    applyUnderlineDecoration(run.style, underline, scale);
  } else if (strike !== 'none') {
    applyStrikeDecoration(run.style, strike, scale);
  }

  host.textContent = text; // SAFE: textContent, never innerHTML
  return host;
}

function positioned(
  document: Document,
  tag: string,
  box: { x: number; y: number; width: number; height: number },
  scale: number
): HTMLElement {
  const element = document.createElement(tag);
  element.style.position = 'absolute';
  element.style.left = `${box.x * scale}px`;
  element.style.top = `${box.y * scale}px`;
  element.style.width = `${box.width * scale}px`;
  element.style.height = `${box.height * scale}px`;
  return element;
}

/**
 * Draw a span as the tracked change it is.
 *
 * Applied to the run BOX rather than the inner text layers: `w:u` and `w:strike` already own
 * those, and a revision's decoration is a second, independent statement about the same glyphs.
 * Word draws both — struck-through text that was also underlined by its author keeps both rules.
 *
 * The colour lands as a custom property on the element rather than a resolved value, so a host
 * restyling `--doc-review-author-N` under `.docx-editor` changes the painted document with it.
 *
 * The dataset attributes are the review surface's join key: a card can find its own text, and
 * the active-item highlight is set by attribute rather than by building a CSS rule out of an
 * id — comment and revision metadata are attacker-controlled.
 */
/**
 * The grey block Word draws behind a field's result.
 *
 * A view affordance, never document formatting: it says "this text was computed, not typed",
 * and Word does not print it. So it lands as a CLASS, not as inline style — the stylesheet owns
 * the colour and the `@media print` rule that drops it, and it must lose cleanly to a revision
 * wash, which is inline and therefore outranks it. That ordering is the point: a deleted field
 * has to read as deleted first and as a field second.
 *
 * `when-selected` is not resolved here. Paint has no caret, and giving it one would rebuild
 * spans on every arrow key; the surface toggles `docx-field-atom--active` from the caret it
 * already tracks, exactly as it does for the open review item.
 */
function applyFieldShading(element: HTMLElement, span: StyleSpanRecord, ctx: PaintContext): void {
  const field = span.fieldAtom;
  if (!field) return;
  // Marked whatever the mode, because the mode is a VIEW setting a host can flip without
  // relaying out, and because the review surface and tests want to find fields regardless.
  element.dataset.fieldAtom = field.formField ? 'form' : 'field';
  // An editable saved result spans several pieces; the caret shades all of them together.
  if (field.resultStart !== undefined && field.resultEnd !== undefined) {
    element.dataset.fieldResultStart = String(field.resultStart);
    element.dataset.fieldResultEnd = String(field.resultEnd);
  }
  const shaded = field.formField
    ? ctx.shadeFormFields !== false
    : (ctx.fieldShading ?? DEFAULT_FIELD_SHADING) !== 'never';
  if (!shaded) return;
  element.classList.add('docx-field-atom');
  // A form field is shaded outright; an ordinary field defers to the caret unless the host
  // asked for `always`.
  if (field.formField || (ctx.fieldShading ?? DEFAULT_FIELD_SHADING) === 'always') {
    element.classList.add('docx-field-atom--shaded');
  }
}

function paintSpan(
  document: Document,
  span: StyleSpanRecord,
  ctx: PaintContext,
  bandHeightPt: number,
  extraLeadingPt: number
): HTMLElement {
  const element = document.createElement('span');
  // Ink resolves the face through the span's font slot; `span.style` itself stays the
  // run's full resolution for every consumer that reads formatting rather than glyphs.
  const faceStyle = styleForFontSlot(span.style, span.fontSlot);
  if (span.unsupported)
    return paintUnsupportedContent(document, span.unsupported, span.box, ctx.scale);
  if (span.equation) {
    if (!ctx.unbound) {
      element.dataset.paragraphId = span.range.paragraphId;
      element.dataset.start = String(span.range.start);
      element.dataset.end = String(span.range.end);
    }
    applyRunFaceStyle(element, faceStyle, ctx);
    mountEquationForSpan(document, element, span.equation, ctx, (run, style) =>
      applyRunFaceStyle(run, style, ctx)
    );
    applyEquationRevision(document, element, span, ctx);
    return element;
  }
  element.className = 'layout-run layout-run-text';
  // Each run is its OWN box, aligned on the baseline.
  //
  // The browser draws a selection band to the box it finds, and a plain inline shares the
  // line box with everything else on the line — so a line mixing 8pt and 36pt highlighted
  // as one slab as tall as the largest run. An inline-block gives every run a box of its
  // own size, which is how Word draws it: the band steps with the text.
  element.style.display = 'inline-block';
  element.style.verticalAlign = 'baseline';
  // THE BAND IS THE BOX; `extraLeadingPt` IS SPACE ABOVE THE GLYPHS INSIDE IT.
  //
  // Auto/atLeast extras live BELOW the glyph band (line padding-bottom in `paintLine`).
  // Exact centering (and any other above-band) is padding-top here. Sizing the run by
  // `line-height` alone leaves CSS to split leading in half and drift off `line.baseline`.
  //
  // Growing the line-height instead of padding is wrong for selection too: the browser
  // paints the native selection to the INNER LINE BOX, so a box shorter than its own
  // line-height bled highlight into the line below.
  element.style.boxSizing = 'border-box';
  element.style.height = `${bandHeightPt * ctx.scale}px`;
  element.style.paddingTop = `${extraLeadingPt * ctx.scale}px`;
  element.style.lineHeight = `${(bandHeightPt - extraLeadingPt) * ctx.scale}px`;
  // ADDRESSABLE ONLY IF IT OWNS OFFSETS. Selection maps through `data-paragraph-id` +
  // `data-start` and reads an endpoint as `start + textContent.length`, so a span whose
  // painted text is wider than its model range hands back an offset the paragraph does not
  // have. A `w:ptab` is exactly that — one painted `\t` over a ZERO-WIDTH range — and a
  // click just left of a contents line's page number resolved to the end of the paragraph,
  // the same answer as clicking after it. Zero-width spans paint as furniture instead: the
  // advance and its leader are still drawn, and the mapper resolves through the real text
  // either side. An ordinary `w:tab` keeps its address; it does occupy an offset.
  if (span.range.end > span.range.start) {
    if (!ctx.unbound) {
      element.dataset.paragraphId = span.range.paragraphId;
      element.dataset.start = String(span.range.start);
      element.dataset.end = String(span.range.end);
    }
  } else {
    element.setAttribute('aria-hidden', 'true');
    element.contentEditable = 'false';
  }
  applyRunFaceStyle(element, faceStyle, ctx);
  applySyntheticBoldSpacing(element, span, ctx.scale);
  if (!kernsText(faceStyle, span.text)) element.style.fontKerning = 'none';
  applyFieldShading(element, span, ctx);
  applyRevisionPresentation(element, span, ctx);
  const textHost = prepareTextPaintHost(document, element, span, ctx.scale);
  if (span.text === '\t') {
    // Keep the model character for range mapping, but clip any native tab ink that would
    // spill past the reserved advance.
    element.style.overflow = 'hidden';
    // A CLIPPED BOX MUST NOT DECIDE THE LINE'S BASELINE.
    //
    // `overflow: hidden` makes an inline-block's baseline its BOTTOM MARGIN EDGE
    // (CSS 2.1 §10.8.1) instead of the baseline of its text. Left baseline-aligned, the
    // tab therefore asked the line box for its whole band above the baseline — more than
    // any glyph run asks for, since a run only needs its ascent — so the browser pushed
    // the common baseline down to satisfy it and every word on the line dropped with it.
    // On a tabbed line that put the text ~3.4px below where layout published the baseline,
    // and the tab leader (its own layer, correctly baselined) then read as floating above
    // the text it was supposed to sit level with. Aligning the tab to the line box top
    // takes it out of the baseline calculation entirely; the box still clips, and its top
    // is exactly where a baseline-aligned run of the same band lands anyway.
    element.style.verticalAlign = 'top';
    // Form blanks: `w:u` on `w:tab` underlines the ADVANCE (Word), not the `\t` glyph.
    // An underscore leader already supplies that rule with repeated glyphs in the active
    // face. Adding the advance border as well paints two parallel lines; retain the border
    // for every other leader, where underline remains independent.
    const tabUnderline = underlineDecorationOf(span.style);
    if (tabUnderline && span.tabLeader !== 'underscore') {
      element.dataset.docxTabUnderline = '';
      applyTabAdvanceUnderline(element.style, tabUnderline, ctx.scale);
    }
  }
  const textElement = mountRunText(
    document,
    textHost,
    paintedSpanText(span),
    span.style,
    ctx.scale
  );
  paintUnspacedBlanks(document, element, textElement, span, ctx.scale);
  paintLegacyCheckbox(element, span, ctx.scale);
  paintLegacyDropdown(element, span);
  if (span.projected) {
    element.dataset.docxField = '';
    element.setAttribute('contenteditable', 'false');
    // Note citations stay pointer-interactive for navigation; PAGE fields stay inert.
    if (span.noteNav) {
      element.style.userSelect = 'none';
      if (span.noteNav.direction === 'to-note') {
        element.dataset.docxNoteRef = '';
        element.dataset.docxNoteScope = span.noteNav.scopeId;
        if (span.text.length > 0) {
          element.setAttribute('aria-description', span.text);
        }
      } else {
        element.dataset.docxNoteMarkBack = '';
        element.dataset.docxNoteScope = span.noteNav.scopeId;
      }
    } else if (span.fieldAtom?.formControl) {
      // A legacy form control takes the press itself: pointer events stay on so the surface
      // can find it under the pointer, and the cursor says it is a control, not text.
      element.style.userSelect = 'none';
      element.style.cursor = 'pointer';
    } else {
      element.style.pointerEvents = 'none';
      element.style.userSelect = 'none';
    }
  }
  return element;
}

/**
 * The anchor element wrapping one line's worth of a hyperlink's runs.
 *
 * FURNITURE, NEVER AUTHORITY. It carries semantics the run spans cannot — `href`, `title`,
 * a focus stop, the "link" role assistive technology announces — and nothing else. Selection
 * mapping, hit-testing and the caret all read the `data-paragraph-id`/`data-start`/
 * `data-end` on the spans INSIDE it, exactly as they do for plain text, so an anchor can be
 * added or removed without any of them changing behaviour.
 *
 * `href` is the SANITIZED projection layout already produced, never the authored target. A
 * link whose scheme was refused, whose relationship is missing, or that sits in read-only
 * page furniture gets no `href` at all: it still paints, still selects, still saves, and
 * there is no attribute for a click or a keyboard activation to follow.
 */
function paintHyperlinkAnchor(
  document: Document,
  link: SpanLinkRecord,
  ctx: PaintContext
): HTMLElement {
  const element = document.createElement('a');
  element.className = 'docx-hyperlink';
  // Standalone painters and hosts with their own CSS still expose live link targets.
  element.style.cursor = !ctx.inertLinks && link.href ? 'pointer' : 'default';
  // The link's identity, so a click can name the `w:hyperlink` it landed on without the
  // pointer path re-deriving it from geometry.
  element.dataset.docxLink = link.id;
  element.dataset.docxLinkKind = link.kind;
  // NEVER A FOCUS TARGET. The pages layer is the surface's single focus host — a
  // contenteditable spanning the whole document — and an `<a>` inside it is a competing one.
  // Chrome focuses an anchor on mousedown, the pointer path then focuses the pages layer
  // back, and re-focusing an element tens of thousands of pixels tall scrolls the viewport
  // to its TOP: clicking a link on page 10 threw the reader back to page 1.
  //
  // Nothing is lost by taking it out of the tab order, because tabbing was never how a link
  // is reached here: the caret is, and Ctrl/Cmd+K opens the popover on the link the caret is
  // in. That is Word's model rather than a browser's tab-through-links model, and it is the
  // one the rest of this surface already implements.
  element.setAttribute('tabindex', '-1');
  // Inert furniture links (headers and footers) are not activation targets either: header
  // editing is a later slice, so a live `href` there would be the one part of the furniture
  // that responds to a click.
  if (!ctx.inertLinks && link.href) {
    // SAFE: `setAttribute`, and the value is the allowlisted projection from `sanitizeHref`
    // — `javascript:`/`data:`/`vbscript:`/`file:` never reach here.
    element.setAttribute('href', link.href);
    // A same-page bookmark jump is handled by the engine; an external target is opened only
    // through the popover. Either way the browser must not navigate on its own, which the
    // surface enforces — this is belt and braces for the print and clipboard paths, where
    // the anchor leaves the editable surface entirely.
    if (link.kind === 'external') element.setAttribute('rel', 'noopener noreferrer');
  }
  // `w:tooltip` is Word's hover text. `title` takes a plain string, not markup.
  if (link.tooltip) element.setAttribute('title', link.tooltip);
  // SHRINK-WRAPPED, BASELINE-ALIGNED — the same box model the runs inside it use.
  //
  // A plain `display: inline` anchor measures ZERO HIGH here: the line is a `font-size: 0`
  // flow, so the inline box's own height is nothing and its rect never grows to cover the
  // inline-block runs within it. A person could still click the link (the run takes the
  // click and it bubbles), but nothing that MEASURES could: automation refused it as
  // invisible, and accessibility and hit-testing saw a link with no extent.
  //
  // `inline-block` gives it a box that shrink-wraps its children; `vertical-align: baseline`
  // keeps that box on the same baseline they were already on, because an inline-block's
  // baseline is its last line box's — the children's. Layout is unchanged and the element is
  // now real.
  element.style.display = 'inline-block';
  element.style.verticalAlign = 'baseline';
  // Decoration and colour stay with the RUNS, which carry the resolved `Hyperlink` character
  // style. Imposing them here would overrule an authored override.
  element.style.textDecoration = 'none';
  element.style.color = 'inherit';
  return element;
}

/**
 * A line is ONE inline flow, not a row of absolutely positioned words.
 *
 * Layout decides what goes on the line, where the line sits, and where the page breaks —
 * the decisions this engine owns. Placing glyphs WITHIN the line is left to the
 * browser, which is going to rasterise them its own way regardless.
 *
 * Positioning each word independently meant the browser drew the selection highlight once
 * per word, so a selected line came out as a row of separate blocks with seams between
 * them instead of one continuous band. It also put every word at a measured x that
 * disagreed with the rendered advance by a fraction of a pixel, and made `vertical-align`
 * inert — superscript had nothing to align against.
 *
 * `white-space: pre` keeps the browser from re-wrapping a line layout already decided, so
 * a line that measured slightly wide overflows by a hair rather than becoming two lines.
 */
function paintLine(
  document: Document,
  line: LineRecord,
  ctx: DrawingPaintHostContext,
  paragraphRtl = false,
  emptyStyle = DEFAULT_RUN_STYLE
): HTMLElement {
  const scale = ctx.scale;
  const element = document.createElement('div');
  element.className = 'docx-line layout-line';
  element.dataset.lineId = line.id;
  if (!ctx.unbound) element.dataset.paragraphId = line.range.paragraphId;
  element.style.position = 'absolute';
  element.style.top = `${line.box.y * scale}px`;
  // Alignment is baked into the geometry, not re-derived here: `contentX` IS the line's left
  // edge, so centred and right-aligned lines start where layout put them — including an empty
  // one, whose <br> caret anchor would otherwise sit at the margin.
  element.style.left = `${line.contentX * scale}px`;
  element.style.height = `${line.box.height * scale}px`;
  // Each run keeps its OWN box, which is how a mixed-size line should highlight: an 8pt
  // run gets an 8pt band and a 36pt run a 36pt one, stepped, the way Word draws it.
  // Forcing the line's height onto every run instead paints one uniform slab.
  //
  // Kill the anonymous line strut that inherits the host page's 16px font-size. That strut
  // shoved baseline-aligned inline-block runs a couple of pixels down, so character shading
  // / highlight backgrounds sat below the paragraph shading band (which uses line-box
  // geometry). `font-size: 0` removes the strut; the published line height is applied as an
  // explicit pixel line-height. Child runs keep their own font sizes and `vertical-align:
  // baseline`, so mixed-size and superscript/subscript (relative offset) still work.
  element.style.fontSize = '0';
  element.style.whiteSpace = 'pre';
  // ONE UNBROKEN RULE ACROSS THE LINE. Every run is its own inline-block, so each run's
  // trailing space ends a line box of its own, and the browser default skips decoration at
  // line edges and around descenders. A document underline crosses both. Both properties
  // inherit, so the line sets them once for every run and decoration layer inside it.
  element.style.setProperty('text-decoration-skip-ink', 'none');
  element.style.setProperty('text-decoration-skip-spaces', 'none');
  // A raised superscript or a tall glyph draws outside the line box rather than being
  // clipped at it; the box governs spacing and the selection band, not what is visible.
  element.style.overflow = 'visible';

  // Justified lines carry their slack in the gaps BETWEEN spans. Inline flow has no gaps,
  // so each span receives its own published advance below — as `word-spacing` stretching its
  // own trailing space where that is safe, and as a margin on the next span otherwise (see
  // `followingGapPaint`). The stretch is what keeps the native selection band continuous:
  // a margin is never highlighted, but a space character's advance is.
  // Per-run band heights, chosen so the browser's line-box math cannot move a glyph:
  // the tallest run's band is the glyph band (own height + space-above leading), and any
  // remaining line-box depth is padding-bottom — Word's auto/atLeast extras sit BELOW the
  // text. Capped at the line height so an `exact`-spaced line cannot grow past its box.
  //
  // The leading is READ, not recovered from the box. The marker and the tab leader place
  // their furniture against this same number, and when each of the three derived it for
  // itself they drifted: the text moved onto the published baseline while the marker
  // beside it stayed half a leading higher.
  const leading = line.leading ?? 0;
  const glyphBand = Math.min(
    Math.max(
      leading,
      ...line.spans.map((span) => span.box.height + leading),
      // Empty lines use the paragraph mark's depth, excluding trailing spacing.
      line.spans.length === 0 ? line.box.height - (line.trailingSpacing ?? 0) : 0
    ),
    line.box.height
  );
  const trailing = Math.max(0, line.box.height - glyphBand);
  element.style.boxSizing = 'border-box';
  element.style.paddingBottom = `${trailing * scale}px`;
  element.style.lineHeight = `${(line.box.height - trailing) * scale}px`;
  // Consecutive spans of the SAME link share one anchor, so a link that spans several
  // formatting runs on one line is one `<a>` — one focus stop, one hover target, one thing
  // a screen reader announces. A link that WRAPS gets one anchor per line, which is the
  // only shape an absolutely-positioned line model can express.
  let anchor: HTMLElement | null = null;
  let anchorLinkId: string | null = null;
  // For a FIELD anchor, the model offset of the field it paints. A field's own result can
  // break into several spans (a space in the result, or a line wrap), all sharing one link id
  // AND one model range, so they stay one anchor. A DIFFERENT field starts at a different
  // offset, so it opens its own — even with an identical target and thus the same content-keyed
  // id. Null while the current anchor is a typed link or there is none.
  let anchorFieldStart: number | null = null;
  // Sorted in the order the READER meets them, which on an ordinary line is the offset order
  // it always was. A resolved display mode draws two paragraphs on the join line and each
  // counts its offsets from zero, so a plain numeric sort interleaved the two halves' images
  // and flushed a spacer for the wrong one.
  const segmentRank = new Map<string, number>();
  for (const [rank, segment] of lineSegments(line).entries()) {
    segmentRank.set(segment.paragraphId, rank);
  }
  const rankOf = (paragraphId: string): number => segmentRank.get(paragraphId) ?? 0;
  const inlineDrawings = [...(line.drawings ?? [])].sort(
    (left, right) =>
      rankOf(left.paragraphId) - rankOf(right.paragraphId) || left.start - right.start
  );
  let nextInlineDrawing = 0;
  // Shaped spans are placed relative to where inline flow (spans and spacers) left them.
  const bidi =
    line.spans.some((span) => span.style.shaping !== undefined) ||
    (line.drawings ?? []).some(pictureIsRtl);
  let logicalAdvance = 0;
  // How far the flow reaches; a picture's spacer reaches its far edge, past any jump before it.
  let flowRight = line.contentX;
  const appendDrawingAdvancesBefore = (paragraphId: string, modelOffset: number): void => {
    while (
      nextInlineDrawing < inlineDrawings.length &&
      (rankOf(inlineDrawings[nextInlineDrawing]!.paragraphId) < rankOf(paragraphId) ||
        (rankOf(inlineDrawings[nextInlineDrawing]!.paragraphId) === rankOf(paragraphId) &&
          inlineDrawings[nextInlineDrawing]!.start < modelOffset))
    ) {
      const drawing = inlineDrawings[nextInlineDrawing]!;
      const advance = bidi
        ? Math.max(0, drawing.advanceEnd - drawing.advanceStart)
        : Math.max(0, drawing.advanceEnd - flowRight);
      flowRight = Math.max(flowRight, drawing.advanceEnd);
      const spacer = document.createElement('span');
      spacer.className = 'docx-inline-drawing-advance';
      spacer.dataset.docxMarker = '';
      // The picture's model position: a lone picture paints no text to hold a caret after it.
      if (!ctx.unbound) {
        spacer.dataset.drawingParagraphId = drawing.paragraphId;
        spacer.dataset.drawingStart = String(drawing.start);
      }
      spacer.setAttribute('contenteditable', 'false');
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.display = 'inline-block';
      spacer.style.width = `${advance * scale}px`;
      // The image itself is absolutely painted, so this inert inline box must also publish
      // its vertical advance. Otherwise CSS aligns text against a zero-height spacer while
      // layout aligns the engine caret against the drawing baseline.
      spacer.style.height = `${drawing.baselineOffset * scale}px`;
      spacer.style.lineHeight = '0';
      spacer.style.pointerEvents = 'none';
      spacer.style.verticalAlign = 'baseline';
      element.append(spacer);
      logicalAdvance += advance;
      nextInlineDrawing += 1;
      anchor = null;
      anchorLinkId = null;
    }
  };
  /**
   * Reserve the horizontal jump a float's wrap zone forced, so the line resumes in the next
   * passage instead of flowing straight across the picture.
   */
  const appendWrapAdvance = (span: StyleSpanRecord): void => {
    const advance = span.wrapAdvanceBefore ?? 0;
    if (advance <= 0.001) return;
    const spacer = document.createElement('span');
    spacer.className = 'docx-wrap-advance';
    spacer.dataset.docxMarker = '';
    spacer.setAttribute('contenteditable', 'false');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.display = 'inline-block';
    spacer.style.width = `${advance * scale}px`;
    spacer.style.height = '0';
    spacer.style.lineHeight = '0';
    spacer.style.pointerEvents = 'none';
    spacer.style.verticalAlign = 'baseline';
    element.append(spacer);
    // The gap is not part of any link's text, so an anchor cannot span it.
    anchor = null;
    anchorLinkId = null;
  };

  // Each boundary's gap is computed ONCE and carried into the next iteration, so a gap is
  // painted exactly once — as a stretch or as a margin, never both, never neither.
  let pendingGap = 0;
  let previousSpanAbsorbedGap = false;
  for (const [spanIndex, span] of line.spans.entries()) {
    const flushed = nextInlineDrawing;
    appendDrawingAdvancesBefore(span.range.paragraphId, span.range.start);
    if (!bidi) appendWrapAdvance(span);
    // Justify slack after a picture: its spacer ends at its far edge, and no span gap paints it.
    const slackAfterPicture =
      !bidi && nextInlineDrawing > flushed
        ? span.box.x - flowRight - (span.wrapAdvanceBefore ?? 0)
        : 0;
    flowRight = Math.max(flowRight, span.box.x + span.box.width);
    const band = Math.min(span.box.height + leading, line.box.height);
    const painted = span.noteSeparator
      ? paintNoteSeparatorSpan(document, span, line, scale)
      : paintSpan(document, span, ctx, band, leading);
    if (bidi) {
      painted.style.position = 'relative';
      painted.style.left = `${(span.box.x - line.contentX - logicalAdvance) * scale}px`;
      // Paint hosts may reserve a pre-scaled width plus a compensating margin.
      if (!painted.style.width) painted.style.width = `${span.box.width * scale}px`;
      painted.style.direction = span.style.shaping?.direction ?? 'ltr';
      // A `w:bdo` override keeps every character in the span's direction, as layout placed it.
      painted.style.unicodeBidi = span.style.shaping?.override ? 'isolate-override' : 'isolate';
      if (span.style.shaping?.wordSpacingPt)
        painted.style.wordSpacing = `${
          (span.style.shaping.wordSpacingPt - syntheticBoldSpacingPt(span)) * scale
        }px`;
      logicalAdvance += span.box.width;
    }
    const margin = pendingGap !== 0 && !previousSpanAbsorbedGap ? pendingGap : slackAfterPicture;
    if (Math.abs(margin) > 0.001) painted.style.marginLeft = `${margin * scale}px`;
    // A justify gap is drawn INSIDE the span before it wherever that span can stretch its
    // trailing space: the browser highlights a space's advance but never a margin, so a
    // margin gap broke the selection band into one block per word on justified lines.
    const next = line.spans[spanIndex + 1];
    const gapAfter = bidi ? 0 : interSpanGapBefore(line, spanIndex + 1, rankOf);
    const owner = gapAfter !== 0 && next !== undefined ? followingGapPaint(span, next) : null;
    previousSpanAbsorbedGap = owner !== null;
    if (owner === 'wordSpacing')
      painted.style.wordSpacing = `${(gapAfter - syntheticBoldSpacingPt(span)) * scale}px`;
    else if (owner === 'letterSpacing')
      painted.style.letterSpacing = letterGapSpacing(painted, span, gapAfter, scale);
    pendingGap = gapAfter;
    const link = span.link;
    if (!link) {
      anchor = null;
      anchorLinkId = null;
      anchorFieldStart = null;
      element.append(painted);
      continue;
    }
    // A field atom joins the current anchor only when it is the SAME field: same link id and
    // same model offset. Two adjacent fields share one content-keyed id when their targets
    // match, so keying on the id alone would merge two discrete links into one anchor a screen
    // reader announces once. Keying on the offset too keeps each field its own link unit while
    // still letting one field's wrapped or space-split result stay a single anchor. A result
    // laid out as editable text spans several offsets, so its pieces share `resultStart`.
    if (span.fieldAtom) {
      const fieldStart = fieldAnchorStart(span);
      const sameField =
        anchor !== null && anchorLinkId === link.id && anchorFieldStart === fieldStart;
      if (!sameField) {
        anchor = paintHyperlinkAnchor(document, link, ctx);
        anchorLinkId = link.id;
        anchorFieldStart = fieldStart;
        element.append(anchor);
      }
      anchor!.append(painted);
      continue;
    }
    // A typed link never joins a field anchor (`anchorFieldStart !== null`), and a field never
    // joins this one, so the two link kinds stay distinct even when adjacent.
    if (!anchor || anchorLinkId !== link.id || anchorFieldStart !== null) {
      anchor = paintHyperlinkAnchor(document, link, ctx);
      anchorLinkId = link.id;
      anchorFieldStart = null;
      element.append(anchor);
    }
    anchor.append(painted);
  }
  // Past the end of the LAST segment, so a trailing image in either half still flushes.
  appendDrawingAdvancesBefore(
    lineSegments(line)[lineSegments(line).length - 1]?.paragraphId ?? line.range.paragraphId,
    Number.POSITIVE_INFINITY
  );
  appendEmptyLineAnchor(element, line, scale, emptyStyle, (style) =>
    applyRunFaceStyle(element, style, ctx)
  );

  const lineOrigin = Object.freeze({
    x: line.contentX,
    y: line.box.y,
    width: line.box.width,
    height: line.box.height,
  });
  paintRunBorders(document, element, line, scale);
  if (ctx.showParagraphMarks && line.manualBreakAfter)
    paintManualLineBreak(document, line, element, scale, ctx.revisionStyles, paragraphRtl);
  const drawingCtx = drawingContextOf(asResolvedPaintContext(ctx));
  if (line.drawings && line.drawings.length > 0) {
    for (const painted of paintInlineDrawingsOnLine(
      document,
      line,
      drawingCtx.ctx,
      drawingCtx.urlRegistry,
      lineOrigin
    )) {
      element.append(painted);
    }
  }
  return element;
}

/** The layout-published gap before one span, excluding separately painted advances. */
function interSpanGapBefore(
  line: LineRecord,
  index: number,
  rankOf: (paragraphId: string) => number
): number {
  if (index <= 0 || index >= line.spans.length) return 0;
  const previous = line.spans[index - 1]!;
  const current = line.spans[index]!;
  // A drawing occupies this gap exactly when its spacer is FLUSHED between these two spans,
  // so the test is the same reader-order window `appendDrawingAdvancesBefore` walks: rank
  // first, then offset. Matching the raw offset alone was wrong twice on a resolved join
  // line, where each half counts offsets from zero: a second-half drawing whose offset fell
  // inside a first-half hole zeroed a gap it does not occupy, and a second-half drawing
  // BEFORE its own text — numerically below the first half's ranges — was flushed here yet
  // not counted, so its advance was painted twice.
  const previousRank = rankOf(previous.range.paragraphId);
  const currentRank = rankOf(current.range.paragraphId);
  const drawingOccupiesGap = line.drawings?.some((drawing) => {
    const rank = rankOf(drawing.paragraphId);
    const afterPrevious =
      rank > previousRank || (rank === previousRank && drawing.start >= previous.range.start);
    const beforeCurrent =
      rank < currentRank || (rank === currentRank && drawing.start < current.range.start);
    return afterPrevious && beforeCurrent;
  });
  if (drawingOccupiesGap) return 0;
  return paintedGapBetween(previous, current);
}

function paintFragment(
  document: Document,
  fragment: ParagraphFragmentRecord,
  ctx: DrawingPaintHostContext
): HTMLElement {
  const scale = ctx.scale;
  const element = positioned(document, 'div', fragment.box, scale);
  element.className = 'docx-paragraph-fragment layout-paragraph';
  if (fragment.clipToBox) element.style.overflow = 'hidden';
  if (!ctx.unbound) element.dataset.paragraphId = fragment.paragraphId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  if (!ctx.unbound) applyParagraphFormatAnchor(element, fragment);
  if (ctx.readOnlyParagraphIds?.has(fragment.paragraphId)) {
    element.classList.add('docx-generated-region');
    element.dataset.docxReadOnly = '';
    element.setAttribute('contenteditable', 'false');
  }
  if (ctx.emptyTocPlaceholderIds?.has(fragment.paragraphId)) {
    element.classList.add('docx-toc-empty-placeholder');
    element.dataset.docxTocEmpty = '';
  }
  // Fragment box remains the flow/hit region (includes before/after spacing). Paragraph
  // shading paints from the published line-area box — never the outer fragment background.
  if (fragment.shading && HEX.test(fragment.shading) && fragment.shadingBox) {
    element.append(paintParagraphShading(document, fragment, scale));
    // Automatic text inherits white on dark paragraph shading.
    if (automaticTextColor(fragment.shading)) element.style.color = '#FFFFFF';
  }
  // List markers are layout furniture inside the hanging indent — never model text.
  if (fragment.marker) {
    element.append(paintListMarker(document, fragment, ctx));
  }
  // Punctuation leaders sit behind the text. Underscores rise above the tab's own background
  // below, or an opaque highlight/shading/revision wash would erase their only visible rule.
  for (const line of fragment.lines) {
    for (const span of line.spans) {
      if (!span.tabLeader) continue;
      const leader = paintTabLeader(document, fragment, line, span, ctx);
      if (leader) element.append(leader);
    }
  }
  const lineElements: HTMLElement[] = [];
  for (const line of fragment.lines) {
    const painted = paintLine(
      document,
      line,
      ctx.revisionMarkup && formatRevisionOf(fragment.props)
        ? { ...ctx, paragraphFormatRevision: formatRevisionOf(fragment.props)! }
        : ctx,
      paragraphIsRtl(fragment.props),
      fragment.emptyParagraphStyle
    );
    if (fragment.markFormatRevision && line === fragment.lines[fragment.lines.length - 1]) {
      applyParagraphFormatAnchor(painted, fragment, true);
    }
    // Line boxes are page-relative; inside a fragment they are drawn relative to it —
    // BOTH axes. The fragment box already carries the x origin (indent, or a table cell's
    // content edge), so an absolute left here would count that origin twice.
    painted.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
    painted.style.left = `${(line.contentX - fragment.box.x) * scale}px`;
    element.append(painted);
    lineElements.push(painted);
  }
  paintParagraphEndFurniture(document, fragment, lineElements, ctx, scale);
  // Layout owns border geometry. Side rules sit OUTSIDE the text column — Word draws them
  // there and never reflows the text for them — so a painter deriving an edge from the
  // fragment box would put the frame through the words.
  if (fragment.borders) {
    for (const stroke of fragment.borders) {
      element.append(paintParagraphBorder(document, fragment, stroke, scale));
    }
  } else if (fragment.bottomBorder) {
    // Table-cell paragraphs still publish the bottom rule alone.
    element.append(
      paintParagraphBorder(
        document,
        fragment,
        { side: 'bottom', edge: fragment.bottomBorder.edge, box: fragment.bottomBorder.box },
        scale
      )
    );
  }
  return element;
}

/**
 * Paint a list marker from layout-published geometry.
 *
 * Inert to editing/selection (`data-docx-marker`), same exclusion class as header/footer
 * furniture. Text is `textContent` only; face styles come from the resolved marker style.
 */
function paintListMarker(
  document: Document,
  fragment: ParagraphFragmentRecord,
  ctx: PaintContext
): HTMLElement {
  const marker = fragment.marker!;
  const scale = ctx.scale;
  const picture = paintListMarkerPicture(document, fragment, asResolvedPaintContext(ctx));
  if (picture) return picture;
  // The marker belongs to the paragraph's FIRST line, which is the line it is drawn beside.
  const leading = fragment.lines[0]?.leading ?? 0;
  const element = positioned(document, 'span', marker.box, scale);
  element.className = 'docx-list-marker';
  element.dataset.docxMarker = '';
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');
  element.style.left = `${(marker.box.x - fragment.box.x) * scale}px`;
  element.style.top = `${(marker.box.y - fragment.box.y) * scale}px`;
  element.style.display = 'block';
  element.style.overflow = 'visible';
  element.style.whiteSpace = 'pre';
  // Mirror `paintLine`: content band at the top (plus any above-leading), auto extras as
  // padding-bottom so the marker shares the text baseline on spaced lines.
  const firstLine = fragment.lines[0];
  // The same band `paintLine` gives the text beside it, including its EMPTY-line arm: a list
  // item with no runs — the one Enter has just opened, and every blank item in a list — has
  // no spans to take a height from, and `Math.max` over none collapsed the band to zero. The
  // browser then centred the marker glyph on a zero-height line box and drew it half a line
  // ABOVE its own row, overlapping the item before it until the next edit repainted.
  const band = firstLine
    ? Math.max(
        leading,
        ...firstLine.spans.map((span) => span.box.height + leading),
        firstLine.spans.length === 0 ? firstLine.box.height - (firstLine.trailingSpacing ?? 0) : 0
      )
    : marker.box.height;
  const glyphBand = Math.min(band, marker.box.height);
  const trailing = Math.max(0, marker.box.height - glyphBand);
  element.style.fontSize = '0';
  element.style.boxSizing = 'border-box';
  element.style.paddingBottom = `${trailing * scale}px`;
  element.style.lineHeight = `${glyphBand * scale}px`;
  const glyph = document.createElement('span');
  glyph.style.display = 'inline-block';
  glyph.style.verticalAlign = 'baseline';
  glyph.style.boxSizing = 'border-box';
  glyph.style.height = `${glyphBand * scale}px`;
  glyph.style.paddingTop = `${leading * scale}px`;
  glyph.style.lineHeight = `${(glyphBand - leading) * scale}px`;
  applyRunFaceStyle(glyph, marker.style, ctx);
  if (marker.pieces) glyph.dir = 'rtl'; // A right-to-left marker: `1.` shows as `.1`.
  mountRunText(document, glyph, marker.text, marker.style, scale);
  element.append(glyph);
  return element;
}

/**
 * Paint the leader of one tab across the advance layout already reserved for it.
 *
 * Inert furniture (`data-docx-tab-leader`), the same class as list markers: it carries no
 * source range, so it can never be selected, copied or serialised. Critically it is NOT a
 * child of the tab span — `dom-selection` reads a span's length from its `textContent`, and
 * a hundred dots inside the `\t` run would make every offset after it wrong.
 */
function paintTabLeader(
  document: Document,
  fragment: ParagraphFragmentRecord,
  line: LineRecord,
  span: StyleSpanRecord,
  ctx: PaintContext
): HTMLElement | null {
  const glyph = span.tabLeader ? TAB_LEADER_GLYPH.get(span.tabLeader) : undefined;
  if (!glyph || span.box.width <= 0) return null;
  const scale = ctx.scale;

  const layer = document.createElement('div');
  layer.className = 'docx-tab-leader';
  layer.dataset.docxTabLeader = '';
  layer.setAttribute('contenteditable', 'false');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.position = 'absolute';
  if (span.tabLeader === 'underscore') layer.style.zIndex = '1';
  layer.style.left = `${(span.box.x - fragment.box.x) * scale}px`;
  layer.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
  layer.style.width = `${span.box.width * scale}px`;
  layer.style.height = `${line.box.height * scale}px`;
  layer.style.overflow = 'hidden';
  layer.style.whiteSpace = 'pre';
  layer.style.pointerEvents = 'none';
  layer.style.userSelect = 'none';
  // LEADER DOTS SIT ON THE BASELINE, like the periods they stand in for.
  //
  // The layer is therefore an ordinary line of text in the run's own face, with the LINE's
  // line-height — the same two things `paintLine` gives the text beside it, so the browser
  // resolves the identical baseline. Earlier attempts hung the glyphs off a zero-size strut
  // and tried to place that strut's baseline arithmetically; a strut with no metrics puts
  // its baseline at half the line-height (the vertical centre), and an inline-block aligns
  // by its OWN internal baseline rather than the one the arithmetic targeted, so the dots
  // came out first centred and then below the text. Matching the text's own setup is the
  // only version that needs no correction.
  // MIRROR `paintLine` EXACTLY, because the baseline is whatever that structure resolves
  // to and no arithmetic here can second-guess it: strut killed with `font-size: 0`, the
  // published line height as an explicit line-height, and the glyphs as a baseline-aligned
  // inline-block carrying their own BAND height — the run's own height plus the line's
  // extra leading, capped at the line box — over an inner line box one leading taller, so
  // a spaced line's leading is padded off the top of the dots exactly as it is off the text.
  // Leaving the band off let the glyphs inherit the whole line height, and their inner line
  // box then centred them; putting the face on the container instead gave the strut
  // different metrics from the dots and floated them.
  //
  // The mirror is literal, so it has to be MAINTAINED as one: both sides read `line.leading`,
  // neither recomputes it, and both spend it as padding rather than line-height. This
  // structure and `paintSpan`'s drifted apart once already, when only one of them was taught
  // that the leading sits above the text.
  const leading = line.leading ?? 0;
  const band = Math.min(span.box.height + leading, line.box.height);
  const trailing = Math.max(0, line.box.height - band);
  layer.style.fontSize = '0';
  layer.style.boxSizing = 'border-box';
  layer.style.paddingBottom = `${trailing * scale}px`;
  layer.style.lineHeight = `${(line.box.height - trailing) * scale}px`;

  const glyphs = document.createElement('span');
  glyphs.style.display = 'inline-block';
  glyphs.style.verticalAlign = 'baseline';
  applyRunFaceStyle(glyphs, span.style, ctx);
  glyphs.style.boxSizing = 'border-box';
  glyphs.style.height = `${band * scale}px`;
  glyphs.style.paddingTop = `${leading * scale}px`;
  glyphs.style.lineHeight = `${(band - leading) * scale}px`;
  if (span.tabLeader === 'heavy') glyphs.style.fontWeight = 'bold';
  // ONE GLYPH PER ITS OWN ADVANCE — the leader is the same character typed over and over,
  // and Word spaces it exactly as typing it would. Layout measured that advance in this
  // run's face; guessing it (a fifth of the em, deliberately short so the repeat overfilled
  // and the clip decided where it ended) left the dots at whatever spacing an over-long
  // string happened to produce, reading as a fine dotted rule rather than periods. Falls
  // back to the old estimate only for a record laid out before the measurement existed.
  const advancePt =
    span.tabLeaderAdvancePt && span.tabLeaderAdvancePt > 0
      ? span.tabLeaderAdvancePt
      : Math.max(0.5, span.style.fontSizePt * 0.2);
  const pattern = tabLeaderPattern(
    (ctx.tabLeaderOriginXPt ?? 0) + span.box.x,
    span.box.width,
    advancePt
  );
  glyphs.style.marginLeft = `${pattern.offsetPt * scale}px`;
  glyphs.textContent = glyph.repeat(pattern.count); // SAFE: textContent, never innerHTML
  // No tracking on top of the glyph's own advance — the leader is plain repeated
  // punctuation, and inherited letter-spacing would re-space it.
  glyphs.style.letterSpacing = '0';
  layer.append(glyphs);
  return layer;
}

/**
 * Paint paragraph shading from layout-published geometry.
 *
 * Height/position come from `shadingBox` (line union) — not from fragment outer height or
 * computed style. Colour is re-validated at the sink like every other file-derived fill.
 */
function paintParagraphShading(
  document: Document,
  fragment: ParagraphFragmentRecord,
  scale: number
): HTMLElement {
  const box = fragment.shadingBox!;
  const band = positioned(document, 'div', box, scale);
  band.className = 'docx-paragraph-shading';
  band.setAttribute('aria-hidden', 'true');
  band.style.left = `${(box.x - fragment.box.x) * scale}px`;
  band.style.top = `${(box.y - fragment.box.y) * scale}px`;
  band.style.backgroundColor = `#${fragment.shading}`;
  return band;
}

/**
 * Paint one `w:pBdr` rule from layout geometry.
 *
 * Size, colour and position come from the record — never from computed style or
 * getBoundingClientRect. Colour is re-validated at the sink like every other file-derived
 * style value, and `side` is a closed union so it can safely reach a class name.
 *
 * `ST_Border` mapping (ECMA-376): common line styles get a CSS approximation; decorative
 * art borders fall through to a solid rule. Compound styles (`double`, …) rely on layout
 * having published the inflated band — paint must not re-derive mins.
 */
function paintParagraphBorder(
  document: Document,
  fragment: ParagraphFragmentRecord,
  stroke: ParagraphBorderStrokeRecord,
  scale: number
): HTMLElement {
  const rule = positioned(document, 'div', stroke.box, scale);
  rule.className = `docx-paragraph-border docx-paragraph-border-${stroke.side}`;
  rule.setAttribute('aria-hidden', 'true');
  const publishedLeft = (stroke.box.x - fragment.box.x) * scale;
  const publishedTop = (stroke.box.y - fragment.box.y) * scale;
  // Preserve layout geometry, but snap a very thin SINGLE rule to a visible screen hairline.
  // Word's 1/4pt header rules otherwise become 0.33 CSS px at 96dpi and effectively disappear.
  // Compound styles already inflate in layout, so they keep the published thickness.
  const vertical = stroke.side === 'left' || stroke.side === 'right' || stroke.side === 'bar';
  const publishedThickness = (vertical ? stroke.box.width : stroke.box.height) * scale;
  const compound = isCompoundParagraphBorder(stroke.edge.val);
  const paintedThickness = compound ? publishedThickness : Math.max(1, publishedThickness);
  rule.style.left = `${
    stroke.side === 'right'
      ? publishedLeft - (paintedThickness - publishedThickness)
      : publishedLeft
  }px`;
  rule.style.top = `${
    stroke.side === 'bottom' ? publishedTop - (paintedThickness - publishedThickness) : publishedTop
  }px`;
  if (vertical) {
    rule.style.width = `${paintedThickness}px`;
  } else {
    rule.style.height = `${paintedThickness}px`;
  }
  const color = stroke.edge.color && HEX.test(stroke.edge.color) ? stroke.edge.color : '000000';
  rule.style.backgroundColor = `#${color}`;
  // A side rule is a tall thin box, so its dash/double pattern runs down it rather than across.
  // `val` selects a CSS approximation; unknown / art styles fall back to a solid rule so a
  // recognised thickness is never silently dropped.
  applyParagraphBorderStyle(rule, stroke.edge.val, color, vertical, paintedThickness, scale);
  return rule;
}

import { applyParagraphBorderStyle, isCompoundParagraphBorder } from './border-stroke-paint.ts';
import { paintPageBorderFrame } from './page-border-paint.ts';
import { applyCellBorders } from './semantic-paint-table-borders.ts';
import { markTrackedRow } from './table-row-revision-paint.ts';
import { changedPageParts } from './semantic-paint-page-diff.ts';
import { replaceHeaderFooterLayer } from './semantic-paint-hf-adopt.ts';
import { tableCellContentHost } from './table-cell-text-direction-paint.ts';
import { paintTableSpacingLayers } from './table-spacing-shading-paint.ts';

function paintTableCell(
  document: Document,
  cell: TableCellFragmentRecord,
  rowBox: { readonly x: number; readonly y: number },
  ctx: DrawingPaintHostContext
): HTMLElement {
  const scale = ctx.scale;
  const cellElement = positioned(document, 'div', cell.box, scale);
  cellElement.className = 'docx-table-cell';
  cellElement.style.left = `${(cell.box.x - rowBox.x) * scale}px`;
  cellElement.style.top = `${(cell.box.y - rowBox.y) * scale}px`;
  cellElement.style.boxSizing = 'border-box';
  cellElement.style.overflow = 'visible';
  // Cell identity in the DOM, so a gesture or a highlight can name the cell it is over
  // without re-deriving the grid from geometry.
  cellElement.dataset.cellId = cell.id;
  cellElement.dataset.gridColumn = String(cell.gridColumn);
  cellElement.dataset.gridSpan = String(cell.gridSpan);
  if (cell.rowSpan && cell.rowSpan > 1) {
    cellElement.dataset.rowSpan = String(cell.rowSpan);
  }

  // Continuation cells stay in the tree for grid bookkeeping but paint nothing.
  if (cell.paintInert || cell.vMergeContinue) {
    cellElement.dataset.vMergeContinue = 'true';
    cellElement.style.border = 'none';
    cellElement.style.backgroundColor = 'transparent';
    rememberPaintedCell(cellElement, cell, cellElement, undefined, []);
    return cellElement;
  }

  cellElement.style.border = 'none';
  const strokes = applyCellBorders(document, cellElement, cell.borders, scale);

  if (cell.shading && HEX.test(cell.shading)) {
    cellElement.style.backgroundColor = `#${cell.shading}`;
  }
  if (cell.revisionShading && ctx.revisionMarkup) {
    const color = ctx.revisionMarkup.cells[cell.revisionShading];
    cellElement.dataset.revisionCell = cell.revisionShading;
    if (color !== 'none') {
      const author = cell.revisionShadingAuthor ?? '';
      cellElement.style.backgroundColor =
        color === 'byAuthor'
          ? (ctx.revisionStyles?.styles.get(author)?.color ??
            reviewAuthorSlotColor(ctx.revisionCellStyles?.authorSlots.get(author) ?? 0))
          : `var(--doc-revision-color-${color})`;
    }
  }
  const contentElement = tableCellContentHost(document, cell, scale, cellElement);
  const blocks: HTMLElement[] = [];
  for (const block of cell.blocks) {
    const painted =
      block.kind === 'table'
        ? paintTableFragment(document, block, ctx)
        : paintFragment(document, block, ctx);
    painted.style.left = `${(block.box.x - cell.box.x) * scale}px`;
    painted.style.top = `${(block.box.y - cell.box.y) * scale}px`;
    contentElement.append(painted);
    blocks.push(painted);
  }
  rememberPaintedCell(cellElement, cell, contentElement, strokes, blocks);
  return cellElement;
}

/**
 * One painted table fragment: positioned row and cell boxes, layout-owned per-edge borders
 * and validated shading, and the cell's blocks recursing into the ordinary painters —
 * which is what gives cell text the same `data-paragraph-id`/`data-start` attributes as
 * body text, so selection and the caret work inside cells with no extra wiring.
 */
function paintTableRow(
  document: Document,
  row: TableRowFragmentRecord,
  fragment: TableFragmentRecord,
  ctx: DrawingPaintHostContext
): HTMLElement {
  const scale = ctx.scale;
  const rowElement = positioned(document, 'div', row.box, scale);
  rowElement.className = 'docx-table-row';
  markTrackedRow(rowElement, row, !!ctx.revisionMarkup);
  rowElement.dataset.rowId = row.id;
  if (row.isHeaderRepeat) rowElement.dataset.headerRepeat = 'true';
  rowElement.style.left = `${(row.box.x - fragment.box.x) * scale}px`;
  rowElement.style.top = `${(row.box.y - fragment.box.y) * scale}px`;
  rowElement.style.overflow = 'visible';
  for (const cell of row.cells) {
    rowElement.append(paintTableCell(document, cell, row.box, ctx));
  }
  return rowElement;
}

function paintTableFragment(
  document: Document,
  fragment: TableFragmentRecord,
  ctx: DrawingPaintHostContext,
  previous?: HTMLElement
): HTMLElement {
  // Rows, cells and cell paragraphs whose paint inputs are unchanged, or moved only, are kept.
  // Gap bands are cut around every cell of the fragment; a band that paints the same is kept.
  const retained =
    previous &&
    reflowTableFragment(previous, fragment, {
      leading: () => paintTableSpacingLayers(document, fragment, ctx.scale, previous),
      scale: ctx.scale,
      showParagraphMarks: ctx.showParagraphMarks === true,
      row: (row) => paintTableRow(document, row, fragment, ctx),
      cell: (cell, rowBox) => paintTableCell(document, cell, rowBox, ctx),
      block: (block, prior) =>
        block.kind === 'table'
          ? paintTableFragment(document, block, ctx, prior)
          : paintFragment(document, block, ctx),
      // Reuse refuses lines with drawings, the only lines whose gaps depend on reading rank.
      gapOf: (line, index) => interSpanGapBefore(line, index, () => 0),
    });
  if (retained) return retained;
  const scale = ctx.scale;
  const element = positioned(document, 'div', fragment.box, scale);
  element.className = 'docx-table-fragment layout-table';
  element.dataset.tableId = fragment.tableId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  element.style.overflow = 'visible';
  element.append(...paintTableSpacingLayers(document, fragment, scale));
  const rows = new Map<TableRowFragmentRecord, HTMLElement>();
  for (const row of fragment.rows) {
    const painted = paintTableRow(document, row, fragment, ctx);
    rows.set(row, painted);
    element.append(painted);
  }
  rememberPaintedTable(element, fragment, rows);
  return element;
}

/** The header and footer layer painter of one page, bound to its paint context. */
function furniturePainter(
  document: Document,
  options: ResolvedPaintContext & {
    readonly activeHeaderFooterRId?: string;
    readonly activeHeaderFooterPageIndex?: number;
  }
): HeaderFooterLayerPainter {
  // One furniture context per tab-leader origin: a story's fragments all share one.
  const furnitureCtxs = new Map<number, ResolvedPaintContext>();
  return {
    chrome: options,
    // Furniture links paint styled but inert — see `paintHyperlinkAnchor`.
    paintFragment: (fragment, tabLeaderOriginXPt) => {
      let furnitureCtx = furnitureCtxs.get(tabLeaderOriginXPt);
      if (!furnitureCtx) {
        furnitureCtx = { ...options, inertLinks: true, tabLeaderOriginXPt };
        furnitureCtxs.set(tabLeaderOriginXPt, furnitureCtx);
      }
      return fragment.kind === 'table'
        ? paintTableFragment(document, fragment, furnitureCtx)
        : paintFragment(document, fragment, furnitureCtx);
    },
    appendDrawings: (parent, drawings, origin, layer, interactive, hfFrontKind) =>
      appendAnchoredDrawingsForRecords(
        document,
        parent,
        drawings,
        options,
        origin,
        layer,
        interactive,
        hfFrontKind
      ),
  };
}

function paintPage(
  document: Document,
  page: PageRecord,
  baseOptions: ResolvedPaintContext & {
    readonly ariaHidden: boolean;
    readonly activeHeaderFooterRId?: string;
    readonly activeHeaderFooterPageIndex?: number;
    readonly contentControlChrome?: PaintOptions['contentControlChrome'];
  },
  materialize: boolean,
  /** Filled with the body block elements, so the next pass can repaint one block in place. */
  painted?: { content?: HTMLElement; blocks?: Map<BlockFragmentRecord, HTMLElement> }
): HTMLElement {
  // Every drawing painted below carries this page's instance key, so a repaint of the
  // page reuses its own already-decoded <img> elements (no per-keystroke flash) without
  // ever stealing a repeated header image from a sibling page.
  const options = {
    ...baseOptions,
    paintInstance: `p${page.index}`,
    tabLeaderOriginXPt: page.contentBox.x - page.box.x,
  };
  const element = positioned(document, 'div', page.box, options.scale);
  // The FRAME is never lightness-inverted — flipping it would flip the paper itself. The
  // sheet keeps the canvas colour its token names and only `.docx-page-content` below is
  // inverted, so the theme and print rules name that class instead.
  element.className = 'docx-page';
  isolatePageFromHost(element);
  element.dataset.pageIndex = String(page.index);
  if (options.ariaHidden) {
    // The painted page is a PICTURE of the document; the editable projection is what
    // assistive technology reads, so this must not be a second, competing reading order.
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('role', 'presentation');
  }
  // A page outside the viewport keeps its SIZE and its place, and nothing else. Scroll
  // position and page count stay exactly as they would be with everything built, so
  // scrolling to a page reveals it rather than reflowing the document underneath.
  element.dataset.materialized = String(materialize);
  if (!materialize) return element;

  // Body anchored records are per-page CONTENT-relative (a page-frame drawing at offset 0
  // publishes paintBounds x/y = -margin). The layer lives on the page element, so the
  // origin is the negated content inset — never page.box, which is absolute and would
  // both drop the margins and displace every page after the first.
  const bodyAnchorOrigin = Object.freeze({
    x: -(page.contentBox.x - page.box.x),
    y: -(page.contentBox.y - page.box.y),
    width: page.box.width,
    height: page.box.height,
  });
  // PAINT ORDER IS THE SHEET'S CHILD ORDER, bottom to top: a `back` page border, the header
  // and footer layer, the body's behind-text drawings, the body, the body's in-front
  // drawings, and a `front` page border. Header and footer content is one layer under the
  // main document: a header drawing set in front of text covers the header text only, never
  // a body line or a body drawing, and `behindDoc` orders it within that layer alone.
  const borderLayer = page.pageBorders
    ? paintPageBorderFrame(document, page.pageBorders, options.scale)
    : null;
  if (borderLayer && page.pageBorders) borderLayer.dataset.docxZOrder = page.pageBorders.zOrder;
  if (borderLayer && page.pageBorders?.zOrder === 'back') element.append(borderLayer);
  const hfHints = paintHeaderFooterLayer(
    document,
    element,
    page,
    furniturePainter(document, options)
  );
  appendAnchoredDrawingLayer(document, element, page, options, bodyAnchorOrigin, 'behind');

  const content = document.createElement('div');
  content.className = 'docx-page-content';
  content.style.position = 'absolute';
  content.style.left = `${(page.contentBox.x - page.box.x) * options.scale}px`;
  content.style.top = `${(page.contentBox.y - page.box.y) * options.scale}px`;
  content.style.width = `${page.contentBox.width * options.scale}px`;
  content.style.height = `${page.contentBox.height * options.scale}px`;
  if (options.activeHeaderFooterRId) {
    content.setAttribute('contenteditable', 'false');
  }
  for (const separator of page.columnSeparators ?? []) {
    const rule = document.createElement('div');
    rule.className = 'docx-column-separator';
    rule.setAttribute('contenteditable', 'false');
    rule.style.position = 'absolute';
    rule.style.left = `${separator.x * options.scale}px`;
    rule.style.top = `${separator.y * options.scale}px`;
    rule.style.width = `${separator.width * options.scale}px`;
    rule.style.height = `${separator.height * options.scale}px`;
    rule.style.backgroundColor = 'currentColor';
    rule.style.pointerEvents = 'none';
    content.append(rule);
  }
  const blocks = painted ? new Map<BlockFragmentRecord, HTMLElement>() : null;
  for (const fragment of page.fragments) {
    const block =
      fragment.kind === 'table'
        ? paintTableFragment(document, fragment, options)
        : paintFragment(document, fragment, options);
    blocks?.set(fragment, block);
    content.append(block);
  }
  if (painted && blocks) {
    painted.content = content;
    painted.blocks = blocks;
  }
  element.append(content);
  appendAnchoredDrawingLayer(document, element, page, options, bodyAnchorOrigin, 'inFront');
  // A `front` page border is over every drawing on the sheet, in-front ones included.
  if (borderLayer && page.pageBorders?.zOrder === 'front') element.append(borderLayer);

  // Footnotes / endnotes — editable stories inside the sheet (not [data-docx-hf] furniture).
  paintPageNoteAreas(document, element, page, options, paintFragment, paintTableFragment);

  // Page furniture (phase 2, read-only): painted inside the sheet but OUTSIDE the content
  // box, inert to editing. `data-docx-hf` is what dom-selection uses to refuse mapping a
  // browser caret inside the furniture back to a model position.
  // Blank furniture affordance: a page with no header (or footer) paints an EMPTY band over
  // that margin — `data-docx-hf` with no relationship id — so hover can invite and a double
  // click can create the story. Geometry mirrors the pointer's activation band: the full
  // margin strip at content width. Never printed or editable; absent on blank parity sheets.
  for (const kind of ['header', 'footer'] as const) {
    if (page[kind] || page.parityBlank) continue;
    const band = document.createElement('div');
    band.className = 'docx-hf docx-hf--placeholder';
    band.dataset.docxHf = kind;
    band.setAttribute('contenteditable', 'false');
    // A SLIM strip where a real header/footer would FLOW — the default furniture distance
    // from the sheet edge — not the whole margin and not the content edge: anchored to
    // content, a cover page with a deep top area drew the invitation halfway down the
    // page, glued to its own heading. Word's header area is a couple of lines near the
    // edge; the pointer still accepts the full margin band, so the visual stays modest
    // without shrinking the target.
    const marginHeight =
      kind === 'header'
        ? page.contentBox.y - page.box.y
        : page.box.y + page.box.height - (page.contentBox.y + page.contentBox.height);
    const height = Math.min(marginHeight, PLACEHOLDER_BAND_PT);
    if (height <= 0) continue;
    // Squeezed toward the content edge when the margin is too tight for distance + band.
    const edgeOffset = Math.max(0, Math.min(PLACEHOLDER_DISTANCE_PT, marginHeight - height));
    const top = kind === 'header' ? edgeOffset : page.box.height - edgeOffset - height;
    band.style.position = 'absolute';
    band.style.left = `${(page.contentBox.x - page.box.x) * options.scale}px`;
    band.style.top = `${top * options.scale}px`;
    band.style.width = `${page.contentBox.width * options.scale}px`;
    band.style.height = `${height * options.scale}px`;
    element.append(band);
  }

  // Edit pills over the body text: the bands they invite into paint under the body.
  for (const hint of hfHints) element.append(hint);

  paintContentControlChrome(document, element, page, options);
  // CHANGE BARS. Word draws a rule in the margin beside every line a revision touches, in
  // one column per sheet. Painted from the whole page — body, notes, header, footer and
  // text boxes — so a change that crosses a paragraph or a cell boundary is one unbroken
  // rule. LAST on the sheet, which is also where block adoption puts a rebuilt one.
  const changeBars = paintPageChangeBars(
    document,
    page,
    options.scale,
    options.changeBars,
    options.changeBarsToggle,
    options.revisionMarkup,
    options.facingPages,
    options.revisionStyles
  );
  if (changeBars) element.append(changeBars);
  return element;
}

/** Height of the blank header/footer invitation band, in points (~two text lines). */
const PLACEHOLDER_BAND_PT = 30;
/** Where the band starts from the sheet edge — `w:pgMar` header/footer default (720 twips). */
const PLACEHOLDER_DISTANCE_PT = 36;

/**
 * One painted page, retained so an unchanged page never has to be rebuilt.
 *
 * Incremental layout keeps the RECORD of an untouched page identical across revisions —
 * same object, by design — so record identity is a complete reuse test: same record, same
 * materialization, same paint parameters means the element in hand is already exactly what
 * this pass would build. Rebuilding every sheet per commit made the browser restyle the
 * whole document on each keystroke, which at several hundred pages cost more than layout
 * and paint together.
 */
interface RetainedPage {
  readonly record: PageRecord;
  readonly materialized: boolean;
  readonly element: HTMLElement;
  /**
   * The body content layer and its block elements by RECORD, kept so the next pass can
   * repaint the one block that moved instead of the sheet it sits on. Absent on a page
   * that was never materialized.
   */
  readonly content?: HTMLElement;
  readonly blocks?: ReadonlyMap<BlockFragmentRecord, HTMLElement>;
}

interface RetainedPaint {
  /** Paint parameters folded into reuse: a zoom or a11y change rebuilds every page. */
  readonly parameters: string;
  readonly pages: readonly RetainedPage[];
}

const retainedPaints = new WeakMap<HTMLElement, RetainedPaint>();

/**
 * Forget what a container currently shows, so the next paint rebuilds it from records.
 *
 * Paint reuse assumes the DOM still holds what this module last put there — it keeps a page
 * whose record is identical, and an unchanged layout therefore repaints nothing at all. An
 * IME breaks that assumption: composed text lands in the painted DOM whatever the model
 * does, so a composition that ends up changing nothing (it was cancelled, or its edit was
 * refused) leaves the browser's characters on screen with no later pass that would remove
 * them. In a read-only document nothing ever heals it.
 */
export function discardRetainedPaint(container: HTMLElement): void {
  retainedPaints.delete(container);
}

/** Forget only the pages holding `nodes` (all of them when no page does): see above. */
export function discardRetainedPaintOf(container: HTMLElement, nodes: readonly Node[]): void {
  const retained = retainedPaints.get(container);
  if (!retained) return;
  const pages = retained.pages.filter((page) => !nodes.some((node) => page.element.contains(node)));
  if (pages.length === retained.pages.length) retainedPaints.delete(container);
  else retainedPaints.set(container, { ...retained, pages });
}

function sameBox(left: PageRecord['box'], right: PageRecord['box']): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

const COLUMN_SEPARATOR_CLASS = 'docx-column-separator';

/**
 * Repaint one page's changed blocks IN PLACE, keeping the sheet and every block that did
 * not move.
 *
 * Typing rewrites one paragraph. Rebuilding the sheet around it detached a few thousand
 * nodes and built them again, which the browser then had to restyle, lay out and repaint in
 * full — and it dropped the text node the caret was in, so the selection had to be mapped
 * and re-applied afterwards. Adopting the sheet keeps all of that: only the edited block's
 * element is built, and on a page the caret is not on, nothing is touched at all.
 */
function adoptPageBlocks(
  document: Document,
  retained: RetainedPage,
  page: PageRecord,
  options: ResolvedPaintContext & {
    readonly ariaHidden: boolean;
    readonly activeHeaderFooterRId?: string;
    readonly activeHeaderFooterPageIndex?: number;
    readonly contentControlChrome?: PaintOptions['contentControlChrome'];
  }
): RetainedPage | null {
  const content = retained.content;
  const previousBlocks = retained.blocks;
  if (!content || !previousBlocks || content.parentElement !== retained.element) return null;
  const blockOptions = {
    ...options,
    paintInstance: `p${page.index}`,
    tabLeaderOriginXPt: page.contentBox.x - page.box.x,
  };
  const blocks = new Map<BlockFragmentRecord, HTMLElement>();
  const elements: HTMLElement[] = [];
  for (const fragment of page.fragments) {
    const element =
      previousBlocks.get(fragment) ??
      equalBlockElement(previousBlocks, fragment, elements) ??
      (fragment.kind === 'table'
        ? paintTableFragment(
            document,
            fragment,
            blockOptions,
            previousTableElement(previousBlocks, fragment)
          )
        : paintFragment(document, fragment, blockOptions));
    blocks.set(fragment, element);
    elements.push(element);
  }
  // Keyed reconcile, exactly as the container does with pages. The column separators are
  // painted ahead of the blocks and are covered by the record comparison above, so they
  // are left where they are rather than being re-created.
  const kept = new Set<HTMLElement>(elements);
  let child = content.firstChild;
  while (child) {
    const next = child.nextSibling;
    const element = child as HTMLElement;
    if (!kept.has(element) && element.classList?.contains(COLUMN_SEPARATOR_CLASS) !== true) {
      (child as ChildNode).remove();
    }
    child = next;
  }
  let cursor = content.firstChild;
  while (cursor && (cursor as HTMLElement).classList?.contains(COLUMN_SEPARATOR_CLASS)) {
    cursor = cursor.nextSibling;
  }
  for (const element of elements) {
    if (element === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    content.insertBefore(element, cursor);
  }
  // The margin rules are a page-level overlay over the adopted blocks, so they are the one
  // piece of the sheet a block change can move; left alone when it did not.
  reconcilePageChangeBars(
    document,
    retained.element,
    page,
    options.scale,
    options.changeBars,
    options.changeBarsToggle,
    options.revisionMarkup,
    options.facingPages,
    options.revisionStyles
  );
  return { record: page, materialized: true, element: retained.element, content, blocks };
}

function virtualPageShellMatches(
  retained: RetainedPage,
  page: PageRecord,
  scale: number,
  ariaHidden: boolean
): boolean {
  const element = retained.element;
  return (
    !retained.materialized &&
    sameBox(retained.record.box, page.box) &&
    element.style.left === `${page.box.x * scale}px` &&
    element.style.top === `${page.box.y * scale}px` &&
    element.style.width === `${page.box.width * scale}px` &&
    element.style.height === `${page.box.height * scale}px` &&
    element.getAttribute('aria-hidden') === (ariaHidden ? 'true' : null)
  );
}

/**
 * Paint a whole layout into a container, reusing the pages that did not change.
 *
 * The DOM is built with `createElement` and `textContent` only — no file-derived string is
 * ever parsed as markup — and stray children (nothing this module painted) are removed, so
 * the container's content is always exactly the painted pages.
 */
export function paintSemanticLayout(
  container: HTMLElement,
  layout: SemanticLayout,
  options: PaintOptions = {}
): void {
  paintSemanticLayoutWithAuthorSlots(container, layout, options);
}

/**
 * Paint with the attached surface's stable author-slot assignment.
 *
 * Internal editor-to-output seam. Standalone consumers use {@link paintSemanticLayout}.
 *
 * @internal
 */
export function paintSemanticLayoutWithAuthorSlots(
  container: HTMLElement,
  layout: SemanticLayout,
  options: PaintOptions,
  authorSlots?: ReadonlyMap<string, number>
): void {
  captureUnsupportedElementFocus(container);
  container.classList.toggle('docx-show-paragraph-marks', options.showParagraphMarks ?? false);
  const chrome = options.contentControlChrome;
  // `hoverIds` is absent ON PURPOSE — see its doc comment. Including it made a pointer
  // entering a TOC rebuild every page, which detached the node the gesture started on.
  const chromeKey = chrome
    ? `${chrome.showAll === true ? '1' : '0'}:${chrome.activeIds ? [...chrome.activeIds].sort().join(',') : ''}:${chrome.checkedIds ? [...chrome.checkedIds].sort().join(',') : ''}:${chrome.tocControlIds ? [...chrome.tocControlIds].sort().join(',') : ''}:${chrome.suppressedIds ? [...chrome.suppressedIds].sort().join(',') : ''}:${chrome.readOnly === true ? 'ro' : ''}`
    : '';
  const drawingStrings = options.drawingStrings ?? DEFAULT_DRAWING_PAINT_STRINGS;
  const breakStrings = options.breakMarkStrings ?? DEFAULT_BREAK_MARK_STRINGS;
  const urlRegistry =
    options.imageUrlPort !== undefined
      ? drawingUrlRegistryFor(container, options.imageUrlPort)
      : null;
  const additionalKey = chrome?.additionalBoundaries
    ? chrome.additionalBoundaries
        .flatMap((boundary) =>
          boundary.fragments.map(
            (fragment) =>
              `${boundary.id}:${fragment.pageIndex}:${fragment.box.x}:${fragment.box.y}:${fragment.box.width}:${fragment.box.height}`
          )
        )
        .sort()
        .join(',')
    : '';
  const readOnlyKey = options.readOnlyParagraphIds
    ? [...options.readOnlyParagraphIds].sort().join(',')
    : '';
  const emptyTocKey = options.emptyTocPlaceholderIds
    ? [...options.emptyTocPlaceholderIds].sort().join(',')
    : '';
  const tocKey = chrome?.tocControlIds ? [...chrome.tocControlIds].sort().join(',') : '';
  // Once per paint, from the WHOLE layout, so every page shares one author→slot map and an
  // incremental repaint cannot disagree with a full one.
  const revisionStyles = revisionStyleContextOf(
    options.revisionStyles ?? (options.revisionMarkup ? 'author' : undefined),
    layout,
    authorSlots
  );
  const revisionCellStyles =
    options.revisionMarkup && Object.values(options.revisionMarkup.cells).includes('byAuthor')
      ? (revisionStyles ?? revisionStyleContextOf('author', layout, authorSlots))
      : null;
  const resolved = {
    scale: options.scale ?? 96 / 72,
    ariaHidden: options.ariaHidden ?? true,
    drawingStrings,
    includePartial: options.includePartial,
    ...(options.unsupportedOwnerPartName
      ? { unsupportedOwnerPartName: options.unsupportedOwnerPartName }
      : {}),
    ...(options.unsupportedSource ? { unsupportedSource: options.unsupportedSource } : {}),
    urlRegistry,
    ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
    ...(options.serifHangulFace ? { serifHangulFace: options.serifHangulFace } : {}),
    ...(options.readOnlyParagraphIds ? { readOnlyParagraphIds: options.readOnlyParagraphIds } : {}),
    ...(options.emptyTocPlaceholderIds
      ? { emptyTocPlaceholderIds: options.emptyTocPlaceholderIds }
      : {}),
    ...(options.defaultFontFamily ? { defaultFontFamily: options.defaultFontFamily } : {}),
    ...(options.fieldShading ? { fieldShading: options.fieldShading } : {}),
    showParagraphMarks: options.showParagraphMarks ?? false,
    ...(options.showParagraphMarks ? { breakMarks: breakMarksOfLayout(layout, breakStrings) } : {}),
    changeBars: options.changeBars ?? 'all-markup',
    changeBarsToggle: options.changeBarsToggle ?? false,
    ...(options.shadeFormFields !== undefined ? { shadeFormFields: options.shadeFormFields } : {}),
    ...(revisionStyles ? { revisionStyles } : {}),
    ...(revisionCellStyles ? { revisionCellStyles } : {}),
    ...(options.revisionMarkup ? { revisionMarkup: options.revisionMarkup } : {}),
    facingPages: options.facingPages,
    revisionKindColors: options.revisionStyles === 'kind',
    ...(options.imageUrlPort ? { imageUrlPort: options.imageUrlPort } : {}),
    ...(options.activeHeaderFooterRId
      ? { activeHeaderFooterRId: options.activeHeaderFooterRId }
      : {}),
    ...(options.activeHeaderFooterPageIndex !== undefined
      ? { activeHeaderFooterPageIndex: options.activeHeaderFooterPageIndex }
      : {}),
    ...(chrome ? { contentControlChrome: chrome } : {}),
  } satisfies ResolvedPaintContext & {
    ariaHidden: boolean;
    activeHeaderFooterRId?: string;
    activeHeaderFooterPageIndex?: number;
  };
  const document = container.ownerDocument;
  // The alias lookup is part of the paint parameters: a page painted before fonts
  // registered must not be reused verbatim afterwards. Header/footer occurrence is
  // applied in place (see applyHeaderFooterPaintChrome) so entering a header, or
  // moving the caret across shared furniture copies, does not rebuild body sheets.
  // Content-control chrome is furniture only, but toggling it must rebuild painted pages
  // so show-all / caret chrome appear. Hover is the one other exception: it is applied
  // to the painted nodes in place, because a pointer crossing a region may not move it.
  const parameters =
    `${resolved.scale}|${resolved.ariaHidden}|${options.includePartial ?? false}|` +
    `${resolved.fontAlias ? aliasIdentity(resolved.fontAlias) : ''}|` +
    `${resolved.serifHangulFace ? aliasIdentity(resolved.serifHangulFace) : ''}|` +
    `${resolved.defaultFontFamily ?? ''}|` +
    `cc:${chromeKey}:${additionalKey}|toc:${tocKey}|` +
    `ro:${readOnlyKey}|tocEmpty:${emptyTocKey}|` +
    `${options.imageUrlPort ? 'url' : ''}|` +
    `${drawingPaintStringsCacheToken(drawingStrings)}|` +
    // The slot map belongs to this paint. A standalone paint derives it from the layout; an
    // attached surface supplies its stable session map. The key must move when that map moves.
    `markup:${JSON.stringify(options.revisionMarkup)}|facing:${options.facingPages}|rev:${revisionStyleContextKey(revisionStyles)}|cells:${revisionStyleContextKey(revisionCellStyles)}|marks:${options.showParagraphMarks ?? false}|` +
    // A reused page keeps its painted labels, so the labels and the section kinds key reuse.
    `${resolved.breakMarks ? `breaks:${breakMarkStringsCacheToken(breakStrings)}:${resolved.breakMarks.token}|` : ''}` +
    `bars:${resolved.changeBars}:${resolved.changeBarsToggle}`;
  const previous = retainedPaints.get(container);
  const parametersUnchanged = previous?.parameters === parameters;
  const reusable = parametersUnchanged
    ? new Map(previous.pages.map((entry) => [entry.record, entry]))
    : null;
  const previousByIndex = previous
    ? new Map(previous.pages.map((entry) => [entry.record.index, entry]))
    : null;

  const pages: RetainedPage[] = layout.pages.map((page) => {
    const materialized = options.materialize?.has(page.index) ?? true;
    const kept = reusable?.get(page);
    if (kept && kept.materialized === materialized) return kept;
    const prior = previousByIndex?.get(page.index);
    if (
      !materialized &&
      prior &&
      virtualPageShellMatches(prior, page, resolved.scale, resolved.ariaHidden)
    ) {
      return { record: page, materialized: false, element: prior.element };
    }
    // Same sheet, different text: keep the page and repaint only the blocks, or the header and
    // footer layer, that moved. Only ever from an unchanged parameter set, so an adopted part
    // is one this pass would have built identically.
    const moved =
      parametersUnchanged && materialized && prior?.materialized
        ? changedPageParts(prior.record, page)
        : null;
    if (moved && prior) {
      // The same context `paintPage` hands the layer.
      const furniture = {
        ...resolved,
        paintInstance: `p${page.index}`,
        tabLeaderOriginXPt: page.contentBox.x - page.box.x,
      };
      const kept =
        !moved.furniture ||
        replaceHeaderFooterLayer(
          document,
          prior.element,
          page,
          furniturePainter(document, furniture)
        );
      const adopted = kept ? adoptPageBlocks(document, prior, page, resolved) : null;
      if (adopted) return adopted;
    }
    const painted: { content?: HTMLElement; blocks?: Map<BlockFragmentRecord, HTMLElement> } = {};
    const element = paintPage(document, page, resolved, materialized, painted);
    return {
      record: page,
      materialized,
      element,
      ...(painted.content ? { content: painted.content } : {}),
      ...(painted.blocks ? { blocks: painted.blocks } : {}),
    };
  });
  retainedPaints.set(container, { parameters, pages });
  container.dataset.revision = String(layout.revision);

  if (urlRegistry) {
    // Keep decoded images and URLs only for painted pages, including selection pins.
    const paintedLayout = {
      ...layout,
      pages: pages.filter((entry) => entry.materialized).map((entry) => entry.record),
    };
    urlRegistry.reconcile(
      collectUsedDrawingResourceKeys(paintedLayout),
      collectUsedDrawingElementKeys(paintedLayout)
    );
  }

  // Keyed reconcile instead of `replaceChildren`: retained elements stay where they are —
  // keeping the browser's style and layout for them, and the DOM selection anchored inside
  // them — while changed pages are placed in order and anything else is dropped.
  const kept = new Set<HTMLElement>(pages.map((entry) => entry.element));
  let child = container.firstChild;
  while (child) {
    const next = child.nextSibling;
    // Drop stale pages first. Leaving them in front of retained virtual shells makes the
    // ordering pass move every shell out and back on each keystroke.
    if (!kept.has(child as HTMLElement)) (child as ChildNode).remove();
    child = next;
  }
  let cursor = container.firstChild;
  for (const entry of pages) {
    if (entry.element === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    container.insertBefore(entry.element, cursor);
  }
  applyHeaderFooterPaintChrome(pages, resolved);
  notifyUnsupportedElementsPaint(container);
}
import { tabLeaderPattern } from '../layout/tab-leader-pattern.ts';
import { equalBlockElement } from './semantic-paint-block-reuse.ts';
