// scopedDocumentOrder: body path must reuse memoized documentOrder identity;
// HF / note scopes stay story-bounded and must not leak body paragraph ids.

import { describe, expect, test } from 'bun:test';
import { documentOrder } from '../../layout/semantic-interaction.ts';
import type {
  HeaderFooterStoryRecord,
  NoteAreaRecord,
  NoteStoryRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../../layout/semantic-records.ts';
import {
  clampSelectionToScope,
  scopedDocumentOrder,
  type HeaderFooterScopeBinding,
} from '../surface-scope.ts';

function para(paragraphId: string): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${paragraphId}#f0`,
    paragraphId,
    fragmentIndex: 0,
    range: { start: 0, end: 1 },
    props: [],
    spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
    indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
    lines: [],
    box: { x: 0, y: 0, width: 100, height: 14 },
  } as unknown as ParagraphFragmentRecord;
}

function story(
  kind: 'header' | 'footer',
  rId: string,
  fragments: readonly ParagraphFragmentRecord[]
): HeaderFooterStoryRecord {
  return {
    kind,
    variant: 'default',
    partName: kind === 'header' ? '/word/header1.xml' : '/word/footer1.xml',
    rId,
    box: { x: 0, y: 0, width: 100, height: 20 },
    fragments,
  };
}

function noteArea(
  scopeId: string,
  noteKind: 'footnote' | 'endnote',
  fragments: readonly ParagraphFragmentRecord[]
): NoteAreaRecord {
  const note: NoteStoryRecord = {
    noteKind,
    noteId: 1,
    scopeId,
    mark: '1',
    box: { x: 0, y: 700, width: 100, height: 20 },
    fragments,
  };
  return {
    kind: noteKind === 'footnote' ? 'footnotes' : 'endnotes',
    placement: 'pageBottom',
    box: { x: 0, y: 700, width: 100, height: 20 },
    notes: [note],
  };
}

function largeBodyLayout(paragraphCount: number): SemanticLayout {
  const pages = [];
  const perPage = 40;
  const pageCount = Math.ceil(paragraphCount / perPage);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const start = pageIndex * perPage;
    const count = Math.min(perPage, paragraphCount - start);
    pages.push({
      id: `page-${pageIndex}`,
      index: pageIndex,
      box: { x: 0, y: pageIndex * 800, width: 612, height: 792 },
      contentBox: { x: 72, y: pageIndex * 800 + 72, width: 468, height: 648 },
      fragments: Array.from({ length: count }, (_, i) =>
        para(`/word/document.xml#0.${pageIndex}.${i}`)
      ),
    });
  }
  return { revision: 1, pages };
}

function scopedLayout(): SemanticLayout {
  return {
    revision: 1,
    pages: [
      {
        id: 'page-0',
        index: 0,
        box: { x: 0, y: 0, width: 612, height: 792 },
        contentBox: { x: 72, y: 72, width: 468, height: 648 },
        fragments: [para('/word/document.xml#0.0.0'), para('/word/document.xml#0.0.1')],
        header: story('header', 'rIdH', [
          para('/word/header1.xml#0.0.0'),
          para('/word/header1.xml#0.0.1'),
        ]),
        footer: story('footer', 'rIdF', [para('/word/footer1.xml#0.0.0')]),
        footnotes: noteArea('footnote:1', 'footnote', [
          para('/word/footnotes.xml#0.2.0'),
          para('/word/footnotes.xml#0.2.1'),
        ]),
      },
      {
        // Shared header copy on page 1 — order must dedupe by paragraph id.
        id: 'page-1',
        index: 1,
        box: { x: 0, y: 800, width: 612, height: 792 },
        contentBox: { x: 72, y: 872, width: 468, height: 648 },
        fragments: [para('/word/document.xml#0.1.0')],
        header: story('header', 'rIdH', [
          para('/word/header1.xml#0.0.0'),
          para('/word/header1.xml#0.0.1'),
        ]),
      },
    ],
  };
}

const headerBinding: HeaderFooterScopeBinding = {
  scope: { kind: 'headerFooter', rId: 'rIdH' },
  pageIndex: 0,
  kind: 'header',
  partName: '/word/header1.xml',
  variant: 'default',
};

describe('scopedDocumentOrder body cache identity', () => {
  test('body/no-note path returns documentOrder by identity', () => {
    const layout = largeBodyLayout(200);
    const memo = documentOrder(layout);
    const first = scopedDocumentOrder(layout, null, null);
    const second = scopedDocumentOrder(layout, null);
    expect(first).toBe(memo);
    expect(second).toBe(memo);
    expect(first).toBe(second);
  });

  test('repeated body calls do not rebuild (stable identity across N calls)', () => {
    const layout = largeBodyLayout(2000);
    const first = scopedDocumentOrder(layout, null, null);
    for (let i = 0; i < 100; i++) {
      expect(scopedDocumentOrder(layout, null, null)).toBe(first);
    }
  });

  test('large synthetic body: operation-count stays O(1) after warm via identity', () => {
    const layout = largeBodyLayout(2000);
    const warm = scopedDocumentOrder(layout, null, null);
    const started = performance.now();
    let hits = 0;
    const ITER = 500;
    for (let i = 0; i < ITER; i++) {
      if (scopedDocumentOrder(layout, null, null) === warm) hits += 1;
    }
    const elapsed = performance.now() - started;
    expect(hits).toBe(ITER);
    // Identity path must stay well under a full-document rebuild budget.
    expect(elapsed).toBeLessThan(20);
  });
});

describe('scopedDocumentOrder HF / note bounds', () => {
  test('header scope lists only header paragraphs, deduped across page copies', () => {
    const layout = scopedLayout();
    expect(scopedDocumentOrder(layout, headerBinding, null)).toEqual([
      '/word/header1.xml#0.0.0',
      '/word/header1.xml#0.0.1',
    ]);
  });

  test('note scope lists the paragraphs of its note story', () => {
    const layout = scopedLayout();
    expect(scopedDocumentOrder(layout, null, 'footnote:1')).toEqual([
      '/word/footnotes.xml#0.2.0',
      '/word/footnotes.xml#0.2.1',
    ]);
  });

  test('note scope spans every note of its kind and no note of the other kind', () => {
    // The footnotes part is one story (ECMA-376 Part 1 §17.11): a selection from footnote 1 extends into footnote 2,
    // but never into an endnote, which is the other story.
    const layout = scopedLayout();
    const page = layout.pages[0]!;
    const second: NoteStoryRecord = {
      ...page.footnotes!.notes[0]!,
      noteId: 2,
      scopeId: 'footnote:2',
      mark: '2',
      fragments: [para('/word/footnotes.xml#0.3.0')],
    };
    const multi: SemanticLayout = {
      ...layout,
      pages: [
        {
          ...page,
          footnotes: { ...page.footnotes!, notes: [...page.footnotes!.notes, second] },
          endnotes: noteArea('endnote:1', 'endnote', [para('/word/endnotes.xml#0.2.0')]),
        },
        layout.pages[1]!,
      ],
    };
    const footnoteStory = [
      '/word/footnotes.xml#0.2.0',
      '/word/footnotes.xml#0.2.1',
      '/word/footnotes.xml#0.3.0',
    ];
    expect(scopedDocumentOrder(multi, null, 'footnote:1')).toEqual(footnoteStory);
    expect(scopedDocumentOrder(multi, null, 'footnote:2')).toEqual(footnoteStory);
    expect(scopedDocumentOrder(multi, null, 'endnote:1')).toEqual(['/word/endnotes.xml#0.2.0']);
  });

  test('HF / note orders are not the memoized body documentOrder', () => {
    const layout = scopedLayout();
    const body = documentOrder(layout);
    const header = scopedDocumentOrder(layout, headerBinding);
    const note = scopedDocumentOrder(layout, null, 'footnote:1');
    expect(header).not.toBe(body);
    expect(note).not.toBe(body);
    expect(header).not.toEqual(body);
    expect(note).not.toEqual(body);
  });

  test('clampSelectionToScope redirects out-of-scope endpoints into the story', () => {
    const layout = scopedLayout();
    const clamped = clampSelectionToScope(
      layout,
      {
        anchor: { paragraphId: '/word/document.xml#0.0.0', offset: 3 },
        head: { paragraphId: '/word/document.xml#0.0.1', offset: 1 },
      },
      headerBinding
    );
    expect(clamped).toEqual({
      anchor: { paragraphId: '/word/header1.xml#0.0.0', offset: 0 },
      head: { paragraphId: '/word/header1.xml#0.0.0', offset: 0 },
    });
  });

  test('body clamp leaves in-document selection untouched', () => {
    const layout = scopedLayout();
    const selection = {
      anchor: { paragraphId: '/word/document.xml#0.0.0', offset: 2 },
      head: { paragraphId: '/word/document.xml#0.0.1', offset: 4 },
    };
    expect(clampSelectionToScope(layout, selection, null, null)).toEqual(selection);
  });
});
