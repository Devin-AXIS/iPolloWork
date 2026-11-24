import { expect, test } from 'bun:test';
import { serializeOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  load,
  layoutContext,
  squareAnchorInCell,
  squareAnchorAtLeft,
} from './anchored-drawing-test-fixtures.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const position =
  '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpY="3441" w:leftFromText="180" w:rightFromText="180"/>';
const plainTable = `<w:tbl><w:tblPr>${position}<w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1600" w:hRule="exact"/></w:trPr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>`;

test('a page-positioned table keeps its wrap band when an external drawing requires immediate placement', () => {
  const xml = squareAnchorAtLeft({ text: 'Lead' }).replace(
    '</w:body>',
    `${plainTable}${p('After '.repeat(30))}</w:body>`
  );
  const part = load(xml);
  const before = serializeOoxmlPart(part);
  const layout = layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  expect(table.kind).toBe('table');
  if (table.kind !== 'table') throw new Error('Missing table');
  expect(table.outOfFlow).toBe(true);
  expect(table.floatingWrap).toBeDefined();
  const after = layout.pages[0]!.fragments.find(
    (f) =>
      f.kind === 'paragraph' && f.lines.some((l) => l.spans.some((s) => s.text.startsWith('After')))
  );
  expect(after).toBeDefined();
  if (after?.kind !== 'paragraph') throw new Error('Missing paragraph');
  for (const line of after.lines)
    expect(
      line.box.y + line.box.height <= table.box.y || line.box.y >= table.box.y + table.box.height
    ).toBe(true);
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('ordinary tables remain in flow under the same external drawing', () => {
  const xml = squareAnchorAtLeft({ text: 'Lead' }).replace(
    '</w:body>',
    `${plainTable.replace(position, '')}${p('After')}</w:body>`
  );
  const part = load(xml);
  const layout = layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  expect(table.kind).toBe('table');
  if (table.kind !== 'table') throw new Error('Missing table');
  expect(table.outOfFlow).toBeFalsy();
  expect(table.floatingWrap).toBeUndefined();
});

test('a floating table retains its own drawing and clears following body text', () => {
  const xml = squareAnchorInCell({ text: 'Cell', layoutInCell: '1' })
    .replace('<w:tblPr>', `<w:tblPr>${position}`)
    .replaceAll('8800', '9360')
    .replace('</w:body>', `${p('After '.repeat(60))}</w:body>`);
  const part = load(xml);
  const layout = layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  expect(table.kind).toBe('table');
  if (table.kind !== 'table') throw new Error('Missing table');
  expect(table.outOfFlow).toBe(true);
  expect(table.floatingWrap).toBeDefined();
  expect(layout.pages[0]!.anchoredDrawings).toHaveLength(1);
  const after = layout.pages[0]!.fragments.find(
    (f) =>
      f.kind === 'paragraph' && f.lines.some((l) => l.spans.some((s) => s.text.startsWith('After')))
  );
  if (after?.kind !== 'paragraph') throw new Error('Missing paragraph');
  for (const line of after.lines)
    expect(
      line.box.y + line.box.height <= table.box.y || line.box.y >= table.box.y + table.box.height
    ).toBe(true);
});

// Row one grows to hold its square-wrapped picture, so the next row starts below it and its text
// runs the full cell width; without the wrap the row keeps its text height.
test('a page-positioned table grows the row that holds its own wrapped drawing', () => {
  const xml = squareAnchorInCell({ text: 'Cell', layoutInCell: '1' })
    .replace('<w:tblPr>', `<w:tblPr>${position}`)
    .replace('</w:tbl>', `<w:tr><w:tc>${p('Later '.repeat(30))}</w:tc></w:tr></w:tbl>`)
    .replace('</w:body>', `${p('After')}</w:body>`);
  const layoutOf = (source: string) => {
    const part = load(source);
    return layoutSemanticDocument(part, 0, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: layoutContext(part),
    });
  };
  const wrapped = layoutOf(xml);
  const unwrapped = layoutOf(xml.replace(/<wp:wrapSquare[^>]*\/>/, '<wp:wrapNone/>'));
  const later = (layout: ReturnType<typeof layoutOf>) => {
    const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
    if (table?.kind !== 'table') throw new Error('Missing table');
    const paragraph = table.rows[1]!.cells[0]!.blocks.find(
      (f) =>
        f.kind === 'paragraph' &&
        f.lines.some((l) => l.spans.some((s) => s.text.startsWith('Later')))
    );
    if (paragraph?.kind !== 'paragraph') throw new Error('Missing later paragraph');
    return paragraph;
  };
  expect(later(wrapped).lines[0]!.spans[0]!.box.x).toBe(later(unwrapped).lines[0]!.spans[0]!.box.x);
  expect(later(wrapped).lines.length).toBe(later(unwrapped).lines.length);
  // The 72pt picture holds row one open; the unwrapped row is one line tall.
  expect(later(wrapped).box.y - later(unwrapped).box.y).toBeGreaterThan(50);
});
