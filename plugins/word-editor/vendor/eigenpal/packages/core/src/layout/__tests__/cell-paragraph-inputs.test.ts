import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { cellParagraphInputs, cellParagraphBreakInputs } from '../cell-paragraph-inputs.ts';
import { resolveParagraphLayoutInputs, type TableCellStyleFormatting } from '../style-cascade.ts';
import { styleCascade } from './table-row-keep-fixtures.ts';
import { paragraphLayoutKey } from '../layout-cache.ts';

function paragraph(): OoxmlElement {
  const parsed = readOoxmlPart(
    '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:ind w:left="240"/></w:pPr><w:r><w:t>Sample</w:t></w:r></w:p>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part.root as OoxmlElement;
}
const dependencies = { listToken: undefined, hostedListToken: '', refToken: '' };

test('cell input reuse follows width and section grid changes', () => {
  const p = paragraph();
  const get = (width: number, grid?: number) =>
    cellParagraphInputs(p, width, undefined, undefined, undefined, grid);
  const initial = get(100);
  expect(get(100)).toBe(initial);
  for (const [width, grid] of [
    [60, undefined],
    [100, 18],
    [100, undefined],
  ] as const) {
    expect(get(width, grid)).toEqual(
      resolveParagraphLayoutInputs(p, width, undefined, undefined, undefined, true, grid)
    );
  }
});

test('cell formatting changes invalidate prepared properties', () => {
  const p = paragraph();
  const style = (size: string): TableCellStyleFormatting => ({
    paragraphProperties: [],
    paragraphPropertyNodes: [],
    runProperties: [{ localName: 'sz', attributes: { val: size } }],
  });
  let lastKey: string | undefined;
  for (const cell of [style('20'), style('40')]) {
    const inputs = cellParagraphInputs(p, 100, styleCascade, undefined, cell, undefined);
    const prepared = cellParagraphBreakInputs(p, inputs, 36, dependencies);
    expect(cellParagraphBreakInputs(p, inputs, 36, dependencies)).toBe(prepared);
    const key = paragraphLayoutKey({
      paragraph: p,
      width: inputs.available,
      properties: prepared.properties,
      producer: 'test',
    });
    expect(key).not.toBe(lastKey);
    // Arbitrary caller-owned arrays still take the regular value-sensitive key path.
    expect(
      paragraphLayoutKey({
        paragraph: p,
        width: inputs.available,
        properties: [...prepared.properties],
        producer: 'test',
      })
    ).toBe(key);
    lastKey = key;
    expect(cellParagraphBreakInputs(p, inputs, 48, dependencies)).not.toBe(prepared);
    expect(
      cellParagraphBreakInputs(p, inputs, 36, { ...dependencies, refToken: 'changed' })
    ).not.toBe(prepared);
  }
});
