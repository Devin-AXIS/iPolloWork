import { withAuthoredCjkGapMetric } from '../cjk-auto-spacing-metric-port.ts';
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';
import { measureUnwrappedAutofitText } from '../autofit-unwrapped-text.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import type { CjkTypographySettings } from '../cjk-typography.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// This deterministic fixture explicitly supplies an authored reverse metric.
const measurer = withAuthoredCjkGapMetric(
  createFixedMeasurer(6, 14),
  (style) => style.fontSizePt / 4
);
const run = (text: string, size = 24, props = '') =>
  `<w:r><w:rPr><w:sz w:val="${size}"/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
function part(body: string, styles = false) {
  const value = readOoxmlPart(
    styles
      ? `<w:styles xmlns:w="${W}">${body}</w:styles>`
      : `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    { name: styles ? '/word/styles.xml' : '/word/document.xml', contentType: 'app/xml' }
  );
  if (!value.ok) throw Error(value.reason);
  return value.part;
}
function widths(
  body: string,
  props = '',
  styles = '',
  widthMeasurer = measurer,
  typography?: CjkTypographySettings
) {
  const source = part(`<w:p><w:pPr>${props}</w:pPr>${body}</w:p>`);
  const paragraph = source.root.children[0]!.children.find(
    (child) => child.kind === 'paragraph'
  ) as OoxmlElement;
  const before = serializeOoxmlPart(source);
  const result = paragraphContentWidthsPt(paragraph, {
    context: { measurer: widthMeasurer },
    view: {
      styleCascade:
        styles || typography
          ? {
              ...buildStyleCascadeTable(part(styles, true).root),
              ...(typography ? { typography } : {}),
            }
          : undefined,
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });
  expect(serializeOoxmlPart(source)).toBe(before);
  return result;
}
const natural = (size: number, length = 1) => ((6 * size) / 11) * length;

test('automatic table cell widths include both CJK Latin advances at 12pt', () => {
  const result = widths(run('甲A乙'));
  expect(result.min).toBeCloseTo(natural(12), 8);
  expect(result.max).toBeCloseTo(natural(12, 3) + 6, 8);
});

test('automatic cell advances are identical across source run boundaries', () => {
  for (const latin of ['A', '1']) {
    const split = widths(run('甲') + run(latin) + run('乙'));
    const joined = widths(run(`甲${latin}乙`));
    expect(split.min).toBeCloseTo(joined.min, 8);
    expect(split.max).toBeCloseTo(joined.max, 8);
  }
});

test('mixed-size cell advances use the same directional policy as line layout', () => {
  const result = widths(run('甲', 24) + run('A', 40) + run('乙', 20));
  expect(result.min).toBeCloseTo(natural(20), 8);
  expect(result.max).toBeCloseTo(natural(12) + natural(20) + natural(10) + 3 + 5, 8);
});

test('cell spacing inherits disabled flags and honors a direct override independently', () => {
  const styles =
    '<w:style w:type="paragraph" w:styleId="Base"><w:pPr><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/></w:style>';
  const disabled = widths(run('甲A1乙'), '<w:pStyle w:val="Child"/>', styles);
  const enabled = widths(run('甲A1乙'), '<w:pStyle w:val="Child"/><w:autoSpaceDE/>', styles);
  expect(disabled.min).toBeCloseTo(natural(12, 2), 8);
  expect(enabled.min).toBeCloseTo(disabled.min, 8);
  expect(disabled.max).toBeCloseTo(natural(12, 4), 8);
  expect(enabled.max).toBeCloseTo(natural(12, 4) + 3, 8);
});

test('manual tracking and authored spaces do not acquire automatic cell advances', () => {
  expect(widths(run('甲A乙', 24, '<w:spacing w:val="20"/>')).min).toBeCloseTo(natural(12) + 1, 8);
  const disable = '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>';
  expect(widths(run('甲 A 乙'))).toEqual(widths(run('甲 A 乙'), disable));
  expect(widths(run('甲') + '<w:r><w:tab/></w:r>' + run('A'))).toEqual(
    widths(run('甲') + '<w:r><w:tab/></w:r>' + run('A'), disable)
  );
});

test('a cell hard break does not carry a leading automatic advance to its next line', () => {
  const result = widths(run('甲') + '<w:r><w:br/></w:r>' + run('A乙'));
  expect(result.min).toBeCloseTo(natural(12), 8);
  expect(result.max).toBeCloseTo(natural(12, 2) + 3, 8);
});

test('an auto-width table keeps its CJK Latin cell on the same line and row height', () => {
  const source = part(
    '<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:tblCellMar><w:top w:w="0"/><w:left w:w="0"/><w:bottom w:w="0"/><w:right w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type="auto" w:w="0"/></w:tcPr><w:p>' +
      run('甲A乙') +
      '</w:p></w:tc></w:tr></w:tbl>'
  );
  const before = serializeOoxmlPart(source);
  const value = layoutSemanticDocument(source, 0, {
    measurer,
    geometry: { width: 120, height: 60, margin: { left: 10, right: 10, top: 10, bottom: 10 } },
  });
  expect(value.pages).toHaveLength(1);
  const table = value.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const paragraph = table.rows[0]!.cells[0]!.blocks[0]!;
  expect(paragraph.kind).toBe('paragraph');
  if (paragraph.kind !== 'paragraph') throw Error('expected a paragraph');
  expect(paragraph.lines).toHaveLength(1);
  expect(paragraph.lines[0]!.spans.map((span) => span.text).join('')).toBe('甲A乙');
  expect(table.rows[0]!.box.height).toBeCloseTo((14 * 12) / 11, 8);
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('hidden source runs and paragraph defaults preserve the same cell spacing barriers', () => {
  const hidden = widths(run('甲') + run('A', 24, '<w:vanish/>') + run('乙'));
  expect(hidden.min).toBeCloseTo(natural(12), 8);
  expect(hidden.max).toBeCloseTo(natural(12, 2), 8);
  const defaults =
    '<w:docDefaults><w:pPrDefault><w:pPr><w:autoSpaceDE w:val="0"/></w:pPr></w:pPrDefault></w:docDefaults>';
  expect(widths(run('甲A乙'), '', defaults).max).toBeCloseTo(natural(12, 3), 8);
});

test('AutoFit preserves a whole shaped Latin token while pricing adjacent automatic advances', () => {
  const shaped = withAuthoredCjkGapMetric(
    {
      ...measurer,
      measure: (text: string, style: Parameters<typeof measurer.measure>[1]) =>
        measurer.measure(text, style) - (text.includes('AV') ? 2 : 0),
    },
    (style) => style.fontSizePt / 4
  );
  const result = widths(run('甲AV乙'), '', '', shaped);
  expect(result.min).toBeCloseTo(natural(12, 2) - 2, 8);
  expect(result.max).toBeCloseTo(natural(12, 4) - 2 + 6, 8);
});

test('automatic maximum gaps precede tab placement and do not hang with trailing spaces', () => {
  const result = widths(run('甲A') + '<w:r><w:tab/></w:r>' + run('乙A  '));
  expect(result.min).toBeCloseTo(natural(12), 8);
  expect(result.max).toBeCloseTo(36 + natural(12, 2) + 3, 8);
});

test('unwrapped gap adjustments retain whole-token shaping and trailing-space geometry', () => {
  const measured: string[] = [];
  const result = measureUnwrappedAutofitText(
    'AV甲\t乙  ',
    [3, 4, 7],
    (text) => {
      measured.push(text);
      return (
        [...text].reduce(
          (sum, char) => sum + (char === ' ' ? 2 : char === '甲' || char === '乙' ? 12 : 8),
          0
        ) - (text.includes('AV') ? 2 : 0)
      );
    },
    8,
    (at) => (Math.floor(at / 36) + 1) * 36,
    (from) => (from === 0 ? 3 : 0)
  );
  expect(result).toEqual({ width: 80, trailing: 4 });
  expect(measured).toContain('AV甲');
  expect(measured).not.toContain('A');
  expect(measured).not.toContain('V');
});

test('a custom unbreakable mixed-script group retains its internal directional gaps', () => {
  const typography: CjkTypographySettings = {
    strict: false,
    compression: 'doNotCompress',
    before: { 'zh-cn': 'A乙' },
    after: { 'zh-cn': '甲A' },
  };
  const lang = '<w:lang w:eastAsia="zh-CN"/>';
  const expected = natural(12, 3) + 6;
  for (const body of [
    run('甲A乙', 24, lang),
    run('甲', 24, lang) + run('A', 24, lang) + run('乙', 24, lang),
  ]) {
    const result = widths(body, '', '', measurer, typography);
    expect(result.min).toBeCloseTo(expected, 8);
    expect(result.max).toBeCloseTo(expected, 8);
  }
});

test('Korean whole-word minimums retain internal text and omit only legal boundary gaps', () => {
  const korean = '<w:lang w:eastAsia="ko-KR"/>';
  const result = widths(
    run('한글AB', 24, korean),
    `<w:wordWrap w:val="0"/><w:rPr>${korean}</w:rPr>`
  );
  expect(result.min).toBeCloseTo(natural(12, 2), 8);
  expect(result.max).toBeCloseTo(natural(12, 4) + 3, 8);
  // Without a Korean paragraph mark, character wrapping divides the Latin word as well.
  const divided = widths(run('한글AB', 24, korean), '<w:wordWrap w:val="0"/>');
  expect(divided.min).toBeCloseTo(natural(12), 8);
  expect(divided.max).toBeCloseTo(result.max, 8);
});

test('an atomic field result prevents an automatic gap across its source range', () => {
  const result = widths(
    run('甲') + '<w:fldSimple w:instr=" AUTHOR ">' + run('A') + '</w:fldSimple>' + run('乙')
  );
  expect(result.min).toBeCloseTo(natural(12), 8);
  expect(result.max).toBeCloseTo(natural(12, 3), 8);
});
