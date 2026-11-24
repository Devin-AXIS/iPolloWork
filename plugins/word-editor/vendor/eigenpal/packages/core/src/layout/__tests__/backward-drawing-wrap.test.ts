import { describe, expect, test } from 'bun:test';
import { drawingSourceOrderInPart } from '../inline-drawing-source.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../pending-line.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { load, layoutContext, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';
const measurer = createFixedMeasurer(6, 14);
describe('backward paragraph wrapping', () => {
  test('top-and-bottom wrapping clears the preceding heading and retains collapsed before spacing', () => {
    const xml = squareAnchorAtLeft({ text: 'body '.repeat(24) })
      .replace(/<wp:wrapSquare[^>]*\/>/, '<wp:wrapTopAndBottom/>')
      .replaceAll('distT="0"', 'distT="45720"')
      .replaceAll('distB="0"', 'distB="45720"')
      .replace(
        '<w:body>',
        '<w:body><w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Lead</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Heading</w:t></w:r></w:p>'
      );
    const part = load(xml);
    const options = { measurer, inlineDrawingLayout: layoutContext(part) };
    const cold = layoutSemanticDocument(part, 1, options);
    const image = cold.pages[0]!.anchoredDrawings![0]!;
    const fragments = paragraphFragmentsOf(cold.pages[0]!);
    expect(image.y).toBeCloseTo(52, 6);
    expect(fragments[1]!.lines[0]!.box.y).toBeCloseTo(image.y + image.height + 3.6 + 8, 6);
    expect(fragments[2]!.lines[0]!.box.y).toBeCloseTo(fragments[1]!.lines[0]!.box.y + 20, 6);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    for (let revision = 1; revision <= 2; revision++)
      expect(layoutSemanticDocument(part, revision, { ...options, cache, session }).pages).toEqual(
        cold.pages
      );
  });

  test('an adjacent paragraph anchor wraps the heading without chasing its added line', () => {
    const xml = squareAnchorAtLeft({ text: 'body '.repeat(24) })
      .replaceAll('distT="0"', 'distT="45720"')
      .replace(
        '<w:body>',
        '<w:body><w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Heading text that is certainly long enough to wrap beside this picture now</w:t></w:r></w:p>'
      );
    const part = load(xml);
    const options = {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      drawingSourceOrder: drawingSourceOrderInPart(part, layoutContext(part)),
    };
    const cold = layoutSemanticDocument(part, 1, options);
    const heading = paragraphFragmentsOf(cold.pages[0]!)[0]!;
    expect(heading.lines).toHaveLength(2);
    expect(heading.lines[0]!.spans[0]!.box.x).toBe(144);
    // Without the picture, the heading is one 14pt line plus 6pt after-spacing.
    expect(cold.pages[0]!.anchoredDrawings![0]!.y).toBe(20);
    expect(paragraphFragmentsOf(cold.pages[0]!)[1]!.lines[0]!.box.y).toBe(34);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, { ...options, cache, session });
    const warm = layoutSemanticDocument(part, 1, { ...options, cache, session });
    expect(first.pages).toEqual(cold.pages);
    expect(warm.pages).toEqual(cold.pages);
    const edited = load(xml.replace('body '.repeat(24), 'changed '.repeat(80)));
    const editedOptions = { ...options, inlineDrawingLayout: layoutContext(edited) };
    expect(layoutSemanticDocument(edited, 2, { ...editedOptions, cache, session }).pages).toEqual(
      layoutSemanticDocument(edited, 2, editedOptions).pages
    );
    const pageBreak = load(
      xml
        .replace('<w:body>', '<w:body><w:p><w:r><w:t>Cover</w:t></w:r></w:p>')
        .replace('<w:spacing w:after="120"/>', '<w:pageBreakBefore/><w:spacing w:after="120"/>')
    );
    const broken = layoutSemanticDocument(pageBreak, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(pageBreak),
    });
    expect(broken.pages).toHaveLength(2);
    expect(paragraphFragmentsOf(broken.pages[1]!)[0]!.lines).toHaveLength(2);
    expect(broken.pages[1]!.anchoredDrawings![0]!.y).toBe(20);
  });

  test('a float without top distance leaves the preceding heading at full width', () => {
    const part = load(
      squareAnchorAtLeft({ text: 'body '.repeat(24) }).replace(
        '<w:body>',
        '<w:body><w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Heading text that is certainly long enough to wrap beside this picture now</w:t></w:r></w:p>'
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      drawingSourceOrder: drawingSourceOrderInPart(part, layoutContext(part)),
    });
    const heading = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(heading.lines).toHaveLength(1);
    expect(heading.lines[0]!.spans[0]!.box.x).toBe(0);
    expect(layout.pages[0]!.anchoredDrawings![0]!.y).toBe(20);
  });
});
