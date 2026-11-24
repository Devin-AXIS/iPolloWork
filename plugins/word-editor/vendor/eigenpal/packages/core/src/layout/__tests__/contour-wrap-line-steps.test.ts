import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

// A line that a tight or through wrap leaves no passage moves down in steps of its own height
// until it clears the contour. A square wrap moves it to the rectangle's bottom.

type Mode = 'square' | 'tight' | 'through';
const emu = (pt: number) => String(Math.round(pt * 12700));
const RECTANGLE = '0,0 0,21600 21600,21600 21600,0 0,0';
// The left edge leans in by about 0.1pt, so the contour is not a rectangle.
const LEANING = '5,0 0,21600 21600,21600 21600,0 5,0';

function wrapXml(mode: Mode, polygon: string): string {
  if (mode === 'square') return '<wp:wrapSquare wrapText="bothSides"/>';
  const [start, ...rest] = polygon.split(' ').map((pair) => pair.split(','));
  const element = mode === 'tight' ? 'wp:wrapTight' : 'wp:wrapThrough';
  return (
    `<${element} wrapText="bothSides"><wp:wrapPolygon edited="0">` +
    `<wp:start x="${start![0]}" y="${start![1]}"/>` +
    rest.map(([x, y]) => `<wp:lineTo x="${x}" y="${y}"/>`).join('') +
    `</wp:wrapPolygon></${element}>`
  );
}

/** A paragraph-framed picture, 500pt wide (wider than the column) by default, `left` points in. */
function anchor(options: {
  readonly mode: Mode;
  readonly y: number;
  readonly height: number;
  readonly width?: number;
  readonly left?: number;
  readonly polygon?: string;
}): string {
  const xml = squareAnchorAtLeft({ text: '' });
  return xml
    .slice(xml.indexOf('<w:r>'), xml.indexOf('</wp:anchor>') + '</wp:anchor>'.length)
    .concat('</w:drawing></w:r>')
    .replaceAll('1828800', emu(options.width ?? 500))
    .replaceAll('914400', emu(options.height))
    .replace(
      '<wp:positionH relativeFrom="column"><wp:posOffset>0',
      `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(options.left ?? 0)}`
    )
    .replace(
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0',
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(options.y)}`
    )
    .replace(
      '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>',
      wrapXml(options.mode, options.polygon ?? RECTANGLE)
    );
}

const document = (body: string) => `<w:document xmlns:w="${WML_NAMESPACE_URI}"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
 xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <w:body>${body}</w:body></w:document>`;
const text = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;

function render(body: string) {
  const part = load(document(body));
  return layoutSemanticDocument(part, 1, {
    compatibilityMode: 15,
    // 6pt per character.
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
}

const fragments = (layout: ReturnType<typeof render>) => paragraphFragmentsOf(layout.pages[0]!);
function expectTops(layout: ReturnType<typeof render>, expected: readonly number[]): void {
  const tops = fragments(layout).map((fragment) => fragment.box.y);
  expect(tops).toHaveLength(expected.length);
  tops.forEach((top, index) => expect(top).toBeCloseTo(expected[index]!, 6));
}
/** The single-line height, read from a paragraph that no float touches. */
const LINE = fragments(render(text('Top')))[0]!.box.height;

describe('lines blocked by a contour wrap', () => {
  test('the line height leaves a step between the square and contour results', () => {
    expect(LINE).toBeGreaterThan(10);
    expect(LINE).toBeLessThan(17);
  });

  test('an anchor-only mark steps by its line height below a tight or through contour', () => {
    // The picture covers 3pt to 20pt of the mark's paragraph.
    const markAbove = (mode: Mode, polygon?: string) =>
      render(`<w:p>${anchor({ mode, y: 3, height: 17, polygon })}</w:p>${text('DATE:')}`);
    expectTops(markAbove('square'), [20, 20 + LINE]);
    for (const mode of ['tight', 'through'] as const) {
      for (const polygon of [RECTANGLE, LEANING]) {
        const layout = markAbove(mode, polygon);
        expectTops(layout, [2 * LINE, 3 * LINE]);
        // The picture keeps its place; only the mark moves.
        expect(layout.pages[0]!.anchoredDrawings![0]!.y).toBe(3);
      }
    }
  });

  test('a text line steps by its height below a contour anchored in an earlier paragraph', () => {
    // The picture covers 16pt to 33pt; the second paragraph's line starts one line down.
    const textAbove = (mode: Mode) =>
      render(
        `<w:p><w:r><w:t>Top</w:t></w:r>${anchor({ mode, y: 16, height: 17 })}</w:p>` + text('DATE:')
      );
    expectTops(textAbove('square'), [0, 33]);
    expectTops(textAbove('tight'), [0, 3 * LINE]);
    expectTops(textAbove('through'), [0, 3 * LINE]);
  });

  test('no glyph goes into a passage narrower than the glyph beside a contour', () => {
    for (const polygon of [RECTANGLE, LEANING]) {
      for (const mode of ['tight', 'through'] as const) {
        // A 4pt passage in front of the picture, narrower than any 6pt glyph.
        const layout = render(
          `<w:p>${anchor({ mode, y: 3, height: 17, left: 4, polygon })}</w:p>${text('DATE:')}`
        );
        const date = fragments(layout)[1]!;
        expect(date.lines).toHaveLength(1);
        expect(date.lines[0]!.spans.map((span) => span.text).join('')).toBe('DATE:');
        expectTops(layout, [2 * LINE, 3 * LINE]);
      }
    }
  });

  test('a horizontal rule keeps its line beside a float that leaves it a narrower passage', () => {
    const rule =
      '<w:p><w:r><w:pict><v:rect o:hrstd="t" o:hr="t" style="width:451.3pt;height:.05pt" ' +
      'fillcolor="#a0a0a0" stroked="f"/></w:pict></w:r></w:p>';
    for (const mode of ['square', 'tight', 'through'] as const) {
      // A 120pt picture 348pt in from the column covers 0pt to 20pt, beside the rule's line.
      const picture = anchor({ mode, y: 0, height: 20, width: 120, left: 348 });
      const layout = render(
        `<w:p><w:r><w:t>Top</w:t></w:r>${picture}</w:p>${rule}${text('DATE:')}`
      );
      const [top, ruled, date] = fragments(layout);
      expect(ruled!.box.y).toBeCloseTo(top!.box.height, 6);
      expect(ruled!.box.y).toBeLessThan(20);
      expect(date!.box.y).toBeCloseTo(ruled!.box.y + ruled!.box.height, 6);
    }
  });
});
