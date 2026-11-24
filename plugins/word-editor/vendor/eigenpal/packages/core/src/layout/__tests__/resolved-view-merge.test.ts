// A resolved display mode shows what the document BECOMES, and a tracked paragraph mark is a
// tracked paragraph BREAK. `proposed` answers accept-all, `original` answers reject-all, and
// the store performs the merge either way — layout has to draw the same document.
//
// The merge is only half of it. `proposed` is what the free engine renders BY DEFAULT and that
// surface is editable, so the characters of the second paragraph have to keep addressing the
// second paragraph. Every test below that looks like a geometry test is really an identity
// test wearing geometry.

import { describe, expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { documentOrder } from '../document-order.ts';
import {
  caretAt,
  caretStops,
  hitTestSemantic,
  paragraphTextFromLayout,
  selectionRects,
  spansInSelection,
} from '../semantic-interaction.ts';
import { lineAtPosition, linesOf } from '../semantic-records.ts';
import { reviewAnchorIndex } from '../review-support.ts';
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

const marked = (mark: string, text: string) =>
  `<w:p><w:pPr><w:rPr>${mark}</w:rPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const plain = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const DELETED_MARK = marked('<w:del w:id="1" w:author="A"/>', 'Hello ') + plain('world');
const INSERTED_MARK = marked('<w:ins w:id="1" w:author="A"/>', 'Hello ') + plain('world');

const lay = (part: OoxmlPart, displayMode: RevisionDisplayMode) =>
  layoutSemanticDocument(part, 1, { measurer, displayMode });

const textPerLine = (part: OoxmlPart, displayMode: RevisionDisplayMode) =>
  linesOf(lay(part, displayMode)).map((line) => line.spans.map((span) => span.text).join(''));

/** The short id, so an assertion reads as the paragraph a person would point at. */
const shortId = (id: string) => id.split('#').pop()!;

describe('a resolved view merges what its decisions merge', () => {
  test('proposed runs a deleted mark into the next paragraph', () => {
    expect(textPerLine(load(DELETED_MARK), 'proposed')).toEqual(['Hello world']);
    expect(textPerLine(load(DELETED_MARK), 'all-markup')).toEqual(['Hello ', 'world']);
    expect(textPerLine(load(DELETED_MARK), 'original')).toEqual(['Hello ', 'world']);
  });

  test('original un-splits an inserted mark', () => {
    expect(textPerLine(load(INSERTED_MARK), 'original')).toEqual(['Hello world']);
    expect(textPerLine(load(INSERTED_MARK), 'proposed')).toEqual(['Hello ', 'world']);
  });

  test('the merged paragraph equals the merged tree', () => {
    // The specification of the two resolved modes, applied to the one revision kind that
    // could not honour it: the projection and the op have to describe the same document.
    const part = load(DELETED_MARK);
    const accepted = applyTreeOp(part, { op: 'acceptAllRevisions' });
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(textPerLine(part, 'proposed')).toEqual(textPerLine(accepted.part, 'proposed'));
  });

  test('a run of removed marks collapses into one paragraph, not into pairs', () => {
    // The store had this wrong: a paragraph that absorbed one could not merge forward again,
    // so sixteen consecutive deleted marks became eight paragraphs. Both lanes answer once.
    const part = load(
      marked('<w:del w:id="1" w:author="A"/>', 'one ') +
        marked('<w:del w:id="2" w:author="A"/>', 'two ') +
        marked('<w:del w:id="3" w:author="A"/>', 'three ') +
        plain('four')
    );
    expect(textPerLine(part, 'proposed')).toEqual(['one two three four']);
    const accepted = applyTreeOp(part, { op: 'acceptAllRevisions' });
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(textPerLine(accepted.part, 'proposed')).toEqual(['one two three four']);
  });

  test('a table between two marks ends the group', () => {
    // A merge that crossed a container would move content into a different parent, which is
    // the same refusal the store makes.
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
      '<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
      plain('cell') +
      '</w:tc></w:tr></w:tbl>';
    const part = load(marked('<w:del w:id="1" w:author="A"/>', 'before ') + table + plain('after'));
    expect(textPerLine(part, 'proposed')).toEqual(['before ', 'cell', 'after']);
  });

  test('a trailing mark has nothing to merge into and keeps its content', () => {
    const part = load(plain('first') + marked('<w:del w:id="1" w:author="A"/>', 'last'));
    expect(textPerLine(part, 'proposed')).toEqual(['first', 'last']);
  });
});

describe('the merged half still addresses its own paragraph', () => {
  const paragraphIds = (part: OoxmlPart) => {
    const layout = lay(part, 'proposed');
    return linesOf(layout).flatMap((line) =>
      line.spans.map((span) => shortId(span.range.paragraphId))
    );
  };

  test('each span names the paragraph that holds its characters', () => {
    expect(paragraphIds(load(DELETED_MARK))).toEqual(['0.0.0', '0.0.1']);
  });

  test('offsets restart at zero in the second paragraph', () => {
    const spans = linesOf(lay(load(DELETED_MARK), 'proposed')).flatMap((line) => line.spans);
    expect(spans.map((span) => [span.text, span.range.start, span.range.end])).toEqual([
      ['Hello ', 0, 6],
      ['world', 0, 5],
    ]);
  });

  test('the caret can reach both halves, in reading order', () => {
    const stops = caretStops(lay(load(DELETED_MARK), 'proposed'), measurer);
    expect(stops.map((stop) => [shortId(stop.position.paragraphId), stop.position.offset])).toEqual(
      [
        ['0.0.0', 0],
        ['0.0.0', 1],
        ['0.0.0', 2],
        ['0.0.0', 3],
        ['0.0.0', 4],
        ['0.0.0', 5],
        ['0.0.0', 6],
        ['0.0.1', 0],
        ['0.0.1', 1],
        ['0.0.1', 2],
        ['0.0.1', 3],
        ['0.0.1', 4],
        ['0.0.1', 5],
      ]
    );
  });

  test('the end of the first half and the start of the second sit at the same x', () => {
    // They are the same place on the page and two different positions in the document, which
    // is exactly what a merge means.
    const layout = lay(load(DELETED_MARK), 'proposed');
    const ids = linesOf(layout)[0]!.spans.map((span) => span.range.paragraphId);
    const endOfFirst = caretAt(layout, { paragraphId: ids[0]!, offset: 6 }, measurer);
    const startOfSecond = caretAt(layout, { paragraphId: ids[1]!, offset: 0 }, measurer);
    expect(endOfFirst).not.toBeNull();
    expect(startOfSecond).not.toBeNull();
    expect(startOfSecond!.x).toBeCloseTo(endOfFirst!.x, 5);
  });

  test('a click in the second half lands in the second paragraph', () => {
    const layout = lay(load(DELETED_MARK), 'proposed');
    const worldSpan = linesOf(layout)[0]!.spans[1]!;
    const hit = hitTestSemantic(layout, {
      x: worldSpan.box.x + worldSpan.box.width / 2,
      y: worldSpan.box.y + worldSpan.box.height / 2,
      pageIndex: 0,
    });
    expect(hit).not.toBeNull();
    expect(shortId(hit!.position.paragraphId)).toBe('0.0.1');
    expect(hit!.position.offset).toBeGreaterThan(0);
  });

  test('a click in the first half still lands in the first paragraph', () => {
    const layout = lay(load(DELETED_MARK), 'proposed');
    const helloSpan = linesOf(layout)[0]!.spans[0]!;
    const hit = hitTestSemantic(layout, {
      x: helloSpan.box.x + 2,
      y: helloSpan.box.y + helloSpan.box.height / 2,
      pageIndex: 0,
    });
    expect(shortId(hit!.position.paragraphId)).toBe('0.0.0');
  });
});

describe('a cell is a story like any other', () => {
  const CELL_DOC =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
    '<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
    marked('<w:del w:id="1" w:author="A"/>', 'Hello ') +
    plain('world') +
    '</w:tc></w:tr></w:tbl>';

  const cellLines = (displayMode: RevisionDisplayMode) => {
    const layout = lay(load(CELL_DOC), displayMode);
    const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    if (table?.kind !== 'table') throw new Error('no table');
    return table.rows[0]!.cells[0]!.blocks.flatMap((block) =>
      block.kind === 'paragraph' ? block.lines : []
    );
  };

  test('the merge happens inside a cell, with identity intact', () => {
    // Tables are where negotiated text lives, so a tracked Enter inside one is not an exotic
    // case. The cell lane builds its own fragments, so it needs the remap of its own.
    const lines = cellLines('proposed');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('Hello world');
    expect(
      lines[0]!.spans.map((span) => [shortId(span.range.paragraphId), span.range.start])
    ).toEqual([
      ['0.0.0.2.0.1', 0],
      ['0.0.0.2.0.2', 0],
    ]);
  });

  test('all-markup keeps the two cell paragraphs apart', () => {
    expect(cellLines('all-markup')).toHaveLength(2);
  });
});

describe('what reads a merged line reads its own paragraph', () => {
  // Everything below was published correctly and consumed wrongly: the spans named their own
  // paragraphs while the consumer walked the line whole, and both members count from zero.
  const MULTI_RUN =
    '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
    '<w:r><w:t xml:space="preserve">Hel</w:t></w:r>' +
    '<w:r><w:t xml:space="preserve">lo </w:t></w:r></w:p>' +
    plain('world');

  test('the text of each paragraph comes from its own spans', () => {
    const layout = lay(load(DELETED_MARK), 'proposed');
    const ids = linesOf(layout)[0]!.spans.map((span) => span.range.paragraphId);
    expect(paragraphTextFromLayout(layout, ids[0]!)).toBe('Hello ');
    expect(paragraphTextFromLayout(layout, ids[1]!)).toBe('world');
  });

  test('a member of several runs reports its whole extent', () => {
    // The line names the first member; its range must reach the end of THAT member, not stop
    // at its first run and not run on into the next member.
    const line = linesOf(lay(load(MULTI_RUN), 'proposed'))[0]!;
    expect(line.range.end).toBe(6);
    expect(paragraphTextFromLayout(lay(load(MULTI_RUN), 'proposed'), line.range.paragraphId)).toBe(
      'Hello '
    );
  });

  test('a selection inside the second half is highlighted', () => {
    const layout = lay(load(DELETED_MARK), 'proposed');
    const second = linesOf(layout)[0]!.spans[1]!.range.paragraphId;
    const rects = selectionRects(
      layout,
      {
        anchor: { paragraphId: second, offset: 0 },
        head: { paragraphId: second, offset: 5 },
      },
      documentOrder(layout)
    );
    expect(rects).toHaveLength(1);
    expect(rects[0]!.width).toBeGreaterThan(0);
    expect(
      spansInSelection(
        layout,
        {
          anchor: { paragraphId: second, offset: 0 },
          head: { paragraphId: second, offset: 5 },
        },
        documentOrder(layout)
      ).map((span) => span.text)
    ).toEqual(['world']);
  });

  test('a selection across the join covers both halves', () => {
    const layout = lay(load(DELETED_MARK), 'proposed');
    const ids = linesOf(layout)[0]!.spans.map((span) => span.range.paragraphId);
    const rects = selectionRects(
      layout,
      {
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[1]!, offset: 5 },
      },
      documentOrder(layout)
    );
    const covered = rects.reduce((total, rect) => total + rect.width, 0);
    const line = linesOf(layout)[0]!;
    const lineWidth = line.spans.reduce((total, span) => total + span.box.width, 0);
    expect(covered).toBeCloseTo(lineWidth, 1);
  });
});

describe('a group that cannot be measured is not merged', () => {
  // The merge places one member's characters at an offset taken from the store and reads them
  // back out of spans the layout walk produced. Where those two disagree, merging would
  // publish one paragraph's text at another's offsets — worse than the break it removes.

  test('a field that straddles the mark keeps the paragraphs apart', () => {
    // Word writes a TOC this way: `begin` in one paragraph, `end` in a later one. Merged, the
    // field closes across the mark and swallows the whole second paragraph into one atom.
    const straddling =
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>Chapter One</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Chapter Two</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const layout = lay(load(straddling), 'proposed');
    const paragraphs = new Set(
      linesOf(layout).flatMap((line) => line.spans.map((span) => span.range.paragraphId))
    );
    // Both paragraphs still address themselves, which is the property worth keeping.
    expect(paragraphs.size).toBe(2);
  });

  test('content at the shared nesting cap is omitted before a paragraph merge', () => {
    // Store and layout both make content reached at the cap opaque. The struck paragraph mark
    // can therefore merge the later visible paragraph without publishing unaddressable text.
    const deep = (depth: number, inner: string): string =>
      depth === 0 ? inner : `<w:sdt><w:sdtContent>${deep(depth - 1, inner)}</w:sdtContent></w:sdt>`;
    const atTheCap =
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
      deep(32, '<w:r><w:t xml:space="preserve">deep </w:t></w:r>') +
      '</w:p>' +
      plain('world');
    expect(textPerLine(load(atTheCap), 'proposed')).toEqual(['world']);

    const belowTheCap =
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
      deep(3, '<w:r><w:t xml:space="preserve">deep </w:t></w:r>') +
      '</w:p>' +
      plain('world');
    expect(textPerLine(load(belowTheCap), 'proposed')).toEqual(['deep world']);
  });

  test('markup that only looks like a revision merges nothing', () => {
    // A `.docx` is a zip of XML the sender controls. Matching the mark by local name alone —
    // at any level — let foreign markup join two paragraphs in the default view, a join no
    // decision in the file can produce and no Accept can undo.
    const spoofed = [
      '<w:pPr><x:rPr xmlns:x="urn:x"><w:del w:id="1" w:author="A"/></x:rPr></w:pPr>',
      '<x:pPr xmlns:x="urn:x"><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></x:pPr>',
      '<w:pPr><w:rPr><x:del xmlns:x="urn:x" w:id="1" w:author="A"/></w:rPr></w:pPr>',
    ];
    for (const pPr of spoofed) {
      const part = load(
        `<w:p>${pPr}<w:r><w:t xml:space="preserve">Hello </w:t></w:r></w:p>` + plain('world')
      );
      expect(textPerLine(part, 'proposed')).toEqual(['Hello ', 'world']);
    }
  });
});

describe('a click past the end of a merged line', () => {
  test('lands at the end of the paragraph under the pointer', () => {
    // The offset comes from a walk over the whole line and the paragraph from the segment
    // under the pointer, so without a clamp the two were counted in different paragraphs and
    // a click in the margin produced an offset the second paragraph does not have.
    const layout = lay(load(DELETED_MARK), 'proposed');
    const line = linesOf(layout)[0]!;
    const hit = hitTestSemantic(layout, {
      x: line.box.x + line.box.width + 200,
      y: line.box.y + line.box.height / 2,
      pageIndex: 0,
    });
    expect(shortId(hit!.position.paragraphId)).toBe('0.0.1');
    expect(hit!.position.offset).toBe(5);
  });
});

describe('a field that closes in an earlier paragraph', () => {
  test('does not read as balanced', () => {
    // Counting a net let an `end` with no `begin` cancel a later `begin`, so a paragraph that
    // both closes one field and opens another read as balanced and merged anyway.
    const closesThenOpens =
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:rPr><w:del w:id="2" w:author="A"/></w:rPr></w:pPr>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:t xml:space="preserve">TWO</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>' +
      plain('three');
    const spans = linesOf(lay(load(closesThenOpens), 'proposed')).flatMap((line) => line.spans);
    const two = spans.find((span) => span.text.includes('TWO'));
    // `TWO` addresses its own paragraph from offset 0, whatever the fields around it do.
    expect(two?.range.start).toBe(0);
  });
});

describe('a merged member is still findable by the things that index paragraphs', () => {
  test('lineAtPosition answers for both members', () => {
    // An inline image is resolved through this, so a member it could not answer for was a
    // picture in the merged half that could not be selected.
    const layout = lay(load(DELETED_MARK), 'proposed');
    const ids = linesOf(layout)[0]!.spans.map((span) => span.range.paragraphId);
    expect(lineAtPosition(layout, ids[0]!, 3)).not.toBeNull();
    expect(lineAtPosition(layout, ids[1]!, 3)).not.toBeNull();
    expect(lineAtPosition(layout, ids[1]!, 0)).not.toBeNull();
  });

  test('the review rail can anchor a card in either member', () => {
    const layout = lay(load(DELETED_MARK), 'proposed');
    const ids = linesOf(layout)[0]!.spans.map((span) => span.range.paragraphId);
    const anchors = reviewAnchorIndex(layout, (page) =>
      page.fragments.filter((fragment) => fragment.kind === 'paragraph')
    );
    expect(anchors.has(ids[0]!)).toBe(true);
    expect(anchors.has(ids[1]!)).toBe(true);
  });
});
