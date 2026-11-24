// A table positioned against the text (`w:vertAnchor="text"`, ECMA-376 Part 1, 17.4.66) with a
// `w:tblpYSpec` alignment (17.4.65) floats at the top of its anchor paragraph. Every alignment
// value puts it there, and the alignment still supersedes `w:tblpY`. The anchor paragraph
// wraps beside the table.
import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import { readTableFloatPosition } from '../table-float-properties.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const SPECS = ['top', 'center', 'bottom', 'inside', 'outside', 'inline'] as const;
const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tblpPr = (spec: string, vertAnchor = 'text') =>
  `<w:tblpPr w:vertAnchor="${vertAnchor}" w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="1001" w:tblpYSpec="${spec}"/>`;
const table = (spec: string) =>
  `<w:tbl><w:tblPr>${tblpPr(spec)}<w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="1600"/>` +
  '<w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1600"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr>' +
  `<w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>`;
const part = (xml: string) => {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const tblPr = (xml: string) => {
  const root = part(`<w:tblPr xmlns:w="${WML_NAMESPACE_URI}">${xml}</w:tblPr>`).root;
  return root;
};

test('a text-relative alignment reads as the anchor top, and a page alignment stays', () => {
  for (const spec of SPECS) {
    const text = readTableFloatPosition(tblPr(tblpPr(spec)))!;
    expect(text.ySpec).toBeUndefined();
    expect(text.yPt).toBe(0);
    const page = readTableFloatPosition(tblPr(tblpPr(spec, 'page')))!;
    expect(page.ySpec).toBe(spec);
    expect(page.yPt).toBe(50);
  }
});

test('a text-relative table with an alignment floats beside its anchor paragraph', () => {
  for (const spec of SPECS) {
    const layout = layoutSemanticDocument(
      part(
        `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>` +
          `${p('Lead')}${table(spec)}${p('word '.repeat(30))}${p('Tail')}</w:body></w:document>`
      ),
      0,
      {
        measurer: createFixedMeasurer(6, 12),
        geometry: { width: 200, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      }
    );
    const fragments = layout.pages[0]!.fragments;
    const floating = fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
    const anchor = fragments.filter(
      (f): f is ParagraphFragmentRecord => f.kind === 'paragraph'
    )[1]!;
    expect(isOutOfFlowTableFragment(floating)).toBe(true);
    expect(floating.box.y).toBe(12);
    expect(anchor.lines[0]!.box.y).toBe(12);
    for (const span of anchor.lines[0]!.spans)
      expect(span.box.x + span.box.width).toBeLessThanOrEqual(floating.box.x);
  }
});
