import { expect, test } from 'bun:test';
import { loadBody, layoutUnderFloat, squareWrapZone } from './float-over-table-harness.ts';
import { linesOf } from '../semantic-records.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../pending-line.ts';

const text = 'ABCD EFGH';
const paragraph = (properties: string) =>
  `<w:p><w:pPr>${properties}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function render(properties: string, prefix = '', columns = false, top = 0, height = 40) {
  const source = loadBody(
    prefix +
      paragraph(properties) +
      (columns ? '<w:sectPr><w:cols w:num="2" w:space="200"/></w:sectPr>' : '')
  );
  const target = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .filter((child) => child.kind === 'paragraph')
    .at(-1)!;
  const zone = {
    ...squareWrapZone({
      anchorParagraphId: target.id,
      top,
      height,
      left: columns ? 103 : 8,
      width: columns ? 57 : 132,
      contentWidth: 180,
    }),
    sourceKind: 'table' as const,
    columnIndex: columns ? 1 : 0,
  };
  const result = layoutUnderFloat(source, new Map([[0, [zone]]]));
  return { result, lines: linesOf(result).filter((line) => line.range.paragraphId === target.id) };
}

test.each([
  '<w:ind w:right="800"/>',
  '<w:ind w:end="800"/>',
  '<w:bidi/><w:ind w:start="800"/>',
  '<w:ind w:right="800" w:firstLine="240"/>',
])('table clearance respects the effective paragraph right edge: %s', (properties) => {
  const { lines } = render(properties);
  expect(lines).toHaveLength(1);
  expect(lines[0]!.box.y).toBe(40);
  expect(lines[0]!.spans.map((span) => span.text).join('')).toBe(text);
  for (const span of lines[0]!.spans) {
    expect(span.box.x).toBeGreaterThanOrEqual(properties.includes('firstLine') ? 12 : 0);
    expect(span.box.x + span.box.width).toBeLessThanOrEqual(140.001);
  }
});

test('right-indent clearance uses page coordinates in the second column', () => {
  const { lines } = render(
    '<w:ind w:right="400"/>',
    '<w:p><w:r><w:t>Lead</w:t><w:br w:type="column"/></w:r></w:p>',
    true
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]!.box.y).toBe(40);
  expect(lines[0]!.spans.map((span) => span.text).join('')).toBe(text);
  expect(lines[0]!.spans[0]!.box.x).toBe(95);
  for (const span of lines[0]!.spans) {
    expect(span.box.x).toBeGreaterThanOrEqual(95);
    expect(span.box.x + span.box.width).toBeLessThanOrEqual(160.001);
  }
});

test('indent clearance defers the paragraph when the remaining page band cannot fit it', () => {
  const { result, lines } = render(
    '<w:ind w:right="800"/>',
    '<w:p><w:pPr><w:spacing w:line="1200" w:lineRule="exact"/></w:pPr><w:r><w:t>Lead</w:t></w:r></w:p>',
    false,
    60,
    15
  );
  expect(result.pages).toHaveLength(2);
  expect(lines).toHaveLength(1);
  expect(lines[0]!.box.y).toBe(0);
  expect(lines[0]!.spans.map((span) => span.text).join('')).toBe(text);
  expect(
    result.pages[1]!.fragments.some(
      (fragment) => fragment.kind === 'paragraph' && fragment.lines.includes(lines[0]!)
    )
  ).toBe(true);
});

test('column-origin changes invalidate local wrapping without changing paragraph width', () => {
  const make = (first: number, third: number) =>
    loadBody(
      '<w:p><w:r><w:t>Lead</w:t><w:br w:type="column"/></w:r></w:p>' +
        paragraph('') +
        `<w:sectPr><w:cols w:num="3" w:equalWidth="0"><w:col w:w="${first * 20}" w:space="200"/>` +
        `<w:col w:w="1200" w:space="200"/><w:col w:w="${third * 20}"/></w:cols></w:sectPr>`
    );
  const initial = make(50, 70);
  const replacement = make(70, 50);
  const body = initial.root.children.find((child) => child.localName === 'body')!;
  const replacementBody = replacement.root.children.find((child) => child.localName === 'body')!;
  if (!('children' in body) || !('children' in replacementBody)) throw Error('body');
  const changed = {
    ...initial,
    root: {
      ...initial.root,
      children: initial.root.children.map((child) =>
        child === body
          ? {
              ...body,
              children: body.children.map((node) =>
                node.localName === 'sectPr'
                  ? replacementBody.children.find((node) => node.localName === 'sectPr')!
                  : node
              ),
            }
          : child
      ),
    },
  };
  const target = body.children.filter((child) => child.kind === 'paragraph').at(-1)!;
  const table = {
    ...squareWrapZone({
      anchorParagraphId: target.id,
      top: 0,
      height: 40,
      left: 70,
      width: 30,
      contentWidth: 200,
    }),
    sourceKind: 'table' as const,
    columnIndex: 1,
  };
  const options = {
    measurer: createFixedMeasurer(),
    geometry: { width: 220, height: 200, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    inlineDrawingLayout: {
      ownerPartName: '/word/document.xml',
      project: () => null,
      resourceOf: () => {
        throw Error('no drawing resources');
      },
    },
    drawingExclusionPass: 0,
    drawingExclusionZonesByPage: new Map([[0, [table]]]),
  };
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const starts: number[] = [];
  for (const [revision, source] of [initial, changed, initial].entries()) {
    const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
    const cold = layoutSemanticDocument(source, revision, options);
    expect(warm.pages).toEqual(cold.pages);
    const targetLines = linesOf(warm).filter((line) => line.range.paragraphId === target.id);
    expect(targetLines.map((line) => line.spans.map((span) => span.text).join('')).join('')).toBe(
      text
    );
    // The 20pt passage of the narrow layout cannot hold the opening word, which moves below
    // the table to the column's origin; the 40pt passage of the wider one holds it.
    expect(targetLines[0]!.spans[0]!.box.x).toBe(revision === 1 ? 100 : 60);
    starts.push(targetLines[0]!.range.end);
  }
  expect(starts[0]).not.toBe(starts[1]);
  expect(starts[0]).toBe(starts[2]);
});

// A float that shortens a line moves the paragraph's own horizontal geometry with it: Word
// measures a first-line indent from the start of the usable segment, and centres between the
// pictures beside the line rather than between the page margins.
function beside(properties: string, zones: readonly { left: number; width: number }[]) {
  const source = loadBody(paragraph(properties));
  const target = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .filter((child) => child.kind === 'paragraph')
    .at(-1)!;
  const built = zones.map((zone, index) => ({
    ...squareWrapZone({
      anchorParagraphId: target.id,
      top: 0,
      height: 40,
      left: zone.left,
      width: zone.width,
      contentWidth: 180,
      drawingNodeId: `float-${index}`,
    }),
    sourceKind: 'table' as const,
  }));
  return linesOf(layoutUnderFloat(source, new Map([[0, built]])))
    .filter((line) => line.range.paragraphId === target.id)
    .map((line) => line.spans[0]!.box.x);
}

test('a first-line indent is measured from the float-shortened left edge', () => {
  // Without the float the first line starts at 12pt; the float moves the whole measure.
  expect(beside('<w:ind w:firstLine="240"/>', [{ left: 0, width: 60 }])[0]).toBe(72);
  expect(beside('<w:ind w:firstLine="240"/>', [])[0]).toBe(12);
});

test('a centred line centres inside the passage the floats leave it', () => {
  const between = beside('<w:jc w:val="center"/>', [
    { left: 0, width: 40 },
    { left: 140, width: 40 },
  ]);
  const full = beside('<w:jc w:val="center"/>', []);
  // The passage [40, 140) shares its midpoint with the 180pt measure, so a centred line does
  // not move — proving the snap advance is not counted as content.
  expect(between[0]).toBe(full[0]!);
});
