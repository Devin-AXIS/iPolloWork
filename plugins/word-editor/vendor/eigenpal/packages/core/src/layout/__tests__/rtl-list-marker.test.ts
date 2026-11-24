import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument, createFixedMeasurer } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { listSuffixSpaceWidth } from '../list-marker-geometry.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string) {
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}
const measurer = createFixedMeasurer(6, 14);
function fixture(
  rtl: boolean,
  table: boolean,
  suffix: string,
  marker = '%1.',
  region: { width?: number; frame?: boolean; columns?: boolean } = {}
) {
  const width = region.width ?? 200;
  // The same level serves both directions: `w:left` and `lvlJc="left"` name the LEADING side,
  // which is the right margin in a bidi paragraph.
  const numberingIndex = buildNumberingIndex(
    part(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="${marker}"/><w:lvlJc w:val="left"/><w:suff w:val="${suffix}"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
    ).root
  );
  const paragraph = `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}${region.frame ? '<w:framePr w:x="400" w:y="600" w:w="1000"/>' : ''}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>مرحبا عالم مرحبا عالم مرحبا عالم</w:t></w:r></w:p>`;
  const body = table
    ? `<w:tbl><w:tblGrid><w:gridCol w:w="${width * 20}"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
    : paragraph;
  const doc = layoutSemanticDocument(
    part(
      `<w:document xmlns:w="${W}"><w:body>${region.columns ? '<w:p><w:r><w:br w:type="column"/></w:r></w:p>' : ''}${body}${region.columns ? '<w:sectPr><w:cols w:num="2" w:space="400"/></w:sectPr>' : ''}</w:body></w:document>`
    ),
    0,
    {
      measurer,
      numberingIndex,
      geometry: { width, height: 300, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
  );
  return [...paragraphFragmentsOf(doc.pages[0]!)].find((fragment) => fragment.marker)!;
}
for (const table of [false, true])
  for (const suffix of ['tab', 'space', 'nothing']) {
    test(`RTL list marker and ${suffix} suffix stay beside text (table=${table})`, () => {
      const ltr = fixture(false, table, suffix),
        rtl = fixture(true, table, suffix);
      const left = ltr.marker!,
        right = rtl.marker!;
      expect(right.text).toBe(left.text);
      expect(right.ordinal).toBe(left.ordinal);
      const leftText = Math.min(...ltr.lines[0]!.spans.map((span) => span.box.x));
      const rightText = Math.max(...rtl.lines[0]!.spans.map((span) => span.box.x + span.box.width));
      const gap = right.box.x - rightText;
      expect(gap).toBeGreaterThanOrEqual(-0.001);
      expect(gap).toBeCloseTo(leftText - left.box.x - left.box.width, 5);
      if (suffix === 'nothing') expect(gap).toBeCloseTo(0, 5);
      if (suffix === 'space') expect(gap).toBeCloseTo(listSuffixSpaceWidth(right.style), 5);
      expect(rtl.lines.length).toBeGreaterThan(1);
    });
    test(`RTL overflowing marker retains suffix spacing (table=${table}, suffix=${suffix})`, () => {
      const ltr = fixture(false, table, suffix, '(%1.%1.%1.)'),
        rtl = fixture(true, table, suffix, '(%1.%1.%1.)');
      const a = ltr.marker!,
        b = rtl.marker!;
      const leftText = Math.min(...ltr.lines[0]!.spans.map((span) => span.box.x));
      const rightText = Math.max(...rtl.lines[0]!.spans.map((span) => span.box.x + span.box.width));
      expect(b.box.x - rightText).toBeCloseTo(leftText - a.box.x - a.box.width, 5);
      expect(b.box.x).toBeGreaterThanOrEqual(rightText - 0.001);
    });
  }

for (const region of [{ width: 20 }, { frame: true }, { columns: true }])
  test(`RTL marker follows its published region ${JSON.stringify(region)}`, () => {
    const ltr = fixture(false, false, 'tab', '%1.', region),
      rtl = fixture(true, false, 'tab', '%1.', region);
    const a = ltr.marker!,
      b = rtl.marker!;
    const left = Math.min(...ltr.lines[0]!.spans.map((s) => s.box.x));
    const right = Math.max(...rtl.lines[0]!.spans.map((s) => s.box.x + s.box.width));
    // Overindented regions retain the existing one-point layout clamp and forced glyph overflow.
    if (region.width !== 20) expect(b.box.x - right).toBeCloseTo(left - a.box.x - a.box.width, 5);
    expect(b.box.x - right).toBeGreaterThanOrEqual(0);
    if (region.width === 20) expect(rtl.box.width).toBe(1);
    if (region.columns) expect(b.box.x).toBeGreaterThan(100);
    if (region.frame) expect(b.box.x + b.box.width).toBeLessThanOrEqual(70);
  });
