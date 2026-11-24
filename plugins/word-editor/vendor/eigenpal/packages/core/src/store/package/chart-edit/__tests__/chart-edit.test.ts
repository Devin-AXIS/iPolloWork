import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage, type OoxmlPackage } from '../../ooxml-package.ts';
import { readZip } from '../../zip.ts';
import {
  binaryPartBytes,
  chartDataEdit,
  chartTargetOf,
  readChartData,
  readChartFormatOf,
  type ChartTarget,
} from '../data.ts';
import { withChartColor, withChartFormat, withChartType } from '../format.ts';
import {
  buildInlineChartDrawing,
  relativeTarget,
  withChartSpace,
  withChartWorkbook,
  withNewChart,
} from '../package.ts';
import { asChartElement } from '../tree.ts';
import { CHART_TYPES } from '../type.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function blank(): OoxmlPackage {
  const read = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/></w:body></w:document>`
      ),
    })
  );
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

function reopen(pkg: OoxmlPackage): OoxmlPackage {
  const read = readOoxmlPackage(writeOoxmlPackage(pkg));
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

function targetOf(pkg: OoxmlPackage, part: string): ChartTarget {
  const root = pkg.parts.get(part)?.root;
  if (!root) throw new Error(`no part ${part}`);
  return { ownerPart: '/word/document.xml', part, chartSpace: asChartElement(root) };
}

describe('chart edits in the package', () => {
  test('a new chart of every type saves, reopens, and reads its sample data', () => {
    for (const type of CHART_TYPES) {
      const added = withNewChart(blank(), '/word/document.xml', type, undefined);
      const pkg = reopen(added.pkg);
      const read = readChartData(pkg, targetOf(pkg, added.chartPart));
      expect(read.ok).toBe(true);
      if (!read.ok) continue;
      const pie = type === 'pie' || type === 'doughnut';
      expect(read.data.series.length).toBe(pie ? 1 : 3);
      expect(read.data.categories.length).toBe(4);
      expect(read.data.workbook).toBe('embedded');
      const format = readChartFormatOf(targetOf(pkg, added.chartPart));
      expect(format.ok && format.format.type).toBe(type);
      // The workbook is a readable package with its own content types.
      const book = binaryPartBytes(pkg, added.workbookPart);
      const zip = readZip(book!);
      expect(zip.ok && zip.entries.has('/xl/worksheets/sheet1.xml')).toBe(true);
      expect(pkg.relationships.get(added.chartPart)?.[0]?.rawTarget).toBe(
        '../embeddings/Workbook1.xlsx'
      );
      expect(pkg.relationships.get('/word/document.xml')?.[0]?.rawTarget).toBe('charts/chart1.xml');
    }
  });

  test('a second chart takes the next part names', () => {
    const one = withNewChart(blank(), '/word/document.xml', 'line', undefined);
    const two = withNewChart(one.pkg, '/word/document.xml', 'pie', undefined);
    expect(two.chartPart).toBe('/word/charts/chart2.xml');
    expect(two.workbookPart).toBe('/word/embeddings/Workbook2.xlsx');
    expect(two.relationshipId).not.toBe(one.relationshipId);
  });

  test('a data edit writes the chart part and its workbook, and both survive reopen', () => {
    const added = withNewChart(blank(), '/word/document.xml', 'columnClustered', undefined);
    let pkg = added.pkg;
    const read = readChartData(pkg, targetOf(pkg, added.chartPart));
    if (!read.ok) throw new Error(read.reason);
    const { kind, categories, series } = read.data;
    const edit = chartDataEdit(pkg, targetOf(pkg, added.chartPart), {
      kind,
      categories: [...categories, { label: 'East' }],
      series: series.map((s, i) => ({
        ...s,
        name: i === 0 ? 'Plan' : s.name,
        values: [...s.values, 9],
      })),
    });
    pkg = withChartSpace(pkg, added.chartPart, edit.chartSpace);
    expect(edit.workbook?.part).toBe(added.workbookPart);
    pkg = withChartWorkbook(pkg, edit.workbook!.part, edit.workbook!.bytes);
    pkg = reopen(pkg);
    const after = readChartData(pkg, targetOf(pkg, added.chartPart));
    if (!after.ok) throw new Error(after.reason);
    expect(after.data.categories.map((c) => c.label).at(-1)).toBe('East');
    expect(after.data.series[0]!.name).toBe('Plan');
    expect(after.data.series[2]!.values.at(-1)).toBe(9);
    expect(after.data.workbook).toBe('embedded');
  });

  test('type, elements, and colors change and survive reopen', () => {
    const added = withNewChart(blank(), '/word/document.xml', 'columnClustered', undefined);
    let pkg = added.pkg;
    let space = targetOf(pkg, added.chartPart).chartSpace;
    space = withChartFormat(space, { title: 'Sales', legend: 'right', valueAxisTitle: 'Units' });
    space = withChartColor(space, 1, { theme: 'accent6' });
    space = withChartType(space, 'lineMarkers');
    pkg = reopen(withChartSpace(pkg, added.chartPart, space));
    const read = readChartFormatOf(targetOf(pkg, added.chartPart));
    if (!read.ok) throw new Error(read.reason);
    expect(read.format.type).toBe('lineMarkers');
    expect(read.format.title).toBe('Sales');
    expect(read.format.legend).toBe('right');
    expect(read.format.axisTitles?.value).toBe('Units');
    expect(read.format.colors[1]!.color).toEqual({ theme: 'accent6' });
  });

  test('node ids stay unique after an edit that copies a series', () => {
    const added = withNewChart(blank(), '/word/document.xml', 'columnClustered', undefined);
    const target = targetOf(added.pkg, added.chartPart);
    const read = readChartData(added.pkg, target);
    if (!read.ok) throw new Error(read.reason);
    const edit = chartDataEdit(added.pkg, target, {
      ...read.data,
      series: [...read.data.series, { name: 'New', values: [1, 2, 3, 4] }],
    });
    const pkg = withChartSpace(added.pkg, added.chartPart, edit.chartSpace);
    const ids = new Set<string>();
    let count = 0;
    const walk = (node: { id: string; kind: string; children?: readonly unknown[] }): void => {
      ids.add(node.id);
      count += 1;
      for (const kid of node.children ?? []) walk(kid as typeof node);
    };
    walk(pkg.parts.get(added.chartPart)!.root);
    expect(ids.size).toBe(count);
    expect(pkg.parts.get(added.chartPart)!.root.id).toBe(target.chartSpace.id);
  });

  test('a chart drawing names its chart part', () => {
    const added = withNewChart(blank(), '/word/document.xml', 'pie', undefined);
    const drawing = buildInlineChartDrawing({
      docPrId: 1,
      relationshipId: added.relationshipId,
      name: 'Chart 1',
      widthPoints: 432,
      heightPoints: 252,
    });
    expect(chartTargetOf(added.pkg, '/word/document.xml', drawing)?.part).toBe(added.chartPart);
  });

  test('relative targets', () => {
    expect(relativeTarget('/word/document.xml', '/word/charts/chart1.xml')).toBe(
      'charts/chart1.xml'
    );
    expect(relativeTarget('/word/charts/chart1.xml', '/word/embeddings/Workbook1.xlsx')).toBe(
      '../embeddings/Workbook1.xlsx'
    );
  });
});
