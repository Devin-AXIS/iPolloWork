// Cover-page vertical rhythm: auto line spacing extras sit BELOW each line, and a taller
// paragraph mark leaves a line with text at the text's own height. A title block checks the
// full inter-glyph gap sequence, not a single padding assertion.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  applyLineSpacing,
  buildStyleCascadeTable,
  layoutSemanticDocument,
  linesOf,
  type TextMeasurer,
} from '../index.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OWNER = '/word/document.xml';

/** Size-aware metrics (~Arial): height ≈ 1.15em, baseline ≈ 0.9em. */
const measurer: TextMeasurer = {
  measure(text, style) {
    return text.length * style.fontSizePt * 0.5;
  },
  lineMetrics(style) {
    return { height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 };
  },
};

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: OWNER,
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });

const RUN_H = 10 * 1.15;
const RUN_BL = 10 * 0.9;
/** Auto 460/240 extras on a 10pt run line. */
const AUTO_460_EXTRA = RUN_H * (460 / 240) - RUN_H;

describe('auto line spacing and paragraph-mark height', () => {
  test('unformatted marks do not inflate smaller text in body or table cells', () => {
    // Word: 9pt Arial text advances about 10.32pt even with an 11pt Normal
    // style. The style still sizes an empty paragraph's caret line.
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
        '<w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults></w:styles>',
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const small = '<w:p><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>Small text</w:t></w:r></w:p>';
    for (const body of [
      small,
      `<w:tbl><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${small}</w:tc></w:tr></w:tbl>`,
    ]) {
      const layout = layoutSemanticDocument(load(body), 1, {
        measurer,
        styleCascade: buildStyleCascadeTable(styles.part.root),
      });
      expect(linesOf(layout)[0]!.box.height).toBeCloseTo(9 * 1.15, 5);
    }
    const empty = layoutSemanticDocument(load('<w:p/>'), 1, {
      measurer,
      styleCascade: buildStyleCascadeTable(styles.part.root),
    });
    expect(linesOf(empty)[0]!.box.height).toBeCloseTo(11 * 1.15, 5);
  });

  test('auto extras leave the baseline put (space falls below)', () => {
    expect(applyLineSpacing({ rule: 'auto', value: 460 }, RUN_H, RUN_BL)).toEqual({
      height: RUN_H * (460 / 240),
      baseline: RUN_BL,
    });
  });

  test('a taller mark leaves a text line at the text height', () => {
    const markTall = linesOf(
      lay(
        '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
          '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>'
      )
    )[0]!;
    expect(markTall.box.height).toBeCloseTo(RUN_H, 5);
    expect(markTall.baseline).toBeCloseTo(RUN_BL, 5);
    expect(markTall.leading).toBeCloseTo(0, 5);
  });

  // Adapted from PR #707, cac0249b7. Approximate missing-face metrics are not a mark floor.
  test('unavailable mark metrics do not enlarge text, but still size empty paragraphs', () => {
    const fontAwareMeasurer: TextMeasurer = {
      ...measurer,
      hasResolvedFont(style) {
        return style.fontFamily !== 'Unavailable Mark Face';
      },
    };
    const mark =
      '<w:pPr><w:rPr><w:rFonts w:ascii="Unavailable Mark Face"/>' +
      '<w:sz w:val="32"/></w:rPr></w:pPr>';
    const visible =
      '<w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="20"/></w:rPr>' +
      '<w:t>visible</w:t></w:r>';
    const layout = layoutSemanticDocument(
      load('<w:p>' + mark + visible + '</w:p><w:p>' + mark + '</w:p>'),
      1,
      { measurer: fontAwareMeasurer }
    );
    const lines = linesOf(layout);
    expect(lines[0]!.box.height).toBeCloseTo(RUN_H, 5);
    expect(lines[1]!.box.height).toBeCloseTo(16 * 1.15, 5);
  });

  test('title-block inter-glyph gaps follow the line arithmetic line-by-line', () => {
    // The spacing of a title region.
    // "as Borrower and" keeps the authored left/right indents so it wraps; every wrap line
    // must appear in the gap table (skipping a wrap line previously hid a 30pt false gap).
    const body =
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="182"/>' +
      '<w:jc w:val="center"/></w:pPr><w:r><w:t>LOAN FACILITY</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="202" w:line="460" w:lineRule="auto"/>' +
      '<w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>between</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="TableParagraph"/><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN HOLDINGS PLC</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="22" w:line="460" w:lineRule="auto"/>' +
      '<w:ind w:left="4816" w:right="4838"/><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>as Borrower and</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="TableParagraph"/><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>APEX CAPITAL PARTNERS LIMITED</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:line="218" w:lineRule="exact"/>' +
      '<w:jc w:val="center"/></w:pPr><w:r><w:t>as Lender</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="11900" w:h="16840"/>' +
      '<w:pgMar w:top="600" w:right="540" w:bottom="440" w:left="560"/></w:sectPr>';

    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}">` +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>' +
        '<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="20"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="BodyText"><w:basedOn w:val="Normal"/>' +
        '<w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableParagraph">' +
        '<w:basedOn w:val="Normal"/></w:style></w:styles>',
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const layout = layoutSemanticDocument(load(body), 1, {
      measurer,
      styleCascade: buildStyleCascadeTable(styles.part.root),
    });

    // First page body lines in order through "as Lender" — no regex that drops wrap lines.
    const focus: ReturnType<typeof linesOf> = [];
    for (const line of linesOf(layout)) {
      focus.push(line);
      const text = line.spans.map((span) => span.text).join('');
      if (text.includes('as Lender')) break;
    }
    expect(focus.length).toBeGreaterThanOrEqual(7);

    const glyphTop = (line: (typeof focus)[number]) => line.box.y + line.leading;
    const glyphBottom = (line: (typeof focus)[number]) => {
      const spanH = Math.max(0, ...line.spans.map((span) => span.box.height), RUN_H);
      return line.box.y + line.leading + spanH;
    };

    const labels = focus.map((line) => line.spans.map((span) => span.text).join(''));
    const gaps = focus
      .slice(0, -1)
      .map((_, index) => glyphTop(focus[index + 1]!) - glyphBottom(focus[index]!));

    // Expected with this measurer (auto/atLeast extras BELOW; the 16pt marks add nothing):
    //   LOAN→between     = before 202twip = 10.1
    //   between→MERIDIAN = auto460 extra ≈ 10.5417
    //   MERIDIAN→(wrap0) = before 22twip 1.1
    //   wrap→wrap        = auto460 extra ≈ 10.5417 each
    //   last wrap→APEX   = auto460 extra ≈ 10.5417
    //   APEX→Lender      = 0
    // Rejected above-leading model produced ~20.6 then ~5.4 (clumps).
    expect(labels[0]).toContain('LOAN');
    expect(labels[1]).toContain('between');
    expect(labels[2]).toContain('MERIDIAN');
    expect(labels.at(-2)).toContain('APEX');
    expect(labels.at(-1)).toContain('Lender');

    const expected = [
      202 / 20, // LOAN → between
      AUTO_460_EXTRA, // between → MERIDIAN
      22 / 20, // MERIDIAN → first wrap of "as Borrower and"
      ...Array.from({ length: gaps.length - 4 }, () => AUTO_460_EXTRA), // wraps + → APEX
      0, // APEX → as Lender
    ];
    expect(gaps.length).toBe(expected.length);
    for (let index = 0; index < gaps.length; index += 1) {
      expect(gaps[index]!).toBeCloseTo(expected[index]!, 1);
    }
  });

  test('paint puts auto trailing depth in padding-bottom, not padding-top', () => {
    const layout = lay(
      '<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>between</w:t></w:r></w:p>'
    );
    const line = linesOf(layout)[0]!;
    expect(line.leading).toBeCloseTo(0, 5);
    expect(line.box.height).toBeCloseTo(RUN_H * 2, 5);
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const painted = container.querySelector<HTMLElement>('.docx-line')!;
    const run = container.querySelector<HTMLElement>('.layout-run-text')!;
    expect(parseFloat(run.style.paddingTop)).toBeCloseTo(0, 5);
    expect(parseFloat(painted.style.paddingBottom)).toBeCloseTo(RUN_H, 5);
  });
});

describe('second case: BodyText line=336 extras stay below (same fixture family)', () => {
  test('definition-style auto-336 does not invert inter-line gaps', () => {
    // Independent of the cover: BodyText clauses in the same package use line=336.
    const layout = lay(
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/>' +
        '<w:spacing w:before="210" w:line="336" w:lineRule="auto"/></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>First definition line that is long enough to wrap onto a second line in this narrow column xx</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="5000" w:h="16840"/>' +
        '<w:pgMar w:top="600" w:right="200" w:bottom="440" w:left="200"/></w:sectPr>'
    );
    const wrapped = linesOf(layout);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      expect(line.leading).toBe(0);
      expect(line.box.height).toBeCloseTo(RUN_H * (336 / 240), 5);
    }
    const gap =
      wrapped[1]!.box.y + wrapped[1]!.leading - (wrapped[0]!.box.y + wrapped[0]!.leading + RUN_H);
    const extra336 = RUN_H * (336 / 240) - RUN_H;
    expect(gap).toBeCloseTo(extra336, 5);
  });
});

test('small table text does not inherit a taller implicit cell-end mark', () => {
  const cell = (mark: string) =>
    '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:pPr>' +
    mark +
    '</w:pPr><w:r><w:rPr><w:sz w:val="12"/></w:rPr><w:t>Small cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const implicit = linesOf(lay(cell('')))[0]!;
  const explicitLayout = lay(cell('<w:rPr><w:sz w:val="32"/></w:rPr>'));
  const explicit = linesOf(explicitLayout)[0]!;
  const table = explicitLayout.pages[0]!.fragments.find((block) => block.kind === 'table')!;
  // Under text, the explicit mark sets no row minimum either: the text line sizes the row.
  expect(table.rows[0]!.box.height).toBeCloseTo(6 * 1.15, 5);
  expect(implicit.box.height).toBeCloseTo(6 * 1.15, 5);
  expect(explicit.box.height).toBeCloseTo(6 * 1.15, 5);
  expect(explicit.baseline).toBeCloseTo(implicit.baseline, 5);
});

test('small body text uses its visible font under an explicitly formatted mark too', () => {
  const run = '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Small text</w:t></w:r>';
  const body = linesOf(lay(`<w:p>${run}</w:p>`))[0]!;
  expect(body.box.height).toBeCloseTo(RUN_H, 6);
  const explicit = linesOf(
    lay(`<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>${run}</w:p>`)
  )[0]!;
  expect(explicit.box.height).toBeCloseTo(RUN_H, 6);
  expect(explicit.baseline).toBeCloseTo(body.baseline, 6);
});
