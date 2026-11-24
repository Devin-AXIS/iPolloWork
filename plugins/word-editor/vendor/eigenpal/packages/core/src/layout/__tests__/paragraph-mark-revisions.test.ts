// What a tracked PARAGRAPH MARK publishes, and where.
//
// The mark is `w:pPr/w:rPr/w:ins|w:del` (ECMA-376 §17.13.5.20, §17.13.5.15). It decorates no
// character, so a fragment carries it rather than a span, and nothing else in the layout moves
// when it changes. Every gap below shipped as silence: a decision a reader could not see.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphMarkRevisionsOf, type RevisionDisplayMode } from '../revision-projection.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

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

/** Every paragraph fragment on every page, cells included. */
function paragraphFragments(
  part: OoxmlPart,
  mode?: RevisionDisplayMode
): ParagraphFragmentRecord[] {
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    ...(mode ? { displayMode: mode } : {}),
  });
  const found: ParagraphFragmentRecord[] = [];
  const walk = (fragments: readonly { kind: string }[]): void => {
    for (const fragment of fragments) {
      if (fragment.kind === 'paragraph') found.push(fragment as ParagraphFragmentRecord);
      if (fragment.kind === 'table') {
        for (const row of (
          fragment as {
            rows: readonly { cells: readonly { blocks: readonly { kind: string }[] }[] }[];
          }
        ).rows) {
          for (const cell of row.cells) walk(cell.blocks);
        }
      }
    }
  };
  for (const page of layout.pages) walk(page.fragments);
  return found;
}

const MARKED = (rPr: string, text = 'paragraph text') =>
  `<w:p><w:pPr><w:rPr>${rPr}</w:rPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('a paragraph mark can carry more than one decision', () => {
  test('both halves of an insert-then-delete pair are projected, in file order', () => {
    // `EG_ParaRPrTrackChanges` is `ins? del? moveFrom? moveTo?`, and this engine's own writer
    // emits the first two together: B proposing removal of a break A proposed adding. Reading
    // only the first hid B's decision from the PAGE. The review pane reads the tree directly
    // and always listed both, which is the worse shape: a card for a change nothing showed.
    const part = load(MARKED('<w:ins w:id="7" w:author="A"/><w:del w:id="8" w:author="B"/>'));
    const body = part.root.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'body'
    )!;
    const paragraph = (body as { children: readonly { kind: string }[] }).children.find(
      (child) => child.kind === 'paragraph'
    )!;
    expect(paragraphMarkRevisionsOf(paragraph as never)).toEqual([
      { kind: 'insert', id: '7', author: 'A', nodeId: expect.any(String) },
      { kind: 'delete', id: '8', author: 'B', nodeId: expect.any(String) },
    ]);
    expect(paragraphFragments(part)[0]?.markRevisions).toHaveLength(2);
  });

  test('an unmarked paragraph publishes nothing at all', () => {
    expect(
      paragraphFragments(load('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'))[0]?.markRevisions
    ).toBeUndefined();
  });
});

describe('a mark inside a table cell is a mark', () => {
  // `CT_Tbl` declares `w:tblPr` without `minOccurs`, so it is required, and Word writes
  // `w:tcW` on every cell. A fixture the reader happens to accept is still a document Word
  // would call damaged.
  const CELL_DOC =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
    '<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
    MARKED('<w:del w:id="3" w:author="A"/>', 'cell paragraph') +
    '</w:tc></w:tr></w:tbl>';

  test('the cell lane publishes it, as the body lane does', () => {
    // The cell lane builds its own paragraph fragment. It did not write this field, so a
    // tracked split or merge inside a `w:tc` drew no pilcrow, no margin rule, and raised no
    // review card — in a document type where tables hold most of the negotiated text.
    const marks = paragraphFragments(load(CELL_DOC)).flatMap(
      (fragment) => fragment.markRevisions ?? []
    );
    expect(marks).toEqual([{ kind: 'delete', id: '3', author: 'A', nodeId: expect.any(String) }]);
  });
});

describe('a resolved view shows no attribution', () => {
  // Word draws the mark in All Markup only. `proposed` and `original` answer what the document
  // WOULD be once every decision is taken, and a document that has taken them has nothing left
  // to attribute.
  for (const mode of ['proposed', 'original'] as const) {
    test(`${mode} publishes no mark revision`, () => {
      const part = load(MARKED('<w:ins w:id="7" w:author="A"/>'));
      expect(paragraphFragments(part, mode)[0]?.markRevisions).toBeUndefined();
    });
  }

  test('all-markup publishes it', () => {
    const part = load(MARKED('<w:ins w:id="7" w:author="A"/>'));
    expect(paragraphFragments(part, 'all-markup')[0]?.markRevisions).toHaveLength(1);
  });
});

describe('a moved paragraph carries its mark like any other', () => {
  // `EG_ParaRPrTrackChanges` is `ins? del? moveFrom? moveTo?`. Word writes `w:moveFrom` on the
  // mark of the copy the paragraph left and `w:moveTo` on the copy it arrived at, so a move of
  // whole paragraphs is recorded on the mark and nowhere else.
  test('both move halves are projected', () => {
    const from = paragraphFragments(load(MARKED('<w:moveFrom w:id="4" w:author="A"/>')));
    const to = paragraphFragments(load(MARKED('<w:moveTo w:id="5" w:author="A"/>')));
    expect(from[0]?.markRevisions).toEqual([
      { kind: 'moveFrom', id: '4', author: 'A', nodeId: expect.any(String) },
    ]);
    expect(to[0]?.markRevisions).toEqual([
      { kind: 'moveTo', id: '5', author: 'A', nodeId: expect.any(String) },
    ]);
  });

  test('the half that REMOVES the mark is the one a single-value reader sees', () => {
    // `moveFrom` is a removal — accepting the move takes this copy of the break away — so it
    // must win the same way a deletion does, or the glyph and the margin rule disagree.
    const both = load(MARKED('<w:ins w:id="6" w:author="A"/><w:moveFrom w:id="4" w:author="B"/>'));
    expect(paragraphFragments(both)[0]?.markRevision).toMatchObject({
      kind: 'moveFrom',
      author: 'B',
    });
  });
});

describe('a format change on the mark reaches the page', () => {
  // `w:rPrChange` on `w:pPr/w:rPr` (§17.13.5.32) is the mark's own formatting changing under
  // tracking. It draws no pilcrow — Word draws none either — but it needs geometry, or a
  // review card has no place on the page to point at.
  const CHANGED =
    '<w:p><w:pPr><w:rPr><w:b/>' +
    '<w:rPrChange w:id="11" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr/></w:rPrChange>' +
    '</w:rPr></w:pPr><w:r><w:t>paragraph text</w:t></w:r></w:p>';

  test('it is published, with its own provenance', () => {
    expect(paragraphFragments(load(CHANGED))[0]?.markFormatRevision).toEqual({
      kind: 'format',
      id: '11',
      author: 'A',
      date: '2026-01-01T00:00:00Z',
      nodeId: expect.any(String),
    });
  });

  test('a resolved view publishes none of it', () => {
    expect(paragraphFragments(load(CHANGED), 'proposed')[0]?.markFormatRevision).toBeUndefined();
  });
});
