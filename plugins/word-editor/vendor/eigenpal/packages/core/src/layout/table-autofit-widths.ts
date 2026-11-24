import { returnUncoveredHintedText } from './east-asia-hint-coverage.ts';
import { memoizedNestedNeed, type NestedTableNeed } from './nested-table-need-memo.ts';
import { cachedAutofitCellWidths, widenedCellInsets } from './table-autofit-cell-cache.ts';
import { rowForWidenedMeasurement } from './legacy-table-side-rules.ts';
import { autofitReuseScope } from './autofit-context-reuse.ts';
import { withDefaultTabInterval } from './paragraph-tabs.ts';
import { MAX_TABLE_GROWTH_PT } from './table-widths.ts';
import { unwrappedCellHold } from './table-cell-hide-mark.ts';
import * as columnFit from './table-column-fit.ts';
import {
  cellSpacingGapPt,
  cellSpacingScale,
  columnsAroundCells,
  spacedCellWidths,
  spacingGapsPt,
} from './table-cell-spacing.ts';
import {
  MIN_COLUMN_PT,
  autofitTargetPt,
  contentSizedWidths,
  sameOrComputed,
  spanAdjustedMinimums,
  widenAutofitColumns,
} from './table-autofit-distribution.ts';

export { autofitTargetPt, widenAutofitColumns } from './table-autofit-distribution.ts';
// Autofit column minimums: a column is never narrower than the widest unbreakable segment
// its cells hold.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';
import { bidiSourceBoundaries } from './bidi-piece-coalescing.ts';
import { bidiPieces, paragraphIsRtl } from './rtl-paragraph.ts';
import {
  BREAK_AFTER_DASH,
  ENDS_WITH_BREAKING_SPACE,
  STARTS_WITH_BREAKING_SPACE,
  wordBoundaries,
  ZERO_WIDTH_SPACE,
} from './cjk-line-break.ts';
import { paragraphWordCuts } from './paragraph-word-cuts.ts';
import {
  automaticAutofitSpacing,
  cjkAutofitBreaks,
  measureUnwrappedAutofitText,
  nextAutofitTabStop,
} from './autofit-unwrapped-text.ts';
import { measureInlineDrawing, type InlineDrawingLayoutContext } from './drawing-layout.ts';
import { createEquationLayouter } from './equation-layout.ts';
import type { DocumentProperties } from '@docx-editor.dev/core/store';
import type { FieldCodeRanges } from './field-code-toc.ts';
import type { BodyPageFieldContext } from './field-page-furniture.ts';
import type { FieldPageContext } from './field-projection.ts';
import type { RefFieldContext } from './field-ref.ts';
import type { NoteMarkContext } from './note-projection.ts';
import type { TocLinkRanges } from './toc-link-formatting.ts';
import { cellStyleKey } from './autofit-value-token.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { piecesOfParagraphForDisplay } from './field-projection-display.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { measureDisplayText } from './run-style.ts';
import { widenBalancedSpaces } from './balanced-space-widths.ts';
import { continuesFitTextGroup, fitTextGroupOf, fitTextGroups } from './fit-text-groups.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { SemanticTableCell, SemanticTableStructure } from './semantic-table.ts';
import {
  cascadeRunProperties,
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { centeredLegacyReachPt, contentAlignedReachPt, leadingIndentPt } from './table-origin.ts';
import {
  fixedNestedWidths,
  percentShareWidths,
  preferredSpreadWidths,
} from './table-autofit-spread.ts';
import {
  emptyColumnContent,
  mergeMarkupNeeds,
  type AutofitColumnContent,
} from './table-autofit-column-content.ts';
export type { AutofitColumnContent } from './table-autofit-column-content.ts';
import { resolveCjkTypography } from './cjk-typography.ts';
import { withoutLineEndWhitespace } from './trailing-spaces.ts';
import { autofitHyphenation } from './auto-hyphenation.ts';

/**
 * What autofit needs from layout to measure each cell the way layout paints it.
 * @public
 */
export interface TableAutofitContext {
  /** Measures text exactly as line breaking does. */
  readonly measurer: TextMeasurer;
  /** Nested in a fixed table's cell (`nestedAutofitStructure`). */ readonly parentTableFixed?: true;
  /** List items by paragraph id: a list level indents its paragraph. */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /** Resolves inline pictures, so a picture column keeps the width the picture paints at. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /** Field and note context, so the minimum measures the text layout paints. */
  readonly fields?: AutofitFieldContext;
  /** The document's default tab interval, where an unwrapped line's tabs advance to. */
  readonly defaultTabStopPt?: number;
  /**
   * The document's compatibility mode, as `w:compatSetting` states it. Absent means no
   * declaration, which lays out as a legacy mode: a positive first-line indent is left out of a
   * column's minimum. Callers that set it must also fold it into {@link passToken}.
   */
  readonly compatibilityMode?: number;
  /**
   * A token that changes whenever a paragraph's projected text can change: the same tokens
   * the paragraph break cache keys on. Minimums are cached only when this and
   * {@link TableAutofitContext.passToken} are both given.
   */
  readonly paragraphToken?: (paragraph: OoxmlElement) => string;
  /**
   * A token over every other input the minimum reads: the drawing context and every member of
   * {@link TableAutofitContext.fields}. It must change when any of them changes. List state is
   * not part of it: {@link TableAutofitContext.paragraphToken} must carry each paragraph's
   * list tokens.
   */
  readonly passToken?: string;
}

/**
 * The field and note context cell layout projects paragraphs with.
 * @public
 */
export interface AutofitFieldContext {
  /** The page a header or footer paints on, for its PAGE and NUMPAGES results. */
  readonly pageContext?: FieldPageContext;
  /** Footnote and endnote reference marks, as numbered for this pass. Treated as immutable. */
  readonly noteMarks?: NoteMarkContext;
  /** Package properties that AUTHOR, TITLE, and similar fields paint. */
  readonly documentProperties?: DocumentProperties;
  /** Body page-field placeholders; `false` paints cached results instead. */
  readonly bodyPageFields?: BodyPageFieldContext | false;
  /** Refreshed cross-reference results. */
  readonly refFields?: RefFieldContext;
  /** Paint field instructions instead of results. */
  readonly showFieldCodes?: boolean;
  /** Field-code ranges by paragraph id, when instructions are shown. */
  readonly fieldCodeRanges?: FieldCodeRanges;
  /** Table-of-contents link styling by paragraph id. */
  readonly tocLinkStyleRanges?: TocLinkRanges;
}

export { autofitContextOf, carryTableAutofitScope } from './table-autofit-context.ts';

/** The view a structure was read in: the cascade, display mode, and author filter. */
export interface AutofitView {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  /** How deep the table being measured sits; nested tables read one level deeper. */
  readonly depth?: number;
  /**
   * Reads a nested table in the same view in the narrowest cell, at its own depth; null past
   * the nesting limit, where layout paints nothing either. See {@link narrowNestedReader}.
   */
  readonly readNested: (table: OoxmlElement, depth: number) => SemanticTableStructure | null;
  /**
   * The same table read with every revision shown. Column widths size for deleted content
   * too, whatever the view shows, so a view that hides revisions measures this structure.
   */
  readonly markupStructure?: SemanticTableStructure;
}

/** Below this a column is already as wide as its content needs. */
const WIDTH_EPSILON_PT = 0.01;

interface MinimumInputs {
  readonly context: TableAutofitContext;
  readonly view: AutofitView;
  readonly tableCellStyle: SemanticTableCell['styleFormatting'] | undefined;
}

/** What a cached minimum was measured under: view identities and string tokens only. */
interface MinimumKey {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: string;
  readonly cellStyle: string;
  /** Shared by every paragraph of a pass, so it usually compares by pointer. */
  readonly passToken: string;
  readonly paragraphToken: string;
}

/**
 * The last minimum per measurer and paragraph node, so an edit re-measures only the paragraphs
 * it changed. Keyed by the measurer first and holding only tokens in its values: neither a
 * disposed export measurer nor an earlier pass's field and drawing contexts live on through
 * the document's nodes.
 */
const paragraphMinimums = new WeakMap<
  TextMeasurer,
  WeakMap<
    OoxmlElement,
    { readonly key: MinimumKey; readonly widths: ParagraphWidths; scope?: object }
  >
>();

/** A paragraph's narrowest and widest width: unbreakable segments, and lines left unwrapped. */
export interface ContentWidths {
  readonly min: number;
  readonly max: number;
}

/** {@link ContentWidths} with the minimum a column that has to widen keeps. */
interface ParagraphWidths extends ContentWidths {
  /**
   * The minimum once the column has to widen anyway: the first word after spaces that open the
   * paragraph keeps its first-line indent, so it stays on the first line. `min` lets that word
   * start the next line, which decides whether the column widens at all.
   */
  readonly minWidened: number;
}

function minimumKey(paragraph: OoxmlElement, inputs: MinimumInputs): MinimumKey | null {
  const { context, view } = inputs;
  // Both tokens or no cache: a paragraph token alone cannot see the pass inputs change.
  if (!context.paragraphToken || context.passToken === undefined) return null;
  return {
    styleCascade: view.styleCascade,
    displayMode: view.displayMode,
    authorFilter: view.authorFilter?.cacheKey ?? '',
    cellStyle: cellStyleKey(inputs.tableCellStyle),
    passToken: context.passToken,
    paragraphToken: context.paragraphToken(paragraph),
  };
}

function sameKey(a: MinimumKey, b: MinimumKey): boolean {
  return (
    a.styleCascade === b.styleCascade &&
    a.displayMode === b.displayMode &&
    a.authorFilter === b.authorFilter &&
    a.cellStyle === b.cellStyle &&
    a.passToken === b.passToken &&
    a.paragraphToken === b.paragraphToken
  );
}

/**
 * The widest segment of a paragraph that no line break may split, plus its indents.
 *
 * Break opportunities are spaces, zero-width spaces, tabs, line breaks, and the dash rule of
 * {@link wordBoundaries}. An ideographic run counts as one segment here, and so does an
 * unspaced Thai, Lao, Khmer, or Myanmar run: an autofit column
 * widens to keep it whole, although line breaking may still wrap it inside the column. A
 * segment runs across source runs, field results, and hidden text, measured in the face each
 * piece paints. A positive first-line indent counts against the first segment.
 */
export function paragraphMinimumWidthPt(paragraph: OoxmlElement, inputs: MinimumInputs): number {
  return paragraphContentWidthsPt(paragraph, inputs).min;
}

/**
 * {@link paragraphMinimumWidthPt} together with the paragraph's widest line when nothing wraps:
 * every line between hard breaks at its full width, trailing spaces hung, plus its indents.
 */
export function paragraphContentWidthsPt(
  paragraph: OoxmlElement,
  inputs: MinimumInputs
): ContentWidths {
  const { min, max } = paragraphWidthsPt(paragraph, inputs);
  return { min, max };
}

function paragraphWidthsPt(paragraph: OoxmlElement, inputs: MinimumInputs): ParagraphWidths {
  const { context, view } = inputs;
  const { measurer } = context;
  const { styleCascade, displayMode } = view;
  const scope = autofitReuseScope(context);
  let byParagraph = paragraphMinimums.get(measurer);
  if (!byParagraph) paragraphMinimums.set(measurer, (byParagraph = new WeakMap()));
  const cached = byParagraph.get(paragraph);
  if (
    scope &&
    cached?.scope === scope &&
    cached.key.styleCascade === view.styleCascade &&
    cached.key.displayMode === view.displayMode &&
    cached.key.authorFilter === (view.authorFilter?.cacheKey ?? '') &&
    cached.key.cellStyle === cellStyleKey(inputs.tableCellStyle)
  )
    return cached.widths;
  const key = minimumKey(paragraph, inputs);
  if (key && cached && sameKey(cached.key, key)) {
    cached.scope = scope;
    return cached.widths;
  }
  const layoutInputs = resolveParagraphLayoutInputs(
    paragraph,
    Number.MAX_SAFE_INTEGER,
    styleCascade,
    context.listItems?.get(paragraph.id),
    inputs.tableCellStyle,
    true
  );
  const fields = context.fields;
  const projected = piecesOfParagraphForDisplay(
    paragraph,
    layoutInputs.inheritedRunProperties,
    fields?.pageContext,
    styleCascade
      ? (inherited, direct) => cascadeRunProperties(inherited, direct, styleCascade)
      : undefined,
    undefined,
    fields?.noteMarks,
    displayMode,
    undefined,
    context.inlineDrawingLayout,
    styleCascade?.themeFonts,
    undefined,
    fields?.documentProperties,
    fields?.bodyPageFields ?? false,
    fields?.refFields,
    view.authorFilter,
    fields?.showFieldCodes,
    fields?.fieldCodeRanges?.get(paragraph.id),
    fields?.tocLinkStyleRanges?.get(paragraph.id)
  );
  const typography = resolveCjkTypography(
    layoutInputs.props,
    styleCascade?.typography,
    layoutInputs.markRunProperties
  );
  // The bidi pass gives each piece the shaping and joining context line breaking measures with;
  // an unshaped complex-script word measures far wider than it paints. Fitted text takes
  // its stated width here as in line breaking, and balanced spaces their balanced width.
  const pieces = widenBalancedSpaces(
    fitTextGroups(
      bidiPieces(
        returnUncoveredHintedText(projected, measurer),
        paragraphIsRtl(layoutInputs.props),
        bidiSourceBoundaries(paragraph),
        true
      ),
      measurer
    ),
    typography,
    measurer
  );
  const automaticSpacing = automaticAutofitSpacing(typography, measurer);
  let previousText: Parameters<typeof automaticSpacing>[3];
  const cjkBreaks = cjkAutofitBreaks(pieces, layoutInputs, measurer, styleCascade);
  const hyphenationOf = autofitHyphenation(pieces, layoutInputs.props, styleCascade, context);
  const { left, right, firstLine, hanging } = layoutInputs.indent;
  const tabs = withDefaultTabInterval(layoutInputs.tabStops, context.defaultTabStopPt);
  // Tab stops count from the leading indent, which is the right one in right-to-left text.
  // The line breaker clamps a negative leading indent at the content edge.
  const rtl = paragraphIsRtl(layoutInputs.props);
  const leading = Math.max(0, rtl ? right : left);
  // A negative leading indent moves text into the cell margin and lowers the minimum; a
  // negative trailing indent does not (the line still ends at the cell's content edge).
  const sides = rtl ? Math.max(0, left) + right : left + Math.max(0, right);
  // Where a tab at `at` lands: the next stop the paragraph states, else the default grid.
  const nextTabStop = (at: number): number => nextAutofitTabStop(tabs, at);
  // Where each line starts: the first one shifted by its first-line indent or hanging. A list
  // item's hanging slot belongs to its marker; its text starts back at the left indent.
  const listItem = context.listItems?.get(paragraph.id);
  const firstShift = listItem ? Math.max(0, firstLine) : hanging > 0 ? -hanging : firstLine;
  // In legacy modes a word too wide for the first line breaks there, so the minimum leaves a
  // positive first-line indent out. A list item's marker slot still counts.
  const minimumShift =
    !listItem && hasCompatibilityRule(context.compatibilityMode, 'autofitMinimumSkipsFirstLine')
      ? Math.min(0, firstShift)
      : firstShift;
  let widest = 0;
  let widestWidened = 0;
  let segment = 0;
  let first = true;
  // Spaces opened the paragraph: the word after them starts the next line in `min`, but keeps
  // the first-line indent in `minWidened`.
  let firstAfterSpaces = false;
  // The unwrapped line: its full width so far, and the spaces it would hang at its end.
  let line = 0;
  let hung = 0;
  let longest = 0;
  let onFirstLine = true;
  const endLine = (): void => {
    previousText = undefined;
    const width = Math.max(0, line - hung + sides + (onFirstLine ? firstShift : 0));
    if (line > 0 && width > longest) longest = width;
    line = 0;
    hung = 0;
    onFirstLine = false;
  };
  const advance = (width: number, spaces = 0): void => {
    line += width;
    hung = spaces < width ? spaces : hung + spaces;
  };
  const close = (): void => {
    if (segment > 0) {
      // Indents are physical sides; the first-line shift moves whichever one leads.
      const width = Math.max(0, segment + sides + (first ? minimumShift : 0));
      if (width > widest) widest = width;
      const shift = first || firstAfterSpaces ? minimumShift : 0;
      widestWidened = Math.max(widestWidened, Math.max(0, segment + sides + shift));
      first = false;
      firstAfterSpaces = false;
    }
    segment = 0;
  };
  let layoutEquation: ReturnType<typeof createEquationLayouter> | undefined;
  // A dash that ends a run breaks only if the next run does not open with another dash.
  let dashPending = false;
  // A dash that opens a run breaks after itself when text precedes it, as line breaking reads it.
  const wordCuts = paragraphWordCuts(pieces, (piece) => piece.style.hidden === true);
  for (const piece of pieces) {
    if (piece.style.hidden) continue;
    // A drawing that is not an inline atom (anchored, hidden, unresolved) takes no width in
    // the line, exactly as the line breaker skips its placeholder.
    if (piece.projected && !piece.inlineDrawing && !piece.equation && piece.text === '\uFFFC')
      continue;
    if (dashPending && !BREAK_AFTER_DASH.has(piece.text[0] ?? '')) close();
    dashPending = false;
    // A table cell lays out as though page breaks were absent: the words around one join.
    if (piece.text === PAGE_BREAK_CHAR) continue;
    if (piece.text === '\n') {
      // A break ends the first line, and with it the first-line indent.
      endLine();
      close();
      first = false;
      firstAfterSpaces = false;
      continue;
    }
    // A picture or an equation is one box with a break opportunity on each side.
    const atomWidth = piece.inlineDrawing
      ? measureInlineDrawing(piece.inlineDrawing.projection).totalWidth
      : piece.equation
        ? (layoutEquation ??= createEquationLayouter(measurer))(
            piece.equation,
            piece.style,
            piece.equationLayout
          ).geometry.box.width
        : undefined;
    if (atomWidth !== undefined) {
      previousText = undefined;
      advance(atomWidth);
      close();
      segment = atomWidth;
      close();
      continue;
    }
    // A run that opens with a breaking space breaks before it, as the line breaker does,
    // unless it continues a fitted group: a group never breaks.
    if (STARTS_WITH_BREAKING_SPACE.test(piece.text) && !continuesFitTextGroup(piece)) close();
    const style = styleForFontSlot(piece.style, piece.fontSlot);
    const measure = (text: string): number => measureDisplayText(text, style, measurer);
    if (piece.measureText !== undefined) {
      advance(measure(piece.measureText));
      segment += measure(piece.measureText);
      continue;
    }
    const boundaries =
      cjkBreaks?.boundaries(piece) ??
      wordCuts?.boundaries(piece) ??
      wordBoundaries(piece.text, false);
    const spacing = automaticSpacing(piece, boundaries, style, previousText);
    const unwrapped = measureUnwrappedAutofitText(
      piece.text,
      wordCuts?.boundaries(piece),
      measure,
      line + leading + (onFirstLine ? firstShift : 0),
      nextTabStop,
      cjkBreaks?.unwrappedAdvance(piece, spacing.extraAdvance) ?? spacing.extraAdvance
    );
    advance(unwrapped.width, unwrapped.trailing);
    if (cjkBreaks?.opens(piece)) close();
    // A fitted group is one unit: the minimum holds its whole stated width.
    if (fitTextGroupOf(piece) !== undefined) {
      segment += measure(piece.text);
      continue;
    }
    let from = 0;
    const hyphenation = hyphenationOf?.(piece, boundaries);
    for (const to of hyphenation?.cuts ?? boundaries) {
      const candidate = piece.text.slice(from, to);
      from = to;
      if (candidate.length === 0) continue;
      if (candidate === '\t') {
        previousText = undefined;
        // A tab uses up the first-line indent, and spaces after it no longer open the line.
        close();
        first = false;
        firstAfterSpaces = false;
        continue;
      }
      const ink = withoutLineEndWhitespace(candidate);
      // A minimum cut omits only its leading gap; internal gaps and token shaping remain.
      const continues = segment > 0;
      segment += spacing.minimum(to - candidate.length, continues);
      segment -= cjkBreaks?.shared(piece, to - candidate.length, to, continues) ?? 0;
      // Spaces that open the paragraph end its first line: the word after them may start the
      // next line, where the first-line indent no longer applies.
      if (ink.length === 0 && segment === 0) {
        firstAfterSpaces ||= first;
        first = false;
      }
      if (ink.length === candidate.length) segment += measure(candidate);
      else if (ink.length > 0) segment += measure(candidate) - measure(candidate.slice(ink.length));
      // A fragment that ends at a hyphenation point carries its hyphen.
      const hyphen = hyphenation?.hyphens.has(to) === true;
      if (hyphen) segment += measure('-');
      // A space or a dash ends the segment, including a dash that ends its run; a plain run
      // seam does not.
      if (
        ink.length < candidate.length ||
        to < piece.text.length ||
        hyphen ||
        ENDS_WITH_BREAKING_SPACE.test(candidate) ||
        candidate.endsWith(ZERO_WIDTH_SPACE)
      )
        close();
      else dashPending = BREAK_AFTER_DASH.has(candidate.at(-1)!);
    }
    previousText = spacing.previousText;
  }
  close();
  endLine();
  // An empty paragraph keeps its side indents and a list marker slot, never a first-line indent.
  const emptyShift = listItem ? firstShift : Math.min(0, firstShift);
  const min = widest > 0 ? widest : Math.max(0, left + right + emptyShift);
  const minWidened = Math.max(min, widestWidened);
  const widths = { min, max: Math.max(minWidened, longest), minWidened };
  if (key) byParagraph.set(paragraph, { key, widths, scope });
  return widths;
}

function nestedTableMinimumPt(
  table: OoxmlElement,
  context: TableAutofitContext,
  view: AutofitView
): NestedTableNeed {
  const depth = (view.depth ?? 0) + 1;
  return memoizedNestedNeed(context, table, view, depth, () =>
    measureNestedTableNeed(table, context, view, depth)
  );
}

function measureNestedTableNeed(
  table: OoxmlElement,
  context: TableAutofitContext,
  view: AutofitView,
  depth: number
): NestedTableNeed {
  const nested = view.readNested(table, depth);
  // Past the nesting limit layout paints nothing, so nothing needs room.
  if (!nested) return { plain: 0, widened: 0 };
  // A fixed table counts the words it holds, not its stated width, so the column narrows to
  // its content and the table with it, though a cell of vertical text keeps its width.
  const nestedView = { ...view, depth };
  let minimums = spacingGapsPt(nested);
  if (nested.layoutFixed) {
    for (const minimum of fixedTableCellMinimums(nested, context, nestedView)) minimums += minimum;
    const fixed = minimums + leadingIndentPt(nested);
    return { plain: fixed, widened: fixed };
  }
  // An autofit table paints at its resolved width in the narrowest cell: a stated absolute
  // width keeps it, a cell-relative width shrinks with the cell, and the resolver decides both.
  let width = 0;
  for (const column of nested.columnWidthsPt) width += column;
  const need = (keepsFirstLine: boolean): number => {
    const ifWidened: number[] = [];
    const content = emptyColumnContent();
    autofitColumnMinimumsPt(nested, context, nestedView, ifWidened, content, keepsFirstLine);
    // A spanning cell of the nested table asks the outer column for its room too.
    const held = spanAdjustedMinimums(
      spacedCellWidths(nested),
      ifWidened,
      content.maximums,
      content.spans
    );
    // Every column keeps a hairline, as the widths it settles at do.
    let total = minimums;
    for (const minimum of held) total += Math.max(minimum, MIN_COLUMN_PT);
    return Math.max(width, total) + leadingIndentPt(nested);
  };
  return { plain: need(false), widened: need(true) };
}

/**
 * A fixed table's cell minimums when it must narrow inside a cell: the content each column
 * holds, raised for its spanning cells. A column only spanning cells cover asks for nothing
 * of its own, since the table gives up its stated widths.
 */
function fixedTableCellMinimums(
  structure: SemanticTableStructure,
  context: TableAutofitContext,
  view: AutofitView
): readonly number[] {
  const ifWidened: number[] = [];
  const content = emptyColumnContent();
  autofitColumnMinimumsPt(structure, context, view, ifWidened, content, false);
  // A column with no horizontal text of its own asks for no more than a hairline, while a cell
  // of vertical text keeps the width it has: one column's minimum, or a span's requirement.
  const own = ifWidened.map((minimum, column) =>
    Math.max(content.measured[column] ? minimum : 0, MIN_COLUMN_PT)
  );
  const spans = [...content.spans];
  for (const hold of content.verticalHolds) {
    if (hold.count > 1) spans.push(hold);
    else own[hold.from] = Math.max(own[hold.from]!, hold.minimum);
  }
  return spanAdjustedMinimums(own, own, own, spans);
}

/** How often a table settles again for spans its settled columns no longer hold. */
const MAX_SPAN_ROUNDS = 3;

/** The narrowest cell a nested table can be given. */
const NARROW_CELL_PT = 1;

type StructureReader = (
  table: OoxmlElement,
  contentWidthPt: number,
  depth: number,
  styleCascade?: StyleCascadeTable,
  displayMode?: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number
) => SemanticTableStructure | null;

/** One narrow read per nested node and view, apart from the cell-width read layout memoizes. */
const narrowReads = new WeakMap<
  object,
  {
    readonly key: string;
    readonly styleCascade: StyleCascadeTable | undefined;
    readonly structure: SemanticTableStructure | null;
  }
>();

/**
 * A nested-table reader for {@link AutofitView.readNested}: the nested structure in the
 * narrowest cell, memoized per node apart from the cell-width structure layout reads. Its
 * first read also refills the reader's own per-node slot once; later reads come from here.
 */
export function narrowNestedReader(
  read: StructureReader,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined,
  compatibilityMode: number | undefined
): (table: OoxmlElement, depth: number) => SemanticTableStructure | null {
  return (table, depth) => {
    const key = `${depth}|${displayMode}|${authorFilter?.cacheKey ?? ''}|${compatibilityMode ?? ''}`;
    const memo = narrowReads.get(table);
    if (memo && memo.key === key && memo.styleCascade === styleCascade) return memo.structure;
    const structure = read(
      table,
      NARROW_CELL_PT,
      depth,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    );
    narrowReads.set(table, { key, styleCascade, structure });
    return structure;
  };
}

/**
 * Each physical column's autofit minimum, as a cell width: its widest single-column cell
 * content plus that cell's horizontal content insets, so an empty cell keeps them. A cell that
 * continues a vertical merge or sets its text vertically sets no minimum; a cell that spans
 * columns reports its own requirement in `content` instead.
 */
export function autofitColumnMinimumsPt(
  structure: SemanticTableStructure,
  context: TableAutofitContext,
  view: AutofitView,
  /** Filled with each column's minimum should it have to widen (see widenedCellInsets). */
  ifWidened?: number[],
  /** Filled with what the cells say beyond their minimums (see {@link AutofitColumnContent}). */
  content?: AutofitColumnContent,
  /**
   * Whether `ifWidened` keeps the first-line indent of a word after leading spaces
   * (`minWidened`). A nested table asks both ways: only its plain need decides whether the
   * outer column widens.
   */
  widenedKeepsFirstLine = true
): number[] {
  const columnCount = structure.columnWidthsPt.length;
  // -1 marks a column no single-column cell measured; a measured empty column may be 0.
  const minimums = new Array<number>(columnCount).fill(-1);
  const wide = new Array<number>(columnCount).fill(-1);
  const widest = new Array<number>(columnCount).fill(-1);
  const preferred = new Array<boolean>(columnCount).fill(false);
  const collapsed = structure.cellSpacingPt === 0;
  // Measured as cell widths: a spaced table's gaps sit between its cells, outside them.
  const gapPt = cellSpacingGapPt(structure.cellSpacingPt);
  const cellWidths = spacedCellWidths(structure);
  // The margins a column keeps whole should its minimums overflow. These are the current
  // margins, not the widened ones: the current ones matched the reference renderings.
  const noteInsets = (column: number, insets: { left: number; right: number }): void => {
    if (content)
      content.insets[column] = Math.max(content.insets[column] ?? 0, insets.left + insets.right);
  };
  for (const row of structure.rows) {
    const widenedRow =
      structure.outerRuleOffsetPt !== undefined && !structure.legacyContentAlignment
        ? rowForWidenedMeasurement(row, columnCount, content !== undefined)
        : undefined;
    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
      const cell = row.cells[cellIndex]!;
      if (cell.vMergeContinue) continue;
      if (cell.gridColumn < 0 || cell.gridColumn >= columnCount) continue;
      if (cell.gridSpan === 1 && cell.preferredWidth.value > 0) {
        const stated = cell.preferredWidth;
        if (stated.type === 'dxa' || stated.type === 'pct') preferred[cell.gridColumn] = true;
        if (content && stated.type === 'pct') content.percentColumns[cell.gridColumn] = true;
        if (content && stated.type === 'dxa') {
          const points = stated.value;
          const known = content.preferredWidths[cell.gridColumn];
          if (known === undefined || points > known)
            content.preferredWidths[cell.gridColumn] = points;
        }
      }
      if (cell.textDirection !== 'horizontal') {
        // Vertical text runs along the row, not across the column: it sets no autofit minimum.
        // It does record the width it has, which a table giving up its stated widths keeps.
        const end = Math.min(cell.gridColumn + cell.gridSpan, columnCount);
        let held = 0;
        for (let column = cell.gridColumn; column < end; column++) held += cellWidths[column]!;
        const count = end - cell.gridColumn;
        content?.verticalHolds.push({ from: cell.gridColumn, count, minimum: held });
        if (count === 1) noteInsets(cell.gridColumn, cellContentInsets(cell, collapsed));
        continue;
      }
      if (cell.gridSpan !== 1 && !content) continue;
      const measured = cachedAutofitCellWidths(cell, collapsed, context, view, () => {
        let least = -1;
        let leastWidened = -1;
        let most = -1;
        const insets = cellContentInsets(cell, collapsed);
        for (const block of cell.blocks) {
          if (block.kind === 'table') {
            const nested = nestedTableMinimumPt(block, context, view);
            least = Math.max(least, nested.plain);
            leastWidened = Math.max(leastWidened, nested.widened);
            most = Math.max(most, nested.widened);
          }
          if (block.kind !== 'paragraph') continue;
          const widths = paragraphWidthsPt(block, {
            context,
            view,
            tableCellStyle: cell.styleFormatting,
          });
          least = Math.max(least, widths.min);
          leastWidened = Math.max(leastWidened, widths.minWidened);
          most = Math.max(most, widths.max);
        }
        const widened = widenedCellInsets(cell, collapsed, insets, widenedRow?.cells[cellIndex]);
        return {
          least,
          leastWidened,
          most,
          left: insets.left,
          right: insets.right,
          wideLeft: widened.left,
          wideRight: widened.right,
        };
      });
      const { least, leastWidened, most } = measured;
      if (least < 0) continue;
      const keepsSharedLines = structure.autoOuterRulePt || structure.sharedGridLinesHold;
      const around = keepsSharedLines
        ? measured.left + measured.right
        : measured.wideLeft + measured.wideRight;
      if (cell.gridSpan !== 1) {
        // A spanning cell also covers the gaps between the columns it spans.
        const covered = (cell.gridSpan - 1) * gapPt;
        content?.spans.push({
          from: cell.gridColumn,
          count: cell.gridSpan,
          minimum: Math.max(0, (widenedKeepsFirstLine ? leastWidened : least) + around - covered),
          current: Math.max(0, least + measured.left + measured.right - covered),
        });
        continue;
      }
      // An unwrapped cell holds its column (`unwrappedCellHold`).
      const unwrapped = most + measured.left + measured.right;
      const held = cell.noWrap ? unwrappedCellHold(cell.preferredWidth, unwrapped) : 0;
      const needed = Math.max(held, least + measured.left + measured.right);
      if (needed > minimums[cell.gridColumn]!) minimums[cell.gridColumn] = needed;
      const neededWide = Math.max(held, (widenedKeepsFirstLine ? leastWidened : least) + around);
      if (neededWide > wide[cell.gridColumn]!) wide[cell.gridColumn] = neededWide;
      const neededMost = Math.max(held, most + around);
      if (neededMost > widest[cell.gridColumn]!) widest[cell.gridColumn] = neededMost;
      noteInsets(cell.gridColumn, measured);
    }
  }
  // A column only spanning cells cover has no minimum of its own; it keeps its width.
  for (const [column, minimum] of minimums.entries()) {
    if (content) content.measured[column] = minimum >= 0;
    if (minimum < 0) minimums[column] = cellWidths[column]!;
    if (ifWidened) ifWidened[column] = wide[column]! < 0 ? minimums[column]! : wide[column]!;
    if (content) {
      content.insets[column] ??= 0;
      content.maximums[column] = widest[column]! < 0 ? minimums[column]! : widest[column]!;
      // A column with no measured cell of its own keeps its width, as a preferred one does.
      content.sizedByContent[column] = !preferred[column] && widest[column]! >= 0;
    }
  }
  return minimums;
}

/**
 * Widths per context and structure. A context belongs to one pass of one flow, during which
 * no token can change, so the memo is exact; it dies with the pass.
 */
const passWidths = new WeakMap<
  object,
  WeakMap<
    SemanticTableStructure,
    { readonly contentWidthPt: number; readonly widths: readonly number[] }
  >
>();

/**
 * A structure's physical column widths after autofit widening, or the structure's own array
 * by identity when every column already holds its content.
 */
export function autofitColumnWidthsPt(
  structure: SemanticTableStructure,
  contentWidthPt: number,
  context: TableAutofitContext,
  view: AutofitView
): readonly number[] {
  const owner = autofitReuseScope(context) ?? context;
  let byStructure = passWidths.get(owner);
  if (!byStructure) passWidths.set(owner, (byStructure = new WeakMap()));
  const known = byStructure.get(structure);
  if (known && known.contentWidthPt === contentWidthPt) return known.widths;
  if (structure.layoutFixed) {
    // Only a nested fixed table reaches here: its columns give way down to their own minimums.
    const widths = fixedNestedWidths(structure, contentWidthPt, () =>
      fixedTableCellMinimums(structure, context, view)
    );
    byStructure.set(structure, { contentWidthPt, widths });
    return widths;
  }
  // Whether the table widens is decided in its current geometry. Widening rebuilds every cell
  // and can change its insets, so a widened table sizes every column for that geometry.
  const ifWidened: number[] = [];
  const content = emptyColumnContent();
  const minimumsNow = autofitColumnMinimumsPt(structure, context, view, ifWidened, content);
  // Deleted content widens a column too: take the larger need of the two readings.
  const markup = view.markupStructure;
  if (markup && markup.columnWidthsPt.length === structure.columnWidthsPt.length) {
    const markupView: AutofitView = { ...view, displayMode: 'all-markup' };
    mergeMarkupNeeds({ minimumsNow, ifWidened, content }, (widened, into) =>
      autofitColumnMinimumsPt(markup, context, markupView, widened, into)
    );
  }
  // Everything below works on cell widths; a spaced table's gaps come back at the end.
  const cellWidths = spacedCellWidths(structure);
  const frame = structure.rows[0]?.spacingFrame;
  const scale = cellSpacingScale(structure.columnWidthsPt, structure.cellSpacingPt, frame);
  const gaps = spacingGapsPt(structure);
  columnFit.keepFirstLineWhereWidening(ifWidened, minimumsNow, cellWidths, (plain) =>
    autofitColumnMinimumsPt(structure, context, view, plain, undefined, false)
  );
  // A column a cell gives a preferred width starts from that width, not from the grid.
  const preferredWidths = cellWidths.map((width, column) =>
    content.preferredWidths[column] === undefined ? width : content.preferredWidths[column]! * scale
  );
  // Whether the table widens is decided with its present insets and painted widths, spans too.
  const current = spanAdjustedMinimums(
    cellWidths,
    minimumsNow,
    content.maximums,
    content.spans.map((span) => ({ ...span, minimum: span.current ?? span.minimum }))
  );
  const sizedByContent = content.sizedByContent.some(Boolean);
  // An automatic-width table keeps its outer side rules inside the text column.
  const roomWidthPt = contentWidthPt - (structure.autoOuterRulePt ?? 0);
  const availableFor = (room: number): number => Math.max(0, room - leadingIndentPt(structure));
  const widens = current.some(
    (minimum, column) => minimum > cellWidths[column]! + WIDTH_EPSILON_PT
  );
  // Stated cell widths that had to give way do so above each column's content minimum.
  const refit =
    sizedByContent || (structure.autoOuterRulePt ?? 0) > 0
      ? undefined
      : columnFit.autofitRefit(structure, content, cellWidths, minimumsNow, {
          depth: view.depth ?? 0,
          compatibilityMode: context.compatibilityMode,
        });
  const stretched =
    refit || sizedByContent || gaps > 0 || content.spans.length > 0
      ? undefined
      : columnFit.stretchAboveMinimums(structure.statedColumnWidthsPt, cellWidths, minimumsNow);
  if (stretched) {
    const widths = sameOrComputed(structure, stretched);
    byStructure.set(structure, { contentWidthPt, widths });
    return widths;
  }
  if (refit) {
    const widths = sameOrComputed(structure, gaps > 0 ? columnsAroundCells(refit, gaps) : refit);
    byStructure.set(structure, { contentWidthPt, widths });
    return widths;
  }
  // Widening may end shared grid lines, but not legacy content alignment, whose minimums hold.
  const spread = sizedByContent
    ? undefined
    : preferredSpreadWidths(
        structure,
        content,
        widens && !structure.legacyContentAlignment ? ifWidened : minimumsNow,
        roomWidthPt,
        view.depth ?? 0
      );
  if (spread || (!widens && !sizedByContent)) {
    // A grid that fills the text column gives way by its outer rule, never further.
    const rule = structure.autoOuterRulePt ?? 0;
    const settledPt = cellWidths.reduce((sum, width) => sum + width, 0);
    const shrinkTo = Math.max(availableFor(roomWidthPt), settledPt - rule);
    const widths = spread
      ? sameOrComputed(structure, spread)
      : rule > 0
        ? sameOrComputed(
            structure,
            widenAutofitColumns(cellWidths, minimumsNow, shrinkTo, Infinity, {
              shrinkToTarget: true,
              // Room is unbounded here, so no minimums overflow.
              insets: [],
            })
          )
        : structure.columnWidthsPt;
    byStructure.set(structure, { contentWidthPt, widths });
    return widths;
  }
  let minimums = spanAdjustedMinimums(preferredWidths, ifWidened, content.maximums, content.spans);
  // The table indent moves a leading-aligned table into the text column's room, and a table
  // whose outer content meets the text edges reaches past them. A legacy content-aligned
  // table also owns the room its own width already spans.
  const totalPt = structure.columnWidthsPt.reduce((sum, width) => sum + width, 0);
  const legacy = structure.legacyContentAlignment === true;
  const reachPt =
    contentAlignedReachPt(structure) ||
    centeredLegacyReachPt(structure, context.compatibilityMode, view.depth ?? 0);
  const availablePt = legacy
    ? Math.max(totalPt, availableFor(contentWidthPt) + reachPt)
    : availableFor(roomWidthPt) + reachPt;
  const targetPt =
    autofitTargetPt(structure.tableWidth, totalPt, availablePt, legacy, contentWidthPt) - gaps;
  // A table wider than its text column grows to hold its minimums instead of scaling them.
  const roomPt = Math.max(0, (structure.pastTextColumn ? MAX_TABLE_GROWTH_PT : availablePt) - gaps);
  const ownWidth = structure.tableWidth.value > 0 && structure.tableWidth.type !== 'auto';
  let base = cellWidths;
  const settle = (from: readonly number[] = base): readonly number[] =>
    sizedByContent
      ? contentSizedWidths(
          preferredWidths,
          content.sizedByContent,
          minimums,
          content.maximums,
          // A table with no width of its own takes what its content asks, up to its room.
          ownWidth ? targetPt : undefined,
          roomPt,
          {
            currentPt: from.reduce((sum, width) => sum + width, 0),
            insets: content.insets,
          }
        )
      : (percentShareWidths(structure, content, from, minimums, targetPt, view.depth ?? 0) ??
        widenAutofitColumns(from, minimums, targetPt, roomPt, { insets: content.insets }));
  let cells = settle();
  const unstretched = columnFit.unstretchedBase(structure, cellWidths, cells, targetPt);
  if (unstretched) {
    minimums = columnFit.keepUnmeasured(minimums, content.measured, unstretched);
    cells = settle((base = unstretched));
  }
  // A span the preferred widths held may lose its room as columns settle: hold it against
  // the settled widths and settle again.
  for (let round = 0; round < MAX_SPAN_ROUNDS; round++) {
    const short = content.spans.filter((span) => {
      let held = 0;
      for (let column = span.from; column < span.from + span.count; column++)
        held += cells[column] ?? 0;
      return held < span.minimum;
    });
    if (short.length === 0) break;
    const raised = spanAdjustedMinimums(cells, minimums, content.maximums, short);
    // Overflowing tables scale every column below its minimum; raising cannot help there.
    if (raised.every((minimum, column) => minimum === minimums[column])) break;
    minimums = raised;
    cells = settle();
  }
  const widths = sameOrComputed(structure, gaps > 0 ? columnsAroundCells(cells, gaps) : cells);
  byStructure.set(structure, { contentWidthPt, widths });
  return widths;
}
