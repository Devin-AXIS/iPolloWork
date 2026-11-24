// A header is a story, and a story is laid out in a display mode.
//
// The inline flow always received the mode, so a deleted run vanished from a header in the
// resolved views. The BLOCK list did not, so a paragraph a tracked mark merges away kept its
// own line and a paragraph a revision removed entirely kept a blank one — in the view the free
// engine renders by default, on the part a reader sees on every page.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const measurer = createFixedMeasurer(6, 14);

function header(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:hdr xmlns:w="${WML_NAMESPACE_URI}">${body}</w:hdr>`, {
    name: '/word/header1.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const textPerLine = (part: OoxmlPart, displayMode: RevisionDisplayMode): string[] =>
  layoutHeaderFooterStory(
    part,
    468,
    measurer,
    'test',
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    displayMode
  )
    .fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
    .map((line) => line.spans.map((span) => span.text).join(''));

const MARK_DELETED =
  '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
  '<w:r><w:t xml:space="preserve">Head </w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Tail</w:t></w:r></w:p>';

describe('a header answers the display mode with its blocks as well as its runs', () => {
  test('a tracked paragraph mark merges in the resolved view', () => {
    expect(textPerLine(header(MARK_DELETED), 'proposed')).toEqual(['Head Tail']);
    expect(textPerLine(header(MARK_DELETED), 'all-markup')).toEqual(['Head ', 'Tail']);
  });

  test('a paragraph a revision removed leaves no blank line behind', () => {
    // Mark deleted AND nothing left to render: Word shows no line where the paragraph was.
    const emptied =
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
      '<w:del w:id="2" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>' +
      '<w:p><w:r><w:t>Tail</w:t></w:r></w:p>';
    expect(textPerLine(header(emptied), 'proposed')).toEqual(['Tail']);
  });

  test('the identity of each member survives into the header story', () => {
    const fragments = layoutHeaderFooterStory(
      header(MARK_DELETED),
      468,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      'proposed'
    ).fragments;
    const spans = fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
    );
    expect(spans.map((span) => [span.text, span.range.start])).toEqual([
      ['Head ', 0],
      ['Tail', 0],
    ]);
    // Two paragraphs, each addressing itself, drawn as one.
    expect(new Set(spans.map((span) => span.range.paragraphId)).size).toBe(2);
  });
});

describe('a header draws its own tracked mark', () => {
  test('All Markup publishes the mark, so the page can draw a pilcrow and a change bar', () => {
    // Furniture is laid out through deps that do not always carry a display mode. Reading an
    // unset mode as "not All Markup" left a header's own tracked break with no attribution at
    // all: no pilcrow, no rule in the margin, while the review pane listed a card for it.
    const story = layoutHeaderFooterStory(header(MARK_DELETED), 468, measurer, 'test');
    const marks = story.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? (fragment.markRevisions ?? []) : []
    );
    expect(marks.map((mark) => mark.kind)).toEqual(['delete']);
  });

  test('a resolved view draws none of it, and merges instead', () => {
    const story = layoutHeaderFooterStory(
      header(MARK_DELETED),
      468,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      'proposed'
    );
    const marks = story.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? (fragment.markRevisions ?? []) : []
    );
    expect(marks).toEqual([]);
    expect(textPerLine(header(MARK_DELETED), 'proposed')).toEqual(['Head Tail']);
  });
});
