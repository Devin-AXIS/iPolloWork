import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) =>
  `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact" w:before="0" w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (merge = false) =>
  `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/></w:tblBorders><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${[0, 1].map((index) => `<w:tr><w:tc><w:tcPr>${merge ? `<w:vMerge${index === 0 ? ' w:val="restart"' : ''}/>` : ''}</w:tcPr>${index === 1 && merge ? '<w:p/>' : paragraph(index === 0 ? 'First' : 'Second')}</w:tc><w:tc>${paragraph(index === 0 ? 'Label1' : 'Label2')}</w:tc></w:tr>`).join('')}</w:tbl>`;
function run(body: string, height = 100) {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const options = {
    geometry: { width: 250, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    measurer: createFixedMeasurer(5, 12),
    session: createLayoutSession(),
  };
  const result = layoutSemanticDocument(parsed.part, 0, options);
  expect(layoutSemanticDocument(parsed.part, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return result;
}
for (const merge of [false, true]) {
  test(`outer strokes add a full point around two 12pt rows (merged=${merge})`, () => {
    const result = run(table(merge) + paragraph('After'));
    const [fragment, after] = result.pages[0]!.fragments;
    if (fragment!.kind !== 'table') throw new Error('table');
    expect(fragment.box.height).toBe(25);
    expect(after!.box.y).toBe(25);
    const paintedLastCell = merge ? fragment.rows[0]!.cells[0]! : fragment.rows[1]!.cells[0]!;
    const stroke = paintedLastCell.borders.strokes!.find((stroke) => stroke.side === 'bottom')!;
    expect(stroke.y + stroke.height).toBe(paintedLastCell.box.height);
  });
}
test('authored bottom clearance participates in admission before content is published', () => {
  const result = run(table(), 24.8);
  expect(result.pages).toHaveLength(2);
  const texts: string[] = [];
  for (const page of result.pages)
    for (const fragment of page.fragments) {
      expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(24.8);
      if (fragment.kind !== 'table') continue;
      for (const row of fragment.rows)
        for (const cell of row.cells)
          for (const block of cell.blocks) {
            if (block.kind === 'paragraph')
              for (const line of block.lines) texts.push(...line.spans.map((span) => span.text));
          }
    }
  expect(texts).toEqual(['First', 'Label1', 'Second', 'Label2']);
});

test('merge admission includes the full bottom stroke in its content height', () => {
  const body = table(true).replace(
    paragraph('First'),
    paragraph('First') + paragraph('Extra1') + paragraph('Extra2')
  );
  const result = run(body + paragraph('After'));
  const [fragment, after] = result.pages[0]!.fragments;
  if (fragment!.kind !== 'table') throw new Error('table');
  expect(fragment.box.height).toBe(37);
  const head = fragment.rows[0]!.cells[0]!;
  expect(head.box.height).toBe(37);
  const last = head.blocks[2]!;
  expect(head.box.y + head.box.height - last.box.y - last.box.height).toBe(0.5);
  expect(after!.box.y).toBe(37);
});

test('a split row keeps its existing boundary until full terminal clearance is reserved', () => {
  const body = table().replace(paragraph('First'), paragraph('First') + paragraph('Extra'));
  const result = run(body, 13);
  const fragment = result.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'table') throw new Error('table');
  const cell = fragment.rows[0]!.cells[0]!;
  // A split occurrence has not reserved the terminal inset, so its rule is still a band:
  // it starts at the boundary and runs downward, like every other shared horizontal rule.
  // NOT reference-confirmed — no captured control paints a table across a page edge.
  const stroke = cell.borders.strokes!.find((stroke) => stroke.side === 'bottom')!;
  expect(stroke.y).toBeCloseTo(cell.box.height, 6);
  expect(stroke.y + stroke.height).toBeCloseTo(cell.box.height + 0.5, 6);
});
