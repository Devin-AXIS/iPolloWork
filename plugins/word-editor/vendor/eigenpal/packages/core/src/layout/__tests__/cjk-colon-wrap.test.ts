import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { compressCjkPieces, cjkSeamNaturalWidths } from '../cjk-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { anchorLineStartsByModelOffset } from '../anchor-line-probe.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { createLayoutSession } from '../layout-session.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { squareWrapZone } from './float-over-table-harness.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const policy = {
  ...DEFAULT_CJK_TYPOGRAPHY,
  settings: {
    compression: 'compressPunctuation' as const,
    sourceEastAsianFont: true,
    strict: false,
    before: {},
    after: {},
  },
};
// Hiragino Mincho ProN W3 gives these characters 1000-unit advances. Its colon ink
// reaches 570 units, so retaining a half-em colon at a line edge crosses the margin.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    text.length *
    ((style.fontSizePt * style.horizontalScalePercent) / 100 + style.characterSpacingPt),
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};
function part(xml: string) {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
const doc = part(
  `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Hiragino Mincho ProN" w:eastAsia="Hiragino Mincho ProN"/><w:sz w:val="24"/><w:kern w:val="2"/></w:rPr><w:t>甲甲甲甲：【乙丙丁</w:t></w:r></w:p></w:body></w:document>`
);
const settings = part(
  `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
);
// The document default names a face that turns compression on; Hiragino as a default does not.
const styles = part(
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
);
const cascade = buildStyleCascadeTable(styles.root, undefined, settings.root);
function layout(width: number, session = createLayoutSession(), enabled = true, source = doc) {
  return layoutSemanticDocument(source, 0, {
    measurer,
    session,
    styleCascade: enabled ? cascade : buildStyleCascadeTable(null),
    geometry: {
      width: width + 20,
      height: 500,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
}

test.each([30, 42, 54, 60, 66, 78])('compressed colon ink stays within a %s pt line', (width) => {
  const result = layout(width);
  for (const line of linesOf(result))
    for (const [index, span] of line.spans.entries()) {
      if (!span.text.includes('：')) continue;
      const at = span.text.indexOf('：');
      const inkEnd = span.box.x + measurer.measure(span.text.slice(0, at), span.style) + 12 * 0.57;
      expect(inkEnd).toBeLessThanOrEqual(width);
      if (span.glyphOffsetPt === 0) expect(line.spans[index + 1]?.text.startsWith('【')).toBe(true);
    }
});

test('Word restores colon compression after wrapping and cache reuse', () => {
  const session = createLayoutSession();
  const textLines = (width: number, enabled = true) =>
    linesOf(layout(width, session, enabled)).map((line) =>
      line.spans.map((span) => span.text).join('')
    );
  const natural = textLines(54, false);
  expect(natural).toEqual(['甲甲甲', '甲：【乙', '丙丁']);
  const word = ['甲甲甲', '甲：【乙丙', '丁'];
  expect(textLines(54)).toEqual(word);
  expect(textLines(54)).toEqual(word);
  expect(textLines(78)).toEqual(['甲甲甲甲：【乙', '丙丁']);
  expect(textLines(54)).toEqual(word);
});

test('a centered colon retains the complete band for highlight and shading', () => {
  for (const decoration of [{ shading: '000000' }, { highlight: 'yellow' as const }]) {
    const style = {
      ...DEFAULT_RUN_STYLE,
      kerningMinPt: 1,
      fontSizePt: 12,
      color: 'FFFFFF',
      ...decoration,
    };
    const pieces = [
      { text: '：', start: 0, end: 1, props: [], style },
      {
        text: '【甲',
        start: 1,
        end: 3,
        props: [],
        style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1, fontSizePt: 12 },
      },
    ];
    const compressed = compressCjkPieces(pieces, policy, measurer);
    expect(compressed[0]).toBe(pieces[0]);
    expect(measurer.measure(compressed[0]!.text, compressed[0]!.style)).toBe(12);
  }
});

// Native Word PDF, Hiragino Mincho ProN W3, 12 pt, 54 pt measure.
// The origins come from Word's PDF content, independently of this measurer.
test('Word narrow-line origins survive every source-run split', () => {
  const text = '甲甲甲甲：【乙丙丁';
  const run = (value: string) =>
    `<w:r><w:rPr><w:sz w:val="24"/><w:kern w:val="2"/></w:rPr><w:t>${value}</w:t></w:r>`;
  for (let split = 0; split <= text.length; split++) {
    const source = part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/></w:pPr>${run(text.slice(0, split))}${run(text.slice(split))}</w:p></w:body></w:document>`
    );
    const lines = linesOf(layout(54, createLayoutSession(), true, source));
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '甲甲甲',
      '甲：【乙丙',
      '丁',
    ]);
    const origins = lines[1]!.spans.flatMap((span) =>
      [...span.text].map(
        (_, offset) =>
          span.box.x +
          measurer.measure(span.text.slice(0, offset), span.style) +
          (span.glyphOffsetPt ?? 0)
      )
    );
    expect(origins).toEqual([0, 12, 18, 30, 42]);
  }
});

test('colon fit widths retain authored tracking, size, and scale', () => {
  for (const characterSpacingPt of [-2, 0, 3]) {
    const pieces = [
      { text: '甲', start: 0, end: 1, props: [], style: DEFAULT_RUN_STYLE },
      {
        text: '：【甲',
        start: 1,
        end: 4,
        props: [],
        style: {
          ...DEFAULT_RUN_STYLE,
          kerningMinPt: 1,
          fontSizePt: 18,
          horizontalScalePercent: 50,
          characterSpacingPt,
        },
      },
    ];
    const compressed = compressCjkPieces(pieces, policy, measurer);
    const widths = cjkSeamNaturalWidths(compressed, pieces, measurer);
    const colon = compressed.find((piece) => piece.text === '：')!;
    expect(widths.get(colon)).toBe(9 + characterSpacingPt);
    expect(measurer.measure(colon.text, colon.style)).toBe(4.5 + characterSpacingPt);
  }
});

test('anchor prediction uses the colon fit width before its shared bearing reduction', () => {
  const originals = [
    {
      text: '甲甲甲甲：【乙丙丁',
      start: 0,
      end: 9,
      props: [],
      style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1, fontSizePt: 12 },
    },
  ];
  const pieces = compressCjkPieces(originals, policy, measurer);
  const anchors = anchorLineStartsByModelOffset({
    pieces,
    seamNaturalWidths: cjkSeamNaturalWidths(pieces, originals, measurer),
    cjkBreaks: cjkParagraphBreaks(pieces, policy),
    typography: { ...policy, overflowPunctuation: false },
    measurer,
    available: 54,
    firstLineOffset: 0,
    anchorStarts: [3, 4, 5, 7, 8],
    equationLayoutOf: () => null,
  });
  expect([...anchors.entries()]).toEqual([
    [3, 3],
    [4, 3],
    [5, 3],
    [7, 3],
    [8, 8],
  ]);
});

test('a colon cannot borrow a bearing across two drawing passages', () => {
  const paragraph = doc.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zone = squareWrapZone({
    anchorParagraphId: 'earlier-paragraph',
    top: 0,
    height: 100,
    left: 60,
    width: 30,
    contentWidth: 150,
  });
  const lines = breakParagraph(
    paragraph,
    paragraph.id,
    0,
    150,
    measurer,
    undefined,
    null,
    [],
    undefined,
    undefined,
    undefined,
    {
      typography: { ...policy, overflowPunctuation: false },
      pageExclusionZones: [zone],
      paragraphStartY: 0,
    }
  );
  const spans = lines.flatMap((line) => line.spans);
  expect(spans.map((span) => span.text).join('')).toBe('甲甲甲甲：【乙丙丁');
  const colon = spans.find((span) => span.text.includes('：'))!;
  const opening = spans.find((span) => span.text.startsWith('【'))!;
  expect(colon.style.characterSpacingPt).toBe(0);
  expect(colon.glyphOffsetPt).toBeUndefined();
  expect(opening.box.x).toBe(90);
  expect(opening.wrapAdvanceBefore).toBe(30);
});
