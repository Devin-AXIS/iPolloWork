import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../../ooxml-package.ts';
import type { OoxmlNode } from '../../ooxml-tree.ts';
import { binaryPartBytes, chartTargetOf } from '../data.ts';
import { duplicatedChartDrawing, withDuplicatedChart } from '../duplicate.ts';
import { ChartRefusal } from '../tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;
const CHART_REL = `${R}/chart`;
const PACKAGE_REL = `${R}/package`;
const COLORS_REL = 'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle';
const OLE_REL = `${R}/oleObject`;

const WORKBOOK = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4, 5]);

function packageWithChart(options: { external?: boolean } = {}): OoxmlPackage {
  const external = options.external
    ? `<Relationship Id="rId9" Type="${OLE_REL}" Target="file:///C:/book.xlsx" TargetMode="External"/>`
    : '';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
        '<Override PartName="/word/charts/colors1.xml" ContentType="application/vnd.ms-office.chartcolorstyle+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:c="${C}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        '<wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="7" name="Chart 7"><a:hlinkClick r:id="rId5"/></wp:docPr>' +
        `<a:graphic><a:graphicData uri="${C}"><c:chart r:id="rId4"/></a:graphicData></a:graphic>` +
        '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId4" Type="${CHART_REL}" Target="charts/chart1.xml"/>` +
        `<Relationship Id="rId5" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`
    ),
    'word/charts/chart1.xml': strToU8(
      `<c:chartSpace xmlns:c="${C}" xmlns:r="${R}"><c:chart><c:plotArea/></c:chart>` +
        (options.external ? '<c:externalData r:id="rId9"/>' : '<c:externalData r:id="rId2"/>') +
        '</c:chartSpace>'
    ),
    'word/charts/_rels/chart1.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${PACKAGE_REL}" Target="../embeddings/Book1.xlsx"/>` +
        `<Relationship Id="rId3" Type="${COLORS_REL}" Target="colors1.xml"/>${external}</Relationships>`
    ),
    'word/charts/colors1.xml': strToU8(
      '<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" meth="cycle" id="10"/>'
    ),
    'word/embeddings/Book1.xlsx': WORKBOOK,
  });
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error('fixture did not read');
  return read.package;
}

function drawingOf(pkg: OoxmlPackage): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'drawing') return node;
    for (const kid of node.children) {
      const found = find(kid);
      if (found) return found;
    }
    return null;
  };
  return find(pkg.parts.get('/word/document.xml')!.root)!;
}

const attributeValues = (node: OoxmlNode, localName: string): string[] =>
  node.kind === 'textValue'
    ? []
    : [
        ...node.attributes.filter((a) => a.localName === localName).map((a) => a.value),
        ...node.children.flatMap((kid) => attributeValues(kid, localName)),
      ];

describe('withDuplicatedChart', () => {
  test('copies the chart part and every part it reaches under new names', () => {
    const pkg = packageWithChart();
    const source = chartTargetOf(pkg, '/word/document.xml', drawingOf(pkg))!;
    const copy = withDuplicatedChart(pkg, '/word/document.xml', pkg, source.part);
    expect(copy.chartPart).toBe('/word/charts/chart2.xml');
    expect(copy.parts).toHaveLength(3);
    // The workbook copies byte for byte under its own name.
    const book = copy.parts.find((name) => name.endsWith('.xlsx'))!;
    expect(book).not.toBe('/word/embeddings/Book1.xlsx');
    expect(binaryPartBytes(copy.pkg, book)).toEqual(WORKBOOK);
    // The copy's relationships point at the copies, and its XML names its own ids.
    const rels = copy.pkg.relationships.get(copy.chartPart)!;
    expect(rels.map((r) => r.rawTarget).sort()).toEqual(
      ['../embeddings/Book2.xlsx', 'colors2.xml'].sort()
    );
    const externalData = attributeValues(copy.pkg.parts.get(copy.chartPart)!.root, 'id');
    const bookRel = rels.find((r) => r.rawTarget.endsWith('.xlsx'))!;
    expect(externalData).toEqual([bookRel.id]);
    // The story part gets one new chart relationship.
    const owner = copy.pkg.relationships.get('/word/document.xml')!;
    expect(owner.find((r) => r.id === copy.relationshipId)!.rawTarget).toBe('charts/chart2.xml');
    // The source stays as it was.
    expect(copy.pkg.parts.get('/word/charts/chart1.xml')).toBe(
      pkg.parts.get('/word/charts/chart1.xml')
    );
  });

  test('a copy into another package takes the first free names there', () => {
    const source = packageWithChart();
    const target = packageWithChart();
    const part = chartTargetOf(source, '/word/document.xml', drawingOf(source))!.part;
    const copy = withDuplicatedChart(target, '/word/document.xml', source, part);
    expect(copy.chartPart).toBe('/word/charts/chart2.xml');
  });

  test('a link to an external workbook goes, and the cached chart stays', () => {
    const pkg = packageWithChart({ external: true });
    const part = chartTargetOf(pkg, '/word/document.xml', drawingOf(pkg))!.part;
    const copy = withDuplicatedChart(pkg, '/word/document.xml', pkg, part);
    const xml = JSON.stringify(copy.pkg.parts.get(copy.chartPart)!.root);
    expect(xml).not.toContain('externalData');
    expect(
      copy.pkg.relationships.get(copy.chartPart)!.some((r) => r.targetMode === 'External')
    ).toBe(false);
  });

  test('a relationship cycle copies each part once', () => {
    const pkg = packageWithChart();
    const chained = new Map(pkg.relationships);
    chained.set('/word/charts/colors1.xml', [
      {
        ownerPart: '/word/charts/colors1.xml',
        id: 'rId1',
        type: COLORS_REL,
        rawTarget: 'colors1.xml',
        targetMode: 'Internal',
        order: 0,
      },
    ]);
    const cyclic = { ...pkg, relationships: chained } as OoxmlPackage;
    const part = chartTargetOf(cyclic, '/word/document.xml', drawingOf(cyclic))!.part;
    const copy = withDuplicatedChart(cyclic, '/word/document.xml', cyclic, part);
    expect(copy.parts).toHaveLength(3);
  });
});

describe('duplicatedChartDrawing', () => {
  test('names the new relationship and docPr id, and drops a hyperlink', () => {
    const pkg = packageWithChart();
    const drawing = duplicatedChartDrawing(drawingOf(pkg), 'rId42', 99);
    const xml = JSON.stringify(drawing);
    expect(xml).toContain('"value":"rId42"');
    expect(xml).toContain('"value":"99"');
    expect(xml).not.toContain('hlinkClick');
  });

  test('refuses a drawing that is not a chart', () => {
    expect(() =>
      duplicatedChartDrawing(
        {
          id: 'x',
          kind: 'generic',
          namespaceUri: W,
          localName: 'drawing',
          namespaceBindings: [],
          attributes: [],
          children: [],
        } as unknown as OoxmlNode,
        'rId1',
        1
      )
    ).toThrow(ChartRefusal);
  });
});
