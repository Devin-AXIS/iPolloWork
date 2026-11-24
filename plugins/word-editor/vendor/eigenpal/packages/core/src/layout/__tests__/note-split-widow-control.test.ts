// `w:widowControl` governs a note paragraph exactly as it governs a body one.
//
// `note-splitting.ts` used to cut at any line boundary, so a three-line endnote with room
// for two kept two lines and stranded the third on the next page. The reference moves the
// whole note instead: a corpus document scored 1.268 % against it, and its next page compounded
// the error by drawing a continuation separator where the reference opens a fresh area.
import { describe, expect, test } from 'bun:test';
import { splitNoteFragments } from '../note-splitting.ts';
import type { NoteStoryLayout } from '../note-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const LINE = 12;

function paragraph(lineCount: number, props: ParagraphFragmentRecord['props'] = []) {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    index: i,
    box: { x: 0, y: i * LINE, width: 100, height: LINE },
    baseline: LINE - 3,
    range: { paragraphId: 'p1', start: i * 10, end: i * 10 + 9 },
    spans: [],
  }));
  return {
    kind: 'paragraph',
    id: 'p1#f0',
    paragraphId: 'p1',
    fragmentIndex: 0,
    paragraphEnd: true,
    props,
    range: { paragraphId: 'p1', start: 0, end: lineCount * 10 },
    spacing: { before: 0, after: 0 },
    box: { x: 0, y: 0, width: 100, height: lineCount * LINE },
    lines,
  } as unknown as ParagraphFragmentRecord;
}

function story(fragment: ParagraphFragmentRecord): NoteStoryLayout {
  return {
    noteKind: 'endnote',
    noteId: 1,
    scopeId: 'endnote:1',
    noteType: undefined,
    fragments: [fragment],
    flowHeight: fragment.box.height,
  } as unknown as NoteStoryLayout;
}

const FULL_COLUMN = LINE * 20;

describe('note splitting honours widow control', () => {
  test('a three-line note with room for two moves whole', () => {
    const split = splitNoteFragments(story(paragraph(3)), LINE * 2, {
      fullContentHeight: FULL_COLUMN,
    });
    expect(split.head).toHaveLength(0);
    expect(split.tail).toHaveLength(1);
  });

  test('a four-line note with room for three leaves two and carries two', () => {
    const split = splitNoteFragments(story(paragraph(4)), LINE * 3, {
      fullContentHeight: FULL_COLUMN,
    });
    expect((split.head[0] as ParagraphFragmentRecord).lines).toHaveLength(2);
    expect((split.tail[0] as ParagraphFragmentRecord).lines).toHaveLength(2);
  });

  test('a six-line note with room for four splits where it fits', () => {
    const split = splitNoteFragments(story(paragraph(6)), LINE * 4, {
      fullContentHeight: FULL_COLUMN,
    });
    expect((split.head[0] as ParagraphFragmentRecord).lines).toHaveLength(4);
    expect((split.tail[0] as ParagraphFragmentRecord).lines).toHaveLength(2);
  });

  test('`w:widowControl w:val="0"` opts out and the cut stays where it fell', () => {
    const off = [
      { localName: 'widowControl', attributes: { val: '0' } },
    ] as unknown as ParagraphFragmentRecord['props'];
    const split = splitNoteFragments(story(paragraph(3, off)), LINE * 2, {
      fullContentHeight: FULL_COLUMN,
    });
    expect((split.head[0] as ParagraphFragmentRecord).lines).toHaveLength(2);
    expect((split.tail[0] as ParagraphFragmentRecord).lines).toHaveLength(1);
  });

  test('fails open when the note already has the full column, so it cannot loop', () => {
    const split = splitNoteFragments(story(paragraph(3)), LINE * 2, {
      fullContentHeight: LINE * 2,
    });
    expect((split.head[0] as ParagraphFragmentRecord).lines).toHaveLength(2);
    expect((split.tail[0] as ParagraphFragmentRecord).lines).toHaveLength(1);
  });
});
