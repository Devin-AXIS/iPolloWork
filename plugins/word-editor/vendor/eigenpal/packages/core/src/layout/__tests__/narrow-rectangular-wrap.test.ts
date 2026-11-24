import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';

interface Beside {
  /** Float offset and width in points, from the column's left edge. */
  readonly x: number;
  readonly width: number;
  readonly text: string;
  /** Paragraph spacing above, in twentieths of a point. */
  readonly before?: number;
  /** Float height in points; 100 when absent. */
  readonly height?: number;
}

/** A square-wrapped rectangle anchored in the paragraph that holds `text`. */
function layoutBeside(shape: Beside) {
  const cy = (shape.height ?? 100) * 12700;
  const spacing = shape.before ? `<w:pPr><w:spacing w:before="${shape.before}"/></w:pPr>` : '';
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>
    <w:p><w:r><w:t>Lead</w:t></w:r></w:p>
    <w:p>${spacing}<w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${shape.x * 12700}</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
    <wp:extent cx="${shape.width * 12700}" cy="${cy}"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="rectangle"/>
    <wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${shape.width * 12700}" cy="${cy}"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>
    </wp:anchor></w:drawing></w:r><w:r><w:t xml:space="preserve">${shape.text}</w:t></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const projections = indexInlineDrawingProjectionsInPart(parsed.part);
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 220, height: 400, margin: { left: 10, right: 10, top: 10, bottom: 10 } },
    measurer: {
      measure: (text) => Array.from(text).length * 10,
      lineMetrics: () => ({ height: 12, baseline: 10 }),
    },
    inlineDrawingLayout: {
      ownerPartName: '/word/document.xml',
      project: (node) => projections.get(node.id) ?? null,
      projectionForAtom: (id) => projections.get(id) ?? null,
      resourceOf: () => null,
    },
  });
  const fragment = paragraphFragmentsOf(result.pages[0]!)[1]!;
  return fragment.lines
    .filter((line) => line.spans.length)
    .map((line) => ({
      text: line.spans.map((span) => span.text).join(''),
      x: line.spans[0]!.box.x,
      y: line.box.y,
      spans: line.spans.map((span) => [span.box.x, span.box.x + span.box.width]),
    }))
    .map(({ spans, ...line }) => (shape.height === undefined ? line : { ...line, spans }));
}

function layoutCaption(text: string) {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>
    <w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>25400</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
    <wp:extent cx="1244600" cy="1270000"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="rectangle"/>
    <wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1244600" cy="1270000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="123456"/></a:solidFill>
    </wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const projections = indexInlineDrawingProjectionsInPart(parsed.part);
  const drawings: InlineDrawingLayoutContext = {
    ownerPartName: '/word/document.xml',
    project: (node) => projections.get(node.id) ?? null,
    projectionForAtom: (id) => projections.get(id) ?? null,
    resourceOf: () => ({
      kind: 'ready',
      partName: '/word/media/fixture.png',
      contentId: 'fixture',
      resourceKey: 'fixture',
      mime: 'image/png',
      pixelWidth: 100,
      pixelHeight: 100,
      dpiX: 96,
      dpiY: 96,
    }),
  };
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 120, height: 220, margin: { left: 10, right: 10, top: 10, bottom: 10 } },
    measurer: {
      measure: (text) => Array.from(text).length * 10,
      lineMetrics: () => ({ height: 12, baseline: 10 }),
    },
    inlineDrawingLayout: drawings,
  });
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return result;
}

test('a full caption line clears a float with a side gap narrower than one glyph', () => {
  const result = layoutCaption('Caption');
  const lines = paragraphFragmentsOf(result.pages[0]!)
    .flatMap((fragment) => fragment.lines)
    .filter((line) => line.spans.length);
  expect(lines).toHaveLength(1);
  expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('Caption');
  expect(lines[0]!.box.y).toBeGreaterThanOrEqual(100);
});

test('following lines and pages do not repeat the float clearance or lose text', () => {
  const text = 'Caption'.repeat(30);
  const result = layoutCaption(text);
  expect(result.pages).toHaveLength(2);
  const lines = result.pages
    .flatMap((page) => paragraphFragmentsOf(page))
    .flatMap((fragment) => fragment.lines)
    .filter((line) => line.spans.length);
  expect(lines.flatMap((line) => line.spans.map((span) => span.text)).join('')).toBe(text);
  expect(lines[0]!.box.y).toBeGreaterThanOrEqual(100);
  expect(lines[1]!.box.y - lines[0]!.box.y).toBe(12);
  expect(paragraphFragmentsOf(result.pages[1]!)[0]!.lines[0]!.box.y).toBe(0);
});

// The rectangle covers 12pt to 112pt; the column is 200pt wide.
test('an opening word that fits no passage beside a float moves below it whole', () => {
  const lines = layoutBeside({ x: 30, width: 140, text: 'Alphabet go' });
  expect(lines[0]).toEqual({ text: 'Alphabet go', x: 0, y: 112 });
});

test('an opening word too wide for the only passage, at the right, moves below the float', () => {
  const lines = layoutBeside({ x: 0, width: 170, text: 'Alpha go' });
  expect(lines[0]).toEqual({ text: 'Alpha go', x: 0, y: 112 });
});

test('an opening word takes the passage that holds it, and the next word moves below', () => {
  const lines = layoutBeside({ x: 30, width: 100, text: 'Alpha Alphabet' });
  expect(lines).toEqual([
    { text: 'Alpha ', x: 130, y: 12 },
    { text: 'Alphabet', x: 0, y: 112 },
  ]);
});

test('a word wider than the column breaks only where the whole column is clear', () => {
  const lines = layoutBeside({ x: 40, width: 160, text: 'x'.repeat(25) });
  expect(lines).toEqual([
    { text: 'x'.repeat(20), x: 0, y: 112 },
    { text: 'x'.repeat(5), x: 0, y: 124 },
  ]);
});

test('a first line moved below a float takes its paragraph spacing again there', () => {
  // 20pt above: the paragraph starts at 12pt, its text at 32pt, beside the float.
  const lines = layoutBeside({ x: 30, width: 140, text: 'Alphabet', before: 400 });
  expect(lines[0]).toEqual({ text: 'Alphabet', x: 0, y: 132 });
});

test('a word that fits a passage stays beside the float', () => {
  const lines = layoutBeside({ x: 0, width: 100, text: 'Alpha' });
  expect(lines[0]).toEqual({ text: 'Alpha', x: 100, y: 12 });
});

test('an opening line keeps to the passages when clearing its own float would leave the page', () => {
  // The float covers 12pt to 382pt of a 380pt region. Below it the paragraph and its float
  // would move on together, so the line stays beside the float rather than over it.
  const lines = layoutBeside({ x: 30, width: 140, height: 370, text: 'Alphabet go' });
  expect(lines.map((line) => [line.text, line.y])).toEqual([
    ['Alp', 12],
    ['hab', 24],
    ['et go', 36],
  ]);
  for (const line of lines)
    for (const [start, end] of (line as { spans: number[][] }).spans)
      expect(end! <= 30 || start! >= 170).toBe(true);
});
