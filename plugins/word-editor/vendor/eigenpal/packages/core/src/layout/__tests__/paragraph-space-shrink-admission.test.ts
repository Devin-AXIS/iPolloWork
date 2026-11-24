import { spacingOf as spansSpacing } from './shrunk-space.ts';
import { expect, test } from 'bun:test';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { linesOf, type LineRecord, type TextMeasurer } from '../semantic-records.ts';

// Only a paragraph-final word the flow kept by borrowing inter-word space compresses a last
// line. A hanging period also overflows the last line, and must keep its natural spacing.

// A letter is 10pt, a space 4pt and a period 3pt: `aa bb cc dd` fills a 92pt measure, and
// the period after it hangs. Three spaces could give up 1pt each at the 75% floor.
const measurer: TextMeasurer = {
  measure(text, style) {
    let width = 0;
    for (const c of text)
      width += c === ' ' ? 4 + (style.shaping?.wordSpacingPt ?? 0) : c === '.' ? 3 : 10;
    return width;
  },
  lineMetrics() {
    return { height: 14, baseline: 11 };
  },
};

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
/** A 30pt square inline picture. */
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="381000" cy="381000"/><wp:docPr id="1" name="pic"/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
  '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/>' +
  '</a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="381000" cy="381000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline>' +
  '</w:drawing></w:r>';
// East Asian language on the run makes an ASCII period hangable punctuation.
const run = (text: string) =>
  `<w:r><w:rPr><w:lang w:eastAsia="ja-JP"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const justified = (runs: string) => `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs}</w:p>`;
const oneCell = (paragraph: string, width: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${width * 20}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
  `</w:tblPr><w:tblGrid><w:gridCol w:w="${width * 20}"/></w:tblGrid><w:tr><w:tc><w:tcPr>` +
  `<w:tcW w:w="${width * 20}" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`;

// Punctuation hangs only when the document defaults name an East Asian face.
const styles = load(
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="MS Mincho"/></w:rPr>' +
    '</w:rPrDefault></w:docDefaults></w:styles>'
);

function layout(bodyXml: string, width: number, compatibilityMode: number | undefined) {
  const part = load(
    `<w:document ${NS}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="${(width + 50) * 20}" ` +
      'w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/>' +
      '</w:sectPr></w:body></w:document>'
  );
  const result = layoutSemanticDocument(part, 1, {
    measurer,
    compatibilityMode,
    styleCascade: buildStyleCascadeTable(styles.root),
    inlineDrawingLayout: layoutContext(part),
  });
  return linesOf(result)[0]!;
}

const spacingOf = (line: LineRecord) => spansSpacing(line.spans);
const startOf = (line: LineRecord, text: string) =>
  line.spans.find((s) => s.text.startsWith(text))!.box.x - line.spans[0]!.box.x;

test('a last line whose period hangs keeps natural spacing, in body text and in a cell', () => {
  for (const mode of [undefined, 14]) {
    for (const [bodyXml, width] of [
      [justified(run('aa bb cc dd.')), 92],
      [oneCell(justified(run('aa bb cc dd.')), 92), 200],
    ] as const) {
      const line = layout(bodyXml, width, mode);
      expect(line.spans.map((s) => s.text).join('')).toBe('aa bb cc dd.');
      expect(spacingOf(line)).toEqual(line.spans.map(() => 0));
      expect(startOf(line, 'dd')).toBeCloseTo(72, 6);
    }
  }
});

test('mode 15 shrinks a last line to keep its period inside, in body text and in a cell', () => {
  for (const [bodyXml, width] of [
    [justified(run('aa bb cc dd.')), 92],
    [oneCell(justified(run('aa bb cc dd.')), 92), 200],
  ] as const) {
    const line = layout(bodyXml, width, 15);
    expect(line.spans.map((s) => s.text).join('')).toBe('aa bb cc dd.');
    // Each of the three spaces gives up its 1pt to the 75% floor.
    expect(spacingOf(line).filter((spacing) => spacing !== 0)).toEqual([-1, -1, -1]);
    expect(startOf(line, 'dd')).toBeCloseTo(69, 6);
  }
});

test('text after an inline picture on a last line never moves into the picture', () => {
  for (const mode of [undefined, 14, 15]) {
    const line = layout(justified(run('aa bb ') + picture + run(' cc dd.')), 126, mode);
    const drawing = line.drawings![0]!;
    expect(drawing.width).toBeCloseTo(30, 6);
    const after = line.spans.filter((s) => s.range.start >= drawing.start);
    expect(after.length).toBeGreaterThan(0);
    expect(Math.min(...after.map((s) => s.box.x))).toBeGreaterThanOrEqual(
      drawing.x + drawing.width - 0.001
    );
    expect(spacingOf(line)).toEqual(line.spans.map(() => 0));
    expect(startOf(line, 'cc') - drawing.x).toBeCloseTo(34, 6);
  }
});

test("a cell paragraph's admitted last word compresses its line in modern mode only", () => {
  const cell = oneCell(justified('<w:r><w:t>aa bb cc</w:t></w:r>'), 66);
  const line = layout(cell, 200, 15);
  expect(line.spans.map((s) => s.text).join('')).toBe('aa bb cc');
  expect(spacingOf(line)).toEqual([-1, -1, 0]);
  const last = line.spans.at(-1)!;
  expect(last.box.x + last.box.width - line.spans[0]!.box.x).toBeCloseTo(66, 6);
  expect(
    layout(cell, 200, 14)
      .spans.map((s) => s.text)
      .join('')
  ).toBe('aa bb ');
});
