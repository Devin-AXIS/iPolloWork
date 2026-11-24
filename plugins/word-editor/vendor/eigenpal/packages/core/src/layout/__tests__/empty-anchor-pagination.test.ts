import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

const emu = (pt: number) => String(pt * 12700);
function anchor(y: number, height: number, frame = 'page', width = 550) {
  const xml = squareAnchorAtLeft({ text: '' });
  return xml
    .slice(xml.indexOf('<w:r>'), xml.indexOf('</wp:anchor>') + '</wp:anchor>'.length)
    .concat('</w:drawing></w:r>')
    .replaceAll('1828800', emu(width))
    .replaceAll('914400', emu(height))
    .replace('relativeFrom="column"', 'relativeFrom="margin"')
    .replace(
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0',
      `<wp:positionV relativeFrom="${frame}"><wp:posOffset>${emu(y)}`
    );
}
function textbox(y: number, height: number, frame = 'page') {
  return anchor(y, height, frame).replace(
    /<a:graphic>.*<\/a:graphic>/,
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:prstGeom prst="rect"/></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Box content</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
      '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>'
  );
}
const document = (body: string) => `<w:document xmlns:w="${WML_NAMESPACE_URI}"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <w:body>${body}</w:body></w:document>`;
const text = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
function render(
  body: string,
  session?: ReturnType<typeof createLayoutSession>,
  revision = 1,
  compatibilityMode: number | undefined = 15
) {
  const part = load(document(body));
  return layoutSemanticDocument(part, revision, {
    compatibilityMode,
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
    session,
  });
}
const body = (title: string) =>
  text(title) +
  `<w:p>${textbox(180, 580)}${textbox(24, 100, 'paragraph')}</w:p>` +
  `<w:p>${textbox(80, 320)}</w:p>`;
const summary = (layout: ReturnType<typeof render>) =>
  layout.pages.map((page) => ({
    paragraphs: paragraphFragmentsOf(page).map((p) => ({
      y: p.box.y,
      text: p.lines.flatMap((l) => l.spans.map((s) => s.text)).join(''),
    })),
    drawings: page.anchoredDrawings?.map((d) => [d.x, d.y, d.width, d.height]) ?? [],
  }));

describe('empty anchor paragraph pagination', () => {
  test('assigns anchor pages before later page bands wrap earlier text', () => {
    const layout = render(body('Heading'));
    expect(layout.pages).toHaveLength(2);
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.box.y).toBe(0);
    expect(layout.pages.map((p) => p.anchoredDrawings?.length ?? 0)).toEqual([2, 1]);
    expect(layout.pages[1]!.anchoredDrawings![0]!.y).toBe(8);
    expect(layout.pages[1]!.anchoredDrawings![0]!.textboxStory?.fragments).toHaveLength(1);
  });
  test('moving an own rectangle upward clears its mark before placing the following anchors', () => {
    const moved =
      text('Heading') +
      `<w:p>${textbox(180, 580)}${textbox(10, 62, 'paragraph')}</w:p>` +
      `<w:p>${textbox(80, 320)}</w:p>`;
    const session = createLayoutSession();
    render(body('Heading'), session);
    const layout = render(moved, session, 2);
    expect(layout.pages.map((p) => p.anchoredDrawings?.length ?? 0)).toEqual([2, 1]);
    expect(summary(layout)).toEqual(summary(render(moved)));
    expect(layout.pages[0]!.anchoredDrawings!.find((d) => d.height === 62)!.y).toBeCloseTo(
      paragraphFragmentsOf(layout.pages[0]!)[0]!.box.height + 10
    );
  });
  test('resizing an own rectangle cannot move its anchor when clearance crosses the page bottom', () => {
    const resized =
      text('Heading') +
      `<w:p>${textbox(180, 580)}${textbox(10, 100, 'paragraph')}</w:p>` +
      `<w:p>${textbox(80, 320)}</w:p>`;
    const session = createLayoutSession();
    render(body('Heading'), session);
    const layout = render(resized, session, 2);
    expect(layout.pages.map((p) => p.anchoredDrawings?.length ?? 0)).toEqual([2, 1]);
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.box.y).toBe(0);
    expect(summary(layout)).toEqual(summary(render(resized)));
    expect(summary(render(resized, session, 3))).toEqual(summary(layout));
    expect(layout.pages[0]!.anchoredDrawings!.find((d) => d.height === 100)!.y).toBeCloseTo(
      paragraphFragmentsOf(layout.pages[0]!)[0]!.box.height + 10
    );
  });
  test('an empty header anchor does not count its own rectangle as story flow height', () => {
    const xml = document(`<w:p>${anchor(-30, 80, 'paragraph')}</w:p>`)
      .replace('<w:document', '<w:hdr')
      .replace('<w:body>', '')
      .replace('</w:body></w:document>', '</w:hdr>');
    const part = load(xml, '/word/header1.xml');
    const story = layoutHeaderFooterStory(
      part,
      468,
      createFixedMeasurer(6, 14),
      'test',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'proposed',
      layoutContext(part, '/word/header1.xml'),
      undefined,
      undefined,
      undefined,
      undefined,
      { compatibilityMode: 15 }
    );
    expect(story.flowHeight).toBeLessThan(20);
  });
  test('own fixed bands are resolved on a prospective page before assigning their anchor', () => {
    const resized =
      text('Heading') +
      `<w:p>${textbox(180, 580)}${textbox(2, 50, 'paragraph')}</w:p>` +
      `<w:p>${textbox(80, 320)}</w:p>`;
    const session = createLayoutSession();
    render(body('Heading'), session);
    const layout = render(resized, session, 2);
    expect(layout.pages.map((p) => p.anchoredDrawings?.length ?? 0)).toEqual([2, 1]);
    expect(summary(layout)).toEqual(summary(render(resized)));
    expect(summary(render(resized, session, 3))).toEqual(summary(layout));
  });
  test('legacy modes retain backward wrapping of fixed anchor bands', () => {
    for (const mode of [11, 12, 14, undefined]) {
      const part = load(document(body('Heading')));
      const layout = layoutSemanticDocument(part, 1, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: layoutContext(part),
        compatibilityMode: mode,
      });
      expect(layout.pages[0]!.anchoredDrawings?.length ?? 0).toBe(0);
    }
    expect(render(body('Heading'), undefined, 1, 16).pages[0]!.anchoredDrawings).toHaveLength(2);
  });
  test('retained layout agrees with fresh layout after heading edits', () => {
    const session = createLayoutSession();
    render(body('Heading'), session);
    expect(summary(render(body('Changed heading'), session, 2))).toEqual(
      summary(render(body('Changed heading')))
    );
  });
  // These rectangles start 20pt below the top margin, so the first paragraph's mark stays
  // above them and only the second paragraph clears them.
  test('a paragraph with multiple anchors clears a preceding full-width rectangle', () => {
    const layout = render(
      `<w:p>${anchor(92, 100)}</w:p><w:p>${anchor(300, 100)}${anchor(450, 100)}</w:p>`
    );
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.box.y).toBe(0);
    expect(paragraphFragmentsOf(layout.pages[0]!)[1]!.box.y).toBe(120);
  });
  test('paragraph-relative anchors follow inherited rectangular clearance', () => {
    const layout = render(
      `<w:p>${anchor(92, 100)}</w:p><w:p>${anchor(0, 80, 'paragraph')}${anchor(380, 80)}</w:p>`
    );
    const paragraph = paragraphFragmentsOf(layout.pages[0]!)[1]!;
    const following = layout.pages[0]!.anchoredDrawings!.find(
      (drawing) =>
        drawing.anchorParagraphId === paragraph.paragraphId &&
        drawing.height === 80 &&
        drawing.y < 300
    )!;
    expect(paragraph.box.y).toBe(120);
    expect(following.y).toBe(paragraph.box.y);
  });
  test('a plain empty paragraph moves below a rectangle that leaves no passage', () => {
    const layout = render(`<w:p>${anchor(92, 100)}</w:p><w:p/>`);
    // The 550pt rectangle covers the whole column from 20pt below the top margin, 100pt down.
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.box.y).toBe(0);
    expect(paragraphFragmentsOf(layout.pages[0]!)[1]!.box.y).toBe(120);
  });
  test('an empty paragraph can stay beside a narrow rectangle', () => {
    const layout = render(`<w:p>${anchor(72, 100, 'page', 100)}</w:p><w:p/>`);
    const first = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(paragraphFragmentsOf(layout.pages[0]!)[1]!.box.y).toBe(first.box.height);
  });
  test('a paragraph mark moves below its own square-wrapped anchor without moving it', () => {
    const layout = render(`<w:p>${anchor(0, 100, 'paragraph')}</w:p>`);
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.box.y).toBe(100);
    expect(layout.pages[0]!.anchoredDrawings![0]!.y).toBe(0);
  });
  for (const mode of [15, undefined]) {
    test(`an anchor-only mark clears its own blocking rectangle in mode ${mode}`, () => {
      // A paragraph-framed rectangle 3pt below the paragraph top, 17pt tall and wider than the
      // column leaves the mark no passage, so the mark and the next paragraph move below it.
      const layout = render(
        `<w:p>${anchor(3, 17, 'paragraph')}</w:p>${text('Next')}`,
        undefined,
        1,
        mode
      );
      const [own, next] = paragraphFragmentsOf(layout.pages[0]!);
      expect(layout.pages[0]!.anchoredDrawings!.map((d) => [d.y, d.height])).toEqual([[3, 17]]);
      expect(own!.box.y).toBe(20);
      expect(next!.box.y).toBeCloseTo(20 + own!.box.height);
    });
  }
  test('one and two own rectangles clear an anchor-only mark alike', () => {
    const one = render(`<w:p>${anchor(0, 100, 'paragraph')}</w:p>${text('Next')}`);
    const two = render(
      `<w:p>${anchor(0, 100, 'paragraph')}${anchor(300, 100)}</w:p>${text('Next')}`
    );
    const ys = (layout: ReturnType<typeof render>) =>
      paragraphFragmentsOf(layout.pages[0]!).map((p) => p.box.y);
    expect(ys(one)).toEqual(ys(two));
  });
  test('a leading tall narrow anchor moves its paragraph to the next page', () => {
    // The box starts 300pt to the right, so the paragraph mark has a passage beside it. The
    // box is taller than the rest of the page and cannot end at the bottom margin without
    // rising above its line, so the paragraph moves with it.
    const positionH = '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset>';
    const tall = anchor(8, 500, 'paragraph', 100);
    expect(tall).toContain(positionH);
    const right = tall.replace(positionH, positionH.replace('>0<', '>3810000<'));
    const filler = Array.from({ length: 40 }, () => text('Filler')).join('');
    const layout = render(filler + `<w:p>${right}</w:p>`);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.anchoredDrawings).toBeUndefined();
    expect(layout.pages[1]!.anchoredDrawings).toHaveLength(1);
    expect(layout.pages[1]!.anchoredDrawings![0]!.y).toBeCloseTo(8, 3);
  });
});
