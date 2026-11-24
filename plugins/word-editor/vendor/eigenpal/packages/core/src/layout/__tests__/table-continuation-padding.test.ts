import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

for (const header of [false, true]) {
  test(`continued cells retain padding and page-edge borders (${header ? 'repeated header' : 'page top'})`, () => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
      <w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar>
      <w:tblBorders>${['top', 'bottom', 'left', 'right', 'insideH'].map((side) => `<w:${side} w:val="single" w:sz="8"/>`).join('')}</w:tblBorders>
      </w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>
      ${header ? `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${paragraph('Header')}</w:tc></w:tr>` : ''}
      <w:tr><w:tc>${Array.from({ length: 6 }, (_, i) => paragraph(`Line ${i}`)).join('')}</w:tc></w:tr>
      </w:tbl>${paragraph('After')}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const before = serializeOoxmlPart(parsed.part);
    const options = {
      geometry: { width: 140, height: 50, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      measurer: createFixedMeasurer(4, 10),
      session: createLayoutSession(),
    };
    const result = layoutSemanticDocument(parsed.part, 0, options);
    expect(layoutSemanticDocument(parsed.part, 0, options).pages).toEqual(result.pages);
    expect(serializeOoxmlPart(parsed.part)).toBe(before);
    const text: string[] = [];
    let continuations = 0;
    for (const page of result.pages) {
      for (const table of page.fragments.filter((f) => f.kind === 'table')) {
        expect(table.box.y + table.box.height).toBeLessThanOrEqual(50);
        for (const row of table.rows) {
          const cell = row.cells[0]!;
          if (row.isHeaderRepeat) continue;
          if (row.isContinuation) continuations++;
          // Every row reserves its OWN 1pt top rule in full, a fragment's first row and a
          // continuation alike, so the 4pt `w:tblCellMar` top pads to 5 throughout.
          expect(cell.blocks[0]!.box.y - cell.box.y).toBeCloseTo(5, 6);
          if (row === table.rows[0]) expect(cell.borders!.top?.widthPt).toBe(1);
          if (row === table.rows.at(-1)) expect(cell.borders!.bottom?.widthPt).toBe(1);
          for (const block of cell.blocks) {
            if (block.kind === 'paragraph')
              text.push(...block.lines.map((line) => line.spans.map((span) => span.text).join('')));
          }
        }
      }
    }
    expect(continuations).toBe(header ? 2 : 1);
    expect(text).toEqual([
      ...(header ? ['Header'] : []),
      ...Array.from({ length: 6 }, (_, i) => `Line ${i}`),
    ]);
  });
}
