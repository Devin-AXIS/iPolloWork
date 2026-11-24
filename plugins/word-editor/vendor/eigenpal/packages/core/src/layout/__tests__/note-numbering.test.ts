// Derived note display numbers via shared formatNumFmt.

import { describe, expect, test } from 'bun:test';
import {
  deriveNoteDisplayMarks,
  deriveNoteDisplayMarksResolved,
  noteDisplayMarkMap,
} from '../note-numbering.ts';
import {
  DEFAULT_ENDNOTE_PROPERTIES,
  DEFAULT_FOOTNOTE_PROPERTIES,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  type AuthoredNoteProperties,
} from '../../store/package/note-properties.ts';

describe('note property resolution', () => {
  test('defaults when nothing authored', () => {
    expect(resolveFootnoteProperties()).toEqual(DEFAULT_FOOTNOTE_PROPERTIES);
    expect(resolveEndnoteProperties()).toEqual(DEFAULT_ENDNOTE_PROPERTIES);
  });

  test('section overrides document', () => {
    const document: AuthoredNoteProperties = { numFmt: 'decimal', numStart: 1 };
    const section: AuthoredNoteProperties = { numFmt: 'lowerRoman' };
    expect(resolveFootnoteProperties(section, document).numFmt).toBe('lowerRoman');
    expect(resolveFootnoteProperties(undefined, document).numFmt).toBe('decimal');
  });

  test('illegal endnote pageBottom falls back', () => {
    expect(resolveEndnoteProperties({ pos: 'pageBottom' }).pos).toBe('docEnd');
  });
});

describe('deriveNoteDisplayMarks', () => {
  test('continuous decimal sequence', () => {
    const marks = deriveNoteDisplayMarks(
      'footnote',
      [
        { noteId: 10, sectionIndex: 0 },
        { noteId: 11, sectionIndex: 0 },
        { noteId: 12, sectionIndex: 1 },
      ],
      DEFAULT_FOOTNOTE_PROPERTIES
    );
    expect(marks.map((m) => m.mark)).toEqual(['1', '2', '3']);
    expect(marks.map((m) => m.noteId)).toEqual([10, 11, 12]);
  });

  test('eachSect restarts', () => {
    const marks = deriveNoteDisplayMarks(
      'footnote',
      [
        { noteId: 1, sectionIndex: 0 },
        { noteId: 2, sectionIndex: 0 },
        { noteId: 3, sectionIndex: 1 },
      ],
      { ...DEFAULT_FOOTNOTE_PROPERTIES, numRestart: 'eachSect' }
    );
    expect(marks.map((m) => m.mark)).toEqual(['1', '2', '1']);
  });

  test('eachPage restarts when pageIndex known', () => {
    const marks = deriveNoteDisplayMarks(
      'footnote',
      [
        { noteId: 1, sectionIndex: 0, pageIndex: 0 },
        { noteId: 2, sectionIndex: 0, pageIndex: 0 },
        { noteId: 3, sectionIndex: 0, pageIndex: 1 },
      ],
      { ...DEFAULT_FOOTNOTE_PROPERTIES, numRestart: 'eachPage' }
    );
    expect(marks.map((m) => m.mark)).toEqual(['1', '2', '1']);
  });

  test('customMarkFollows suppresses a number', () => {
    const marks = deriveNoteDisplayMarks(
      'footnote',
      [
        { noteId: 1, sectionIndex: 0, customMarkFollows: true },
        { noteId: 2, sectionIndex: 0 },
      ],
      DEFAULT_FOOTNOTE_PROPERTIES
    );
    expect(marks[0]!.mark).toBeNull();
    expect(marks[1]!.mark).toBe('1');
  });

  test('Word-default endnote numFmt is lowerRoman (MS-OE376)', () => {
    expect(DEFAULT_ENDNOTE_PROPERTIES.numFmt).toBe('lowerRoman');
    const marks = deriveNoteDisplayMarks(
      'endnote',
      [
        { noteId: 1, sectionIndex: 0 },
        { noteId: 2, sectionIndex: 0 },
        { noteId: 3, sectionIndex: 0 },
        { noteId: 4, sectionIndex: 0 },
      ],
      DEFAULT_ENDNOTE_PROPERTIES
    );
    expect(marks.map((m) => m.mark)).toEqual(['i', 'ii', 'iii', 'iv']);
    expect(noteDisplayMarkMap(marks).get(4)).toBe('iv');
  });

  test('explicit decimal endnote numFmt still wins over Word default', () => {
    const marks = deriveNoteDisplayMarks(
      'endnote',
      [
        { noteId: 1, sectionIndex: 0 },
        { noteId: 2, sectionIndex: 0 },
      ],
      { ...DEFAULT_ENDNOTE_PROPERTIES, numFmt: 'decimal' }
    );
    expect(marks.map((m) => m.mark)).toEqual(['1', '2']);
  });

  test('section-scoped numFmt/numStart/numRestart resolve per reference section', () => {
    const sectionProps = [
      {
        ...DEFAULT_FOOTNOTE_PROPERTIES,
        numFmt: 'lowerRoman',
        numStart: 1,
        numRestart: 'eachSect' as const,
      },
      {
        ...DEFAULT_FOOTNOTE_PROPERTIES,
        numFmt: 'decimal',
        numStart: 5,
        numRestart: 'eachSect' as const,
      },
    ];
    const marks = deriveNoteDisplayMarksResolved(
      'footnote',
      [
        { noteId: 1, sectionIndex: 0 },
        { noteId: 2, sectionIndex: 0 },
        { noteId: 3, sectionIndex: 1 },
        { noteId: 4, sectionIndex: 1 },
      ],
      (sectionIndex) => sectionProps[sectionIndex] ?? DEFAULT_FOOTNOTE_PROPERTIES
    );
    expect(marks.map((m) => m.mark)).toEqual(['i', 'ii', '5', '6']);
  });
});
