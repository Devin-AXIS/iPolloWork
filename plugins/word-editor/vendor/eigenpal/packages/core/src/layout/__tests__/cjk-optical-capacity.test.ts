import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';

// Fullwidth advances and left/right ink in em, close to a common Simplified Chinese face. The
// widths below are the narrowest measures at which the native application kept the case whole
// on the first line, and the 0.1pt narrower measure at which it did not.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ink: Record<string, [number, number]> = {
  '。': [0.14, 0.36],
  '，': [0.14, 0.3],
  '、': [0.14, 0.33],
  '：': [0.13, 0.27],
  '」': [0.12, 0.45],
  '「': [0.55, 0.88],
  '》': [0.1, 0.45],
  '（': [0.6, 0.9],
};
const measurer: TextMeasurer = {
  measure: (text, style) =>
    ([...text].reduce((sum, c) => sum + (c === ' ' ? 0.25 : 1), 0) *
      style.fontSizePt *
      style.horizontalScalePercent) /
      100 +
    text.length * style.characterSpacingPt,
  inkBounds(text, style) {
    const [left, right] = ink[text] ?? [0.05, 0.95];
    return { left: left * style.fontSizePt, right: right * style.fontSizePt };
  },
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};
function part(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const settings = part(
  `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
);
const styles = part(
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
);
const FILLER = '甲乙丙丁戊己庚辛壬癸';
type Run = string | { readonly text: string; readonly halfPoints: number };
/** The lines of one justified paragraph: the runs, then ideographs that fill the next line. */
function layoutLines(runs: readonly Run[], width: number, pPr = '', rPr = '') {
  const run = (value: Run) => {
    const { text, halfPoints } =
      typeof value === 'string' ? { text: value, halfPoints: 24 } : value;
    return `<w:r><w:rPr><w:sz w:val="${halfPoints}"/>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  };
  const source = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/>${pPr}</w:pPr>${[...runs, FILLER].map(run).join('')}</w:p></w:body></w:document>`
  );
  return linesOf(
    layoutSemanticDocument(source, 0, {
      measurer,
      styleCascade: buildStyleCascadeTable(
        styles.root,
        { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
        settings.root
      ),
      geometry: {
        width: width + 20,
        height: 2000,
        margin: { top: 10, bottom: 10, left: 10, right: 10 },
      },
    })
  );
}
const lines = (runs: readonly Run[], width: number, pPr = '', rPr = '') =>
  layoutLines(runs, width, pPr, rPr).map((line) => line.spans.map((span) => span.text).join(''));
/** Glyph origins on the first line, from its first glyph, in points to two decimals. */
function firstOrigins(runs: readonly Run[], width: number) {
  const spans = layoutLines(runs, width)[0]!.spans;
  const start = spans[0]!.box.x;
  return spans.flatMap((span) =>
    [...span.text].map(
      (_, offset) =>
        Math.round(
          (span.box.x +
            measurer.measure(span.text.slice(0, offset), span.style) +
            (span.glyphOffsetPt ?? 0) -
            start) *
            100
        ) / 100
    )
  );
}
const textOf = (runs: readonly Run[]) =>
  runs.map((value) => (typeof value === 'string' ? value : value.text)).join('');
function threshold(runs: readonly Run[], fits: number, breaks: number, pPr = '', rPr = '') {
  const text = textOf(runs);
  expect({ width: fits, first: lines(runs, fits, pPr, rPr)[0]!.startsWith(text) }).toEqual({
    width: fits,
    first: true,
  });
  expect({ width: breaks, first: lines(runs, breaks, pPr, rPr)[0]!.startsWith(text) }).toEqual({
    width: breaks,
    first: false,
  });
}

test('a glyph joins a justified line when its compression share stays within the expansion it saves', () => {
  // Two blank sides at 12pt: 11.4pt of compression, more than the old half-glyph limit.
  threshold(['甲。乙，丙'], 48.6, 48.5);
  // More sides on a longer line: four sides, nine glyphs.
  threshold(['甲。乙，丙、丁：戊'], 96.7, 96.6);
  // The same two sides on a 15-glyph line: leaving the glyph off spreads its room thinner.
  threshold(['甲乙丙丁戊己庚辛壬癸甲。乙，丙'], 170.05, 170.0);
  // One blank side fits only its own half-em.
  threshold(['甲乙。丙丁'], 54.0, 53.9);
});

test('the expansion gate scales with the font size', () => {
  threshold([{ text: '甲。乙，丙', halfPoints: 16 }], 32.4, 32.35);
  threshold([{ text: '甲。乙，丙', halfPoints: 48 }], 97.1, 96.85);
});

test('adjacent punctuation compresses both blank sides', () => {
  for (const text of ['甲」。丁戊', '甲：「乙戊', '甲「「乙戊', '甲」「乙戊'])
    threshold([text], 48.6, 48.5);
});

test('a smaller blank side passes the rest of its share to the other sides', () => {
  // 5.25pt + 6pt of capacity, not two equal 5.25pt shares.
  threshold(['甲', { text: '。', halfPoints: 21 }, '乙，丙'], 47.3, 47.2);
  // The full stop gives all of its 5.25pt; the comma gives the other 5.95pt.
  const spans = layoutLines(['甲', { text: '。', halfPoints: 21 }, '乙，丙'], 47.3)[0]!.spans;
  expect(spans.find((span) => span.text === '。')!.box.width).toBeCloseTo(5.25, 8);
  expect(spans.find((span) => span.text === '，')!.box.width).toBeCloseTo(6.05, 8);
});

test('both sides of a mixed-size pair give at most half of the smaller glyph', () => {
  threshold([{ text: '甲》', halfPoints: 21 }, '（乙戊'], 46.5, 46.4);
});

test('a justified line hangs its final mark and compresses the marks before it', () => {
  // The full stop hangs past the margin and the two sides before it give 11.15pt.
  threshold(['甲。乙，丙丁。'], 60.85, 60.6);
  threshold(['甲乙。丙。'], 42.1, 41.85);
  // The middle full stop gives 5.9pt and the final one starts at the margin.
  expect(firstOrigins(['甲乙。丙。'], 42.1).slice(0, 5)).toEqual([0, 12, 24, 30.1, 42.1]);
  // With hanging off, the final mark only drops its trailing blank.
  threshold(['甲乙。丙。'], 48.0, 47.9, '<w:overflowPunct w:val="0"/>');
});

test('a kerned pair keeps its natural compression and fits only its remaining blank side', () => {
  // Kerning already takes one half-em from the pair; fitting may take only the other.
  threshold(['甲」「乙戊'], 48.0, 47.9, '', '<w:kern w:val="2"/>');
});

test('the final mark relief counts as capacity in the expansion gate', () => {
  // Hanging: the hung full stop counts as 12pt of capacity, and the deficit includes it.
  threshold(['甲。乙，丙、丁戊。'], 84.9, 84.85);
  threshold(['甲。乙，丙、丁：戊。己戊。'], 133.05, 133.0);
  threshold(['甲乙丙丁戊己庚辛壬癸甲。乙，丙戊。'], 182.4, 182.35);
  // Hanging off: the dropped trailing half counts the same way.
  threshold(['甲。乙，丙、丁：戊。己戊。'], 133.2, 133.15, '<w:overflowPunct w:val="0"/>');
});

test('a candidate that opens with a bracket passes the expansion gate too', () => {
  threshold(['甲。乙，丙、丁（戊'], 85.1, 85.0);
});
