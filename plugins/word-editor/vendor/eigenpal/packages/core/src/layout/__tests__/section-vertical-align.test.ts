// Section vertical alignment (`w:sectPr/w:vAlign`): where a page's body sits in the text area.
import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  layoutSemanticDocumentSteps,
} from '../semantic-layout.ts';
import type { PageFurniture, PageRecord, SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
// 11pt text is 14pt per line. The text area is 160pt tall.
const measurer = createFixedMeasurer(6, 14);
const geometry = { width: 200, height: 200, margin: { left: 20, right: 20, top: 20, bottom: 20 } };
const SIZE = '<w:rPr><w:sz w:val="22"/></w:rPr>';

const run = (text: string) => `<w:r>${SIZE}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}${SIZE}</w:pPr>${text ? run(text) : ''}</w:p>`;
function sectPr(vAlign?: string, type?: string, extra = '') {
  return (
    `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}` +
    // The same 200pt page with 20pt margins as `geometry`, for documents with several sections.
    '<w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="200" w:footer="200" w:gutter="0"/>' +
    `${extra}` +
    `${vAlign ? `<w:vAlign w:val="${vAlign}"/>` : ''}</w:sectPr>`
  );
}
/** The empty paragraph that ends a section and carries its properties. */
const carrier = (vAlign?: string, type?: string) =>
  `<w:p><w:pPr>${SIZE}${sectPr(vAlign, type)}</w:pPr></w:p>`;

function part(body: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
      `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    { name: OWNER, contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
function layout(body: string, options: Partial<Parameters<typeof layoutSemanticDocument>[2]> = {}) {
  return layoutSemanticDocument(part(body), 1, { measurer, geometry, ...options });
}
/** Content-relative tops of every line on a page, in flow order. */
function lineTops(page: PageRecord): number[] {
  const tops: number[] = [];
  const visit = (blocks: PageRecord['fragments']) => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') tops.push(...block.lines.map((line) => line.box.y));
      else for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
    }
  };
  visit(page.fragments);
  return tops.map((top) => Math.round(top * 1000) / 1000);
}
const tops = (value: SemanticLayout, page = 0) => lineTops(value.pages[page]!);

describe('section vertical alignment', () => {
  test('center places the body midway in the text area; bottom puts it on the bottom margin', () => {
    const body = p('alpha') + p('bravo');
    expect(tops(layout(body + sectPr()))).toEqual([0, 14]);
    expect(tops(layout(body + sectPr('top')))).toEqual([0, 14]);
    // 28pt of text leaves 132pt: half above the text when centered, all of it when bottom.
    expect(tops(layout(body + sectPr('center')))).toEqual([66, 80]);
    expect(tops(layout(body + sectPr('bottom')))).toEqual([132, 146]);
    // An unknown value is top alignment.
    expect(tops(layout(body + sectPr('middle')))).toEqual([0, 14]);
  });

  test('paragraph spacing before the first and after the last paragraph takes room', () => {
    const body =
      p('alpha', '<w:spacing w:before="480"/>') + p('bravo', '<w:spacing w:after="480"/>');
    // 24 + 14 + 14 + 24 = 76pt of body; 42pt above it, then the 24pt before the first line.
    expect(tops(layout(body + sectPr('center')))).toEqual([66, 80]);
    expect(tops(layout(body + sectPr('bottom')))).toEqual([108, 122]);
  });

  test('the empty paragraph that carries a section break takes no room', () => {
    const value = layout(p('alpha') + p('bravo') + carrier('center') + p('next') + sectPr());
    expect(tops(value, 0).slice(0, 2)).toEqual([66, 80]);
    // The next section starts on a new page at the top.
    expect(tops(value, 1)).toEqual([0]);
    // A carrier with text, and an empty paragraph that ends no section, both take room.
    const text = `<w:p><w:pPr>${SIZE}${sectPr('center')}</w:pPr>${run('carrier')}</w:p>`;
    expect(tops(layout(p('alpha') + p('bravo') + text + p('next') + sectPr()), 0)).toEqual([
      59, 73, 87,
    ]);
    const empty = p('alpha') + p('bravo') + p('') + carrier('center') + p('next') + sectPr();
    expect(tops(layout(empty), 0).slice(0, 3)).toEqual([59, 73, 87]);
  });

  test('every page of the section aligns, a full page by its remaining fraction of a line', () => {
    const body = Array.from({ length: 12 }, (_, index) => p(`line ${index}`)).join('');
    const value = layout(body + sectPr('center'));
    expect(value.pages).toHaveLength(2);
    // Eleven lines fill 154 of 160pt.
    expect(tops(value, 0)[0]).toBe(3);
    expect(tops(value, 1)).toEqual([73]);
  });

  test('a page that holds two sections stays top-aligned', () => {
    // The second section continues on the first section's page.
    const value = layout(
      p('alpha') + p('bravo') + carrier('center') + p('charlie') + sectPr('center', 'continuous')
    );
    expect(value.pages).toHaveLength(1);
    expect(tops(value)[0]).toBe(0);
  });

  test('multi-column sections stay top-aligned', () => {
    const columns = '<w:cols w:num="2" w:space="0"/>';
    expect(tops(layout(p('alpha') + sectPr('center', undefined, columns)))).toEqual([0]);
  });

  test('both spreads the free height evenly between paragraphs', () => {
    const value = layout(p('alpha') + p('bravo') + p('charlie') + sectPr('both'));
    // 118pt of free height in two equal gaps.
    expect(tops(value)).toEqual([0, 73, 146]);
    // The lines of one paragraph stay together.
    const lines = `<w:p><w:pPr>${SIZE}</w:pPr>${run('one')}<w:r><w:br/></w:r>${run('two')}</w:p>`;
    expect(tops(layout(lines + p('three') + sectPr('both')))).toEqual([0, 14, 146]);
    // One paragraph stays at the top.
    expect(tops(layout(p('alone') + sectPr('both')))).toEqual([0]);
  });

  test('tables move with the body; a justified page with a table stays top-aligned', () => {
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="3200" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3200"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr>${p('cell')}</w:tc></w:tr></w:tbl>`;
    const top = layout(table + p('after') + sectPr());
    const centered = layout(table + p('after') + sectPr('center'));
    const dy = (160 - tops(top)[1]! - 14) / 2;
    expect(dy).toBeGreaterThan(0);
    expect(tops(centered)).toEqual(tops(top).map((value) => value + dy));
    const [topTable, centeredTable] = [top, centered].map((value) => value.pages[0]!.fragments[0]!);
    expect(centeredTable!.box.y).toBe(topTable!.box.y + dy);
    expect(tops(layout(p('before') + table + p('after') + sectPr('both')))).toEqual(
      tops(layout(p('before') + table + p('after') + sectPr()))
    );
  });

  test('the caret follows the moved text', () => {
    const body = p('alpha') + p('bravo');
    const top = layout(body + sectPr());
    const centered = layout(body + sectPr('center'));
    const second = centered.pages[0]!.fragments[1]!;
    if (second.kind !== 'paragraph') throw new Error('expected a paragraph');
    const paragraphId = second.paragraphId;
    const before = caretAt(top, { paragraphId, offset: 2 }, measurer);
    const after = caretAt(centered, { paragraphId, offset: 2 }, measurer);
    expect(before).not.toBeNull();
    expect(after!.y).toBe(before!.y + 66);
    expect(after!.x).toBe(before!.x);
  });

  test('a page with a content control keeps its identity and bounds on an unchanged pass', () => {
    const session = createLayoutSession();
    const control =
      '<w:sdt><w:sdtPr><w:id w:val="7"/><w:alias w:val="Field"/></w:sdtPr><w:sdtContent>' +
      `${p('inside')}</w:sdtContent></w:sdt>`;
    const source = part(p('alpha') + control + sectPr('center'));
    const options = { measurer, geometry, session };
    const first = layoutSemanticDocument(source, 1, options);
    const again = layoutSemanticDocument(source, 1, options);
    const third = layoutSemanticDocument(source, 1, options);
    expect(tops(first)).toEqual([66, 80]);
    // Each unchanged pass hands back the retained pages; none moves or repaints again.
    expect(again.pages[0]).toBe(first.pages[0]);
    expect(third.pages[0]).toBe(first.pages[0]);
    expect(tops(third)).toEqual([66, 80]);
    // The control's bounds follow the moved text.
    const bounds = third.contentControls!.find((record) => record.alias === 'Field')!;
    const line = third.pages[0]!.fragments[1]!;
    expect(bounds.fragments[0]!.box.y).toBeGreaterThanOrEqual(line.box.y - 1);
    expect(bounds.fragments[0]!.box.y).toBeLessThan(line.box.y + 14);
  });

  test('an incremental session keeps page identity and never moves a page twice', () => {
    const session = createLayoutSession();
    const run1 = (body: string) =>
      layoutSemanticDocument(part(body), 1, { measurer, geometry, session });
    const body = p('alpha') + p('bravo') + carrier('center') + p('next') + sectPr('bottom');
    const first = run1(body);
    expect(tops(first, 0).slice(0, 2)).toEqual([66, 80]);
    expect(tops(first, 1)).toEqual([146]);
    const source = part(body);
    const again = layoutSemanticDocument(source, 1, { measurer, geometry, session });
    const unchanged = layoutSemanticDocument(source, 1, { measurer, geometry, session });
    expect(unchanged.pages[0]).toBe(again.pages[0]);
    expect(unchanged.pages[1]).toBe(again.pages[1]);
    expect(tops(unchanged, 0).slice(0, 2)).toEqual([66, 80]);
    // An edit that adds a line moves the body by half of it, from the top-aligned layout.
    const edited = run1(
      p('alpha') + p('bravo') + p('charlie') + carrier('center') + p('next') + sectPr('bottom')
    );
    expect(tops(edited, 0).slice(0, 3)).toEqual([59, 73, 87]);
    expect(tops(edited, 1)).toEqual([146]);
    const fresh = layoutSemanticDocument(
      part(
        p('alpha') + p('bravo') + p('charlie') + carrier('center') + p('next') + sectPr('bottom')
      ),
      1,
      { measurer, geometry }
    );
    expect(tops(edited, 0)).toEqual(tops(fresh, 0));
  });

  test('a full page keeps its alignment when the section-break paragraph falls past its end', () => {
    // Eleven lines fill 154 of 160pt; the empty carrier after them does not fit on the page.
    const lines = Array.from({ length: 11 }, (_, index) => p(`line ${index}`)).join('');
    const value = layout(lines + carrier('center') + p('next') + sectPr());
    expect(tops(value, 0)[0]).toBe(3);
  });

  test('a page with a continuous break stays top-aligned when the next section is empty', () => {
    const text = `<w:p><w:pPr>${SIZE}${sectPr('center')}</w:pPr>${run('carrier')}</w:p>`;
    const value = layout(p('alpha') + text + sectPr('center', 'continuous'));
    expect(value.pages).toHaveLength(1);
    expect(tops(value)[0]).toBe(0);
  });

  test('pages shown before a pass ends are aligned as the finished pass aligns them', () => {
    const body = Array.from({ length: 30 }, (_, index) => p(`line ${index}`)).join('');
    // A live pass (one with a session) reports each page it completes.
    const steps = layoutSemanticDocumentSteps(part(body + sectPr('center')), 1, {
      measurer,
      geometry,
      session: createLayoutSession(),
    });
    const interim: SemanticLayout[] = [];
    let next = steps.next();
    while (!next.done) {
      const progress = next.value;
      if (progress?.finalize && progress.pages.length > 1)
        interim.push(progress.finalize(progress.pages));
      next = steps.next();
    }
    expect(interim.length).toBeGreaterThan(0);
    for (const shown of interim) expect(tops(shown, 0)).toEqual(tops(next.value, 0));
  });

  test('the empty last line of a split carrier with text takes room', () => {
    // "alpha" and eleven line breaks: eleven lines fill the first page, the empty last one
    // sits alone on the second page.
    const breaks = `<w:r>${SIZE}<w:br/></w:r>`.repeat(11);
    const carrierWithText =
      `<w:p><w:pPr><w:widowControl w:val="0"/>${SIZE}${sectPr('center')}</w:pPr>` +
      `${run('alpha')}${breaks}</w:p>`;
    const value = layout(carrierWithText + p('next') + sectPr());
    expect(tops(value, 1)).toEqual([73]);
  });

  test('changing the alignment in the same session moves the unchanged page again', () => {
    const session = createLayoutSession();
    const pass = (vAlign: string) =>
      layoutSemanticDocument(part(p('alpha') + sectPr(vAlign)), 1, { measurer, geometry, session });
    expect(tops(pass('center'))).toEqual([73]);
    expect(tops(pass('bottom'))).toEqual([146]);
    expect(tops(pass('both'))).toEqual([0]);
    expect(tops(pass('center'))).toEqual([73]);
  });

  test('only the page that holds the end of a continuous-break paragraph stays top-aligned', () => {
    // Fifteen lines in one paragraph that ends the centered section: eleven fill the first page.
    const lineBreak = `<w:r>${SIZE}<w:br/></w:r>`;
    const lines = Array.from({ length: 15 }, (_, index) => run(`l${index}`)).join(lineBreak);
    const body =
      `<w:p><w:pPr><w:widowControl w:val="0"/>${SIZE}${sectPr('center')}</w:pPr>${lines}</w:p>` +
      sectPr('center', 'continuous');
    const value = layout(body);
    expect(value.pages).toHaveLength(2);
    expect(tops(value, 0)[0]).toBe(3);
    expect(tops(value, 1)[0]).toBe(0);
  });

  test('a new page count does not move the bodies of unchanged pages again', () => {
    const session = createLayoutSession();
    const lines = (count: number) =>
      Array.from({ length: count }, (_, index) => p(`line ${index}`)).join('');
    const options = { measurer, geometry, session };
    const first = layoutSemanticDocument(part(lines(33) + sectPr('center')), 1, options);
    expect(first.pages).toHaveLength(3);
    // One more line starts a fourth page; the first page's body is unchanged.
    const second = layoutSemanticDocument(part(lines(34) + sectPr('center')), 2, options);
    expect(second.pages).toHaveLength(4);
    expect(tops(second, 0)).toEqual(tops(first, 0));
    expect(second.pages[0]!.fragments).toBe(first.pages[0]!.fragments);
  });
});

describe('section vertical alignment with furniture and drawings', () => {
  const READY: ImageResourceState = Object.freeze({
    kind: 'ready',
    partName: '/word/media/image1.png',
    contentId: 'image1',
    resourceKey: 'k1',
    mime: 'image/png',
    pixelWidth: 100,
    pixelHeight: 100,
    dpiX: 96,
    dpiY: 96,
  });
  /** A 36pt square picture, positioned from `frame`, behind the text or wrapped square. */
  const picture = (frame: string, wrap: 'none' | 'square', offsetEmu = 0) =>
    '<w:p><w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${wrap === 'none' ? 1 : 0}" locked="0"` +
    ' allowOverlap="1" layoutInCell="1" relativeHeight="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="${frame}"><wp:posOffset>${offsetEmu}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="457200" cy="457200"/>' +
    (wrap === 'none' ? '<wp:wrapNone/>' : '<wp:wrapSquare wrapText="bothSides"/>') +
    '<wp:docPr id="1" name="pic1"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
  function withDrawing(body: string): SemanticLayout {
    const source = part(body);
    const projections = indexInlineDrawingProjectionsInPart(source);
    return layoutSemanticDocument(source, 1, {
      measurer,
      geometry,
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        projectionForAtom: (atomId) => projections.get(atomId) ?? null,
        project: (node) =>
          projections.get(node.id) ??
          projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
        resourceOf: () => READY,
      },
    });
  }
  const drawingTop = (value: SemanticLayout) => value.pages[0]!.anchoredDrawings![0]!.y;

  test('a drawing positioned from its paragraph moves with it; a page frame stays', () => {
    for (const [frame, moves] of [
      ['paragraph', true],
      ['page', false],
      ['margin', false],
    ] as const) {
      const body = picture(frame, 'none') + p('text');
      const top = withDrawing(body + sectPr());
      const centered = withDrawing(body + sectPr('center'));
      const firstLine = (value: SemanticLayout) => {
        const fragment = value.pages[0]!.fragments.find(
          (candidate) => candidate.kind === 'paragraph' && candidate.lines.length > 0
        );
        return fragment?.kind === 'paragraph' ? fragment.lines.at(-1)!.box.y : NaN;
      };
      const dy = firstLine(centered) - firstLine(top);
      expect(dy).toBeGreaterThan(0);
      expect(drawingTop(centered)).toBeCloseTo(drawingTop(top) + (moves ? dy : 0), 6);
      // The offset from the drawing's frame is unchanged, so a resize or move reads it right.
      const fromFrame = (value: SemanticLayout) =>
        value.pages[0]!.anchoredDrawings![0]!.y -
        value.pages[0]!.anchoredDrawings![0]!.verticalFrameOrigin;
      expect(fromFrame(centered)).toBeCloseTo(fromFrame(top), 6);
    }
  });

  test('a page with a moving drawing that the page edge cuts stays top-aligned', () => {
    // 40pt above its paragraph: the picture starts 20pt above the page.
    const body = picture('paragraph', 'none', -508000) + p('text');
    const top = withDrawing(body + sectPr());
    expect(top.pages[0]!.anchoredDrawings![0]!.paintBounds.height).toBeLessThan(36);
    expect(tops(withDrawing(body + sectPr('center')))).toEqual(tops(top));
  });

  test('a drawing on a later page moves with its paragraph as well', () => {
    const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    const body =
      picture('paragraph', 'none') + p('one') + pageBreak + picture('paragraph', 'none') + p('two');
    const top = withDrawing(body + sectPr());
    const centered = withDrawing(body + sectPr('center'));
    expect(centered.pages).toHaveLength(2);
    const moved = (page: number) =>
      centered.pages[page]!.anchoredDrawings![0]!.y - top.pages[page]!.anchoredDrawings![0]!.y;
    expect(moved(0)).toBeGreaterThan(0);
    expect(moved(1)).toBeGreaterThan(0);
  });

  /** A 36pt square inline picture in a paragraph of its own. */
  const inlinePicture = (spacing: string, effectEmu = 0, rotation = 0) =>
    `<w:p><w:pPr>${spacing}</w:pPr><w:r><w:drawing>` +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="457200" cy="457200"/>' +
    `<wp:effectExtent l="${effectEmu}" t="0" r="${effectEmu}" b="0"/>` +
    '<wp:docPr id="2" name="pic2"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    '<pic:cNvPr id="2" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm rot="${rotation}"><a:ext cx="457200" cy="457200"/></a:xfrm>` +
    '<a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';

  test('an inline picture in a line that holds it moves with the body', () => {
    const body = p('before') + inlinePicture('');
    const top = tops(withDrawing(body + sectPr()));
    const centered = tops(withDrawing(body + sectPr('center')));
    expect(centered[0]!).toBeGreaterThan(top[0]!);
  });

  test('a page with an inline picture cut by its line stays top-aligned', () => {
    const exact = '<w:spacing w:line="280" w:lineRule="exact"/>';
    // Wide effect extents paint past the extent sideways while the line cuts it vertically.
    // Turned a quarter, the same picture paints a box as large as its extent.
    for (const [effect, rotation] of [
      [0, 0],
      [228600, 0],
      [228600, 5400000],
    ] as const) {
      const body = p('before') + inlinePicture(exact, effect, rotation);
      const top = withDrawing(body + sectPr());
      const fragment = top.pages[0]!.fragments[1]!;
      if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
      const drawing = fragment.lines[0]!.drawings![0]!;
      expect(drawing.paintBounds.y).toBeGreaterThan(drawing.y);
      expect(tops(withDrawing(body + sectPr('center')))).toEqual(tops(top));
    }
  });

  test('a page with a drawing that wraps text stays top-aligned', () => {
    const body = picture('page', 'square') + p('text');
    expect(tops(withDrawing(body + sectPr('center')))).toEqual(tops(withDrawing(body + sectPr())));
  });

  test('a page whose header holds a drawing that wraps body text stays top-aligned', () => {
    const read = readOoxmlPart(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
        `xmlns:pic="${PIC}" xmlns:r="${R}">${picture('margin', 'square')}</w:hdr>`,
      { name: '/word/header1.xml', contentType: 'application/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const projections = indexInlineDrawingProjectionsInPart(read.part);
    const story = layoutHeaderFooterStory(
      read.part,
      160,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ownerPartName: '/word/header1.xml',
        projectionForAtom: (atomId) => projections.get(atomId) ?? null,
        project: (node) =>
          projections.get(node.id) ??
          projectDrawing(node, {
            ownerPartName: '/word/header1.xml',
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => READY,
      }
    );
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', story]]),
      footers: new Map(),
    };
    const options = {
      geometry: { ...geometry, headerDistance: 10, footerDistance: 10 },
      furniture,
    };
    const centered = layout(p('alpha') + sectPr('center'), options);
    expect(centered.pages[0]!.header?.anchoredDrawings?.length).toBe(1);
    expect(tops(centered)).toEqual(tops(layout(p('alpha') + sectPr(), options)));
  });

  test('a header taller than its margin narrows the area the body centers in', () => {
    const lines = Array.from({ length: 4 }, (_, index) => `<w:p>${run(`header ${index}`)}</w:p>`);
    const read = readOoxmlPart(`<w:hdr xmlns:w="${WML_NAMESPACE_URI}">${lines.join('')}</w:hdr>`, {
      name: '/word/header1.xml',
      contentType: 'application/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', layoutHeaderFooterStory(read.part, 160, measurer, 'test')]]),
      footers: new Map(),
    };
    const withHeader = { ...geometry, headerDistance: 10, footerDistance: 10 };
    const value = layout(p('alpha') + sectPr('center'), { geometry: withHeader, furniture });
    const page = value.pages[0]!;
    // Four 14pt header lines from 10pt down end at 66pt, below the 20pt margin.
    expect(page.contentBox.height).toBeLessThan(160);
    expect(tops(value)).toEqual([(page.contentBox.height - 14) / 2]);
  });
});
