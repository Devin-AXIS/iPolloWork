// A line break with `w:clear` resumes the text after it on the next line that the floating
// objects on the named side do not interrupt. `left` clears the floats that block the start of
// the break's line, `right` the floats past the pen, and `all` every float.

import { describe, expect, test } from 'bun:test';
import { bodyAnchorFrameBase } from '../body-flow-helpers.ts';
import { synthesizeParagraphWrapExclusionZones } from '../drawing-exclusion.ts';
import { WML_NAMESPACE_URI, readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import type { OoxmlHardBreakNode } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { anchoredDrawingsOf, linesOf, type SemanticLayout } from '../semantic-records.ts';
import {
  breakClearanceSkip,
  ownParagraphFramedClearZones,
  textWrappingBreakClearOf,
} from '../text-wrapping-break-clear.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const emu = (pt: number) => Math.round(pt * 12_700);
/** 12 pt lines at the default 10 pt size: the pitch every expectation below counts in. */
const measurer = createFixedMeasurer(6.6, 13.2);
const LINE = 12;

interface Float {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly wrap?: string;
  readonly behindDoc?: '0' | '1';
}

let nextId = 1;
function float(options: Float): string {
  const id = nextId++;
  const wrap = options.wrap ?? '<wp:wrapSquare wrapText="bothSides"/>';
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(options.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(options.y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(options.width)}" cy="${emu(options.height)}"/>` +
    wrap +
    `<wp:docPr id="${id}" name="pic${id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="${emu(options.width)}" cy="${emu(options.height)}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const br = (clear?: string, type: string | null = 'textWrapping') =>
  `<w:r><w:br${type ? ` w:type="${type}"` : ''}${clear ? ` w:clear="${clear}"` : ''}/></w:r>`;
const paragraph = (content: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;

/** Letter-sized page, 72 pt margins: a 468 by 648 pt content box. */
function layout(body: string, sectPr = ''): SemanticLayout {
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
      `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>${sectPr}</w:sectPr></w:body></w:document>`
  );
  return layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: layoutContext(part) });
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Page index and box of the line whose text starts with `prefix`. */
function lineAt(result: SemanticLayout, prefix: string) {
  for (const [pageIndex, page] of result.pages.entries()) {
    for (const line of linesOf({ ...result, pages: [page] })) {
      const text = line.spans.map((span) => span.text).join('');
      if (text.startsWith(prefix))
        return { pageIndex, y: round(line.box.y), x: round(line.contentX) };
    }
  }
  throw new Error(`no line starts with ${prefix}`);
}

const LEFT = { x: 0, y: 0, width: 100, height: 80 };
const RIGHT = { x: 368, y: 0, width: 100, height: 80 };

describe('reading w:clear', () => {
  const breakNode = (attributes: string): OoxmlHardBreakNode => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:br ${attributes}/></w:r></w:p></w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!result.ok) throw new Error(result.reason);
    const find = (node: { kind: string; children?: readonly unknown[] }): unknown =>
      node.kind === 'hardBreak'
        ? node
        : (node.children ?? []).map((child) => find(child as never)).find(Boolean);
    return find(result.part.root as never) as OoxmlHardBreakNode;
  };

  test('a text wrapping break or an untyped break carries its side', () => {
    expect(textWrappingBreakClearOf(breakNode('w:type="textWrapping" w:clear="all"'))).toBe('all');
    expect(textWrappingBreakClearOf(breakNode('w:clear="left"'))).toBe('left');
    expect(textWrappingBreakClearOf(breakNode('w:clear="right"'))).toBe('right');
  });

  test('none, an unknown value, and page or column breaks clear nothing', () => {
    expect(textWrappingBreakClearOf(breakNode('w:clear="none"'))).toBeUndefined();
    expect(textWrappingBreakClearOf(breakNode('w:clear="sideways"'))).toBeUndefined();
    expect(textWrappingBreakClearOf(breakNode('w:type="page" w:clear="all"'))).toBeUndefined();
    expect(textWrappingBreakClearOf(breakNode('w:type="column" w:clear="all"'))).toBeUndefined();
  });
});

describe('the side a break clears', () => {
  const after = (picture: Float | readonly Float[], clear?: string) => {
    const pictures = (Array.isArray(picture) ? picture : [picture]).map(float).join('');
    return lineAt(
      layout(
        paragraph(run('Before') + pictures + br(clear) + run('After')) + paragraph(run('Next'))
      ),
      'After'
    );
  };

  test('all moves the next line to the bottom of a float', () => {
    expect(after(LEFT, 'all')).toMatchObject({ y: 80, x: 0 });
    expect(after(RIGHT, 'all')).toMatchObject({ y: 80, x: 0 });
  });

  test('left clears a float that blocks the start of the line, not one past the pen', () => {
    expect(after(LEFT, 'left')).toMatchObject({ y: 80, x: 0 });
    expect(after(RIGHT, 'left')).toMatchObject({ y: LINE, x: 0 });
  });

  test('right clears a float past the pen, not one before the line start', () => {
    expect(after(RIGHT, 'right')).toMatchObject({ y: 80, x: 0 });
    expect(after(LEFT, 'right')).toMatchObject({ y: LINE, x: 100 });
  });

  test('with floats on both sides each side clears its own float', () => {
    const tall = { ...RIGHT, height: 160 };
    expect(after([LEFT, tall], 'left').y).toBe(80);
    expect(after([LEFT, tall], 'right').y).toBe(160);
    expect(after([LEFT, tall], 'all').y).toBe(160);
  });

  test('a centred float is on the right of a pen before it', () => {
    const centre = { x: 184, y: 0, width: 100, height: 80 };
    expect(after(centre, 'right').y).toBe(80);
    expect(after(centre, 'left').y).toBe(LINE);
  });

  test('none, or no float at all, is an ordinary line break', () => {
    expect(after(LEFT, 'none')).toMatchObject({ y: LINE, x: 100 });
    const plain = layout(paragraph(run('Before') + br('all') + run('After')));
    expect(lineAt(plain, 'After').y).toBe(LINE);
  });

  test('an untyped w:br clears as a text wrapping break does', () => {
    const result = layout(paragraph(run('Before') + float(LEFT) + br('all', null) + run('After')));
    expect(lineAt(result, 'After').y).toBe(80);
  });
});

describe('the side a break clears in a right-to-left paragraph', () => {
  // ST_BrClear names the left and right sides of the page and gives no reading-order rule, so
  // the sides stay physical in a `w:bidi` paragraph. This pins that reading; it has not been
  // compared with a reference render.
  const after = (picture: Float, clear: string) =>
    lineAt(
      layout(
        paragraph(run('Before') + float(picture) + br(clear) + run('After'), '<w:bidi/>') +
          paragraph(run('Next'))
      ),
      'After'
    );

  test('left clears the float on the physical left', () => {
    expect(after(LEFT, 'left').y).toBe(80);
    expect(after(RIGHT, 'left').y).toBe(LINE);
  });

  test('right clears the float on the physical right', () => {
    expect(after(RIGHT, 'right').y).toBe(80);
    expect(after(LEFT, 'right').y).toBe(LINE);
  });
});

describe('which floats a break clears', () => {
  const afterBreak = (picture: Float, before = '') =>
    lineAt(
      layout(before + paragraph(run('Before') + float(picture) + br('all') + run('After'))),
      'After'
    ).y;

  test('floats that do not wrap text are not cleared', () => {
    expect(afterBreak({ ...LEFT, wrap: '<wp:wrapNone/>' })).toBe(LINE);
    expect(afterBreak({ ...LEFT, wrap: '<wp:wrapNone/>', behindDoc: '1' })).toBe(LINE);
  });

  test('a float of an earlier paragraph is cleared', () => {
    const result = layout(
      paragraph(run('First') + float(LEFT)) + paragraph(run('Before') + br('all') + run('After'))
    );
    expect(lineAt(result, 'Before')).toMatchObject({ y: LINE, x: 100 });
    expect(lineAt(result, 'After').y).toBe(80);
  });

  test('a float ending inside the next line moves it to the float bottom', () => {
    expect(afterBreak({ ...LEFT, height: 17 })).toBe(17);
  });

  test('a float below the next line leaves it in place', () => {
    expect(afterBreak({ ...LEFT, y: 40, height: 60 })).toBe(LINE);
  });

  test('a top-and-bottom float is cleared at its band bottom', () => {
    expect(afterBreak({ ...LEFT, y: 20, wrap: '<wp:wrapTopAndBottom/>' })).toBe(100);
  });

  test('two clearing breaks in a row leave one line below the float', () => {
    const result = layout(
      paragraph(run('Before') + float(LEFT) + br('all') + br('all') + run('After'))
    );
    expect(lineAt(result, 'After').y).toBe(80 + LINE);
  });

  test('a float inside a table cell is cleared inside the cell', () => {
    const cell = paragraph(run('Before') + float(LEFT) + br('all') + run('After'));
    const result = layout(
      '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl>` +
        paragraph(run('Next'))
    );
    const before = lineAt(result, 'Before');
    expect(lineAt(result, 'After').y).toBeCloseTo(before.y + 80, 3);
    expect(lineAt(result, 'Next').y).toBeGreaterThanOrEqual(before.y + 80 + LINE - 0.001);
  });
});

describe('a clearing break across a region boundary', () => {
  const fill = (count: number, spacing = '') =>
    Array.from({ length: count }, (_, index) => paragraph(run(`Fill ${index}`), spacing)).join('');

  test('a cleared line that misses the page bottom opens the next page clear', () => {
    // 50 fill lines leave 48 pt. The cleared line would start at the float bottom, 640 pt, and
    // end past the 648 pt page bottom, so it opens the next page, where no float remains.
    const result = layout(
      fill(50) +
        paragraph(run('Anchor') + float({ ...LEFT, height: 40 })) +
        paragraph(
          run('Before') + br() + run('Second') + br('all') + run('After') + br() + run('More')
        )
    );
    expect(lineAt(result, 'Before')).toMatchObject({ pageIndex: 0, x: 100 });
    expect(lineAt(result, 'Second')).toMatchObject({ pageIndex: 0, x: 100 });
    expect(lineAt(result, 'After')).toMatchObject({ pageIndex: 1, y: 0 });
    expect(lineAt(result, 'More')).toMatchObject({ pageIndex: 1, y: LINE });
  });

  const EXACT = '<w:spacing w:line="240" w:lineRule="exact"/>';
  const moving =
    paragraph(
      float({ x: 0, y: 0, width: 200, height: 120 }) + br('all') + run('Caption'),
      `${EXACT}<w:keepLines/>`
    ) + paragraph(run('Following'), EXACT);

  const expectBelowPicture = (result: SemanticLayout) => {
    const caption = lineAt(result, 'Caption');
    const page = result.pages[caption.pageIndex]!;
    const picture = anchoredDrawingsOf(page)[0]!;
    expect(picture).toBeDefined();
    const bottom = picture.y + picture.height;
    expect(caption.y).toBeGreaterThanOrEqual(bottom - 0.001);
    expect(lineAt(result, 'Following').y).toBeGreaterThanOrEqual(caption.y + LINE - 0.001);
    return { caption, picture };
  };

  test('a paragraph that moves whole to the next page keeps its caption below the picture', () => {
    const result = layout(fill(48, EXACT) + moving);
    const { caption, picture } = expectBelowPicture(result);
    expect(caption.pageIndex).toBe(1);
    expect(picture.y).toBe(0);
    expect(caption.y).toBe(120);
  });

  test('a paragraph that moves whole to the next column keeps its caption below the picture', () => {
    const result = layout(
      fill(48, EXACT) + moving + fill(5, EXACT),
      '<w:cols w:num="2" w:space="720"/>'
    );
    const { caption, picture } = expectBelowPicture(result);
    expect(caption.pageIndex).toBe(0);
    expect(picture.x).toBeGreaterThan(200);
  });

  const table = (cell: string, trPr = '') =>
    '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>' +
    `<w:tr>${trPr}<w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl>`;
  const tall = (height: number) => ({ x: 0, y: 0, width: 100, height });

  test('a cell row continued on the next page does not clear the float it left behind', () => {
    // 25 fill lines put the cell at 300 pt; its 340 pt float ends at 640 on the first page,
    // so the cleared line opens the next one.
    const result = layout(
      fill(25) +
        table(paragraph(run('Before') + float(tall(340)) + br('all') + run('After'))) +
        paragraph(run('Next'))
    );
    expect(lineAt(result, 'After')).toMatchObject({ pageIndex: 1, y: 0 });
  });

  for (const [label, body] of [
    [
      'a float that fills the page',
      table(paragraph(run('Before') + float(tall(640)) + br('all') + run('After'))),
    ],
    [
      'a float taller than the page in a row that cannot split',
      fill(10) +
        table(
          paragraph(run('Before') + float(tall(2000)) + br('all') + run('After')),
          '<w:trPr><w:cantSplit/></w:trPr>'
        ),
    ],
    [
      'a float taller than the page anchored after the break',
      table(paragraph(run('Before') + br('all') + float(tall(2000)) + run('After'))),
    ],
  ] as const) {
    test(`a cleared cell line always finds a page: ${label}`, () => {
      const result = layout(body + paragraph(run('Next')));
      const after = lineAt(result, 'After');
      expect(after.pageIndex).toBeGreaterThan(lineAt(result, 'Before').pageIndex);
      expect(after.y).toBe(0);
    });
  }

  /** `Before`, a 340 pt float that ends above the bottom margin, then 40 short lines. */
  const spilling = () =>
    run('Before') +
    float(tall(340)) +
    Array.from({ length: 40 }, (_, index) => br() + run(`W${index}`)).join('');
  const spilledLines = (result: SemanticLayout) =>
    linesOf({ ...result, pages: [result.pages[1]!] }).filter((line) =>
      line.spans.some((span) => span.text.startsWith('W'))
    );

  for (const [where, body] of [
    ['a table cell', () => fill(25) + table(paragraph(spilling()))],
    ['the body', () => fill(25) + paragraph(spilling())],
  ] as const) {
    test(`lines continued from ${where} do not wrap around a float left on the earlier page`, () => {
      const result = layout(body());
      expect(anchoredDrawingsOf(result.pages[1]!)).toHaveLength(0);
      const lines = spilledLines(result);
      expect(lines.length).toBeGreaterThan(0);
      // An unstyled table keeps its outer edge on the text edge, so cell text starts after
      // the 10-twip fallback margin.
      const textEdge = where === 'a table cell' ? 0.5 : 0;
      for (const line of lines) expect(round(line.contentX)).toBe(textEdge);
    });
  }
});

describe('own clearing bands of a paragraph that moved', () => {
  // The float sits in the right margin, 480 pt from the margin edge: it blocks no part of the
  // 468 pt column. The page zone for it, built with the sheet's frames, clears nothing.
  const inMargin = float({ x: 480, y: 0, width: 60, height: 120 }).replace(
    '<wp:positionH relativeFrom="column">',
    '<wp:positionH relativeFrom="margin">'
  );
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body>${paragraph(inMargin + br('all') + run('Caption'))}</w:body></w:document>`
  );
  const node = part.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const frameBase = bodyAnchorFrameBase({
    pageNumber: 1,
    onPageParityRead: () => {},
    geometry: { width: 612, height: 792, margin: { left: 72, right: 72, bottom: 72 } },
    insets: { top: 72, bottom: 72, height: 648 },
    contentWidth: 468,
    contentHeight: 648,
    ownerPartName: '/word/document.xml',
  });
  const own = (withFrames: boolean) =>
    ownParagraphFramedClearZones({
      ...(withFrames ? { frameBase } : {}),
      paragraph: node,
      paragraphId: node.id,
      drawingLayout: layoutContext(part),
      contentLeft: 0,
      contentRight: 468,
      paragraphTop: 0,
      displayMode: 'proposed',
    });

  test('with the sheet frames the band takes the float X and clears nothing in the column', () => {
    const zones = own(true);
    expect(zones).toHaveLength(1);
    const page = synthesizeParagraphWrapExclusionZones({
      frameBase,
      paragraph: node,
      paragraphId: node.id,
      drawingLayout: layoutContext(part),
      contentLeft: 0,
      contentRight: 468,
      paragraphStartY: 0,
      anchorLineTopByModelStart: new Map([[0, 0]]),
    });
    expect(zones[0]!.input.contentBounds.x).toBeCloseTo(page[0]!.input.contentBounds.x, 6);
    expect(breakClearanceSkip(0, LINE, zones, 0, 468)).toBe(0);
  });

  test('without the frames the band counts on its vertical extent alone', () => {
    expect(breakClearanceSkip(0, LINE, own(false), 0, 468)).toBe(120);
  });
});
