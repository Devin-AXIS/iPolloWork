// Section vertical alignment (`w:sectPr/w:vAlign`, §17.6.23).
//
// A page whose body belongs to one centered or bottom-aligned section moves that body down
// inside the text area. A justified (`both`) page spreads the free height evenly between its
// paragraphs; the lines of one paragraph stay together. The empty paragraph that carries the
// section break takes no room. A page that holds more than one section stays top-aligned.
//
// Applied to a COMPLETE pass, page by page, after pagination and notes, and to the pages a
// pass shows before it ends. Pagination keeps flowing against top-aligned geometry, so an
// incremental pass never reads moved records: the layout session keeps the top-aligned pages.
// Each aligned page is memoized on the page it moves, so an unchanged page keeps its identity
// across passes, and on its fragment array, so a page rebuilt only for its metadata does not
// move its body again.
//
// Not applied: multi-column sections, pages with notes, text frames, floating tables, or
// drawings that wrap text (in the body, header, or footer), pages where a drawing that moves
// with its paragraph is cut by the page edge, pages that hold a continuous section break, and
// justified pages that hold a table. Those pages stay top-aligned.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import { wrapProducesExclusion } from './drawing-exclusion.ts';
import { shiftAnchoredDrawing } from './drawing-overlap.ts';
import { storyHasFloatingTable } from './furniture-table-exclusion.ts';
import { translateParagraphFragment } from './paragraph-frame.ts';
import {
  paragraphSectionNode,
  type DocumentSection,
  type SectionVerticalAlign,
} from './section-properties.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from './semantic-records.ts';

interface AlignedBody {
  readonly alignment: SectionVerticalAlign;
  readonly height: number;
  readonly drawings: PageRecord['anchoredDrawings'];
  readonly fragments: readonly BlockFragmentRecord[];
  readonly anchoredDrawings?: PageRecord['anchoredDrawings'];
}
// Two memos keep work and identity across passes. A page the next pass hands back unchanged
// returns the same aligned page; a page rebuilt only for its metadata (a new page count, say)
// keeps its fragment array, and reuses the moved body by that array. Both are checked against
// the page's current alignment, which an edit to a later paragraph can change.
interface AlignedPage {
  readonly alignment: SectionVerticalAlign;
  readonly page: PageRecord;
}
const alignedPages = new WeakMap<PageRecord, AlignedPage>();
const alignedBodies = new WeakMap<readonly BlockFragmentRecord[], AlignedBody>();
const publishedPages = new WeakSet<PageRecord>();

/** Whether any section aligns its pages other than at the top. */
export function sectionsAlignVertically(sections: readonly DocumentSection[]): boolean {
  return sections.some((section) => section.properties.verticalAlign !== undefined);
}

interface SectionIndex {
  readonly sections: readonly DocumentSection[];
  readonly sectionOfBlock: ReadonlyMap<string, number>;
  /** Empty paragraphs that only carry a section break. */
  readonly carriers: ReadonlySet<string>;
  /** Paragraphs that end a section the next one continues on the same page. */
  readonly continuous: ReadonlySet<string>;
}

/**
 * The published layout with each eligible page's body moved by its section's `w:vAlign`.
 * Returns `layout` itself when no page moves.
 */
export function alignSectionPagesVertically(
  layout: SemanticLayout,
  sections: readonly DocumentSection[],
  blocks: readonly OoxmlElement[],
  /** Align only the pages before this index; the later ones are aligned already. */
  limit = layout.pages.length
): SemanticLayout {
  if (!sectionsAlignVertically(sections)) return layout;
  const sectionOfBlock = new Map<string, number>();
  const carriers = new Set<string>();
  const continuous = new Set<string>();
  for (let position = 0; position < sections.length; position += 1) {
    const section = sections[position]!;
    const end = Math.min(section.blockEndExclusive, blocks.length);
    for (let index = section.blockStart; index < end; index += 1)
      sectionOfBlock.set(blocks[index]!.id, section.index);
    const last = blocks[end - 1];
    if (!last || end <= section.blockStart || !paragraphSectionNode(last)) continue;
    carriers.add(last.id);
    if (sections[position + 1]?.properties.breakType === 'continuous') continuous.add(last.id);
  }
  const index: SectionIndex = { sections, sectionOfBlock, carriers, continuous };
  let changed = false;
  const pages = layout.pages.map((page, position) => {
    if (position >= limit) return page;
    const next = alignPage(page, index);
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...layout, pages } : layout;
}

/** A paragraph fragment that holds no text and paints nothing, such as a section-break mark. */
const isSilentMark = (fragment: BlockFragmentRecord): boolean =>
  fragment.kind === 'paragraph' &&
  fragment.outOfFlow === true &&
  !fragment.positionedFrame &&
  isEmptyParagraph(fragment);

function alignPage(page: PageRecord, index: SectionIndex): PageRecord {
  if (publishedPages.has(page)) return page;
  const alignment = pageAlignment(page, index);
  if (alignment === undefined) return page;
  const known = alignedPages.get(page);
  if (known?.alignment === alignment) return known.page;
  const aligned = alignBody(page, index, alignment);
  alignedPages.set(page, { alignment, page: aligned });
  if (aligned !== page) publishedPages.add(aligned);
  return aligned;
}

/** The page's alignment, or `undefined` when it stays top-aligned. */
function pageAlignment(page: PageRecord, index: SectionIndex): SectionVerticalAlign | undefined {
  if (page.parityBlank || page.noteStream || page.footnotes || page.endnotes) return undefined;
  if (page.fragments.length === 0) return undefined;
  let sectionIndex: number | undefined;
  for (const fragment of page.fragments) {
    if (fragment.kind === 'paragraph') {
      if (fragment.paragraphEnd && index.continuous.has(fragment.paragraphId)) return undefined;
      if (fragment.outOfFlow && !isSilentMark(fragment)) return undefined;
    } else if (fragment.floatingWrap) return undefined;
    const section = index.sectionOfBlock.get(
      fragment.kind === 'paragraph' ? fragment.paragraphId : fragment.tableId
    );
    if (section === undefined || (sectionIndex !== undefined && section !== sectionIndex))
      return undefined;
    sectionIndex = section;
  }
  const properties = index.sections.find((section) => section.index === sectionIndex)?.properties;
  if (!properties || properties.columns.count > 1) return undefined;
  if (page.anchoredDrawings?.some((drawing) => wrapProducesExclusion(drawing.wrap)))
    return undefined;
  // Header and footer drawings and floating tables that wrap body text stay where they are.
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    if (story.anchoredDrawings?.some((drawing) => wrapProducesExclusion(drawing.wrap)))
      return undefined;
    if (storyHasFloatingTable(story)) return undefined;
  }
  return properties.verticalAlign;
}

function alignBody(
  page: PageRecord,
  index: SectionIndex,
  alignment: SectionVerticalAlign
): PageRecord {
  const height = page.contentBox.height;
  const memo = alignedBodies.get(page.fragments);
  if (
    memo &&
    memo.alignment === alignment &&
    memo.height === height &&
    memo.drawings === page.anchoredDrawings
  )
    return withBody(page, memo.fragments, memo.anchoredDrawings);
  const offsets = bodyOffsets(page.fragments, index.carriers, height, alignment);
  const body = (offsets && shiftPageBody(page, offsets)) || {
    fragments: page.fragments,
    anchoredDrawings: page.anchoredDrawings,
  };
  alignedBodies.set(page.fragments, {
    alignment,
    height,
    drawings: page.anchoredDrawings,
    ...body,
  });
  return withBody(page, body.fragments, body.anchoredDrawings);
}

function withBody(
  page: PageRecord,
  fragments: readonly BlockFragmentRecord[],
  anchoredDrawings: PageRecord['anchoredDrawings']
): PageRecord {
  if (fragments === page.fragments) return page;
  return { ...page, fragments, ...(anchoredDrawings ? { anchoredDrawings } : {}) };
}

/**
 * How far each fragment moves, or `null` when nothing moves. Silent marks and the final empty
 * paragraph that carries the section break take no room; each moves with the fragment before it.
 */
function bodyOffsets(
  fragments: readonly BlockFragmentRecord[],
  carriers: ReadonlySet<string>,
  height: number,
  alignment: SectionVerticalAlign
): readonly number[] | null {
  const last = fragments.length - 1;
  const measured: boolean[] = [];
  let count = 0;
  let bottom = 0;
  for (let index = 0; index <= last; index += 1) {
    const fragment = fragments[index]!;
    const excluded =
      isSilentMark(fragment) ||
      (index === last &&
        fragment.kind === 'paragraph' &&
        fragment.fragmentIndex === 0 &&
        carriers.has(fragment.paragraphId) &&
        isEmptyParagraph(fragment));
    measured.push(!excluded);
    if (excluded) continue;
    count += 1;
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  const slack = height - bottom;
  if (count === 0 || slack <= 0.01) return null;
  if (alignment === 'both') {
    // Rows of a justified table spread apart as well; that stays unsupported.
    if (count < 2 || fragments.some((fragment) => fragment.kind === 'table')) return null;
  }
  const gap = alignment === 'both' ? slack / (count - 1) : 0;
  const offsets: number[] = [];
  let seen = 0;
  let previous: number | undefined;
  for (let index = 0; index <= last; index += 1) {
    if (measured[index]) {
      previous = alignment === 'both' ? seen * gap : alignment === 'center' ? slack / 2 : slack;
      seen += 1;
    }
    offsets.push(
      previous ?? (alignment === 'both' ? 0 : alignment === 'center' ? slack / 2 : slack)
    );
  }
  return offsets;
}

function isEmptyParagraph(fragment: ParagraphFragmentRecord): boolean {
  return (
    !fragment.marker &&
    fragment.lines.every(
      (line) => !line.drawings?.length && line.spans.every((span) => span.text.length === 0)
    )
  );
}

/**
 * The page body moved by `offsets`, or `null` when a drawing that moves with its paragraph is
 * cut, by the page edge before or after the move or by its line: its clipped geometry cannot
 * move as it is.
 */
function shiftPageBody(
  page: PageRecord,
  offsets: readonly number[]
): Pick<PageRecord, 'fragments' | 'anchoredDrawings'> | null {
  if (holdsClippedInlineDrawing(page.fragments)) return null;
  const paragraphs = new Map<string, number>();
  const cellParagraphs = new Map<string, number>();
  const fragments = page.fragments.map((fragment, index) =>
    shiftBlock(fragment, offsets[index]!, paragraphs, cellParagraphs, false)
  );
  // The page edges, in the content-box coordinates drawings use. Both boxes are placed in
  // the document, so the content box's offset on its own sheet is the difference.
  const inset = page.contentBox.y - page.box.y;
  const top = -inset + 0.01;
  const bottom = page.box.height - inset - 0.01;
  let clipped = false;
  const anchoredDrawings = page.anchoredDrawings?.map((drawing) => {
    const dy = textOffset(drawing, paragraphs, cellParagraphs);
    if (dy === undefined || Math.abs(dy) <= 0.000_1) return drawing;
    const paint = drawing.paintBounds;
    const from = Math.min(drawing.y, paint.y);
    const to = Math.max(drawing.y + drawing.height, paint.y + paint.height);
    if (from <= top || to + dy >= bottom) clipped = true;
    // The frame the drawing is positioned from moves with it, so an edit that reads the
    // drawing's offset from its frame still reads the authored offset.
    return Object.freeze({
      ...shiftAnchoredDrawing(drawing, 0, dy),
      verticalFrameOrigin: drawing.verticalFrameOrigin + dy,
    });
  });
  if (clipped) return null;
  return { fragments, anchoredDrawings: anchoredDrawings && Object.freeze(anchoredDrawings) };
}

/** Whether a page holds an inline drawing that its line or the body may cut. */
function holdsClippedInlineDrawing(blocks: readonly BlockFragmentRecord[]): boolean {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      for (const line of block.lines)
        for (const drawing of line.drawings ?? [])
          if (inlineDrawingClipped(drawing, line.box)) return true;
    } else
      for (const row of block.rows)
        for (const cell of row.cells) if (holdsClippedInlineDrawing(cell.blocks)) return true;
  }
  return false;
}

/**
 * Whether an inline drawing may be cut: its extent reaches past its line (an exact line height
 * cuts it there, at any rotation), or, upright, its painted bounds do not cover its extent.
 * Effects and flips only grow the painted bounds around the extent.
 */
function inlineDrawingClipped(drawing: InlineDrawingRecord, line: LayoutBox): boolean {
  if (drawing.y < line.y - 0.01 || drawing.y + drawing.height > line.y + line.height + 0.01)
    return true;
  if (drawing.transform.rotationDegrees % 180 !== 0) return false;
  const paint = drawing.paintBounds;
  return (
    paint.y > drawing.y + 0.01 ||
    paint.y + paint.height < drawing.y + drawing.height - 0.01 ||
    paint.x > drawing.x + 0.01 ||
    paint.x + paint.width < drawing.x + drawing.width - 0.01
  );
}

/**
 * How far a drawing positioned from its paragraph or line moves: as far as that paragraph.
 * Page and margin frames stay, except for a drawing laid out in its table cell.
 */
function textOffset(
  drawing: AnchoredDrawingRecord,
  paragraphs: ReadonlyMap<string, number>,
  cellParagraphs: ReadonlyMap<string, number>
): number | undefined {
  const relative = drawing.verticalFrame === 'paragraph' || drawing.verticalFrame === 'line';
  const body = paragraphs.get(drawing.anchorParagraphId);
  if (body !== undefined) return relative ? body : undefined;
  const cell = cellParagraphs.get(drawing.anchorParagraphId);
  return cell !== undefined && (relative || drawing.layoutInCell) ? cell : undefined;
}

const moveBox = (box: LayoutBox, dy: number): LayoutBox => ({ ...box, y: box.y + dy });

function shiftBlock(
  block: BlockFragmentRecord,
  dy: number,
  paragraphs: Map<string, number>,
  cellParagraphs: Map<string, number>,
  inCell: boolean
): BlockFragmentRecord {
  if (block.kind === 'paragraph') {
    (inCell ? cellParagraphs : paragraphs).set(block.paragraphId, dy);
    return shiftParagraph(block, dy);
  }
  return shiftTable(block, dy, paragraphs, cellParagraphs);
}

function shiftParagraph(fragment: ParagraphFragmentRecord, dy: number): ParagraphFragmentRecord {
  const moved = translateParagraphFragment(fragment, 0, dy);
  const pieces = moved.marker?.pieces;
  if (!moved.marker || !pieces) return moved;
  // Right-to-left marker pieces share the marker's coordinate space.
  return {
    ...moved,
    marker: {
      ...moved.marker,
      pieces: pieces.map((piece) => ({ ...piece, box: moveBox(piece.box, dy) })),
    },
  };
}

function shiftTable(
  table: TableFragmentRecord,
  dy: number,
  paragraphs: Map<string, number>,
  cellParagraphs: Map<string, number>
): TableFragmentRecord {
  return {
    ...table,
    box: moveBox(table.box, dy),
    rows: table.rows.map((row) => ({
      ...row,
      box: moveBox(row.box, dy),
      cells: row.cells.map((cell) => ({
        ...cell,
        box: moveBox(cell.box, dy),
        blocks: cell.blocks.map((block) => shiftBlock(block, dy, paragraphs, cellParagraphs, true)),
      })),
    })),
  };
}
