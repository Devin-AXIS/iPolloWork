import { anyShrunk, shrunkBy, spacingOf } from './shrunk-space.ts';
import { expect, test } from 'bun:test';
import { loadBody, squareWrapZone } from './float-over-table-harness.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord, type TextMeasurer } from '../semantic-records.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';

const measurer: TextMeasurer = {
  measure(text, style) {
    return [...text].reduce(
      (sum, character) => sum + (character === ' ' ? 4 + (style.shaping?.wordSpacingPt ?? 0) : 10),
      0
    );
  },
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};
const drawings: InlineDrawingLayoutContext = {
  ownerPartName: '/word/document.xml',
  project: () => null,
  resourceOf: () => {
    throw new Error('This fixture uses a synthetic square wrap zone');
  },
};

function layout(options: {
  readonly runs?: readonly string[];
  readonly boldIndex?: number;
  readonly rtl?: boolean;
  readonly text?: string;
  readonly width?: number;
  readonly floatLeft?: number;
  readonly floatWidth?: number;
  readonly floatTop?: number;
  readonly float?: boolean;
  readonly floats?: readonly { readonly left: number; readonly width: number }[];
  readonly wrap?: 'square' | 'tight';
  readonly alignment?: string;
  readonly tabs?: readonly {
    readonly alignment: 'left' | 'center' | 'right';
    readonly position: number;
  }[];
  readonly compatibilityMode?: number;
}) {
  const width = options.width ?? 180;
  const runs = options.runs ?? [options.text ?? 'aa bb cc dd ee'];
  const tabs = options.tabs
    ? '<w:tabs>' +
      options.tabs
        .map((tab) => `<w:tab w:val="${tab.alignment}" w:pos="${tab.position * 20}"/>`)
        .join('') +
      '</w:tabs>'
    : '';
  const part = loadBody(
    `<w:p><w:pPr><w:jc w:val="${options.alignment ?? 'both'}"/>${options.rtl ? '<w:bidi/>' : ''}${tabs}</w:pPr>` +
      runs
        .map(
          (text, index) =>
            `<w:r>${index === options.boldIndex ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
        )
        .join('') +
      '</w:p>'
  );
  const paragraph = part.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zones = (
    options.floats ?? [{ left: options.floatLeft ?? 22, width: options.floatWidth ?? 92 }]
  ).map((float, index) => {
    const top = options.floatTop ?? 0;
    const zone = squareWrapZone({
      anchorParagraphId: paragraph.id,
      top,
      height: 70,
      left: float.left,
      width: float.width,
      contentWidth: width,
      drawingNodeId: `float-${index}`,
    });
    if (options.wrap !== 'tight') return zone;
    const right = float.left + float.width;
    const polygon = [
      { x: float.left, y: top },
      { x: right, y: top },
      { x: right, y: top + 70 },
      { x: float.left, y: top + 70 },
    ];
    return { ...zone, input: { ...zone.input, mode: 'tight' as const, polygon } };
  });
  return linesOf(
    layoutSemanticDocument(part, 1, {
      measurer,
      compatibilityMode: options.compatibilityMode,
      geometry: {
        width: width + 20,
        height: 180,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      inlineDrawingLayout: drawings,
      drawingExclusionZonesByPage: new Map([[0, options.float === false ? [] : zones]]),
      drawingExclusionPass: 0,
    })
  );
}

function text(line: LineRecord, from = 0, to = Infinity): string {
  return line.spans
    .filter((span) => span.box.x >= from - 0.001 && span.box.x < to - 0.001)
    .map((span) => span.text)
    .join('')
    .trimEnd();
}

function outsideFloat(line: LineRecord, left: number, right: number): void {
  for (const span of line.spans) {
    const visible = span.text.trimEnd();
    if (!visible) continue;
    const end = span.box.x + measurer.measure(visible, span.style);
    expect(end <= left + 0.001 || span.box.x >= right - 0.001).toBe(true);
  }
}

test('a 66pt right passage admits the same extra word as a plain 66pt line', () => {
  const plain = layout({ text: 'bb cc dd ee', width: 66, float: false, compatibilityMode: 15 });
  expect(plain.map((line) => text(line))).toEqual(['bb cc dd', 'ee']);
  const lines = layout({ compatibilityMode: 15 });
  expect(text(lines[0]!, 114)).toBe('bb cc dd');
  expect(text(lines[1]!)).toBe('ee');
  const right = lines[0]!.spans.filter((span) => span.box.x >= 114);
  expect(spacingOf(right).slice(0, 2)).toEqual([-1, -1]);
  expect(
    right.at(-1)!.box.x + measurer.measure(right.at(-1)!.text.trimEnd(), right.at(-1)!.style)
  ).toBeCloseTo(180, 6);
  outsideFloat(lines[0]!, 22, 114);
});

test('both passages compress independently without moving glyphs into the float', () => {
  const lines = layout({
    width: 224,
    floatLeft: 66,
    text: 'aa bb cc dd ee ff gg',
    compatibilityMode: 15,
  });
  expect(text(lines[0]!, 0, 66)).toBe('aa bb cc');
  expect(text(lines[0]!, 158)).toBe('dd ee ff');
  expect(text(lines[1]!)).toBe('gg');
  outsideFloat(lines[0]!, 66, 158);
});

test('a 65pt right passage cannot borrow compression capacity across the float', () => {
  const lines = layout({
    width: 223,
    floatLeft: 66,
    text: 'aa bb cc dd ee ff gg',
    compatibilityMode: 15,
  });
  expect(text(lines[0]!, 0, 66)).toBe('aa bb cc');
  expect(text(lines[0]!, 158)).toBe('dd ee');
  outsideFloat(lines[0]!, 66, 158);
});

test('a word split across source runs borrows only its passage spaces', () => {
  for (const boldIndex of [undefined, 1]) {
    const lines = layout({ runs: ['aa bb cc d', 'd ee'], boldIndex, compatibilityMode: 15 });
    expect(text(lines[0]!, 114)).toBe('bb cc dd');
    outsideFloat(lines[0]!, 22, 114);
  }
});

test('three passages each use their own compression slots', () => {
  const lines = layout({
    width: 382,
    floats: [
      { left: 66, width: 92 },
      { left: 224, width: 92 },
    ],
    text: 'aa bb cc dd ee ff gg hh ii jj',
    compatibilityMode: 15,
  });
  expect(text(lines[0]!, 0, 66)).toBe('aa bb cc');
  expect(text(lines[0]!, 158, 224)).toBe('dd ee ff');
  expect(text(lines[0]!, 316)).toBe('gg hh ii');
  outsideFloat(lines[0]!, 66, 158);
  outsideFloat(lines[0]!, 224, 316);
});

test('right-to-left paragraphs keep their existing float admission behavior', () => {
  const ranges = (lines: readonly LineRecord[]) =>
    lines.map((line) => [line.range.start, line.range.end]);
  const options = { rtl: true, text: 'aa bb cc dd ee' };
  const lines = layout({ ...options, compatibilityMode: 15 });
  expect(lines.some((line) => anyShrunk(line.spans))).toBe(false);
  // Compression stays off, so the lines break where legacy mode breaks them.
  expect(ranges(lines)).toEqual(ranges(layout({ ...options, compatibilityMode: 14 })));
});

test('a right-to-left run leaves compression on in its left-to-right paragraph', () => {
  // On a later line, in the compressed passage itself, and in the line's last word.
  for (const [source, passage] of [
    ['aa bb cc dd ee אב', 'bb cc dd'],
    ['aa bb אב dd ee', 'bb אב dd'],
    ['aa bb cc אב ee', 'bb cc אב'],
  ] as const) {
    const lines = layout({ text: source, compatibilityMode: 15 });
    expect(text(lines[0]!, 114)).toBe(passage);
    // Its two spaces each lend 1pt, wherever the run boundaries fall.
    const right = lines[0]!.spans.filter((span) => span.box.x >= 114);
    const shrink = spacingOf(right);
    expect(shrink.reduce((sum, value) => sum + value, 0)).toBeCloseTo(-2, 6);
    expect(shrink.filter((value) => value !== 0)).toEqual([-1, -1]);
    outsideFloat(lines[0]!, 22, 114);
    // Legacy modes do not compress, so the passage keeps only two words.
    expect(text(layout({ text: source, compatibilityMode: 14 })[0]!, 114)).toBe(
      passage.split(' ').slice(0, 2).join(' ')
    );
  }
});

test('spaces after a left tab compress inside the remaining float passage', () => {
  const lines = layout({
    text: 'aa\tbb cc dd ee',
    tabs: [{ alignment: 'left', position: 114 }],
    compatibilityMode: 15,
  });
  expect(text(lines[0]!, 114)).toBe('bb cc dd');
  const tab = lines[0]!.spans.find((span) => span.text === '\t')!;
  expect(tab.box.x + tab.box.width).toBeCloseTo(114, 6);
  const bb = lines[0]!.spans.find((span) => span.text.startsWith('bb'))!;
  expect(bb.box.x).toBeCloseTo(114, 6);
  expect(shrunkBy(lines[0]!.spans, lines[0]!.spans.indexOf(bb))).toBeCloseTo(1, 6);
  outsideFloat(lines[0]!, 22, 114);
});

test('a float passage cannot borrow spaces before its left tab', () => {
  const lines = layout({
    width: 223,
    floatLeft: 66,
    text: 'a a\tbb cc dd ee',
    tabs: [{ alignment: 'left', position: 158 }],
    compatibilityMode: 15,
  });
  // The right passage needs 3pt. Its two slots lend 2pt; the earlier slot lends nothing.
  expect(text(lines[0]!, 158)).toBe('bb cc');
  const tab = lines[0]!.spans.find((span) => span.text === '\t')!;
  const throughTab = lines[0]!.spans.slice(0, lines[0]!.spans.indexOf(tab) + 1);
  expect(anyShrunk(throughTab)).toBe(false);
  outsideFloat(lines[0]!, 66, 158);
});

test('center and right tabs keep their uncompressed text beside a float', () => {
  for (const tab of [
    { alignment: 'center' as const, position: 148 },
    { alignment: 'right' as const, position: 180 },
  ]) {
    const lines = layout({
      text: 'aa\tbb cc dd',
      tabs: [tab],
      compatibilityMode: 15,
    });
    expect(text(lines[0]!, 114)).toBe('bb cc');
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => anyShrunk(line.spans))).toBe(false);
    outsideFloat(lines[0]!, 22, 114);
  }
});

test('the paragraph final word can compress the last passage', () => {
  const lines = layout({ text: 'aa bb cc dd', compatibilityMode: 15 });
  expect(lines).toHaveLength(1);
  expect(text(lines[0]!, 114)).toBe('bb cc dd');
  outsideFloat(lines[0]!, 22, 114);
});

test('one-sided wrapping uses the remaining passage width', () => {
  const lines = layout({
    floatLeft: 0,
    floatWidth: 114,
    text: 'bb cc dd ee',
    compatibilityMode: 15,
  });
  expect(text(lines[0]!)).toBe('bb cc dd');
  outsideFloat(lines[0]!, 0, 114);
});

test('a compressed line beside a right float ends at its passage edge', () => {
  for (const wrap of ['square', 'tight'] as const) {
    const lines = layout({
      floatLeft: 66,
      floatWidth: 114,
      text: 'bb cc dd ee',
      wrap,
      compatibilityMode: 15,
    });
    expect(lines.map((line) => text(line))).toEqual(['bb cc dd', 'ee']);
    const spans = lines[0]!.spans;
    expect(spacingOf(spans).slice(0, 2)).toEqual([-1, -1]);
    const last = spans.at(-1)!;
    expect(last.box.x + measurer.measure(last.text.trimEnd(), last.style)).toBeCloseTo(66, 6);
    outsideFloat(lines[0]!, 66, 180);
  }
});

test('a compressed line in the left passage of a middle float ends before the float', () => {
  // The 14pt passage right of the float holds no word, so each line stays in the left one.
  const lines = layout({
    floatLeft: 66,
    floatWidth: 100,
    text: 'bb cc dd ee',
    compatibilityMode: 15,
  });
  expect(lines.map((line) => text(line))).toEqual(['bb cc dd', 'ee']);
  const last = lines[0]!.spans.at(-1)!;
  expect(last.box.x + measurer.measure(last.text.trimEnd(), last.style)).toBeCloseTo(66, 6);
  outsideFloat(lines[0]!, 66, 166);
});

test('legacy, unspecified compatibility, and left alignment retain their line breaks', () => {
  for (const compatibilityMode of [undefined, 14]) {
    const lines = layout({ compatibilityMode });
    expect(text(lines[0]!, 114)).toBe('bb cc');
  }
  const lines = layout({ alignment: 'left', compatibilityMode: 15 });
  expect(text(lines[0]!, 114)).toBe('bb cc');
});

test('a float below the line leaves ordinary space admission unchanged', () => {
  const lines = layout({ text: 'aa bb cc dd', width: 66, floatTop: 100, compatibilityMode: 15 });
  expect(text(lines[0]!)).toBe('aa bb cc');
});
