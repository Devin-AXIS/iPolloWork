// The table style named "Normal Table" keeps its built-in properties: no indent and 108 twips
// of left and right cell margin. Reference renderings ignore everything it authors (indent,
// alignment, cell margins, borders, shading, paragraph and run properties) in compatibility
// modes 15, 14, and 12, as the default style and when a table names it. The name decides,
// not the id: a default style with another name applies as written.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MARGINS =
  '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right']
    .map((edge) => `<w:${edge} w:val="single" w:sz="24" w:space="0" w:color="FF0000"/>`)
    .join('') +
  '</w:tblBorders>';
// The style's own cell shading is authored too, but layout paints no table-style `w:tcPr`
// shading yet (#1844), so no test can tell it apart.
const AUTHORED =
  '<w:pPr><w:spacing w:before="400"/></w:pPr><w:rPr><w:b/></w:rPr>' +
  `<w:tblPr><w:tblInd w:w="720" w:type="dxa"/><w:jc w:val="center"/>${BORDERS}${MARGINS}</w:tblPr>` +
  '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/></w:tcPr>';

function read(name: string, xml: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

interface Probe {
  readonly id?: string;
  readonly name?: string;
  /** What the style authors; the full set by default. */
  readonly authored?: string;
  /** `w:tblStyle`, when the table names the style itself. */
  readonly tableStyle?: string;
  readonly mode?: number;
}

/** The first cell of a table laid out under one default table style. */
function firstCell({
  id = 'TableNormal',
  name = 'Normal Table',
  authored = AUTHORED,
  tableStyle = '',
  mode = 15,
}: Probe) {
  const styles = read(
    '/word/styles.xml',
    `<w:styles xmlns:w="${W}"><w:style w:type="table" w:default="1" w:styleId="${id}">` +
      `<w:name w:val="${name}"/>${authored}</w:style></w:styles>`
  );
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tableStyle}` +
      '<w:tblW w:w="3000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>alpha</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:body></w:document>'
  );
  const layout = layoutSemanticDocument(document, 0, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: buildStyleCascadeTable(styles.root),
    compatibilityMode: mode,
    geometry: { width: 400, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const cell = table.rows[0]!.cells[0]!;
  const paragraph = cell.blocks[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('expected a paragraph');
  const span = paragraph.lines[0]!.spans[0]!;
  return {
    tableX: table.box.x,
    /** How far the text sits inside the table: the left cell margin. */
    inset: span.box.x - table.box.x,
    bold: span.style.bold,
    border: cell.borders?.left,
    spaceBefore: paragraph.lines[0]!.box.y,
  };
}

test('the built-in "Normal Table" ignores everything it authors', () => {
  const normal = firstCell({});
  // No indent and no centering: the table starts at the margin.
  expect(normal.tableX).toBe(0);
  // 108 twips of left margin, where the authored definition states none.
  expect(normal.inset).toBeCloseTo(5.4, 6);
  expect(normal.bold).toBe(false);
  expect(normal.border).toBeUndefined();
  expect(normal.spaceBefore).toBe(0);
});

test('the same style under another name applies as written', () => {
  const custom = firstCell({ name: 'My default' });
  expect(custom.tableX).toBeGreaterThan(0);
  // No cell margin: only half of the 3pt border sits between the edge and the text.
  expect(custom.inset).toBeCloseTo(1.5, 6);
  expect(custom.bold).toBe(true);
  expect(custom.border).toBeDefined();
  expect(custom.spaceBefore).toBeGreaterThan(0);
});

test('an authored indent alone is ignored too', () => {
  const authored = '<w:tblPr><w:tblInd w:w="720" w:type="dxa"/></w:tblPr>';
  expect(firstCell({ authored }).tableX).toBe(0);
  expect(firstCell({ authored, name: 'My default' }).tableX).toBeCloseTo(36, 6);
});

test('the name decides, not the id', () => {
  const byName = firstCell({ id: 'MyDefault' });
  expect(byName.tableX).toBe(0);
  expect(byName.bold).toBe(false);
  expect(firstCell({ name: 'My default' }).bold).toBe(true);
});

test('a table that names "Normal Table" also gets the built-in properties', () => {
  const named = firstCell({ tableStyle: '<w:tblStyle w:val="TableNormal"/>' });
  expect(named.tableX).toBe(0);
  expect(named.bold).toBe(false);
});

test('older compatibility modes ignore the authored definition as well', () => {
  for (const mode of [14, 12]) {
    const legacy = firstCell({ mode });
    // Legacy modes pull the table left by its left cell margin: the built-in 108 twips.
    expect(legacy.tableX).toBeCloseTo(-5.4, 6);
    expect(legacy.inset).toBeCloseTo(5.4, 6);
    expect(legacy.bold).toBe(false);
  }
});
