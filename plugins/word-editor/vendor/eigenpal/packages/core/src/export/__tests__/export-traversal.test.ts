import { expect, test } from 'bun:test';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TableFragmentRecord,
} from '../../layout/semantic-records.ts';
import {
  forEachSemanticDrawing,
  forEachSemanticSpan,
  forEachSemanticStory,
} from '../../layout/export-traversal.ts';

function span(paragraphId: string, text: string, projected = false): StyleSpanRecord {
  return {
    range: { paragraphId, start: 0, end: text.length },
    text,
    style: {},
    box: { x: 1, y: 2, width: Math.max(1, text.length), height: 10 },
    ...(projected ? { projected: true } : {}),
  } as unknown as StyleSpanRecord;
}

function paragraph(
  paragraphId: string,
  spans: readonly StyleSpanRecord[],
  lineParagraphId = paragraphId
): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    paragraphId,
    lines: [
      {
        range: { paragraphId: lineParagraphId, start: 0, end: 1 },
        spans,
        drawings: [],
      },
    ],
  } as unknown as ParagraphFragmentRecord;
}

test('traverses canonical story segments and exposes authored identities through repeats', () => {
  const merged = paragraph(
    'survivor',
    [span('absorbed', 'A'), span('survivor', 'B', true)],
    'absorbed'
  );
  const headerParagraph = paragraph('header-p', [span('header-p', 'H')]);
  const table = (fragmentIndex: number, repeat: boolean): TableFragmentRecord =>
    ({
      kind: 'table',
      tableId: 'table',
      fragmentIndex,
      rows: [
        {
          id: 'header-row',
          isHeaderRow: true,
          isHeaderRepeat: repeat,
          cells: [{ gridColumn: 0, gridSpan: 1, blocks: [headerParagraph] }],
        },
      ],
    }) as unknown as TableFragmentRecord;
  const layout = {
    pages: [
      { index: 0, fragments: [merged, table(0, false)] },
      { index: 1, fragments: [table(1, true)] },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<{ paragraphId: string; projected: boolean; sourceRange: unknown }> = [];

  forEachSemanticSpan(layout, ({ paragraphId, span: current, sourceRange }) => {
    visits.push({ paragraphId, projected: current.projected === true, sourceRange });
  });

  expect(visits.map((visit) => visit.paragraphId)).toEqual([
    'absorbed',
    'survivor',
    'header-p',
    'header-p',
  ]);
  expect(visits[0]?.sourceRange).toEqual({ paragraphId: 'absorbed', start: 0, end: 1 });
  expect(visits[1]).toMatchObject({ paragraphId: 'survivor', projected: true, sourceRange: null });
});

test('traverses textbox stories anchored from body and page furniture', () => {
  const textboxDrawing = (paragraphId: string, text: string) =>
    ({
      kind: 'anchoredDrawing',
      drawingNodeId: `${paragraphId}-owner`,
      x: 10,
      y: 20,
      paintBounds: { x: 9, y: 19, width: 12, height: 22 },
      hitBounds: { x: 10, y: 20, width: 10, height: 20 },
      behindDocument: false,
      textboxStory: {
        contentOffset: { x: 3, y: 4 },
        fragments: [paragraph(paragraphId, [span(paragraphId, text)])],
      },
    }) as unknown as NonNullable<SemanticLayout['pages'][number]['anchoredDrawings']>[number];
  const layout = {
    pages: [
      {
        index: 0,
        box: { x: 0, y: 100, width: 600, height: 800 },
        contentBox: { x: 50, y: 160, width: 500, height: 680 },
        fragments: [],
        anchoredDrawings: [textboxDrawing('body-textbox', 'B')],
        header: {
          box: { x: 7, y: 8, width: 500, height: 40 },
          fragments: [],
          anchoredDrawings: [
            {
              ...textboxDrawing('header-textbox', 'H'),
              horizontalFrame: 'page',
              verticalFrame: 'paragraph',
              horizontalFrameOrigin: -50,
              verticalFrameOrigin: 0,
            },
          ],
        },
        footer: {
          box: { x: 9, y: 700, width: 500, height: 40 },
          fragments: [],
          anchoredDrawings: [
            {
              ...textboxDrawing('footer-textbox', 'F'),
              horizontalFrame: 'column',
              verticalFrame: 'page',
              horizontalFrameOrigin: 0,
              verticalFrameOrigin: -60,
            },
          ],
        },
      },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<{
    story: string;
    rootStory: string;
    textboxDepth: number;
    paragraphId: string;
    storyOrigin: Readonly<{ x: number; y: number }>;
    absoluteBox: unknown;
    owner: unknown;
  }> = [];

  forEachSemanticSpan(
    layout,
    ({ story, rootStory, textboxDepth, paragraphId, textboxOwner, storyOrigin, absoluteBox }) =>
      visits.push({
        story,
        rootStory,
        textboxDepth,
        paragraphId,
        storyOrigin,
        absoluteBox,
        owner: textboxOwner,
      })
  );

  expect(visits).toEqual([
    {
      story: 'textbox',
      rootStory: 'body',
      textboxDepth: 1,
      paragraphId: 'body-textbox',
      storyOrigin: { x: 63, y: 184 },
      absoluteBox: { x: 64, y: 186, width: 1, height: 10 },
      owner: layout.pages[0]!.anchoredDrawings![0],
    },
    {
      story: 'textbox',
      rootStory: 'header',
      textboxDepth: 1,
      paragraphId: 'header-textbox',
      storyOrigin: { x: 63, y: 32 },
      absoluteBox: { x: 64, y: 34, width: 1, height: 10 },
      owner: layout.pages[0]!.header!.anchoredDrawings![0],
    },
    {
      story: 'textbox',
      rootStory: 'footer',
      textboxDepth: 1,
      paragraphId: 'footer-textbox',
      storyOrigin: { x: 22, y: 184 },
      absoluteBox: { x: 23, y: 186, width: 1, height: 10 },
      owner: layout.pages[0]!.footer!.anchoredDrawings![0],
    },
  ]);

  const drawingOrigins: Array<{ rootStory: string; origin: unknown }> = [];
  forEachSemanticDrawing(layout, (visit) => {
    if (visit.textboxDepth === 0) {
      drawingOrigins.push({ rootStory: visit.rootStory, origin: visit.drawingOrigin });
    }
  });
  expect(drawingOrigins).toEqual([
    { rootStory: 'body', origin: { x: 60, y: 180 } },
    { rootStory: 'header', origin: { x: 60, y: 28 } },
    { rootStory: 'footer', origin: { x: 19, y: 180 } },
  ]);
});

test('enumerates every root story through one page authority', () => {
  const story = { fragments: [] };
  const layout = {
    pages: [
      {
        index: 0,
        fragments: [],
        header: story,
        footer: story,
        footnotes: {
          separator: story,
          notes: [{ noteKind: 'footnote', scopeId: 'footnote:1', fragments: [] }],
        },
        endnotes: {
          separator: story,
          notes: [{ noteKind: 'endnote', scopeId: 'endnote:2', fragments: [] }],
        },
      },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<[string, string | null]> = [];

  forEachSemanticStory(layout, ({ story: kind, noteScopeId }) => {
    visits.push([kind, noteScopeId]);
  });

  expect(visits).toEqual([
    ['body', null],
    ['header', null],
    ['footer', null],
    ['note-separator', null],
    ['footnote', 'footnote:1'],
    ['note-separator', null],
    ['endnote', 'endnote:2'],
  ]);
});

test('drawing traversal preserves root story, textbox ownership, paragraph, and line', () => {
  const nestedParagraph = paragraph('textbox-p', [span('textbox-p', 'T')]);
  const nestedInline = {
    kind: 'inlineDrawing',
    drawingNodeId: 'nested-inline',
    paragraphId: 'textbox-p',
    x: 5,
    y: 6,
    paintBounds: { x: 4, y: 5, width: 8, height: 9 },
    hitBounds: { x: 5, y: 6, width: 7, height: 8 },
    resource: { kind: 'missing' },
  };
  (nestedParagraph.lines[0]!.drawings as unknown as unknown[]).push(nestedInline);
  const owner = {
    kind: 'anchoredDrawing',
    drawingNodeId: 'textbox-owner',
    x: 10,
    y: 20,
    paintBounds: { x: 9, y: 19, width: 12, height: 22 },
    hitBounds: { x: 10, y: 20, width: 10, height: 20 },
    resource: { kind: 'missing' },
    behindDocument: true,
    textboxStory: { contentOffset: { x: 3, y: 4 }, fragments: [nestedParagraph] },
  };
  const layout = {
    pages: [
      {
        index: 0,
        box: { x: 0, y: 100, width: 600, height: 800 },
        contentBox: { x: 50, y: 160, width: 500, height: 680 },
        fragments: [],
        anchoredDrawings: [owner],
      },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<Record<string, unknown>> = [];

  forEachSemanticDrawing(layout, (visit) => {
    visits.push({
      id: visit.drawing.drawingNodeId,
      story: visit.story,
      rootStory: visit.rootStory,
      root: visit.root,
      storyOrigin: visit.storyOrigin,
      drawingOrigin: visit.drawingOrigin,
      absolutePaintBounds: visit.absolutePaintBounds,
      paintLayer: visit.paintLayer,
      depth: visit.textboxDepth,
      owner: visit.textboxOwner,
      path: visit.textboxPath,
      paragraph: visit.paragraph,
      line: visit.line,
    });
  });

  expect(visits[0]).toMatchObject({
    id: 'textbox-owner',
    story: 'body',
    rootStory: 'body',
    root: {
      host: layout.pages[0],
      box: layout.pages[0]!.contentBox,
      origin: { x: 50, y: 160 },
    },
    paintLayer: 'behind-text',
    storyOrigin: { x: 50, y: 160 },
    drawingOrigin: { x: 60, y: 180 },
    absolutePaintBounds: { x: 59, y: 179, width: 12, height: 22 },
    depth: 0,
    owner: null,
    path: [],
    paragraph: null,
    line: null,
  });
  expect(visits[1]).toMatchObject({
    id: 'nested-inline',
    story: 'textbox',
    rootStory: 'body',
    root: {
      host: layout.pages[0],
      box: layout.pages[0]!.contentBox,
      origin: { x: 50, y: 160 },
    },
    paintLayer: 'inline',
    storyOrigin: { x: 63, y: 184 },
    drawingOrigin: { x: 68, y: 190 },
    absolutePaintBounds: { x: 67, y: 189, width: 8, height: 9 },
    depth: 1,
    owner,
    path: [owner],
    paragraph: nestedParagraph,
    line: nestedParagraph.lines[0],
  });
});
