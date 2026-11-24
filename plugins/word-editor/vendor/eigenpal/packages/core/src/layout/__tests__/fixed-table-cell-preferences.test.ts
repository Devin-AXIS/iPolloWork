import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-serialize.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function readDocument(xml: string) {
  const result = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function table(grid: readonly number[], rows: readonly (readonly number[])[], tableWidth = '') {
  return (
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>${tableWidth}</w:tblPr><w:tblGrid>` +
    grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('') +
    '</w:tblGrid>' +
    rows
      .map(
        (row) =>
          '<w:tr>' +
          row
            .map(
              (width) =>
                `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
                '<w:p><w:r><w:t>Cell text</w:t></w:r></w:p></w:tc>'
            )
            .join('') +
          '</w:tr>'
      )
      .join('') +
    '</w:tbl>'
  );
}

describe('fixed tables without a stated table width', () => {
  for (const revision of [
    { kind: 'del', hiddenMode: 'proposed' },
    { kind: 'ins', hiddenMode: 'original' },
  ] as const) {
    test(`retains the grid while a ${revision.kind} row is hidden`, () => {
      const visible = table([1200, 1800], [[1200, 1200]]);
      const deleted = table(
        [1200, 1800],
        [
          [1200, 1800],
          [1200, 1200],
        ]
      ).replace(
        '<w:tr>',
        `<w:tr><w:trPr><w:${revision.kind} w:id="1" w:author="Reviewer" ` +
          'w:date="2020-01-01T00:00:00Z"/></w:trPr>'
      );
      const source = readDocument(
        `<w:document xmlns:w="${W}"><w:body>${deleted}<w:p/>${visible}</w:body></w:document>`
      );
      const xml = serializeOoxmlPart(source);
      for (const document of [source, readDocument(xml)]) {
        const layout = layoutSemanticDocument(document, 0, {
          measurer: createFixedMeasurer(),
          displayMode: revision.hiddenMode,
        });
        const tables = layout.pages.flatMap((page) =>
          page.fragments.filter((fragment) => fragment.kind === 'table')
        );
        expect(tables).toHaveLength(2);
        expect(tables[0]!.rows).toHaveLength(1);
        expect(tables[0]!.rows[0]!.cells.map((cell) => cell.box.width)).toEqual([60, 90]);
        expect(tables[1]!.rows[0]!.cells.map((cell) => cell.box.width)).toEqual([60, 60]);
        expect(serializeOoxmlPart(document)).toBe(xml);
      }
    });
  }

  for (const scenario of [
    {
      name: 'a larger cell preference',
      grid: [1200, 1200],
      rows: [[2400, 1200]],
      widths: [120, 60],
    },
    {
      name: 'uniform preferences followed by a row that matches the grid',
      grid: [1200, 1800, 4200],
      rows: [
        [2400, 2400, 2400],
        [1200, 1800, 4200],
      ],
      widths: [120, 120, 210],
    },
    {
      name: 'uniform widths smaller than an initial grid column',
      grid: [1200, 1800, 4200],
      rows: [[2400, 2400, 2400]],
      widths: [120, 120, 120],
    },
    {
      name: 'unequal widths smaller than the initial grid',
      grid: [2400, 3600],
      rows: [[1200, 1800]],
      widths: [60, 90],
    },
    {
      name: 'the largest explicit width across rows',
      grid: [2400, 3600],
      rows: [
        [1200, 1800],
        [1800, 1200],
      ],
      widths: [90, 90],
    },
    {
      name: 'uniform preferences across repeated rows',
      grid: [2041, 7030],
      rows: [
        [4873, 4873],
        [4873, 4873],
      ],
      widths: [243.65, 243.65],
    },
  ]) {
    for (const tableWidth of ['', '<w:tblW w:w="0" w:type="auto"/>']) {
      test(`preserves ${scenario.name} through layout and serialization: ${tableWidth || 'absent'}`, () => {
        const source = readDocument(
          `<w:document xmlns:w="${W}"><w:body>` +
            table(scenario.grid, scenario.rows, tableWidth) +
            '<w:p/>' +
            table(scenario.grid, [scenario.grid], tableWidth) +
            '</w:body></w:document>'
        );
        const xml = serializeOoxmlPart(source);
        for (const document of [source, readDocument(xml)]) {
          const layout = layoutSemanticDocument(document, 0, { measurer: createFixedMeasurer() });
          const tables = layout.pages.flatMap((page) =>
            page.fragments.filter((fragment) => fragment.kind === 'table')
          );
          expect(tables).toHaveLength(2);
          for (const [index, fragment] of tables.entries()) {
            const widths = index === 0 ? scenario.widths : scenario.grid.map((width) => width / 20);
            for (const row of fragment.rows) {
              expect(row.cells.map((cell) => cell.box.width)).toEqual(widths);
            }
            expect(fragment.box.width).toBe(widths.reduce((sum, width) => sum + width, 0));
          }
          expect(serializeOoxmlPart(document)).toBe(xml);
        }
      });
    }
  }
});

describe('cell width replacement', () => {
  const smallerCells = table([2400, 3600], [[1200, 1800]]);
  for (const scenario of [
    {
      name: 'a positive table width',
      xml: table([2400, 3600], [[1200, 1800]], '<w:tblW w:w="6000" w:type="dxa"/>'),
      widths: [120, 180],
    },
    {
      // Measured: AutoFit replaces the grid with the stated cell widths too.
      name: 'AutoFit layout',
      xml: smallerCells.replace('w:type="fixed"', 'w:type="autofit"'),
      widths: [60, 90],
    },
    {
      // Only the column a cell states a width for gives up its grid width.
      name: 'an unspecified cell width',
      xml: smallerCells.replace('<w:tcW w:w="1200" w:type="dxa"/>', ''),
      widths: [120, 90],
    },
    {
      name: 'a percentage cell width',
      xml: smallerCells.replace(
        '<w:tcW w:w="1200" w:type="dxa"/>',
        '<w:tcW w:w="5000" w:type="pct"/>'
      ),
      widths: [120, 90],
    },
    {
      name: 'a spanning cell',
      xml: table([2400, 3600], [[3000]]).replace('<w:tcPr>', '<w:tcPr><w:gridSpan w:val="2"/>'),
      widths: [300],
    },
  ]) {
    test(`resolves widths with ${scenario.name}`, () => {
      const source = readDocument(
        `<w:document xmlns:w="${W}"><w:body>${scenario.xml}</w:body></w:document>`
      );
      const xml = serializeOoxmlPart(source);
      for (const document of [source, readDocument(xml)]) {
        const layout = layoutSemanticDocument(document, 0, { measurer: createFixedMeasurer() });
        const tables = layout.pages.flatMap((page) =>
          page.fragments.filter((fragment) => fragment.kind === 'table')
        );
        expect(tables).toHaveLength(1);
        expect(tables[0]!.rows[0]!.cells.map((cell) => cell.box.width)).toEqual(scenario.widths);
        expect(serializeOoxmlPart(document)).toBe(xml);
      }
    });
  }
});
