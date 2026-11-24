// What READS a merged fragment.
//
// A resolved display mode publishes a run of paragraphs as ONE fragment, named after the
// paragraph the merge keeps. Every consumer that asked `fragment.paragraphId === mine` was
// therefore right about ordinary documents and blind to the absorbed members: it reported
// them as unlaid — no list marker, no note reference, no card geometry, not in a cell
// selection — while the reader was looking straight at them.
//
// These are the consumers, each asked the question it asks in production.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  fragmentExtentOf,
  fragmentOwnsPosition,
  fragmentParagraphs,
  lineSegments,
} from '../line-segments.ts';
import { buildPageRefIndex, filterRefsOnPage, type PageRefHit } from '../note-pagination.ts';
import { anchorLineY, reviewAnchorIndex } from '../review-support.ts';
import { paragraphsInCells } from '../semantic-cell-selection.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const marked = (text: string) =>
  `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const plain = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** Two paragraphs the reader sees as one: the first one's mark is deleted. */
const MERGED = marked('Hello ') + plain('world');

const lay = (part: OoxmlPart, displayMode: RevisionDisplayMode = 'proposed') =>
  layoutSemanticDocument(part, 1, { measurer, displayMode });

function paragraphIds(part: OoxmlPart): readonly string[] {
  const found: string[] = [];
  const visit = (node: { kind: string; id?: string; children?: readonly unknown[] }): void => {
    if (node.kind === 'paragraph' && node.id) found.push(node.id);
    for (const child of node.children ?? []) {
      visit(child as { kind: string; id?: string; children?: readonly unknown[] });
    }
  };
  visit(part.root as unknown as { kind: string; id?: string; children?: readonly unknown[] });
  return found;
}

describe('a fragment answers for every paragraph it draws', () => {
  test('an ordinary fragment names one paragraph and answers from its own range', () => {
    // The no-shift half of the contract: nothing about a document without a merge takes a
    // new path, and the extent is the fragment's own field, untouched.
    const layout = lay(load(plain('alpha')));
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragmentParagraphs(fragment)).toEqual([fragment.paragraphId]);
    expect(fragmentExtentOf(fragment, fragment.paragraphId)).toEqual({
      start: fragment.range.start,
      end: fragment.range.end,
    });
    expect(fragmentExtentOf(fragment, 'not-a-paragraph')).toBeNull();
  });

  test('a merged fragment names both members, in the order the reader meets them', () => {
    const part = load(MERGED);
    const [absorbed, survivor] = paragraphIds(part);
    const fragment = paragraphFragmentsOf(lay(part).pages[0]!)[0]!;
    expect(fragment.paragraphId).toBe(survivor!);
    expect(fragmentParagraphs(fragment)).toEqual([absorbed!, survivor!]);
    // Each in its OWN offsets: both count from zero, which is the whole difficulty.
    expect(fragmentExtentOf(fragment, absorbed!)).toEqual({ start: 0, end: 6 });
    expect(fragmentExtentOf(fragment, survivor!)).toEqual({ start: 0, end: 5 });
  });

  test('ownership is half-open in each member, as it is in an ordinary fragment', () => {
    const part = load(MERGED);
    const [absorbed, survivor] = paragraphIds(part);
    const fragment = paragraphFragmentsOf(lay(part).pages[0]!)[0]!;
    expect(fragmentOwnsPosition(fragment, absorbed!, 0)).toBe(true);
    expect(fragmentOwnsPosition(fragment, absorbed!, 5)).toBe(true);
    expect(fragmentOwnsPosition(fragment, absorbed!, 6)).toBe(false);
    expect(fragmentOwnsPosition(fragment, survivor!, 0)).toBe(true);
    expect(fragmentOwnsPosition(fragment, survivor!, 5)).toBe(false);
  });
});

describe('a note reference in the absorbed half still reaches its page', () => {
  test('the reference is kept, by both the indexed and the unindexed path', () => {
    // The bug this closes is a footnote that vanishes: the mark is painted in the text and
    // the note itself never reaches the bottom of the page, because no fragment claimed the
    // paragraph the reference names.
    const part = load(MERGED);
    const [absorbed] = paragraphIds(part);
    const page = lay(part).pages[0]!;
    const ref: PageRefHit = {
      noteKind: 'footnote',
      noteId: 1,
      paragraphId: absorbed!,
      atomOffset: 2,
      customMarkFollows: false,
      sectionIndex: 0,
    };
    expect(filterRefsOnPage(page, [ref])).toEqual([ref]);
    expect(filterRefsOnPage(page, [ref], buildPageRefIndex([ref]))).toEqual([ref]);
  });

  test('a reference past the end of its member is still not on the page', () => {
    // The fix widens WHICH paragraphs a fragment answers for. It must not widen the offsets:
    // an atom beyond the member's own text belongs to no fragment, merged or not.
    const part = load(MERGED);
    const [absorbed] = paragraphIds(part);
    const page = lay(part).pages[0]!;
    const ref: PageRefHit = {
      noteKind: 'footnote',
      noteId: 1,
      paragraphId: absorbed!,
      atomOffset: 99,
      customMarkFollows: false,
      sectionIndex: 0,
    };
    expect(filterRefsOnPage(page, [ref])).toEqual([]);
    expect(filterRefsOnPage(page, [ref], buildPageRefIndex([ref]))).toEqual([]);
  });
});

describe('a card anchored in the absorbed half has geometry', () => {
  test('both members are in the anchor index, on the same line', () => {
    const part = load(MERGED);
    const [absorbed, survivor] = paragraphIds(part);
    const index = reviewAnchorIndex(lay(part), (page) => paragraphFragmentsOf(page));
    expect(index.has(absorbed!)).toBe(true);
    expect(index.has(survivor!)).toBe(true);
    // One line, so both cards sit beside it — a card with no anchor is dropped by the rail.
    expect(anchorLineY(index.get(absorbed!)!, absorbed!, 0)).toBe(
      anchorLineY(index.get(survivor!)!, survivor!, 0)
    );
  });

  test('the line pick reads the member, not the line range', () => {
    // The join line's `range` names ONE of the two paragraphs, so an offset compared against
    // it is compared in the wrong coordinate space. Where the absorbed half is long and the
    // survivor wraps, every survivor offset below the absorbed member's length matched the
    // FIRST line — a card several lines above the text it annotates.
    const long = 'word '.repeat(15).trim();
    const part = load(
      `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>` +
        `<w:r><w:t xml:space="preserve">${long} </w:t></w:r></w:p>` +
        plain('and then a tail that keeps going for a while yet')
    );
    const layout = lay(part);
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    const index = reviewAnchorIndex(layout, (page) => paragraphFragmentsOf(page));
    // The fixture has to be the shape the bug needs: more than one line, and a line that
    // carries both members.
    expect(fragment.lines.length).toBeGreaterThan(1);
    expect(fragmentParagraphs(fragment)).toHaveLength(2);
    expect(lineSegments(fragment.lines[0]!)).toHaveLength(2);

    // Every member, on every line it appears on, anchors to THAT line.
    for (const line of fragment.lines) {
      for (const segment of lineSegments(line)) {
        const anchor = index.get(segment.paragraphId)!;
        expect(anchorLineY(anchor, segment.paragraphId, segment.start)).toBe(line.box.y);
      }
    }
  });
});

describe('a cell selection covers every paragraph it draws', () => {
  test('the absorbed member is selected with the cell that holds it', () => {
    // A cell selection stands in for a text range, and deletion acts on the paragraphs it
    // lists. Listing the survivor alone left the absorbed member's text in a cell the
    // reader had just emptied.
    const part = load(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr/>${MERGED}</w:tc></w:tr></w:tbl>`
    );
    const layout = lay(part);
    const table = layout.pages[0]!.fragments.find((block) => block.kind === 'table')!;
    if (table.kind !== 'table') throw new Error('no table');
    const cellId = table.rows[0]!.cells[0]!.id;
    const found = paragraphsInCells(layout, [cellId]);
    expect(found).toHaveLength(2);
    const merged = paragraphFragmentsOf(layout.pages[0]!);
    expect(found).toEqual(fragmentParagraphs(merged[0]!) as string[]);
  });
});
