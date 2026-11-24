// Word's paragraph-level pagination controls: widow/orphan, keep-with-next, keep-lines.
//
// These decide WHERE a paragraph is allowed to cross a page boundary, not how it measures.
// `semantic-layout.ts` owns the flow cursor and calls in here for the decision, so the rule
// itself stays a pure function of line counts and can be reasoned about (and tested) without
// a page, a measurer or a DOM.
//
// All three are style-inheritable, so they are read from the CASCADED paragraph property bag
// (`docDefaults` → `basedOn` chain → style → direct), the same bag `w:pageBreakBefore` and
// `w:spacing` are read from. Reading direct `w:pPr` alone would miss every heading that gets
// its `w:keepNext` from the `Heading 1` style — which is all of them.
//
// Everything here fails OPEN. A keep rule that cannot be honoured places the content anyway,
// because Word does the same: a paragraph taller than a page still prints, and a keep chain
// that cannot fit is abandoned rather than looped over.
//
// Modern-mode table paragraphs also use widow/orphan control when a row crosses pages. The
// table placer decides the cut before publishing lines; exact-height rows still clip.
// Cross-paragraph keep chains remain body-flow decisions, while row atomicity is owned
// by `w:cantSplit`. A body keep-next chain ends at a table, priced by the table's opening
// (`tableKeepOpening` in `table-row-keeps.ts`) when the caller supplies one. When the table's
// kept rows run to its end, the chain goes on through them into the content after the table.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { framedTokenJoin } from './layout-cache.ts';
import { sha256FontBytes } from '../store/package/sha256.ts';
import { createKeepRangeIndex, type KeepRange } from './pagination-keep-index.ts';
import { extendedFlowKey } from './flow-key-intern.ts';

/** Extra retries for line retreat; this does not limit keep-chain membership. */
export const KEEP_BREAK_RETRY_ALLOWANCE = 8;
/** Bound for note holdout scans, independent of paragraph-chain membership. */
export const MAX_NOTE_KEEP_SCAN = 8;

/** Minimum lines Word leaves on each side of a page break under widow/orphan control. */
const MIN_LINES_EITHER_SIDE = 2;

/**
 * A paragraph's resolved pagination keeps.
 *
 * `widowControl` is the one that matters for every document: ECMA-376 §17.3.1.44 says that
 * when the setting is never specified anywhere in the style hierarchy it is ON, and Word's
 * own UI ships it checked. A renderer that treats absence as "off" strands a single line at
 * the top or bottom of a page on documents that never mention the property at all.
 */
export interface ParagraphKeeps {
  /** `w:keepNext` (§17.3.1.15) — stay on the page the FOLLOWING paragraph starts on. */
  readonly keepNext: boolean;
  /** `w:keepLines` (§17.3.1.16) — every line of this paragraph on ONE page. */
  readonly keepLines: boolean;
  /** `w:widowControl` (§17.3.1.44) — never one line alone either side of a page break. */
  readonly widowControl: boolean;
}

/** What a paragraph that states none of the three gets: widow/orphan control ON. */
export const DEFAULT_PARAGRAPH_KEEPS: ParagraphKeeps = Object.freeze({
  keepNext: false,
  keepLines: false,
  widowControl: true,
});

/**
 * `w:val` of an `CT_OnOff` toggle. Absent attribute means true (the element's presence IS
 * the assertion); `0`/`false`/`off` is the explicit negation Word writes when a style turns
 * an inherited toggle back off.
 */
function onOff(attributes: Readonly<Record<string, string>> | undefined): boolean {
  const raw = attributes?.val;
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/**
 * Resolve the three keeps from cascaded paragraph properties.
 *
 * Last statement wins, which is how the cascade is ordered (`docDefaults` first, direct
 * `w:pPr` last). An explicit `<w:widowControl w:val="0"/>` in a style therefore turns off
 * what `w:docDefaults` asserted, and a direct `<w:widowControl/>` turns it back on.
 */
export function paragraphKeeps(props: readonly OoxmlProperty[]): ParagraphKeeps {
  let keepNext = false;
  let keepLines = false;
  let widowControl = true;
  for (const property of props) {
    switch (property.localName) {
      case 'keepNext':
        keepNext = onOff(property.attributes);
        break;
      case 'keepLines':
        keepLines = onOff(property.attributes);
        break;
      case 'widowControl':
        widowControl = onOff(property.attributes);
        break;
      default:
        break;
    }
  }
  if (!keepNext && !keepLines && widowControl) return DEFAULT_PARAGRAPH_KEEPS;
  return { keepNext, keepLines, widowControl };
}

/**
 * Pull a page break back so it satisfies `w:keepLines` and `w:widowControl`.
 *
 * Returns the line index the break must happen at, never earlier than `fragmentStart` (the
 * first line of the paragraph on the page being cut) and never later than `lineIndex` (the
 * natural break: the first line that does not fit). The caller un-places the lines between
 * the two and re-flows them onto the next page.
 *
 * `w:keepLines` (§17.3.1.16) is all-or-nothing: the break retreats to the start of what this
 * page holds of the paragraph, so the whole thing moves. `w:widowControl` (§17.3.1.44) is
 * arithmetic on the two sides of the cut — at least two lines must remain on the page and at
 * least two must go over, so a break that would strand one line retreats by one line, and a
 * retreat that then strands one line at the bottom retreats again to move the lot.
 *
 * Order matters: the widow test runs first because fixing it can CREATE an orphan (a 3-line
 * paragraph with room for 2 moves entirely, which is what Word does), and the orphan test
 * then finishes the job.
 *
 * `aloneOnPage` — the lines from `fragmentStart` are all this page holds — is the fail-open
 * switch. Moving them again lands them on an identical empty page, so the rule would fire
 * forever; Word prints the near miss instead, and so does this.
 */
export function adjustedBreakIndex(
  lineIndex: number,
  fragmentStart: number,
  lineCount: number,
  keeps: ParagraphKeeps,
  aloneOnPage: boolean
): number {
  if (lineIndex <= fragmentStart) return lineIndex;

  // keepLines: move everything this page holds of the paragraph. Skipped when it holds
  // nothing else, because the paragraph is simply taller than a page.
  if (keeps.keepLines && !aloneOnPage) return fragmentStart;

  if (!keeps.widowControl || lineCount < MIN_LINES_EITHER_SIDE) return lineIndex;

  let breakAt = lineIndex;
  // Widow: one line of the paragraph would open the next page alone.
  if (lineCount - breakAt < MIN_LINES_EITHER_SIDE) breakAt -= 1;
  // Orphan: one line of the paragraph would close this page alone.
  if (breakAt - fragmentStart === 1) breakAt -= 1;
  if (breakAt < fragmentStart) breakAt = fragmentStart;

  // Retreating to the fragment start on a page the paragraph already owns makes no progress.
  if (breakAt === fragmentStart && aloneOnPage) return lineIndex;
  return breakAt;
}

/**
 * The slice of a laid-out block {@link keepNextGroupHeight} reads.
 *
 * `spacing`/`keeps` are optional because a story's block list also holds tables, which carry
 * neither — and a table is a chain terminator this cannot price, so it reads as a stop.
 */
export interface KeepNextBlock {
  readonly kind: string;
  readonly spacing?: { readonly before: number; readonly after: number };
  readonly keeps?: ParagraphKeeps;
}

/** The slice of a laid-out line {@link keepNextPlan} reads. */
export interface KeepNextLine {
  readonly height: number;
  /** Spacing below the glyph band that a line may carry past the bottom margin. */
  readonly trailingSpacing?: number;
  readonly pageBreakAfter?: boolean;
  readonly columnBreakAfter?: boolean;
}

/** The chain lookahead {@link keepNextPlan} runs. */
export interface KeepNextLookahead {
  readonly blocks: readonly KeepNextBlock[];
  readonly start: number;
  /** Collapsible space after the block above the chain. */
  readonly carry: number;
  /** Space before the first block, when the caller has already placed it. */
  readonly headLead?: number;
  readonly linesFor: (index: number) => readonly KeepNextLine[];
  readonly skipBlock?: (index: number) => boolean;
  readonly breaksBefore?: (index: number) => boolean;
  readonly sumAdjacentSpacing?: boolean;
  /** What a table at `index` needs where it starts, or null when it cannot be priced. */
  readonly tableOpening?: (index: number) => TableKeepOpening | null;
  /**
   * False inside the content after a table: a table reached there is priced by its own
   * opening, never through its kept rows. This bounds a chain to one table's following content.
   */
  readonly throughTables?: boolean;
  /** Internal range index for one stable measurement context. */
  readonly rangeIndex?: ReturnType<typeof createKeepRangeIndex>;
  readonly chainEnd?: (start: number) => number;
  /** Changes whenever line measurements or skipped section marks can change. */
  readonly contextKey?: () => string;
  /** A member whose lines depend on the current flow cursor even without page exclusions. */
  readonly dynamicBlock?: (index: number) => boolean;
  /** Stop once even the smallest later ending exceeds both page admission heights. */
  readonly maxHeight?: number;
  /**
   * Set when this page has a note area. A member that ends here then keeps its space after
   * below its last line once the page cites a footnote, as placement charges it. Without it,
   * the plan fits a group that placement splits.
   */
  readonly closingSpaceAfter?: KeepNoteClosing;
}

/** Whether a page with a note area cites a footnote, before and within a keep group. */
export interface KeepNoteClosing {
  /** The page already cites a footnote. */
  readonly cited: boolean;
  /** Whether a member's lines cite one. */
  readonly cites: (lines: readonly KeepNextLine[]) => boolean;
}

/** What a keep chain that reaches a table needs of it (`tableKeepOpening`). */
export interface TableKeepOpening {
  /** The table's first row starts a new page, so the chain ends before the table. */
  readonly breaksPage?: boolean;
  /** Header rows and the opening of the body rows. */
  readonly height: number;
  /**
   * Header rows and the body rows, when every body row from the first keeps with the next.
   * The opening of the content after the table joins this height. When nothing can be priced
   * there, {@link height} applies.
   */
  readonly throughHeight?: number;
}

/** A priced `w:keepNext` chain. */
export interface KeepNextPlan {
  /** Flow height the chain needs. Its last line is priced at its placement fit extent. */
  readonly height: number;
  /** The last member that fits whole in the room before anything that does not, or -1. */
  readonly lastWhole: number;
  /** The group ends at a table opening, rather than a following paragraph. */
  readonly endsAtTable?: true;
}

/**
 * Flow height a `w:keepNext` chain starting at `start` needs to hold together (§17.3.1.15).
 *
 * The chain is every consecutive block that declares `w:keepNext`, plus the block the last of
 * them is kept WITH. That last paragraph contributes the shortest prefix its own keep rules
 * allow. Widow control requires two lines on each side of a split, so a paragraph with fewer
 * than four lines stays whole. A paragraph with keepLines also stays whole. Pricing a shorter
 * prefix lets the later break retreat move the paragraph away from its heading.
 *
 * Returns null for anything the lookahead cannot price — a table without a priced opening,
 * an unsupported block — and null means the caller places on
 * ordinary fit rules. Word abandons a keep it cannot honour rather than searching, and so
 * does this: the content is placed, just not moved. `linesFor` is asked for lazily, one
 * block at a time, so a chain that stops early never measures the blocks past its end.
 *
 * Paragraph borders are deliberately NOT priced in. Under-estimating degrades to the
 * behaviour without the rule (the keep does not fire); over-estimating would move content to
 * a page it never needed to be on, which is a visible fidelity regression.
 *
 * `sumAdjacentSpacing` adds each member's before-spacing to the after-spacing above it rather
 * than collapsing the two, for documents with `w:doNotUseHTMLParagraphAutoSpacing`. `carry`
 * is then already zero, because the flow cursor carries no collapsible after-spacing.
 *
 * `room` is the flow height left for the group, in the same units as the result. A kept
 * member that cannot fit whole in it and may split under its own rules breaks naturally:
 * its last line then opens the next page with its successor, so the keep holds without
 * moving it. The group ends there at the member's shortest legal opening. A member that
 * fits whole still needs its successor's opening beside it, so the chain continues.
 * A member with an authored page or column break keeps the whole opening before the break.
 *
 * Fit uses the extent placement uses: the last line of a priced run may carry its trailing
 * spacing past the bottom margin. Pricing the full height there would split a member that
 * placement then fits whole, and its successor would open the next page alone.
 */
export function keepNextPlan(
  look: KeepNextLookahead,
  room = Number.POSITIVE_INFINITY
): KeepNextPlan | null {
  const { blocks, start } = look;
  let total = 0;
  let after = look.carry;
  let lastWhole = -1;
  let fits = true;
  let cited = look.closingSpaceAfter?.cited ?? false;
  let result: KeepNextPlan | null = null;
  const finish = (plan: KeepNextPlan): false => {
    result = plan;
    return false;
  };
  const visit = (index: number): boolean => {
    const block = blocks[index];
    if (block && look.skipBlock?.(index)) return true;
    // A table ends the chain. It has no space before; the member above keeps its after.
    if (block?.kind === 'table' && index > start) {
      const table = look.tableOpening?.(index) ?? null;
      if (table === null) return false;
      if (table.breaksPage) return finish({ height: total - after, lastWhole });
      const through = table.throughHeight;
      const following =
        through === undefined || look.throughTables === false
          ? undefined
          : followingKeepOpening(look, index + 1, room - total - through);
      const height = typeof following === 'number' ? through! + following : table.height;
      return finish({
        height: total + height,
        lastWhole,
        ...(typeof following === 'number' ? {} : { endsAtTable: true as const }),
      });
    }
    if (!block || block.kind !== 'paragraph' || !block.spacing || !block.keeps) return false;
    // A forced new page also discards the preceding paragraph's trailing spacing.
    // Above a cited note area, placement still charges the member's space after.
    if (index > start && look.breaksBefore?.(index))
      return finish({ height: total - (look.closingSpaceAfter && cited ? 0 : after), lastWhole });
    // Adjacent before/after collapse to the larger gap unless the document sums them.
    if (index === start && look.headLead !== undefined) total += look.headLead;
    else if (look.sumAdjacentSpacing) total += block.spacing.before;
    else total += Math.max(block.spacing.before, after) - after;
    const lines = look.linesFor(index);
    const hardBreak = lines.findIndex((line) => line.pageBreakAfter || line.columnBreakAfter);
    const openingLength = hardBreak < 0 ? lines.length : hardBreak + 1;
    const openingLines = shortestOpeningLines(lines.length, openingLength, block.keeps);
    cited ||= !!look.closingSpaceAfter?.cites(lines);
    const closing = look.closingSpaceAfter && cited && hardBreak < 0 ? block.spacing.after : 0;
    const opening =
      total + fitExtent(lines, openingLines) + (openingLines === lines.length ? closing : 0);
    // The story's LAST block keeps with nothing, so it terminates the chain however authored.
    if (!block.keeps.keepNext || index + 1 >= blocks.length)
      return finish({ height: opening, lastWhole });
    const whole = fitExtent(lines, openingLength) + closing;
    // A natural split carries this member's last line to its successor's page.
    if (hardBreak < 0 && openingLines < lines.length && total + whole > room) {
      return finish({ height: opening, lastWhole });
    }
    // An authored page or column break ends this page's keep group.
    if (hardBreak >= 0) return finish({ height: total + whole, lastWhole });
    if (fits && total + whole <= room) lastWhole = index;
    else fits = false;
    for (let line = 0; line < openingLength; line += 1) total += lines[line]!.height;
    total += block.spacing.after;
    after = block.spacing.after;
    if (total - after > (look.maxHeight ?? Infinity))
      return finish({ height: Infinity, lastWhole });
    return true;
  };
  // The range index prices members without a closing space after.
  if (look.rangeIndex && !look.closingSpaceAfter) {
    look.rangeIndex.walk(
      start,
      look.chainEnd?.(start) ?? blocks.length - 1,
      (range) => {
        if (range.last < 0) return true;
        // Price the head separately because it has caller-owned leading spacing.
        if (lastWhole < 0 && fits && total === 0) return false;
        const lead = look.sumAdjacentSpacing ? range.before : Math.max(range.before, after) - after;
        const base = total + lead;
        if (base + (fits ? range.maxWhole : range.maxSplit) > room) return false;
        if (fits) lastWhole = range.last;
        total = base + range.advance;
        after = range.after;
        if (total - after > (look.maxHeight ?? Infinity)) {
          finish({ height: Infinity, lastWhole });
          return 'stop';
        }
        return true;
      },
      visit
    );
  } else {
    for (let index = start; index < blocks.length; index += 1) if (!visit(index)) break;
  }
  return result;
}

/** {@link keepNextPlan}'s height, from positional inputs. */
export function keepNextGroupHeight(
  blocks: readonly KeepNextBlock[],
  start: number,
  carry: number,
  linesFor: (index: number) => readonly KeepNextLine[],
  skipBlock?: (index: number) => boolean,
  breaksBefore?: (index: number) => boolean,
  sumAdjacentSpacing = false,
  room = Number.POSITIVE_INFINITY
): number | null {
  const look = { blocks, start, carry, linesFor, skipBlock, breaksBefore, sumAdjacentSpacing };
  return keepNextPlan(look, room)?.height ?? null;
}

/** Height of the first `count` lines as placement fits them: the last may drop its trailing spacing. */
function fitExtent(lines: readonly KeepNextLine[], count: number): number {
  let extent = 0;
  for (let line = 0; line < count; line += 1) extent += lines[line]?.height ?? 0;
  const last = lines[count - 1];
  if (!last) return extent;
  return extent - Math.min(last.height, Math.max(0, last.trailingSpacing ?? 0));
}

/** Where a `w:keepNext` head sits, for {@link keepNextGroupNeed}. */
export interface KeepNextPlacement {
  readonly cursorY: number;
  readonly contentHeight: number;
  /** Space before the head beside the current content. */
  readonly lead: number;
  /** Space before the head that the priced group includes. */
  readonly pricedLead: number;
  /** Space before the head at the top of a fresh page. */
  readonly freshLead: number;
  readonly topExtent: number;
  /** The page's note area, when it has one ({@link KeepNextLookahead.closingSpaceAfter}). */
  readonly closingSpaceAfter?: KeepNoteClosing;
  /** `w:compatSetting` `compatibilityMode`, read through `hasCompatibilityRule`. */
  readonly compatibilityMode: number | undefined;
}

/**
 * Flow height a `w:keepNext` head must reserve, or null when it reserves nothing.
 *
 * The group is priced for the room left here, because a member that cannot fit whole here
 * may split naturally. Natural page movement suppresses the head's before spacing, so that
 * destination is priced separately. A group that must move is priced again for a fresh
 * page, where members split later. A group that cannot fit a fresh page is abandoned, and
 * the head places by its own fit. A group ending at a table first moves to a fresh page,
 * even when the table opening cannot fit beside it there. Table placement then releases
 * the impossible keep without leaving the caption beside earlier content.
 *
 * A group that fits a fresh page but not here moves the head whole in layout before Word
 * 2013. From Word 2013 on, the head stays when the last member that fits whole here may
 * split: that member gives its last lines to the next page when it is placed (see
 * {@link keepNextTailLines}). That member can be the head.
 */
export function keepNextGroupNeed(look: KeepNextLookahead, at: KeepNextPlacement): number | null {
  const here = at.contentHeight - at.cursorY - at.lead - at.topExtent;
  const maxHeight = Math.max(
    here + at.pricedLead,
    at.contentHeight - at.freshLead - at.topExtent + at.pricedLead
  );
  // A fresh page cites nothing yet, so only the plan for this page keeps the space after.
  const plan = (room: number, closingSpaceAfter?: KeepNoteClosing) =>
    keepNextPlan({ ...look, maxHeight, closingSpaceAfter }, room + at.pricedLead);
  const group = plan(here, at.closingSpaceAfter);
  if (group === null) return null;
  const need = group.height - at.pricedLead + at.lead + at.topExtent;
  if (at.cursorY + need <= at.contentHeight) return need;
  const fresh = plan(at.contentHeight - at.freshLead - at.topExtent);
  if (fresh === null) return null;
  if (fresh.height - at.pricedLead + at.freshLead + at.topExtent > at.contentHeight)
    return fresh.endsAtTable ? need : null;
  if (!hasCompatibilityRule(at.compatibilityMode, 'keepNextGivesTailLines') || group.lastWhole < 0)
    return need;
  return splitTailLines(look, group.lastWhole) > 0 ? null : need;
}

/**
 * Word 2013 and later: last lines a `w:keepNext` paragraph gives to the next page, or 0.
 *
 * Asked where the paragraph's first line is placed, after any move and its space before,
 * so `look.headLead` is 0 and `room` runs from that line to the bottom of the column. The
 * paragraph gives lines only when it fits whole here, its successor's opening does not fit
 * after it, it may split, and its chain fits a fresh page of `pageHeight`. Two lines go
 * over under widow control, otherwise one.
 *
 * A member placed after a paragraph that split is asked too, so the chain is priced again
 * from where the split left it.
 */
export function keepNextTailLines(
  look: KeepNextLookahead,
  room: number,
  pageHeight: number,
  compatibilityMode: number | undefined
): number {
  if (!hasCompatibilityRule(compatibilityMode, 'keepNextGivesTailLines')) return 0;
  look = { ...look, maxHeight: Math.max(room, pageHeight) };
  const plan = keepNextPlan(look, room);
  if (plan === null || plan.height <= room || plan.lastWhole !== look.start) return 0;
  const fresh = keepNextPlan({ ...look, closingSpaceAfter: undefined }, pageHeight);
  if (fresh === null || fresh.height > pageHeight) return 0;
  return splitTailLines(look, look.start);
}

/** The inputs every chain in a pass shares: {@link KeepNextLookahead} without its start. */
export type KeepNextSource = Omit<
  KeepNextLookahead,
  'start' | 'carry' | 'headLead' | 'closingSpaceAfter'
> & {
  /** The current page's note area, asked at each decision ({@link KeepNoteClosing}). */
  readonly noteClosing?: () => KeepNoteClosing | undefined;
};

/** A pass's `w:keepNext` decisions, bound to its blocks and its layout mode. */
export interface KeepNextChains {
  /** {@link keepNextGroupNeed} for the chain head at `start`. */
  need(
    start: number,
    carry: number,
    at: Omit<KeepNextPlacement, 'compatibilityMode' | 'closingSpaceAfter'>
  ): number | null;
  /**
   * Line index the paragraph at `start` breaks before when it splits early
   * ({@link keepNextTailLines}), or `lineCount` when it does not. `cursorY` is where its
   * first line goes, after its space before.
   */
  tailBreak(start: number, lineCount: number, cursorY: number, contentHeight: number): number;
  /** {@link followingKeepOpening} of the block at `start`, with `room` left beside it. */
  opening(start: number, room: number): number | null | undefined;
}

/** Build lazy summaries only within consecutive paragraph chains. */
function indexedKeepSource(source: KeepNextSource, end: readonly number[]): KeepNextSource {
  const empty: KeepRange = {
    before: 0,
    after: 0,
    advance: 0,
    maxWhole: -Infinity,
    maxSplit: -Infinity,
    last: -1,
  };
  const rangeIndex = createKeepRangeIndex(
    source.blocks.length,
    (at) => {
      if (source.dynamicBlock?.(at)) return null;
      if (source.skipBlock?.(at)) return empty;
      const block = source.blocks[at]!;
      if (
        block.kind !== 'paragraph' ||
        !block.keeps?.keepNext ||
        !block.spacing ||
        source.breaksBefore?.(at) ||
        at + 1 === source.blocks.length
      )
        return null;
      const lines = source.linesFor(at);
      if (lines.some((line) => line.pageBreakAfter || line.columnBreakAfter)) return null;
      const whole = fitExtent(lines, lines.length);
      const advance = lines.reduce((sum, line) => sum + line.height, 0) + block.spacing.after;
      return {
        before: block.spacing.before,
        after: block.spacing.after,
        advance,
        maxWhole: whole,
        maxSplit:
          shortestOpeningLines(lines.length, lines.length, block.keeps) < lines.length
            ? whole
            : -Infinity,
        last: at,
      };
    },
    source.sumAdjacentSpacing === true
  );
  return { ...source, rangeIndex, chainEnd: (start) => end[start]! };
}

/** Bind the keep-next lookahead of one layout pass. */
export function keepNextChains(
  source: KeepNextSource,
  compatibilityMode: number | undefined
): KeepNextChains {
  const end: number[] = new Array(source.blocks.length);
  for (let at = source.blocks.length - 1; at >= 0; at -= 1) {
    const block = source.blocks[at]!;
    end[at] =
      at + 1 < end.length &&
      (source.skipBlock?.(at) || (block.kind === 'paragraph' && block.keeps?.keepNext))
        ? end[at + 1]!
        : at;
  }
  let context: string | undefined;
  let indexed: KeepNextSource;
  const current = () => {
    const key = source.contextKey?.() ?? '';
    if (!indexed || key !== context) {
      context = key;
      indexed = indexedKeepSource(source, end);
    }
    return indexed;
  };
  return {
    need: (start, carry, at) =>
      keepNextGroupNeed(
        { ...current(), start, carry },
        { ...at, compatibilityMode, closingSpaceAfter: source.noteClosing?.() }
      ),
    tailBreak: (start, lineCount, cursorY, contentHeight) => {
      if (!source.blocks[start]?.keeps?.keepNext || source.skipBlock?.(start)) return lineCount;
      const closingSpaceAfter = source.noteClosing?.();
      const look = { ...current(), start, carry: 0, headLead: 0, closingSpaceAfter };
      const room = contentHeight - cursorY;
      return lineCount - keepNextTailLines(look, room, contentHeight, compatibilityMode);
    },
    opening: (start, room) => followingKeepOpening(current(), start, room),
  };
}

/**
 * Height the block at `start` needs where it opens after a table, with its own keep chain:
 * `undefined` past the story end, 0 when it starts a new page itself, and null when it cannot
 * be priced. `room` is the height left after the table's kept rows; a kept member that cannot
 * fit whole in it and may split ends the chain at its shortest opening ({@link keepNextPlan}).
 * A table in this chain is priced by its own opening, never through its kept rows.
 */
export function followingKeepOpening(
  source: KeepNextSource,
  start: number,
  room: number
): number | null | undefined {
  if (start >= source.blocks.length) return undefined;
  if (source.breaksBefore?.(start)) return 0;
  const look = { ...source, start, carry: 0, headLead: undefined, throughTables: false };
  return keepNextPlan(look, room)?.height ?? null;
}

/** Lines a whole paragraph gives to the next page when it may split early, or 0. */
function splitTailLines(look: KeepNextLookahead, index: number): number {
  const keeps = look.blocks[index]?.keeps;
  if (!keeps) return 0;
  const lines = look.linesFor(index);
  if (lines.some((line) => line.pageBreakAfter || line.columnBreakAfter)) return 0;
  if (shortestOpeningLines(lines.length, lines.length, keeps) >= lines.length) return 0;
  return keeps.widowControl ? MIN_LINES_EITHER_SIDE : 1;
}

/**
 * Lines a paragraph must place before a page break, given its own keeps.
 *
 * `openingLength` stops at an authored page or column break. Under widow control a
 * paragraph with fewer than four lines cannot split, so its whole opening is returned.
 */
function shortestOpeningLines(
  lineCount: number,
  openingLength: number,
  keeps: ParagraphKeeps
): number {
  if (keeps.keepLines) return openingLength;
  if (!keeps.widowControl) return Math.min(1, openingLength);
  return lineCount < MIN_LINES_EITHER_SIDE * 2
    ? openingLength
    : Math.min(MIN_LINES_EITHER_SIDE, openingLength);
}

/**
 * Rewrite layout cache keys into FLOW keys, which is what incremental resume compares.
 *
 * `w:keepNext` makes a paragraph's PLACEMENT depend on the block after it, so its own key no
 * longer describes where it lands. Editing the body text under a heading would otherwise put
 * the first changed block at the body, and a resume starting there would keep a decision the
 * heading took against the old body. Folding in the keys of the blocks its placement reads
 * moves the first changed block back to the head of the chain — the first block whose
 * placement can move.
 *
 * Fixed-size suffix digests keep key growth constant for every paragraph. Returns the input array unchanged
 * when nothing keeps, which is the overwhelming majority of passes.
 */
/**
 * Flow keys that also carry each block's LIST MARKER text.
 *
 * The marker is derived from `numbering.xml` and the counter state, not from the paragraph, so
 * a `w:start`, `w:startOverride` or restart change renumbers a list while every paragraph
 * subtree stays byte-identical. The break-cache key holds the marker's LENGTH on purpose —
 * only the length can move a line break — so on its own it let `1.` become `2.` with no key
 * moving anywhere, and the unchanged-document exit then returned the previous pages whole.
 *
 * Separate from the break key for that same reason: renumbering must re-place the blocks
 * without discarding measurements that are still correct.
 */
export function listMarkerFlowKeys(
  keys: string[],
  markerAt: (index: number) => string | undefined
): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    const marker = markerAt(index);
    if (marker === undefined) continue;
    if (flow === keys) flow = [...keys];
    flow[index] = extendedFlowKey(flow[index]!, '~mk~', marker);
  }
  return flow;
}

/**
 * Flow keys that also carry each block's `w:contextualSpacing` VERDICT.
 *
 * `w:contextualSpacing` (§17.3.1.9) drops a paragraph's space before or after when the
 * neighbour on that side is a paragraph of the SAME style, so the block's own height is a
 * function of two blocks it does not contain. Its content key cannot see that: inserting a
 * list item under the last one has to change the last one's space-after from 8pt to zero,
 * and with the key unmoved the incremental pass resumed past it and kept the stale height —
 * a list whose items closed up on open, and stopped closing up as soon as it was edited.
 *
 * The same cross-block fold as {@link keepNextFlowKeys}, and folded for the same reason.
 * Only the two booleans go in the key, not the neighbours' style ids: what the verdict
 * depends on is whether each side matches, so a rename that moves both sides together must
 * not re-place a block whose spacing is identical.
 *
 * `styleAt` answers null for a block that can never match — a table, or a paragraph with no
 * style — which is what makes an unstyled run of paragraphs keep its spacing.
 */
export function contextualSpacingFlowKeys(
  keys: string[],
  contextualAt: (index: number) => boolean,
  styleAt: (index: number) => string | null,
  neighbourStyleAt: (index: number, side: -1 | 1) => string | null = (index, side) =>
    index + side >= 0 && index + side < keys.length ? styleAt(index + side) : null
): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    if (!contextualAt(index)) continue;
    const style = styleAt(index);
    if (style === null) continue;
    const before = neighbourStyleAt(index, -1) === style;
    const after = neighbourStyleAt(index, 1) === style;
    if (flow === keys) flow = [...keys];
    flow[index] = extendedFlowKey(flow[index]!, '~cs~', `${before ? 1 : 0}${after ? 1 : 0}`);
  }
  return flow;
}

/**
 * Flow keys that also carry each block's PARAGRAPH BORDER GROUP membership.
 *
 * Consecutive paragraphs with identical border settings are ONE bordered block in Word
 * (`w:between`, §17.3.1.24): the box opens above the first and closes below the last, and
 * every interior boundary carries the `between` rule instead of a top and a bottom. So a
 * paragraph's own bottom edge — which rule is drawn, how much vertical extent it claims, and
 * whether it publishes a `bottomBorder` record at all — is a function of the block AFTER it.
 *
 * Nothing about that reaches the block's content key, so the incremental pass resumed past a
 * paragraph that had just stopped being the last of its group and kept the closing edge it no
 * longer owned. The extent is real height, so the error compounds down the flow: a
 * three-paragraph group edited on its last member laid out over three pages where the same
 * bytes reopened took two.
 *
 * Both bits go in, not only the forward one. Incremental RESUME is a prefix cut, where a
 * backward dependency is safe because the earlier block moving re-places everything after it.
 * The convergence tail is a SUFFIX cut, where backward is the exposed direction: a block can
 * sit inside the common suffix while the paragraph above it joins or leaves its group.
 *
 * No repro is known for that, and the reason is worth writing down: the tail's guard compares
 * fragment SIGNATURES, and `semantic-fragment-signature.ts` hashes every `w:pBdr` stroke, so
 * even a height-neutral group change (a different `w:color` on the same `w:sz`) moves the
 * signature of the paragraph that changed. `above` is folded anyway. That guard only sees a
 * changed paragraph still pending on the page being built, it is not the guard that owns this
 * question, and the bit is free — one string comparison the fold already has in hand.
 *
 * `groupKeyAt` answers `''` for a block that can never group: a table, or a paragraph with no
 * borders at all. Two paragraphs group only when their keys are EQUAL, which is what makes an
 * indent change split a group — the key carries the box geometry as well as the rules.
 */
export function borderGroupFlowKeys(
  keys: string[],
  groupKeyAt: (index: number) => string
): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    const group = groupKeyAt(index);
    if (group === '') continue;
    const above = index > 0 && groupKeyAt(index - 1) === group;
    const below = index + 1 < keys.length && groupKeyAt(index + 1) === group;
    if (flow === keys) flow = [...keys];
    flow[index] = extendedFlowKey(flow[index]!, '~bg~', `${above ? 1 : 0}${below ? 1 : 0}`);
  }
  return flow;
}

/**
 * Flow keys that also carry each block's TOC FIELD verdict.
 *
 * A TOC is a complex field spanning paragraphs: a begin paragraph holding `fldChar begin` and
 * the `TOC` instruction, cached result paragraphs, an end paragraph. Layout answers three
 * questions per paragraph from that shape — suppress the field chrome, keep one placeholder
 * line on the begin paragraph because the TOC resolved to nothing, suppress a blank cached
 * result row — and each answer is read from the OTHER paragraphs of the same field.
 *
 * The begin paragraph is the sharp case: whether it keeps a placeholder line depends on
 * whether any RESULT paragraph after it still carries visible text. Refreshing a TOC that
 * comes back empty rewrites the result paragraphs and leaves the begin paragraph untouched,
 * so resume started at the first result and reused a begin paragraph that had just gone from
 * "emits nothing" to "emits a placeholder line" — the line simply vanished for the life of
 * the session, and reopening the same bytes brought it back.
 *
 * The three raw membership bits go in rather than the two booleans layout derives from them,
 * so the fold stays correct whatever the derivation grows into. `verdictAt` answers `''` for
 * a block no TOC touches, which is every block of a document that has no TOC.
 */
export function tocFieldFlowKeys(keys: string[], verdictAt: (index: number) => string): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    const verdict = verdictAt(index);
    if (verdict === '') continue;
    if (flow === keys) flow = [...keys];
    flow[index] = extendedFlowKey(flow[index]!, '~toc~', verdict);
  }
  return flow;
}

/**
 * Flow keys where the block before a section's closing mark carries the mark's key.
 *
 * A page break that ends that block may keep the empty mark on the sheet it closes, which
 * `markJoinsBreakSheet` decides from the MARK's content. Typing into the mark changes only
 * the mark's key, and resume would start at the mark from a checkpoint whose sheet the break
 * never closed. The fold makes the block that owns the decision re-place with it.
 */
export function sectionMarkFlowKeys(keys: string[], endsWithSectionMark: boolean): string[] {
  const last = keys.length - 1;
  if (!endsWithSectionMark || last < 1) return keys;
  const flow = [...keys];
  flow[last - 1] = `${keys[last - 1]}~sm~${keys[last]}`;
  return flow;
}

/**
 * Flow keys for a pass where a later section opens the next sheet (`markJoinsBreakSheet`).
 *
 * Only the block before the closing mark and the mark itself read the flag: the break that
 * ends the first keeps the empty mark on its sheet. Folding it into those two keys, not the
 * pass context, lets a section that gains a successor resume from its checkpoints.
 */
export function markJoinFlowKeys(keys: string[], joins: boolean): string[] {
  if (!joins || keys.length === 0) return keys;
  const flow = [...keys];
  for (let at = Math.max(0, flow.length - 2); at < flow.length; at += 1) {
    flow[at] = `${flow[at]}~mjb`;
  }
  return flow;
}

/**
 * Fold complete keep-chain dependencies last, after all other flow-key folds.
 * Two backwards digest lanes cover ordinary chains and chains through one table.
 * Fixed-size SHA-256 digests bound storage and construction work to the input size.
 * An edit at any depth therefore invalidates every head whose placement reads it.
 */
export function keepNextFlowKeys(
  keys: string[],
  keepsNext: (index: number) => boolean,
  skipBlock?: (index: number) => boolean,
  tableAt?: (index: number) => boolean
): string[] {
  // Mark only suffixes that a kept head reads. Ordinary paragraphs need no digest.
  // Bits 1/2 select the plain/through-table lanes; skipped frames forward either lane.
  const needed = new Uint8Array(keys.length + 1);
  const flags = new Uint8Array(keys.length);
  const heads: number[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const keep = keepsNext(index);
    if (!keep && !needed[index]) continue;
    const skip = skipBlock?.(index) === true;
    const table = tableAt?.(index) === true;
    flags[index] = (keep ? 1 : 0) | (table ? 2 : 0) | (skip ? 4 : 0);
    if (index + 1 === keys.length) continue;
    if (skip) needed[index + 1]! |= needed[index]!;
    else if (keep) {
      heads.push(index);
      needed[index + 1]! |= table ? 1 : 2;
      if (!table) needed[index + 1]! |= needed[index]!;
    }
  }
  if (heads.length === 0) return keys;
  const encoder = new TextEncoder();
  const digest = (value: string) =>
    value.length <= 256 ? value : `\0h${sha256FontBytes(encoder.encode(value))}`;
  const plain: string[] = new Array(keys.length + 1);
  const through: string[] = new Array(keys.length + 1);
  plain[keys.length] = through[keys.length] = '.';
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    if (!needed[index]) continue;
    const skip = (flags[index]! & 4) !== 0;
    const table = (flags[index]! & 2) !== 0;
    const keep = (flags[index]! & 1) !== 0;
    const terminal = index + 1 === keys.length ? '.' : '';
    const own = skip ? '-' : `${keys[index]!.length}:${keys[index]}`;
    const plainValue = own + (skip || (keep && !table) ? plain[index + 1] : terminal);
    const throughValue =
      own +
      (skip
        ? through[index + 1]
        : keep
          ? table
            ? `>${plain[index + 1]}`
            : through[index + 1]
          : terminal);
    if (needed[index]! & 1) plain[index] = digest(plainValue);
    if (needed[index]! & 2)
      through[index] =
        needed[index]! & 1 && plainValue === throughValue ? plain[index]! : digest(throughValue);
  }
  const flow = [...keys];
  for (const index of heads)
    flow[index] = extendedFlowKey(
      keys[index]!,
      '~kn~',
      flags[index]! & 2 ? plain[index + 1]! : through[index + 1]!
    );
  return flow;
}

/** The per-block answers {@link composeFlowKeys} folds over the break-cache keys. */
export interface FlowKeyFoldInputs {
  /** Shared token forces resume before every member of a terminal floating-table group. */
  readonly terminalTableGroup?: {
    readonly start: number;
    readonly anchorIndex: number;
    readonly token: string;
  };
  readonly contextualSpacingAt: (index: number) => boolean;
  /** `null` for a block that can never match a neighbour — a table, or an unstyled paragraph. */
  readonly styleIdAt: (index: number) => string | null;
  /**
   * The style a block's contextual spacing compares against on one side, when that is not
   * simply the adjacent block's: a paragraph a hidden mark removed from the flow still counts.
   */
  readonly neighbourStyleAt?: (index: number, side: -1 | 1) => string | null;
  /** `''` for a block outside every border group. */
  readonly borderGroupKeyAt: (index: number) => string;
  /** Empty when the part has no TOC; the fold is then skipped outright. */
  readonly tocVerdicts: readonly string[];
  readonly markerTextAt: (index: number) => string | undefined;
  /** A table keeps when its last row keeps with the content after the table. */
  readonly keepsNextAt: (index: number) => boolean;
  /** The block is a table: a keep chain ends there and may read through its kept rows. */
  readonly tableAt?: (index: number) => boolean;
  /** The last block is the paragraph that carries the section mark. */
  readonly endsWithSectionMark?: boolean;
  /** Positioned frames contribute neither flow height nor a keep-chain boundary. */
  readonly skipKeepNextAt?: (index: number) => boolean;
}

/**
 * The one composition of the flow-key folds — what incremental resume compares.
 *
 * `keys` stays what the break cache is stored under; the CROSS-BLOCK properties make the
 * two differ: `w:contextualSpacing` (§17.3.1.9), paragraph border groups (§17.3.1.24), the
 * TOC field verdicts, the list marker, a page break before the section mark, and
 * `w:keepNext` (§17.3.1.15) — each of which makes a block's placement depend on a block it
 * does not contain.
 *
 * Each fold returns its input BY IDENTITY when nothing folds, so a document that reads
 * across no boundary at all reaches the end holding the array it started with.
 *
 * `keepNextFlowKeys` runs LAST, and the order is load-bearing. It is the only fold that
 * splices a NEIGHBOUR'S WHOLE KEY into a block's own, so whatever it reads has to be
 * finished: run it first and a chain head carries its members' pre-fold keys, which is a
 * head that never re-places when a member's marker, contextual or border verdict moves.
 * That is latent rather than live today only because `keepNextGroupHeight` prices AUTHORED
 * spacing; folding last makes the composition correct whatever that lookahead grows into.
 * The composition lives HERE, next to the folds, so the order is testable — see
 * `pagination-keeps.test.ts`.
 */
export function composeFlowKeys(keys: string[], at: FlowKeyFoldInputs): string[] {
  const group = at.terminalTableGroup;
  const grouped = group
    ? keys.map((key, index) =>
        index >= group.start && index <= group.anchorIndex
          ? framedTokenJoin([key, group.token])
          : key
      )
    : keys;
  let flow = contextualSpacingFlowKeys(
    grouped,
    at.contextualSpacingAt,
    at.styleIdAt,
    at.neighbourStyleAt
  );
  flow = borderGroupFlowKeys(flow, at.borderGroupKeyAt);
  if (at.tocVerdicts.length > 0) flow = tocFieldFlowKeys(flow, (index) => at.tocVerdicts[index]!);
  flow = listMarkerFlowKeys(flow, at.markerTextAt);
  flow = sectionMarkFlowKeys(flow, at.endsWithSectionMark === true);
  // LAST — see the doc comment above.
  flow = keepNextFlowKeys(flow, at.keepsNextAt, at.skipKeepNextAt, at.tableAt);
  return flow;
}
