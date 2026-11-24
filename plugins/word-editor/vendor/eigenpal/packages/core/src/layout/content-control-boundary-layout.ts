// Content-control boundary records over a laid-out document.
//
// Turns the tree's content controls plus the placed page geometry into per-control (and
// per-page) boundary rectangles for chrome. Everything here is incremental-friendly: parts
// and page records are immutable, so control collection memoizes per part and placed
// geometry memoizes per page object — a typing pass that reuses 675 of 677 pages walks the
// spans of the two pages it rebuilt, not the whole document.

import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '@docx-editor.dev/core/store';
import { isInlineRunContainer, MAX_INLINE_CONTAINER_DEPTH } from '../store/package/ooxml-shared.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { paragraphContentBounds } from './paragraph-content-bounds.ts';
import { linesOfUnneededTable } from './table-fragment-facts.ts';
import { blockStoryContainerChildren, storyRootsOf } from '../store/package/story-blocks.ts';
import {
  MAX_CONTENT_CONTROL_NESTING as MAX_SDT_NESTING,
  contentControlContentChildren,
  isContentControl,
} from '../store/package/content-control-walk.ts';
import {
  contentControlPropertiesOf,
  controlLevelOf,
  mapContentControlType,
  parseContentControlLock,
  propertyChild,
  propertyVal,
} from './content-control-properties.ts';
import {
  effectiveContentControlLock,
  unionLayoutBoxes,
  type BlockFragmentRecord,
  type ContentControlBoundaryRecord,
  type ContentControlGeometryFragment,
  type ContentControlLevel,
  type ContentControlLock,
  type LayoutBox,
  type PageRecord,
  type SemanticLayout,
} from './semantic-records.ts';

import {
  contentControlContextToken,
  contentControlSubtreeToken,
} from './content-control-context-token.ts';

import { modelRangeOf, sameModelRange } from './content-control-model-range.ts';

export { contentControlContextToken };

export interface CollectedControl {
  readonly control: OoxmlElement;
  readonly nestingDepth: number;
  readonly lockStack: readonly ContentControlLock[];
  readonly level: ContentControlLevel;
  readonly paragraphId?: string;
  readonly range?: { readonly start: number; readonly end: number };
  readonly blockIds: readonly string[];
}

/** Collected controls plus the id sets their geometry needs, memoized per immutable part. */
export interface CollectedControlIndex {
  readonly controls: readonly CollectedControl[];
  readonly neededBlockIds: ReadonlySet<string>;
  readonly neededParagraphIds: ReadonlySet<string>;
  /** Content identity of the needed sets, for the per-page geometry memo. */
  readonly neededToken: string;
}

/** Control ranges are model offsets: each field-result mode keeps its own entries. */
const collectedControlIndexes = new FieldResultsModeMemo<OoxmlPart, CollectedControlIndex>();

/** Same references, same order — the identity comparison every retained memo here uses. */
export function sameRefs<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * The retained previous index, content-validated: the index is a pure function of the
 * per-top-level-block control lists, and a keystroke outside any control leaves every one of
 * those lists identical (the edited block's list is the shared empty constant). Rebuilding
 * the sets and the sorted needed-token for a control-heavy document on every fresh part cost
 * more than the walk the per-block memo already saves.
 *
 * Keyed weakly on the story's FIRST block node rather than held in a module slot, so a
 * closed document's index dies with its tree instead of staying pinned until some other
 * document lays out, and two live editors do not thrash one slot (the `list-resolve.ts`
 * anchor idiom). An edit to the first block itself only misses once, never mixes — the
 * lists are still compared reference-for-reference.
 */
const collectedIndexByAnchor = new FieldResultsModeMemo<
  OoxmlNode,
  {
    readonly lists: readonly (readonly CollectedControl[])[];
    readonly index: CollectedControlIndex;
  }
>();

function firstStoryChildOf(part: OoxmlPart): OoxmlNode | null {
  for (const story of storyRootsOf(part)) {
    if (story.root.kind === 'textValue') continue;
    for (const child of story.root.children) {
      if (child.kind !== 'textValue') return child;
    }
  }
  return null;
}

export function collectedControlIndexOf(part: OoxmlPart): CollectedControlIndex {
  const cached = collectedControlIndexes.get(part);
  if (cached !== undefined) return cached;
  const lists = collectControlLists(part);
  const anchor = firstStoryChildOf(part);
  const slot = anchor ? collectedIndexByAnchor.get(anchor) : undefined;
  if (slot && sameRefs(slot.lists, lists)) {
    collectedControlIndexes.set(part, slot.index);
    return slot.index;
  }
  const controls: CollectedControl[] = [];
  for (const list of lists) {
    for (const control of list) controls.push(control);
  }
  const neededBlockIds = new Set<string>();
  const neededParagraphIds = new Set<string>();
  for (const control of controls) {
    for (const blockId of control.blockIds) neededBlockIds.add(blockId);
    if (control.paragraphId !== undefined) neededParagraphIds.add(control.paragraphId);
  }
  const index: CollectedControlIndex = {
    controls,
    neededBlockIds,
    neededParagraphIds,
    neededToken: `${[...neededBlockIds].sort().join(',')};${[...neededParagraphIds].sort().join(',')}`,
  };
  if (anchor) collectedIndexByAnchor.set(anchor, { lists, index });
  collectedControlIndexes.set(part, index);
  return index;
}

const EMPTY_CONTROLS: readonly CollectedControl[] = Object.freeze([]);

function collectControlLists(part: OoxmlPart): readonly (readonly CollectedControl[])[] {
  const out: CollectedControl[] = [];

  const collectBlocks = (nodes: readonly OoxmlNode[], into: string[], containerDepth = 0): void => {
    for (const child of nodes) {
      if (child.kind === 'paragraph' || child.kind === 'table') {
        into.push(child.id);
        continue;
      }
      const nested = blockStoryContainerChildren(child);
      if (nested !== null && containerDepth < MAX_SDT_NESTING) {
        collectBlocks(nested, into, containerDepth + 1);
        continue;
      }
      if (child.kind === 'tableRow' || child.kind === 'tableCell') {
        collectBlocks(child.children, into, containerDepth);
      }
    }
  };

  const walkInline = (
    nodes: readonly OoxmlNode[],
    paragraph: OoxmlParagraphNode,
    depth: number,
    containerDepth: number,
    lockStack: readonly ContentControlLock[]
  ): void => {
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return;
    for (const child of nodes) {
      if (child.kind === 'textValue' || child.kind === 'paragraphProperties') continue;
      if (isContentControl(child)) {
        // Resolve spans only for actual controls. Ordinary paragraphs must not retain
        // a complete offset index merely because the document's controls are queried.
        const range = paragraphOffsetIndex(paragraph).spanOf(child);
        if (!range) continue;
        const properties = contentControlPropertiesOf(child);
        const lock = parseContentControlLock(propertyVal(properties, 'lock'));
        const nextStack = [...lockStack, lock];
        walkInline(
          contentControlContentChildren(child),
          paragraph,
          depth + 1,
          containerDepth + 1,
          nextStack
        );
        out.push({
          control: child,
          nestingDepth: depth,
          lockStack: nextStack,
          level: 'inline',
          paragraphId: paragraph.id,
          range,
          blockIds: [],
        });
        continue;
      }
      if (isInlineRunContainer(child)) {
        walkInline(child.children, paragraph, depth, containerDepth + 1, lockStack);
      }
    }
  };

  const walkBlocks = (
    nodes: readonly OoxmlNode[],
    depth: number,
    lockStack: readonly ContentControlLock[],
    containerDepth = 0
  ): void => {
    for (const child of nodes) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'paragraph') {
        walkInline(child.children, child, depth, 0, lockStack);
        continue;
      }
      if (child.kind === 'table') {
        if (contentControlSubtreeToken(child, depth) === '') continue;
        for (const row of child.children) {
          if (row.kind !== 'tableRow') continue;
          walkBlocks([row], depth, lockStack, containerDepth);
        }
        continue;
      }
      if (child.kind === 'tableRow') {
        for (const cell of child.children) {
          if (cell.kind === 'tableCell')
            walkBlocks(cell.children, depth, lockStack, containerDepth);
          else if (isContentControl(cell)) walkBlocks([cell], depth, lockStack, containerDepth);
        }
        continue;
      }
      if (!isContentControl(child)) {
        const nested = blockStoryContainerChildren(child);
        if (nested !== null && containerDepth < MAX_SDT_NESTING)
          walkBlocks(nested, depth, lockStack, containerDepth + 1);
        continue;
      }
      if (depth >= MAX_SDT_NESTING) continue;
      const properties = contentControlPropertiesOf(child);
      const lock = parseContentControlLock(propertyVal(properties, 'lock'));
      const nextStack = [...lockStack, lock];
      const level = controlLevelOf(child);
      const content = blockStoryContainerChildren(child) ?? [];
      if (level === 'inline') {
        // Inline at body level is malformed; still walk content for nested discovery.
        walkBlocks(content, depth + 1, nextStack, containerDepth + 1);
        continue;
      }
      const blockIds: string[] = [];
      collectBlocks(content, blockIds);
      out.push({
        control: child,
        nestingDepth: depth,
        lockStack: nextStack,
        level,
        blockIds,
      });
      walkBlocks(content, depth + 1, nextStack, containerDepth + 1);
    }
  };

  // Per top-level block, memoized on the immutable node: at body level the depth is 0 and
  // the lock stack is empty, so a block's entries are a pure function of its subtree. A
  // keystroke publishes a new part whose body children are all shared but one — without
  // this the whole document re-walked per pass. An empty answer is the SHARED constant, so
  // the retained-index slot can identity-compare a replaced control-free block.
  // EVERY story the part holds, not a `w:body` child. A header's root is `w:hdr` and a note
  // part's stories hang off `w:footnote` elements, so looking for `body` collected nothing
  // from either — which is why a content control in a header had no record at all, and the
  // caret's geometry then matched whichever BODY control sat at the same page coordinates.
  const lists: (readonly CollectedControl[])[] = [];
  for (const story of storyRootsOf(part)) {
    if (story.root.kind === 'textValue') continue;
    for (const child of story.root.children) {
      if (child.kind === 'textValue') continue;
      const cached = topLevelBlockControls.get(child);
      if (cached !== undefined) {
        lists.push(cached);
        continue;
      }
      const before = out.length;
      walkBlocks([child], 0, []);
      const collected = out.length === before ? EMPTY_CONTROLS : Object.freeze(out.slice(before));
      topLevelBlockControls.set(child, collected);
      lists.push(collected);
    }
  }
  return lists;
}

const topLevelBlockControls = new FieldResultsModeMemo<OoxmlNode, readonly CollectedControl[]>();

interface PlacedBlockBox {
  readonly pageIndex: number;
  readonly blockId: string;
  readonly box: LayoutBox;
}

interface PlacedSpanBox {
  readonly pageIndex: number;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  /**
   * Ordinal of the line this span sits on, so inline-control fragments can union per LINE.
   * Uniting per page gave a wrapped control one rectangle covering everything between its
   * first and last line, including neighbouring words. Composed as page index × 2^20 plus
   * the line's ordinal WITHIN its page, which keeps document order sortable while letting
   * an unchanged page's contribution be reused verbatim when other pages move.
   */
  readonly line: number;
  /**
   * The span's TEXT extent: the raw span box dropped by the line's leading. Span boxes sit
   * at the line-box top, but non-single `w:spacing` puts the whole leading ABOVE the glyphs,
   * so a boundary built from raw boxes tints the gap over the text and misses the text
   * itself.
   */
  readonly box: LayoutBox;
}

/**
 * Deterministic work accounting for boundary generation.
 *
 * This is intentionally local to the layout implementation (it is not re-exported by the
 * package entry point). Tests use it to pin resource growth without depending on wall time.
 */
export interface ContentControlBoundaryWork {
  geometryEntries: number;
  blockLookups: number;
  blockCandidates: number;
  paragraphLookups: number;
  spanCandidates: number;
  pageFragments: number;
}

interface PlacedGeometryIndex {
  readonly blocksById: ReadonlyMap<string, readonly PlacedBlockBox[]>;
  readonly spansByParagraph: ReadonlyMap<string, readonly PlacedSpanBox[]>;
  /**
   * Paragraphs whose spans are NOT one ascending run, so the binary search below cannot be used.
   *
   * A body paragraph is emitted once, in source order, even when it wraps across a page: its
   * later text is on the later page, so the array stays ascending. ONE HEADER STORY IS ATTACHED
   * TO EVERY PAGE IT APPLIES TO, so a header paragraph's array is that ascending run repeated
   * once per page. Binary-searching it lands arbitrarily and the `start >= end` break stops
   * early — measured as an inline control in a repeated header getting geometry on page 1 and
   * nowhere else, so its outline drew once and `contentControlAtPoint` missed it everywhere
   * after.
   *
   * Recorded at build time rather than detected per lookup: the builder already walks every
   * span in order, and a control-heavy template does many lookups per build.
   */
  readonly repeatedParagraphs: ReadonlySet<string>;
}

/** More lines than one page can carry; keeps composite line keys ordered across pages. */
const PAGE_LINE_ORDINAL_SPAN = 1 << 20;

interface PageGeometryContribution {
  /** Version of the needed-id sets this contribution was filtered under. */
  readonly neededStamp: number;
  readonly blocks: readonly PlacedBlockBox[];
  readonly spans: readonly PlacedSpanBox[];
}

/**
 * Per-page geometry contributions, memoized on the immutable page record.
 *
 * A page object owns its fragments and its index, so its contribution is a pure function
 * of the page plus WHICH ids the controls need — versioned by `neededStamp`. Rebuilding
 * this for every page on every pass made boundary attachment, not layout, the cost of a
 * keystroke in a long document full of controls.
 */
const pageGeometryContributions = new WeakMap<PageRecord, PageGeometryContribution>();

let lastNeededToken: string | null = null;
let neededStamp = 0;

function neededStampOf(neededToken: string): number {
  if (neededToken !== lastNeededToken) {
    lastNeededToken = neededToken;
    neededStamp += 1;
  }
  return neededStamp;
}

function pageContribution(
  page: PageRecord,
  index: CollectedControlIndex,
  stamp: number,
  work?: ContentControlBoundaryWork
): PageGeometryContribution {
  const cached = pageGeometryContributions.get(page);
  if (cached !== undefined && cached.neededStamp === stamp) return cached;
  const blocks: PlacedBlockBox[] = [];
  const spans: PlacedSpanBox[] = [];
  let lineOrdinal = page.index * PAGE_LINE_ORDINAL_SPAN;
  // Boxes are stored in the BODY's content-box space, because that is the space the painter
  // and the hit test read them in. A story's fragments are laid out relative to the story's
  // own box, so a story is walked with the offset that carries it into that shared space.
  // Recording a header control's raw box would draw its boundary chrome at the body's origin.
  let offsetX = 0;
  let offsetY = 0;
  const shift = (box: LayoutBox): LayoutBox =>
    offsetX === 0 && offsetY === 0
      ? box
      : { x: box.x + offsetX, y: box.y + offsetY, width: box.width, height: box.height };
  const visit = (pageIndex: number, fragment: BlockFragmentRecord): void => {
    if (fragment.kind === 'paragraph') {
      if (index.neededBlockIds.has(fragment.paragraphId)) {
        work && (work.geometryEntries += 1);
        blocks.push({
          pageIndex,
          blockId: fragment.paragraphId,
          box: shift(paragraphContentBounds(fragment)),
        });
      }
      const needSpans = index.neededParagraphIds.has(fragment.paragraphId);
      for (const line of fragment.lines) {
        const lineKey = lineOrdinal;
        // Clamped inside the page's key band: a hostile page with a million zero-height
        // lines must not spill ordinals into the next page's space (the tail lines then
        // share one union box, which degrades gracefully and stays page-local).
        lineOrdinal = Math.min(
          lineOrdinal + 1,
          page.index * PAGE_LINE_ORDINAL_SPAN + PAGE_LINE_ORDINAL_SPAN - 1
        );
        if (!needSpans) continue;
        // The glyph band: the box less the spacing on BOTH sides of it. Subtracting only
        // `leading` was right while every rule put its extra above the text; `auto`/`atLeast`
        // put it below and leave `leading` at zero, which handed a double-spaced line a
        // boundary chip covering the whole doubled box instead of the glyphs in it.
        const textHeight = Math.max(
          0,
          line.box.height - line.leading - (line.trailingSpacing ?? 0)
        );
        const lineSpans: PlacedSpanBox[] = [];
        for (const span of line.spans) {
          work && (work.geometryEntries += 1);
          lineSpans.push({
            pageIndex,
            paragraphId: span.range.paragraphId,
            start: span.range.start,
            end: span.range.end,
            line: lineKey,
            box: {
              x: span.box.x + offsetX,
              y: span.box.y + line.leading + offsetY,
              width: span.box.width,
              height: textHeight,
            },
          });
        }
        // An inline drawing occupies one model unit and no span, and it can be a control's
        // whole content (a picture control). Its painted bounds stand in for the span it does
        // not have, merged in offset order so the paragraph's run stays ascending.
        for (const drawing of line.drawings ?? []) {
          work && (work.geometryEntries += 1);
          lineSpans.push({
            pageIndex,
            paragraphId: drawing.paragraphId,
            start: drawing.start,
            end: drawing.start + 1,
            line: lineKey,
            box: shift(drawing.paintBounds),
          });
        }
        if (line.drawings?.length) lineSpans.sort((a, b) => a.start - b.start || a.end - b.end);
        for (const entry of lineSpans) spans.push(entry);
      }
      return;
    }
    if (index.neededBlockIds.has(fragment.tableId)) {
      work && (work.geometryEntries += 1);
      blocks.push({ pageIndex, blockId: fragment.tableId, box: shift(fragment.box) });
    }
    // Nothing inside is needed: count its lines as the walk below would, one clamp per line.
    const lines = linesOfUnneededTable(fragment, index.neededBlockIds, index.neededParagraphIds);
    if (lines !== null) {
      const cap = page.index * PAGE_LINE_ORDINAL_SPAN + PAGE_LINE_ORDINAL_SPAN - 1;
      lineOrdinal = Math.min(lineOrdinal + lines, cap);
      return;
    }
    for (const row of fragment.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) {
        for (const inner of cell.blocks) visit(pageIndex, inner);
      }
    }
  };
  for (const fragment of page.fragments) visit(page.index, fragment);
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    offsetX = story.box.x - page.contentBox.x;
    offsetY = story.box.y - page.contentBox.y;
    for (const fragment of story.fragments) visit(page.index, fragment);
  }
  offsetX = 0;
  offsetY = 0;
  const contribution: PageGeometryContribution = { neededStamp: stamp, blocks, spans };
  pageGeometryContributions.set(page, contribution);
  return contribution;
}

function placedGeometryOf(
  layout: SemanticLayout,
  index: CollectedControlIndex,
  work?: ContentControlBoundaryWork
): PlacedGeometryIndex {
  const stamp = neededStampOf(index.neededToken);
  const blocksById = new Map<string, PlacedBlockBox[]>();
  const spansByParagraph = new Map<string, PlacedSpanBox[]>();
  const repeatedParagraphs = new Set<string>();
  for (const page of layout.pages) {
    const contribution = pageContribution(page, index, stamp, work);
    for (const entry of contribution.blocks) {
      const entries = blocksById.get(entry.blockId);
      if (entries) entries.push(entry);
      else blocksById.set(entry.blockId, [entry]);
    }
    for (const entry of contribution.spans) {
      const entries = spansByParagraph.get(entry.paragraphId);
      if (entries) {
        // Strictly less: equal starts are ordinary within one run (a zero-width span beside a
        // real one), and treating them as a repeat would only cost a linear scan.
        if (entry.start < entries[entries.length - 1]!.start) {
          repeatedParagraphs.add(entry.paragraphId);
        }
        entries.push(entry);
      } else spansByParagraph.set(entry.paragraphId, [entry]);
    }
  }
  return { blocksById, spansByParagraph, repeatedParagraphs };
}

function fragmentsForBlockControl(
  blockIds: readonly string[],
  geometry: PlacedGeometryIndex,
  work?: ContentControlBoundaryWork
): ContentControlGeometryFragment[] {
  const byPage = new Map<number, LayoutBox[]>();
  const seen = new Set<string>();
  for (const blockId of blockIds) {
    if (seen.has(blockId)) continue;
    seen.add(blockId);
    work && (work.blockLookups += 1);
    for (const entry of geometry.blocksById.get(blockId) ?? []) {
      work && (work.blockCandidates += 1);
      const list = byPage.get(entry.pageIndex);
      if (list) list.push(entry.box);
      else byPage.set(entry.pageIndex, [entry.box]);
    }
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([pageIndex, boxes]) => {
      const box = unionLayoutBoxes(boxes);
      return box ? [{ pageIndex, box }] : [];
    });
}

function fragmentsForInlineControl(
  paragraphId: string,
  range: { readonly start: number; readonly end: number },
  geometry: PlacedGeometryIndex,
  work?: ContentControlBoundaryWork
): ContentControlGeometryFragment[] {
  work && (work.paragraphLookups += 1);
  const placed = geometry.spansByParagraph.get(paragraphId) ?? [];
  // Grouped per LINE, not per page: a wrapped control publishes one fragment per line it
  // touches, so chrome never paints a union rectangle over the words beside it.
  const byLine = new Map<number, { pageIndex: number; boxes: LayoutBox[] }>();
  // Paragraph spans are emitted in source-range order. Binary search skips all spans ending
  // before this control, so sibling controls do not repeatedly scan the paragraph prefix.
  //
  // Not for a paragraph the layout draws more than once — see `repeatedParagraphs`. There the
  // array is several ascending runs, both the search and the `break` are wrong, and the only
  // correct thing is to look at every span.
  const repeated = geometry.repeatedParagraphs.has(paragraphId);
  let low = 0;
  let high = placed.length;
  while (!repeated && low < high) {
    work && (work.spanCandidates += 1);
    const middle = low + ((high - low) >> 1);
    const beforeStart =
      range.start === range.end
        ? placed[middle]!.end < range.start
        : placed[middle]!.end <= range.start;
    if (beforeStart) low = middle + 1;
    else high = middle;
  }
  if (repeated) low = 0;
  for (let index = low; index < placed.length; index += 1) {
    const span = placed[index]!;
    work && (work.spanCandidates += 1);
    if (span.end <= range.start) continue;
    if (span.start >= range.end) {
      if (repeated) continue;
      break;
    }
    const group = byLine.get(span.line);
    if (group) group.boxes.push(span.box);
    else byLine.set(span.line, { pageIndex: span.pageIndex, boxes: [span.box] });
  }
  // Empty range (empty control): fall back to a zero-width box at the caret when a span
  // touches the insertion point, otherwise leave fragments empty.
  //
  // One per PAGE the paragraph is drawn on. For a body paragraph that is one box and the loop
  // stops at the first. For a repeated header it is one per page, which is what the outline
  // needs to draw on each of them.
  if (byLine.size === 0 && range.start === range.end) {
    const carets: ContentControlGeometryFragment[] = [];
    const seenPages = new Set<number>();
    for (let index = low; index < placed.length; index += 1) {
      const span = placed[index]!;
      work && (work.spanCandidates += 1);
      if (span.start > range.start) {
        if (repeated) continue;
        break;
      }
      if (range.start > span.end) continue;
      if (seenPages.has(span.pageIndex)) continue;
      seenPages.add(span.pageIndex);
      // A zero-width projected span AT the insertion point is the control's own glyph (a
      // `w:sym` checkbox state owns no model text but paints a box): its painted box is the
      // control's geometry, so the widget can hug the glyph instead of a hairline beside it.
      if (span.start === span.end && span.start === range.start && span.box.width > 0) {
        carets.push({ pageIndex: span.pageIndex, box: span.box });
        if (!repeated) break;
        continue;
      }
      const x =
        span.start === span.end
          ? span.box.x
          : span.box.x +
            (span.box.width * (range.start - span.start)) / Math.max(1, span.end - span.start);
      carets.push({
        pageIndex: span.pageIndex,
        box: { x, y: span.box.y, width: 0, height: span.box.height },
      });
      if (!repeated) break;
    }
    if (carets.length > 0) return carets;
  }
  // Line keys are page-major document order, so sorting by line also sorts by page.
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, group]) => {
      const box = unionLayoutBoxes(group.boxes);
      return box ? [{ pageIndex: group.pageIndex, box }] : [];
    });
}

/**
 * Wrapper chrome (alias/tag/type/placeholder/binding), memoized per immutable control node:
 * one settle builds a record per control per pass, and re-reading `w:sdtPr` for hundreds of
 * unchanged controls was a measurable share of the boundary attach.
 */
interface ControlChromeMetadata {
  readonly alias?: string;
  readonly tag?: string;
  readonly controlType: ContentControlBoundaryRecord['controlType'];
  readonly placeholder: boolean;
  readonly bound: boolean;
}

const controlChromeMemos = new WeakMap<OoxmlElement, ControlChromeMetadata>();

function controlChromeOf(control: OoxmlElement): ControlChromeMetadata {
  const cached = controlChromeMemos.get(control);
  if (cached !== undefined) return cached;
  const properties = contentControlPropertiesOf(control);
  const alias = propertyVal(properties, 'alias');
  const tag = propertyVal(properties, 'tag');
  const chrome: ControlChromeMetadata = {
    ...(alias !== undefined ? { alias } : {}),
    ...(tag !== undefined ? { tag } : {}),
    controlType: mapContentControlType(properties),
    placeholder: propertyChild(properties, 'showingPlcHdr') !== undefined,
    bound: propertyChild(properties, 'dataBinding') !== undefined,
  };
  controlChromeMemos.set(control, chrome);
  return chrome;
}

function boundaryRecordOf(
  collected: CollectedControl,
  geometry: PlacedGeometryIndex,
  work?: ContentControlBoundaryWork
): ContentControlBoundaryRecord {
  const fragments =
    collected.level === 'inline' && collected.paragraphId && collected.range
      ? fragmentsForInlineControl(collected.paragraphId, collected.range, geometry, work)
      : fragmentsForBlockControl(collected.blockIds, geometry, work);
  // One source for the chrome fields: a field added to the record has one place to be
  // forgotten, not two, and the no-geometry path can never drift from this one.
  return { ...recordWithoutGeometry(collected), fragments };
}

function sameGeometryFragments(
  left: readonly ContentControlGeometryFragment[],
  right: readonly ContentControlGeometryFragment[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a === b) continue;
    if (a.pageIndex !== b.pageIndex) return false;
    if (
      a.box.x !== b.box.x ||
      a.box.y !== b.box.y ||
      a.box.width !== b.box.width ||
      a.box.height !== b.box.height
    ) {
      return false;
    }
  }
  return true;
}

function sameBoundaryRecord(
  left: ContentControlBoundaryRecord,
  right: ContentControlBoundaryRecord
): boolean {
  return (
    left.id === right.id &&
    left.alias === right.alias &&
    left.tag === right.tag &&
    left.controlType === right.controlType &&
    left.lock === right.lock &&
    left.effectiveLock === right.effectiveLock &&
    left.placeholder === right.placeholder &&
    left.bound === right.bound &&
    left.nestingDepth === right.nestingDepth &&
    left.level === right.level &&
    sameModelRange(left.range, right.range) &&
    sameGeometryFragments(left.fragments, right.fragments)
  );
}

function sameBoundaryList(
  left: readonly ContentControlBoundaryRecord[] | undefined,
  right: readonly ContentControlBoundaryRecord[]
): boolean {
  if (!left) return right.length === 0;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!sameBoundaryRecord(left[index]!, right[index]!)) return false;
  }
  return true;
}

/** Copy layout-level content-control metadata onto a pages/revision shell. */
export function withContentControlMetadata(
  layout: Pick<SemanticLayout, 'revision' | 'pages'>,
  source: SemanticLayout
): SemanticLayout {
  return {
    ...source,
    revision: layout.revision,
    pages: layout.pages,
  };
}

/**
 * The control-carrying wrapper built for one raw page, kept on the page it wraps.
 *
 * Weak on the raw page, so a page that falls out of the layout takes its wrapper with it.
 */
const wrappedPages = new WeakMap<
  PageRecord,
  { readonly controls: readonly ContentControlBoundaryRecord[]; readonly wrapped: PageRecord }
>();

/**
 * Publish content-control boundary records onto a laid-out document.
 *
 * Page fragment identity is preserved when a page's control list is unchanged; metadata-only
 * edits replace the page wrapper so consumers never read a stale `contentControls` array from
 * an identity-reused page. When no page wrapper needs rewriting, the prior `pages` array is
 * kept by reference so a no-change resume still satisfies `layout.pages` identity.
 */
import { boundaryParts, collectedControlIndexOverParts } from './content-control-boundary-parts.ts';

export function attachContentControlBoundaries(
  layout: SemanticLayout,
  part: OoxmlPart,
  token = contentControlContextToken(part),
  work?: ContentControlBoundaryWork
): SemanticLayout {
  // The token the CALLER passes is the body part's. A control in a header lives in a different
  // part, whose token the body's does not move with — so the authority is derived here, over
  // every story part the layout draws. Each part's own token is memoized, so the extra parts
  // cost a join rather than a walk.
  const parts = boundaryParts(layout, part);
  if (parts.length > 1) {
    const perPart = parts.map((storyPart) => contentControlContextToken(storyPart));
    // EMPTY when no part holds a control, not `'|'`. A join of empty strings is truthy, which
    // defeated the short-circuit below for every document that merely HAS a header — so the
    // common case paid the full collect-and-index walk on every pass.
    token = perPart.some((each) => each !== '') ? perPart.join('|') : '';
  }
  // The token includes every control id, so an empty token proves there are no controls.
  // Avoid both otherwise-unconditional full walks: collecting controls from the tree and
  // indexing every placed fragment/span across every page.
  if (token === '') {
    const pagesHaveControls = layout.pages.some(
      (page) => page.contentControls !== undefined && page.contentControls.length > 0
    );
    if (
      !pagesHaveControls &&
      layout.controlContextToken === token &&
      sameBoundaryList(layout.contentControls, [])
    ) {
      return layout;
    }
    const pages = pagesHaveControls
      ? layout.pages.map((page) =>
          page.contentControls !== undefined && page.contentControls.length > 0
            ? { ...page, contentControls: [] }
            : page
        )
      : layout.pages;
    return {
      ...layout,
      pages,
      contentControls: [],
      controlContextToken: token,
    };
  }

  const index = collectedControlIndexOverParts(parts);
  const geometry = placedGeometryOf(layout, index, work);
  const contentControls = index.controls.map((entry) => boundaryRecordOf(entry, geometry, work));
  const byPage = new Map<number, ContentControlBoundaryRecord[]>();
  for (const record of contentControls) {
    for (const fragment of record.fragments) {
      work && (work.pageFragments += 1);
      const list = byPage.get(fragment.pageIndex);
      const pageRecord = { ...record, fragments: [fragment] };
      if (list) list.push(pageRecord);
      else byPage.set(fragment.pageIndex, [pageRecord]);
    }
  }

  if (
    layout.controlContextToken === token &&
    sameBoundaryList(layout.contentControls, contentControls) &&
    layout.pages.every((page) =>
      sameBoundaryList(page.contentControls, byPage.get(page.index) ?? [])
    )
  ) {
    return layout;
  }

  let pagesChanged = false;
  const mapped = layout.pages.map((page) => {
    const pageControls = byPage.get(page.index) ?? [];
    if (sameBoundaryList(page.contentControls, pageControls)) return page;
    if (pageControls.length === 0 && !page.contentControls) return page;
    pagesChanged = true;
    // The SAME wrapper as last time, when the page underneath it and the controls on it are
    // both unchanged. Pagination reuses a page it did not touch, but hands it back without
    // the control list, so this stage re-wraps it on every pass — and a new wrapper every
    // keystroke defeats every consumer keyed on page identity, from the per-page layout
    // indexes to paint's sheet reuse. On a contract with controls on a hundred pages, those
    // hundred sheets were rebuilt for an edit that touched none of them.
    const cached = wrappedPages.get(page);
    if (cached && sameBoundaryList(cached.controls, pageControls)) return cached.wrapped;
    const wrapped = { ...page, contentControls: pageControls };
    const geometry = pageGeometryContributions.get(page);
    if (geometry) pageGeometryContributions.set(wrapped, geometry);
    wrappedPages.set(page, { controls: pageControls, wrapped });
    return wrapped;
  });
  const pages = pagesChanged ? mapped : layout.pages;

  if (
    pages === layout.pages &&
    layout.controlContextToken === token &&
    sameBoundaryList(layout.contentControls, contentControls)
  ) {
    return layout;
  }

  return {
    ...layout,
    pages,
    contentControls,
    controlContextToken: token,
  };
}

/**
 * Every content control a part declares, in document order, WITHOUT geometry.
 *
 * For callers that want the ROSTER rather than the rectangles — the Tab walk through form
 * fields is the one, and it needs story order, not boxes. `fragments` comes back empty here
 * by design; a caller that needs geometry reads `layout.contentControls`, which covers every
 * story the layout draws.
 */
export function contentControlRecordsInPart(
  part: OoxmlPart,
  /**
   * Keep only controls holding one of these paragraphs.
   *
   * For a notes PART, which holds every note in the document rather than one story. Rostered
   * whole, Tab walked out of the open footnote and into the next one, and the keystrokes after
   * it landed in a note the reader was not in.
   */
  withinParagraphs?: ReadonlySet<string>
): readonly ContentControlBoundaryRecord[] {
  const controls = collectedControlIndexOf(part).controls.filter((collected) => {
    if (!withinParagraphs) return true;
    if (collected.paragraphId !== undefined) return withinParagraphs.has(collected.paragraphId);
    // Any paragraph the control DRAWS, not just a top-level one. `blockIds` carries table ids
    // as well as paragraph ids, and the membership set is paragraphs alone — so a block control
    // wrapping a table matched nothing and dropped out of the roster entirely.
    return paragraphsUnder(collected.control).some((id) => withinParagraphs.has(id));
  });
  return controls.map(recordWithoutGeometry);
}

/** Every paragraph id anywhere under a control, tables and nested controls included. */
function paragraphsUnder(control: OoxmlElement): string[] {
  const found: string[] = [];
  const walk = (nodes: readonly OoxmlNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'textValue') continue;
      if (node.kind === 'paragraph') {
        found.push(node.id);
        continue;
      }
      if (isContentControl(node)) {
        walk(contentControlContentChildren(node));
        continue;
      }
      walk(node.children);
    }
  };
  walk(contentControlContentChildren(control));
  return found;
}

/**
 * The innermost content control holding `paragraphId`, in `part`.
 *
 * Deepest wins, matching the geometry path's innermost-by-nesting rule: a control inside a
 * control is the one the caret is actually in.
 */
export function contentControlHoldingParagraph(
  part: OoxmlPart,
  paragraphId: string
): ContentControlBoundaryRecord | null {
  let found: CollectedControl | null = null;
  for (const collected of collectedControlIndexOf(part).controls) {
    // `blockIds` carries a table's OWN id and stops there, so a paragraph inside a table
    // inside a block control is in no `blockIds` list. `contentControlRecordsInPart` was
    // given `paragraphsUnder` for exactly that; this reader was not, so the caret in such a
    // cell reported no control at all — no outline, `remove()` answering `notFound`, and
    // `navigate` stepping over it. Every scope but the body routes through here.
    const holds =
      collected.paragraphId === paragraphId ||
      collected.blockIds.includes(paragraphId) ||
      paragraphsUnder(collected.control).includes(paragraphId);
    if (!holds) continue;
    if (!found || collected.nestingDepth >= found.nestingDepth) found = collected;
  }
  return found ? recordWithoutGeometry(found) : null;
}

function recordWithoutGeometry(collected: CollectedControl): ContentControlBoundaryRecord {
  const chrome = controlChromeOf(collected.control);
  return {
    id: collected.control.id,
    ...(chrome.alias !== undefined ? { alias: chrome.alias } : {}),
    ...(chrome.tag !== undefined ? { tag: chrome.tag } : {}),
    controlType: chrome.controlType,
    lock: collected.lockStack[collected.lockStack.length - 1] ?? 'unlocked',
    effectiveLock: effectiveContentControlLock(collected.lockStack),
    placeholder: chrome.placeholder,
    bound: chrome.bound,
    nestingDepth: collected.nestingDepth,
    level: collected.level,
    fragments: [],
    ...modelRangeOf(collected),
  };
}
