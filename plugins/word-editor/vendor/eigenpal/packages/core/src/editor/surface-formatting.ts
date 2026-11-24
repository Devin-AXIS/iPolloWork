import { revisionMarkupStyleForEditing } from '../layout/revision-markup-style.ts';
import { layoutDerivedSpacingStyleForEditing } from '../layout/layout-derived-spacing.ts';
import {
  formattingRangeBesideRestrictedControl,
  formattingRunAt,
} from '../store/store/direct-properties.ts';
import { noteReferenceEndingAt, noteTypingSource } from '../store/store/note-typing-boundary.ts';
// Formatting queries over the published layout (paginated-surface seam).
//
// This module owns what a toolbar reads and what a formatting command merges against:
// the agreement-based formatting snapshot, run/paragraph property lookups indexed per
// layout, and the merge rule for property containers. The READS are pure functions of
// (layout, selection); the WRITE inputs — what a paragraph, a run or a paragraph mark
// itself authors — come from the canonical tree, because the layout knows only the
// flattened cascade.

import {
  everyStoryOrder,
  paragraphsInCells,
  spansInCells,
  spansInSelection,
  type ParagraphIndent,
  type ResolvedRunStyle,
  type SemanticPosition,
  type ResolvedTabStops,
  type SemanticLayout,
  type SemanticSelection,
  type StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import {
  AUTHORABLE_RUN_PROPERTIES,
  authoredProperties,
  DEFAULT_FORMATTING_DISPLAY_MODE,
  directParagraphMarkProperties,
  findNode,
  propertyContainer,
  readTwipsMeasure,
  runAddressRanges,
  type FormattingDisplayMode,
  type FormattingRevisionAuthorFilter,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
// By path, not through the store's public entry: the walk and its clip are the engine's own
// answer to "which runs does this range cover", not surface a consumer builds on.
import { clippedFormattableRuns } from '../store/store/formattable-runs.ts';
import type { SurfaceFormatting } from './paginated-surface-contract.ts';
import { paragraphFormattingEntry } from './surface-formatting-index.ts';
import { paragraphAlignment } from '../layout/paragraph-flow.ts';
import { paragraphLineSpacing } from '../layout/paragraph-style.ts';
import { paragraphIsRtl } from '../layout/rtl-paragraph.ts';
import { styleForFontSlot } from '../layout/script-itemization.ts';
import { orderPositions } from '../layout/semantic-interaction.ts';
import {
  cascadedParagraphAttributes,
  paragraphBreaksBefore,
  paragraphContextualSpacing,
} from '../layout/paragraph-style.ts';
import { paragraphKeeps, type ParagraphKeeps } from '../layout/pagination-keeps.ts';

const paragraphDirectionOf = (properties: readonly SurfaceProperty[]): 'ltr' | 'rtl' =>
  paragraphIsRtl(properties) ? 'rtl' : 'ltr';

/** One property as the ops and the layout records carry it: an element name plus attributes. */
export interface SurfaceProperty {
  readonly localName: string;
  readonly attributes?: Record<string, string>;
}

/** A paragraph's first published empty-line style, including editable furniture. */
function emptyParagraphStyleOf(
  layout: SemanticLayout,
  paragraphId: string
): ResolvedRunStyle | undefined {
  return paragraphFormattingEntry(layout, paragraphId, true)?.emptyStyle;
}

/**
 * What `paragraphPropertiesOf` answers for a paragraph the layout publishes no fragment
 * for. Empty like any other unstated cascade, but by identity, so a read that resolves a
 * default (line spacing) can tell "states nothing" from "was never laid out".
 */
const UNPUBLISHED_PARAGRAPH_PROPERTIES: readonly SurfaceProperty[] = Object.freeze([]);

/** Cascaded paragraph properties from its first published fragment. */
export function paragraphPropertiesOf(
  layout: SemanticLayout,
  paragraphId: string
): readonly SurfaceProperty[] {
  return (
    paragraphFormattingEntry(layout, paragraphId)?.fragment.props ??
    UNPUBLISHED_PARAGRAPH_PROPERTIES
  );
}

/** Resolved paragraph tabs from its first published fragment. */
export function paragraphTabStopsOf(
  layout: SemanticLayout,
  paragraphId: string
): ResolvedTabStops | null {
  return paragraphFormattingEntry(layout, paragraphId)?.fragment.tabStops ?? null;
}

/** A paragraph's effective indent, plus whether it sits inside a table. */
export interface ParagraphIndentEntry {
  readonly indent: ParagraphIndent;
  readonly inTable: boolean;
}

/**
 * ONE signed first-line offset in twips, negative for a hanging indent. Hanging wins
 * (ECMA-376 §17.3.1.12): the two spellings are mutually exclusive, never summed.
 */
export function signedFirstLine(value: ParagraphIndent): number {
  return Math.round((value.hanging > 0 ? -value.hanging : value.firstLine) * 20);
}

/**
 * A paragraph's EFFECTIVE indent — cascade plus the numbering merge — from the layout
 * records, or null for a paragraph the published layout does not carry.
 *
 * Not derivable from {@link paragraphPropertiesOf}: a list paragraph's indent comes from
 * `numbering.xml` and is merged in after the cascade, so a numbered item authoring no
 * `w:ind` reads zero there while its text sits indented.
 *
 * Table membership rides along because it is the ruler's gate, and this is the one walk
 * that already knows it.
 */
export function paragraphIndentOf(
  layout: SemanticLayout,
  paragraphId: string
): ParagraphIndentEntry | null {
  return paragraphFormattingEntry(layout, paragraphId)?.indent ?? null;
}

/*
 * What a node itself AUTHORS, and how a property write splits per run, live in the store lane
 * (`store/direct-properties.ts`): the automation lane's object model writes formatting on a
 * server with no layout in it, and it must reach the same answers this lane's toolbar does. They
 * are re-exported here under the names the editor lane already used.
 */
export {
  authoredProperties,
  directParagraphMarkProperties,
  directParagraphProperties,
  isAuthorableRunProperty,
  mergedMultiSettingProperty,
  mergedProperties,
  propertyContainer,
  runAddressRanges,
  type RunPropertyEdit,
} from '@docx-editor.dev/core/store';

/**
 * Range run-property planning: THE STORE'S, re-exported under the name the editor lane uses.
 *
 * It was a second implementation for as long as the surface knew something the store could
 * not — which containers hold addressable runs, and which revision halves the reader is
 * looking at. Both moved into the store lane (`formattable-runs.ts`, and the `displayMode`
 * parameter), and what was left here was the same function written twice. Two copies of "which
 * runs does this range cover" is the bug class #493, #497 and #498 all came out of, so the
 * answer lives in one place and this is a name for it.
 */
export { runPropertyEdits } from '@docx-editor.dev/core/store';

/**
 * Whether any run the range covers authors a property an op could clear.
 *
 * The eraser's "is there anything here to erase" question. Asked because an op that names
 * nothing still COUNTS as applied: the store publishes a revision and pushes an undo entry
 * for it even though the tree comes back identical, so pressing Clear Formatting on already
 * clean text reported `changed: true` and cost an undo press that undid nothing.
 *
 * Walks exactly where `runPropertyEdits` walks, so the two can never disagree about which
 * runs a range covers.
 */
export function hasAuthoredRunProperties(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter
): boolean {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return false;
  for (const covered of clippedFormattableRuns(
    paragraph,
    runAddressRanges(paragraph),
    start,
    end,
    displayMode,
    authorFilter
  )) {
    const authored = authoredProperties(
      propertyContainer(covered.run, 'runProperties', 'rPr'),
      AUTHORABLE_RUN_PROPERTIES
    );
    if (authored.length > 0) return true;
  }
  return false;
}

/**
 * What a run at the CARET itself authors — the base pending caret formatting merges over.
 *
 * Word's rule for a collapsed caret: the character typed next takes the formatting of the
 * run to the caret's LEFT; at the very start of a paragraph it takes the run to the right;
 * in an empty paragraph it takes the paragraph mark's own `w:rPr`. The same authored-only
 * narrowing as every other write base applies — echoing the cascade would freeze inherited
 * formatting as direct.
 */
export function authoredRunPropertiesAt(
  part: OoxmlPart,
  paragraphId: string,
  offset: number,
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE,
  authorFilter?: FormattingRevisionAuthorFilter
): readonly SurfaceProperty[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  // Beside a control that typing cannot enter, with no text run to copy, typing writes none.
  // After a note reference the note rule decides instead, as in the store: the run that
  // `formattingRunAt` returns, else the mark, or no face after a reference that ends a link.
  const note = noteReferenceEndingAt(paragraph, offset)
    ? noteTypingSource(paragraph, offset)
    : undefined;
  if (note?.kind === 'none') return [];
  if (!note && formattingRangeBesideRestrictedControl(paragraph, offset) === null) return [];
  // Share the revision-filtered caret owner with complex-script lane selection.
  const owner = formattingRunAt(paragraph, offset, displayMode, authorFilter);
  if (owner) {
    return authoredProperties(
      propertyContainer(owner, 'runProperties', 'rPr'),
      AUTHORABLE_RUN_PROPERTIES
    );
  }
  // No addressable run at all: an empty paragraph, whose mark is what Word reads.
  return directParagraphMarkProperties(part, paragraphId);
}

/**
 * Whether a PENDING property list holds `localName` in its ON state, or `null` when the
 * list does not speak to it. The off spellings mirror what `toggleRunProperty` writes:
 * `val="0"` for the boolean toggles, `val="none"` for `w:u` (a closed enumeration).
 */
export function pendingPropertyState(
  pending: readonly SurfaceProperty[] | null,
  localName: string,
  /** The value being toggled, for a property whose ON state is one member of an
   *  enumeration rather than a boolean (`w:vertAlign`). */
  value?: string
): boolean | null {
  const entry = pending?.find((property) => property.localName === localName);
  if (!entry) return null;
  const val = entry.attributes?.val;
  // `w:vertAlign` armed as `superscript` says NOTHING about whether subscript is on — it
  // says subscript is off. Comparing presence alone made pressing Subscript over an armed
  // superscript read as "already on" and write `baseline`, so the press did the opposite of
  // its label.
  if (localName === 'vertAlign') return val === value;
  if (localName === 'u') return val !== 'none';
  // ST_OnOff's full off vocabulary (17.17.4): `0`, `false` and `off` all mean off, and the
  // read lane treats them alike. Listing only the two this module WRITES would let a host
  // arming `val="off"` directly see a toolbar pressed over text that renders unformatted.
  return val !== '0' && val !== 'false' && val !== 'off' && val !== 'none';
}

/**
 * The formatting snapshot with PENDING caret formatting laid over it, so the toolbar
 * reflects what the next character typed will look like — Word's rule while a stored
 * format is armed. Only the fields pending properties can express are touched; everything
 * else answers from the document.
 */
export function withPendingFormatting(
  formatting: SurfaceFormatting,
  pending: readonly SurfaceProperty[] | null
): SurfaceFormatting {
  if (!pending || pending.length === 0) return formatting;
  let next = formatting;
  for (const property of pending) {
    const val = property.attributes?.val;
    switch (property.localName) {
      case 'b':
        next = { ...next, bold: pendingPropertyState(pending, 'b') === true };
        break;
      case 'i':
        next = { ...next, italic: pendingPropertyState(pending, 'i') === true };
        break;
      case 'u':
        next = { ...next, underline: pendingPropertyState(pending, 'u') === true };
        break;
      case 'strike':
        next = { ...next, strikethrough: pendingPropertyState(pending, 'strike') === true };
        break;
      case 'vertAlign':
        next = {
          ...next,
          superscript: val === 'superscript',
          subscript: val === 'subscript',
        };
        break;
      case 'rFonts':
        next = { ...next, fontFamily: property.attributes?.ascii ?? next.fontFamily };
        break;
      case 'sz': {
        const halfPoints = Number(val);
        if (Number.isFinite(halfPoints)) next = { ...next, fontSizeHalfPoints: halfPoints };
        break;
      }
      case 'color':
        next = { ...next, color: val === 'auto' ? null : (val ?? next.color) };
        break;
      case 'highlight':
        next = { ...next, highlight: val === 'none' ? null : (val ?? next.highlight) };
        break;
      default:
        break;
    }
  }
  return next;
}

/**
 * The spans a selection covers, whichever kind of selection it is.
 *
 * A rectangle of table cells is NOT the text range it stands in for: rows one and two of
 * column one, read as a range, sweep through every cell between them, so a toolbar would
 * report the formatting of cells the user never selected. Reading the cells directly is the
 * only difference cell selection makes to any of these queries.
 */
function selectionSpans(
  layout: SemanticLayout,
  selection: SemanticSelection,
  cells?: readonly string[],
  /**
   * Reading order of the ACTIVE story.
   *
   * The RUN properties need it for the same reason the paragraph ones do. Without it a
   * two-paragraph selection in a header ordered its endpoints against the body, gave up, and
   * reported no spans at all — so Bold read false over bold text and the size box emptied.
   */
  paragraphOrder?: readonly string[]
): readonly StyleSpanRecord[] {
  const spans =
    cells && cells.length > 0
      ? spansInCells(layout, cells)
      : spansInSelection(
          layout,
          selection,
          // One paragraph is ordered by offset alone; skip the document-wide order walk.
          paragraphOrder ??
            (selection.anchor.paragraphId === selection.head.paragraphId
              ? []
              : everyStoryOrder(layout))
        );
  // `everyStoryOrder`, not `documentOrder`. The fallback is only reached by a caller that
  // named no story, and the body's order is wrong for every caret outside it — which is the
  // exact defect the parameter above exists to prevent, left standing in its own fallback.
  return spans.map((span) => {
    const style = layoutDerivedSpacingStyleForEditing(revisionMarkupStyleForEditing(span.style));
    return style === span.style ? span : { ...span, style };
  });
}

/**
 * Every paragraph a range touches, in document order — the span paragraph-level writes cover.
 *
 * A range that ENDS at offset 0 of a paragraph has not touched it. Dragging from the middle
 * of one paragraph to the very start of the next selects no character of the next, and Word
 * treats it that way; including it made a paragraph-level write reach content the user's
 * selection never highlighted. The clamp only applies to a multi-paragraph range: a caret at
 * offset 0 is inside its own paragraph and always touches it.
 */
export function paragraphsInRange(
  order: readonly string[],
  range: { from: SemanticPosition; to: SemanticPosition }
): readonly string[] {
  const firstIndex = order.indexOf(range.from.paragraphId);
  const lastIndex = order.indexOf(range.to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1) return [];
  const last = lastIndex > firstIndex && range.to.offset === 0 ? lastIndex - 1 : lastIndex;
  return order.slice(firstIndex, last + 1);
}

/**
 * The RESOLVED run style at the selection, taken from its first span.
 *
 * The cascade rather than the authored properties, which is what the format painter needs:
 * a run in a styled paragraph states almost nothing itself, so copying its `w:rPr` would
 * copy nothing and painting it would change nothing the reader can see.
 */
export function selectionRunStyle(
  layout: SemanticLayout,
  selection: SemanticSelection,
  cells?: readonly string[],
  paragraphOrder?: readonly string[]
): ResolvedRunStyle | null {
  return selectionSpans(layout, selection, cells, paragraphOrder)[0]?.style ?? null;
}

/** The run properties in force across the selection, taken from its first span. */
export function selectionRunProperties(
  layout: SemanticLayout,
  selection: SemanticSelection,
  cells?: readonly string[],
  paragraphOrder?: readonly string[]
): readonly SurfaceProperty[] {
  return selectionSpans(layout, selection, cells, paragraphOrder)[0]?.props ?? [];
}

/**
 * Whether a run property is already set across the WHOLE selection.
 *
 * Word's rule, and the one that makes a toggle feel right: a partly-bold selection goes
 * fully bold on the first press rather than clearing the bold that is there.
 */
export function isRunPropertyActive(
  layout: SemanticLayout,
  selection: SemanticSelection,
  localName: string,
  cells?: readonly string[],
  /** The value being toggled, for a property whose ON state is one member of an
   *  enumeration rather than a boolean (`w:vertAlign`). */
  value?: string,
  /** Reading order of the ACTIVE story. See {@link selectionSpans}. */
  paragraphOrder?: readonly string[]
): boolean {
  const spans = selectionSpans(layout, selection, cells, paragraphOrder);
  // A collapsed caret in an empty paragraph has no text span. Read its mark face,
  // as the toolbar does, so the toggle and the next typed character agree.
  const empty =
    spans.length === 0 &&
    !cells?.length &&
    selection.anchor.paragraphId === selection.head.paragraphId &&
    selection.anchor.offset === selection.head.offset
      ? emptyParagraphStyleOf(layout, selection.head.paragraphId)
      : undefined;
  const styles = spans.length > 0 ? spans.map((span) => span.style) : empty ? [empty] : [];
  if (styles.length === 0) return false;
  const flagOf = (style: ResolvedRunStyle): boolean => {
    switch (localName) {
      case 'b':
        return style.bold;
      case 'i':
        return style.italic;
      case 'u':
        return style.underline !== null;
      case 'strike':
        return style.strike;
      case 'vertAlign':
        // Its OWN value, not "is raised or lowered at all". Presence alone would make
        // Subscript over superscripted text read as already on, so the press would write
        // `baseline` and un-raise the text instead of lowering it.
        return style.verticalAlign === value;
      default:
        // Every toggleable mark MUST be listed: answering false for one that is
        // active makes its toggle re-apply forever instead of clearing.
        return false;
    }
  };
  return styles.every(flagOf);
}

/**
 * The run defaults a paragraph's content inherits, injected by the surface (a session
 * derivation over the styles and theme parts — this module never reads those trees).
 */
export type InheritedRunDefaults = (
  paragraphId: string,
  runProperties: readonly SurfaceProperty[]
) => { readonly fontFamily: string | null; readonly fontSizeHalfPoints: number | null };

/** A letter of any script; selected text without one does not decide the font box. */
const LETTER = /\p{L}/u;

/**
 * The part of `span` the ordered range `from`-`to` covers. Layout spans are not clipped to the
 * selection, so a selection that starts on the space after a Latin word must not count it.
 */
function selectedTextOf(
  span: StyleSpanRecord,
  from: SemanticPosition,
  to: SemanticPosition
): string {
  const start = span.range.paragraphId === from.paragraphId ? from.offset : span.range.start;
  const end = span.range.paragraphId === to.paragraphId ? to.offset : span.range.end;
  return span.text.slice(
    Math.max(0, start - span.range.start),
    Math.max(0, end - span.range.start)
  );
}

/** The formatting snapshot at a selection, for a toolbar to reflect. */
export function formattingAt(
  layout: SemanticLayout,
  selection: SemanticSelection,
  inherited?: InheritedRunDefaults,
  cells?: readonly string[],
  /**
   * `w:style[@w:default='1'][@w:type='paragraph']` — the style a paragraph that names none
   * is actually written in. Word's style box shows THAT (normally "Normal"), not a blank:
   * "no `w:pStyle`" is a statement about the file, not about what the user is looking at.
   */
  defaultParagraphStyleId?: string | null,
  /**
   * Paragraph ids in reading order for the ACTIVE story.
   *
   * The read has to sweep the same order the write does, or the two disagree about which
   * paragraphs are involved: falling back to the body order answered for a header selection
   * with the head paragraph alone, so a two-paragraph header selection reported the first
   * one's alignment as if the pair agreed — and the following press changed both.
   */
  paragraphOrder?: readonly string[],
  fallbackFontFamily?: string | null,
  /** `false` reads a collapsed caret beside no span: text typed there gets no direct formatting. */
  caretSpan = true
): SurfaceFormatting {
  const spans = caretSpan ? selectionSpans(layout, selection, cells, paragraphOrder) : [];
  const emptyStyles =
    spans.length === 0
      ? paragraphsTouched(layout, selection, cells, paragraphOrder)
          .map((id) => emptyParagraphStyleOf(layout, id))
          .filter((style): style is ResolvedRunStyle => style !== undefined)
      : [];
  const styles = emptyStyles.length > 0 ? emptyStyles : spans.map((span) => span.style);
  // Agreement across the WHOLE selection, or nothing. A collapsed caret yields the one
  // span beside it (Word's rule), so the toolbar reflects the run the user is typing in.
  const agreed = <T>(pick: (style: (typeof styles)[number]) => T): T | null => {
    if (styles.length === 0) return null;
    const first = pick(styles[0]!);
    return styles.every((style) => pick(style) === first) ? first : null;
  };
  // `same` defaults to identity; a caller whose value is a fresh object per paragraph passes
  // its own comparison, or every selection would read as disagreeing.
  const agreedOver = <T>(
    values: readonly T[],
    same: (a: T, b: T) => boolean = (a, b) => a === b
  ): T | null =>
    values.length > 0 && values.every((value) => same(value, values[0]!)) ? values[0]! : null;

  // Font family and size answer the EFFECTIVE value, the way Word's boxes do: a span
  // without a direct `w:rFonts`/`w:sz` falls back to what it inherits (style chain,
  // docDefaults, theme fonts). A caret in an empty paragraph inherits too.
  const hasDirect = (span: (typeof spans)[number], localName: string): boolean =>
    span.props.some((property) => property.localName === localName);
  // The face the span's text PAINTS in, by the painter's own rule (`styleForFontSlot`): East
  // Asian text answers its `w:eastAsia` face, and a complex-script run already resolves
  // `fontFamily` to its `w:cs` face. Chinese text in a Calibri+SimSun run reads SimSun; its
  // Latin letters alone read Calibri.
  //
  // In a selection with East Asian text, selected text without a letter (spaces, punctuation,
  // digits) does not vote. Between or inside Korean and Chinese words it paints through the
  // Latin slot (`2024년`), and counting it made every such selection read blank. Elsewhere
  // every span votes, so digits in another font still make a Latin selection read blank.
  const eastAsian = spans.some((span) => span.fontSlot === 'eastAsia');
  const { anchor, head } = selection;
  const collapsed = anchor.paragraphId === head.paragraphId && anchor.offset === head.offset;
  // Ordered once, only when it matters; a range that cannot be ordered reads whole spans.
  const range =
    !eastAsian || collapsed || cells?.length
      ? null
      : orderPositions(
          selection,
          // One paragraph is ordered by offset alone; skip the document-wide order walk.
          anchor.paragraphId === head.paragraphId ? [] : (paragraphOrder ?? everyStoryOrder(layout))
        );
  const lettered = eastAsian
    ? spans.filter((span) =>
        LETTER.test(range ? selectedTextOf(span, range.from, range.to) : span.text)
      )
    : [];
  const familySpans = lettered.length > 0 ? lettered : spans;
  const familyOf = (span: (typeof spans)[number]): string | null =>
    styleForFontSlot(span.style, span.fontSlot).fontFamily ??
    inherited?.(span.range.paragraphId, span.props).fontFamily ??
    null;
  const sizeOf = (span: (typeof spans)[number]): number =>
    hasDirect(span, 'sz')
      ? Math.round(span.style.fontSizePt * 2)
      : (inherited?.(span.range.paragraphId, span.props).fontSizeHalfPoints ??
        Math.round(span.style.fontSizePt * 2));
  const caretInherited =
    emptyStyles.length > 0
      ? {
          fontFamily: agreed((style) => style.fontFamily ?? fallbackFontFamily ?? null),
          fontSizeHalfPoints: agreed((style) => Math.round(style.fontSizePt * 2)),
        }
      : spans.length === 0
        ? inherited?.(selection.head.paragraphId, [])
        : undefined;

  // Paragraph-level values answer for EVERY paragraph the selection touches — the same
  // span `setParagraphProperty` writes over. Reading only `selection.head` made the
  // alignment control depend on the DIRECTION the user dragged: a centred paragraph
  // selected together with a left one showed Centre pressed one way and Left the other,
  // and pressing either was a change to both. Word shows none of the four pressed.
  const touchedParagraphs = paragraphsTouched(layout, selection, cells, paragraphOrder);
  const paragraphValue = <T>(read: (properties: readonly SurfaceProperty[]) => T): T | null =>
    agreedOver(touchedParagraphs.map((id) => read(paragraphPropertiesOf(layout, id))));
  /**
   * Whether the touched paragraphs DISAGREE about one paragraph-level read.
   *
   * `paragraphValue` answers `null` for two different situations — the paragraphs disagree,
   * and they agree that nothing states it — and a control cannot tell them apart. Showing a
   * disagreement as a concrete value makes it uncorrectable, because the value that would
   * fix it is the one already on screen; showing an absent value as "mixed" tells a single
   * paragraph it disagrees with itself. So the two are reported separately.
   */
  const paragraphDisagrees = <T>(
    read: (properties: readonly SurfaceProperty[]) => T,
    same: (a: T, b: T) => boolean = (a, b) => a === b
  ): boolean => {
    if (touchedParagraphs.length < 2) return false;
    const first = read(paragraphPropertiesOf(layout, touchedParagraphs[0]!));
    // Short-circuits on the first difference, and reuses the per-paragraph property read
    // the layout already memoizes. A Select All over a document whose paragraphs disagree
    // stops at paragraph two rather than walking all of them five times over.
    return touchedParagraphs.some(
      (id, index) => index > 0 && !same(read(paragraphPropertiesOf(layout, id)), first)
    );
  };
  // Normalized BEFORE agreement: `w:jc` absent and `w:jc val="left"` are the same
  // alignment, and comparing the raw attribute would call them a mixed selection.
  //
  // Read through the LAYOUT's own resolver, so the pressed button and the painted line can
  // never disagree about the same paragraph. It also folds the cascade the way a cascade has
  // to be folded — see `cascadedParagraphAttributes`.
  const alignment = paragraphValue((properties) => paragraphAlignment(properties));
  const direction = paragraphValue(paragraphDirectionOf);
  // Resolved per paragraph BEFORE agreement, so a styled paragraph selected together with
  // an unstyled one still reads as mixed (two different styles), while an unstyled
  // paragraph on its own reports the default rather than nothing. Comparing raw `w:pStyle`
  // presence conflated "the selection disagrees" with "this paragraph states no style" and
  // showed a generic placeholder over a paragraph whose style the menu listed by name —
  // with the tick beside none of the rows.
  const style =
    paragraphValue(
      (properties) =>
        cascadedParagraphAttributes(properties, 'pStyle')?.val ??
        defaultParagraphStyleId ??
        undefined
    ) ?? null;
  // `w:spacing` carries three independent things, so they are read as three: the line rule
  // and its value, and the space before/after. All in the vocabulary a toolbar shows —
  // LINES for a multiple, points for everything else — because 276 twentieths and 276
  // 240ths are the same attribute meaning two different quantities, and a control that
  // showed the raw number would be right half the time.
  const spacing = (properties: readonly SurfaceProperty[]) =>
    cascadedParagraphAttributes(properties, 'spacing') ?? undefined;
  //
  // The EFFECTIVE line spacing, read through the layout's own resolver as alignment is, so
  // the ticked menu row and the painted line answer from one place. A paragraph whose
  // cascade states no `w:line` lays out single-spaced, and reporting nothing for it left
  // the line-spacing menu without a current row on the commonest paragraph there is.
  // A paragraph with no published fragment is unknown, not single-spaced: it reads as
  // nothing, so it neither ticks a row on its own nor agrees with laid-out neighbours.
  const lineSpacingTextOf = (properties: readonly SurfaceProperty[]): string => {
    if (properties === UNPUBLISHED_PARAGRAPH_PROPERTIES) return '';
    const resolved = paragraphLineSpacing(properties);
    const round = (value: number) => Math.round(value * 100) / 100;
    if (resolved.rule === 'auto') return `multiple:${round(resolved.value / 240)}`;
    return `${resolved.rule}:${round(resolved.value)}`;
  };
  const lineSpacingText = paragraphValue(lineSpacingTextOf);
  const lineSpacing = ((): SurfaceFormatting['lineSpacing'] => {
    if (!lineSpacingText) return null;
    const [rule, value] = lineSpacingText.split(':');
    return { rule: rule as 'multiple' | 'exact' | 'atLeast', value: Number(value) };
  })();
  // The gap the cascade states, in points, or null when no level states it.
  //
  // The MEASUREMENT, not the resolved gap: `w:beforeAutospacing` replaces the twips beside
  // it with Word's auto value, and resolving that here needs to know whether the paragraph
  // is in a list or a cell — two answers only the layout holds, and guessing either one
  // makes the control disagree with the page it sits above. The measurement is the honest
  // answer, and it is the same answer for the one question asked of it today: Word writes
  // `w:before="100"` beside the flag, so an auto-spaced paragraph reads non-zero and the
  // menu offers Remove, as Word's does.
  const spacePtOf = (
    properties: readonly SurfaceProperty[],
    attribute: 'before' | 'after'
  ): number | null => {
    const raw = readTwipsMeasure(spacing(properties)?.[attribute]);
    return raw === null ? null : Math.round((raw / 20) * 100) / 100;
  };
  const spacePt = (attribute: 'before' | 'after') =>
    paragraphValue((properties) => spacePtOf(properties, attribute));
  // Indent does NOT go null on disagreement, unlike everything above it: the values are the
  // FIRST touched paragraph's and `mixed` reports the rest per field. A ruler has to draw
  // its handles somewhere, and hiding them for Select All — the commonest indent gesture —
  // is worse than showing the first paragraph's truth, which is what Word shows.
  const indent = ((): SurfaceFormatting['indent'] => {
    // Layout publishes physical sides; the contract's are logical, as `w:left` and `w:right`
    // are, so a right-to-left paragraph reports its right indent as `left`.
    const rtlOf = (id: string) => paragraphDirectionOf(paragraphPropertiesOf(layout, id)) === 'rtl';
    const entries = touchedParagraphs.map((id) => {
      const entry = paragraphIndentOf(layout, id);
      if (!entry || !rtlOf(id)) return entry;
      return {
        ...entry,
        indent: { ...entry.indent, left: entry.indent.right, right: entry.indent.left },
      };
    });
    const first = entries[0];
    if (!first) return null;
    // Inside a table the value is correct but unplaceable: it is measured from the cell's
    // content edge, and a ruler drawn against the page margin does not know the cell.
    if (entries.some((entry) => entry === null || entry.inTable)) return null;
    const rtl = rtlOf(touchedParagraphs[0]!);
    // Points to twips at this boundary, so one representation crosses into the contract.
    const twips = (points: number): number => Math.round(points * 20);
    const resolved = entries as readonly ParagraphIndentEntry[];
    const left = twips(first.indent.left);
    const right = twips(first.indent.right);
    const firstLine = signedFirstLine(first.indent);
    return {
      left,
      right,
      firstLine,
      mixed: {
        left: resolved.some((entry) => twips(entry.indent.left) !== left),
        right: resolved.some((entry) => twips(entry.indent.right) !== right),
        firstLine: resolved.some((entry) => signedFirstLine(entry.indent) !== firstLine),
      },
      ...(rtl ? { rtl } : {}),
    };
  })();

  // The Paragraph dialog shows these as checkboxes, so each answers on / off / mixed.
  //
  // Delegated to the LAYOUT readers rather than folded here. A toggle is stated by the
  // presence of its element, so a level that states `<w:keepNext/>` with no attributes has
  // to override a lower level's `w:val="0"` — and an attribute-wise merge of the cascade
  // cannot see that, because a level with no attributes contributes nothing to it. Reading
  // it separately also let the two answers drift: `w:widowControl` defaults to ON
  // (§17.3.1.44) and a second implementation defaulted it off. One reader, one answer.
  const keeps = (pick: (resolved: ParagraphKeeps) => boolean) =>
    paragraphValue((properties) => pick(paragraphKeeps(properties)));
  const pageBreakBeforeFlag = paragraphValue(paragraphBreaksBefore);
  const contextualSpacingFlag = paragraphValue(paragraphContextualSpacing);

  return {
    bold: styles.length > 0 && styles.every((entry) => entry.bold),
    italic: styles.length > 0 && styles.every((entry) => entry.italic),
    underline: styles.length > 0 && styles.every((entry) => entry.underline !== null),
    strikethrough: styles.length > 0 && styles.every((entry) => entry.strike),
    superscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'superscript'),
    subscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'subscript'),
    fontFamily:
      spans.length > 0
        ? agreedOver(familySpans.map(familyOf))
        : (caretInherited?.fontFamily ?? null),
    fontSizeHalfPoints:
      spans.length > 0
        ? agreedOver(spans.map(sizeOf))
        : (caretInherited?.fontSizeHalfPoints ?? null),
    color: agreed((entry) => entry.color),
    highlight: agreed((entry) => entry.highlight),
    alignment,
    direction,
    styleId: style,
    lineSpacing,
    spaceBeforePt: spacePt('before'),
    spaceAfterPt: spacePt('after'),
    disagrees: {
      alignment: paragraphDisagrees((properties) => paragraphAlignment(properties)),
      direction: paragraphDisagrees(paragraphDirectionOf),
      spaceBeforePt: paragraphDisagrees((properties) => spacePtOf(properties, 'before')),
      spaceAfterPt: paragraphDisagrees((properties) => spacePtOf(properties, 'after')),
      lineSpacing: paragraphDisagrees(lineSpacingTextOf),
      tabStops: ((): boolean => {
        if (touchedParagraphs.length < 2) return false;
        const first = JSON.stringify(
          paragraphTabStopsOf(layout, touchedParagraphs[0]!)?.stops ?? null
        );
        return touchedParagraphs.some(
          (id, index) =>
            index > 0 && JSON.stringify(paragraphTabStopsOf(layout, id)?.stops ?? null) !== first
        );
      })(),
    },
    indent,
    // Compared by VALUE across the selection, not by reference: the stops are a fresh array
    // per paragraph, and two paragraphs with identical stops must read as agreeing.
    tabStops:
      agreedOver(
        touchedParagraphs.map((id) => paragraphTabStopsOf(layout, id)?.stops ?? null),
        (a, b) =>
          a === null || b === null
            ? a === b
            : a.length === b.length &&
              a.every(
                (stop, index) =>
                  Math.round(stop.positionPt * 20) === Math.round(b[index]!.positionPt * 20) &&
                  stop.alignment === b[index]!.alignment &&
                  (stop.leader ?? 'none') === (b[index]!.leader ?? 'none')
              )
      )?.map((stop) => ({
        positionTwips: Math.round(stop.positionPt * 20),
        alignment: stop.alignment,
        ...(stop.leader ? { leader: stop.leader } : {}),
      })) ?? null,
    paragraphFlags: {
      contextualSpacing: contextualSpacingFlag,
      keepNext: keeps((resolved) => resolved.keepNext),
      keepLines: keeps((resolved) => resolved.keepLines),
      widowControl: keeps((resolved) => resolved.widowControl),
      pageBreakBefore: pageBreakBeforeFlag,
    },
  } satisfies SurfaceFormatting;
}

/**
 * Every paragraph a selection touches, in document order — the exact span
 * `setParagraphProperty` writes over, so what the toolbar READS and what a press WRITES
 * can never disagree about which paragraphs are involved.
 *
 * Falls back to the head paragraph alone when either endpoint is not in the published
 * order (a layout that has not caught up), which is the previous behaviour.
 */
function paragraphsTouched(
  layout: SemanticLayout,
  selection: SemanticSelection,
  cells?: readonly string[],
  paragraphOrder?: readonly string[]
): readonly string[] {
  // A RECTANGLE first, for the same reason the write takes it first: a selected column read
  // as a range runs through the cells between its corners, so the toolbar answered "mixed"
  // over a column that was uniformly centred — and would then have centred it correctly.
  // The button never lit, before a press or after one.
  if (cells && cells.length > 0) return [...paragraphsInCells(layout, cells)];
  if (selection.anchor.paragraphId === selection.head.paragraphId) {
    return [selection.head.paragraphId];
  }
  // The ACTIVE story's order when the caller knows it, and every story when it does not.
  // `documentOrder` is the body's, and a header selection resolves to -1 in it — so the
  // fallback used to return the head paragraph alone and the caller saw a one-paragraph
  // selection where the reader had made a two-paragraph one.
  const order = paragraphOrder ?? everyStoryOrder(layout);
  const anchorIndex = order.indexOf(selection.anchor.paragraphId);
  const headIndex = order.indexOf(selection.head.paragraphId);
  if (anchorIndex === -1 || headIndex === -1) return [selection.head.paragraphId];
  return order.slice(Math.min(anchorIndex, headIndex), Math.max(anchorIndex, headIndex) + 1);
}

/**
 * The paragraph-mark edit that keeps a whole-paragraph format change honest.
 *
 * Word writes the same run properties onto the paragraph MARK (`w:pPr/w:rPr`) whenever
 * formatting is applied to an entire paragraph. That mark is what a list marker inherits
 * its face from, so without it, sizing a bulleted paragraph left the bullet at the old
 * size beside text that had grown.
 *
 * Returns nothing when the range does not cover the whole paragraph — formatting part of a
 * paragraph must not restyle its pilcrow, and therefore must not move its marker.
 */
export function paragraphMarkOps(
  paragraphText: string,
  from: { readonly paragraphId: string; readonly offset: number },
  to: { readonly paragraphId: string; readonly offset: number },
  properties: readonly SurfaceProperty[]
): readonly {
  readonly op: 'setParagraphMarkProperties';
  readonly paragraphId: string;
  readonly properties: readonly SurfaceProperty[];
}[] {
  if (from.paragraphId !== to.paragraphId) return [];
  if (from.offset !== 0 || to.offset !== paragraphText.length) return [];
  if (paragraphText.length === 0) return [];
  return [{ op: 'setParagraphMarkProperties', paragraphId: from.paragraphId, properties }];
}
