import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { CHART_TYPES } from '../../store/package/chart-edit/type.ts';
import { stubReviewModule } from './review-test-module.ts';
import { chartPaneAvailable, chartTypeIconPaths, listenPaneRequests } from '../chart-chrome.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(body = '<w:p><w:r><w:t>hello</w:t></w:r></w:p>'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
  });
}

function mount(bytes = documentBytes()): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    author: 'Reviewer',
    modules: [stubReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const paragraphId = editor.surface.session.paragraphIds()[0]!;
  editor.surface.setSelection({
    anchor: { paragraphId, offset: 5 },
    head: { paragraphId, offset: 5 },
  });
  return editor;
}

async function reopen(editor: DocxEditorInstance): Promise<DocxEditorInstance> {
  const bytes = new Uint8Array(await editor.save());
  const read = readOoxmlPackage(bytes);
  expect(read.ok).toBe(true);
  const next = createDocxEditor({ container: document.createElement('div'), document: bytes });
  if (!next.surface) throw new Error('surface failed to mount');
  return next;
}

describe('chart commands', () => {
  test('insertChart inserts a selected chart with sample data, in one undo step', () => {
    const editor = mount();
    const result = editor.exec({ type: 'insertChart', chartType: 'columnClustered' });
    expect(result.ok).toBe(true);
    const chart = editor.snapshot().chart;
    expect(chart).not.toBeNull();
    expect(chart!.editable).toBe(true);
    expect(chart!.formattable).toBe(true);
    const data = editor.query({ type: 'chartData' });
    expect(data.ok).toBe(true);
    if (data.ok) {
      expect(data.data.series.map((s) => s.name)).toEqual(['Series 1', 'Series 2', 'Series 3']);
      expect(data.data.categories.map((c) => c.label)).toEqual([
        'Category 1',
        'Category 2',
        'Category 3',
        'Category 4',
      ]);
      expect(data.data.workbook).toBe('embedded');
    }
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.snapshot().chart).toBeNull();
    const pkg = editor.surface!.session.currentPackage();
    expect([...pkg.parts.keys()].some((name) => name.startsWith('/word/charts/'))).toBe(false);
  });

  test('every chart type inserts and survives save and reopen', async () => {
    for (const chartType of CHART_TYPES) {
      const editor = mount();
      expect(editor.exec({ type: 'insertChart', chartType }).ok).toBe(true);
      const reopened = await reopen(editor);
      const pkg = reopened.surface!.session.currentPackage();
      const chartPart = [...pkg.parts.keys()].find((name) =>
        /^\/word\/charts\/chart\d+\.xml$/.test(name)
      );
      expect(chartPart).toBe('/word/charts/chart1.xml');
      const drawingId = [...pkg.parts.get('/word/document.xml')!.root.children]
        .flatMap(function walk(node): string[] {
          if (node.kind === 'textValue') return [];
          return [...(node.kind === 'drawing' ? [node.id] : []), ...node.children.flatMap(walk)];
        })
        .at(0);
      const format = reopened.query({ type: 'chartFormat', drawingNodeId: drawingId });
      expect(format.ok && format.format.type).toBe(chartType);
    }
  });

  test('data, type, format, and color edits apply, undo, and reach the saved file', async () => {
    const editor = mount();
    editor.exec({ type: 'insertChart', chartType: 'columnClustered' });
    const read = editor.query({ type: 'chartData' });
    if (!read.ok) throw new Error(read.reason);
    const edited = editor.exec({
      type: 'setChartData',
      data: {
        kind: read.data.kind,
        categories: [...read.data.categories, { label: 'East' }],
        series: read.data.series.map((s) => ({ ...s, values: [...s.values, 7] })),
      },
    });
    expect(edited.ok).toBe(true);
    expect(editor.exec({ type: 'setChartFormat', format: { title: 'Sales' } }).ok).toBe(true);
    expect(editor.exec({ type: 'setChartColor', index: 0, color: '#7030A0' }).ok).toBe(true);
    expect(editor.exec({ type: 'setChartType', chartType: 'line' }).ok).toBe(true);
    let format = editor.query({ type: 'chartFormat' });
    expect(format.ok && format.format.type).toBe('line');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    format = editor.query({ type: 'chartFormat' });
    expect(format.ok && format.format.type).toBe('columnClustered');
    expect(format.ok && format.format.title).toBe('Sales');
    const reopened = await reopen(editor);
    const pkg = reopened.surface!.session.currentPackage();
    const xml = JSON.stringify(pkg.parts.get('/word/charts/chart1.xml')!.root);
    expect(xml).toContain('East');
    expect(xml).toContain('7030A0');
  });

  test('chart edits refuse without a chart, and in suggesting mode', () => {
    const editor = mount();
    const none = editor.exec({ type: 'setChartType', chartType: 'pie' });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe('chart.errors.noChart');
    editor.exec({ type: 'insertChart', chartType: 'pie' });
    expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    const tracked = editor.exec({ type: 'setChartFormat', format: { title: 'x' } });
    expect(tracked.ok).toBe(false);
    const insert = editor.exec({ type: 'insertChart', chartType: 'line' });
    expect(insert.ok).toBe(false);
  });

  test('a refused edit names its reason as a translation key', () => {
    const editor = mount();
    editor.exec({ type: 'insertChart', chartType: 'pie' });
    const refused = editor.exec({ type: 'setChartFormat', format: { valueAxisTitle: 'Units' } });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('chart.errors.noAxes');
  });

  test('a chart resizes, floats and moves like a picture, and refuses picture-only edits', async () => {
    const editor = mount();
    editor.exec({ type: 'insertChart', chartType: 'columnClustered' });
    const image = editor.snapshot().image;
    expect(image).not.toBeNull();
    expect({
      canResize: image!.canResize,
      canMove: image!.canMove,
      canChangeWrap: image!.canChangeWrap,
      canCrop: image!.canCrop,
    }).toEqual({ canResize: true, canMove: true, canChangeWrap: true, canCrop: false });
    const resized = editor.exec({
      type: 'setImageProperties',
      widthEmu: 3_657_600,
      heightEmu: 2_286_000,
    });
    expect(resized.ok).toBe(true);
    expect(editor.exec({ type: 'setImageWrapType', target: 'square' }).ok).toBe(true);
    const moved = editor.exec({
      type: 'setImagePosition',
      horizontalEmu: 127_000,
      verticalEmu: 254_000,
    });
    expect(moved.ok).toBe(true);
    // The chart stays a chart: its pane still reads it after the frame edits.
    expect(editor.snapshot().chart).not.toBeNull();
    const crop = editor.exec({
      type: 'setImageProperties',
      crop: { left: 10, top: 0, right: 0, bottom: 0 },
    });
    expect(crop.ok).toBe(false);
    if (!crop.ok) expect(crop.reason).toContain('only its size, position, wrap and alt text');
    expect(editor.exec({ type: 'transformImage', action: 'rotateCW' }).ok).toBe(false);
    const reopened = await reopen(editor);
    const xml = JSON.stringify(
      reopened.surface!.session.currentPackage().parts.get('/word/document.xml')!.root
    );
    expect(xml).toContain('3657600');
    expect(xml).toContain('wrapSquare');
    expect(xml).toContain('127000');
  });

  test('undo of a chart edit selects the chart again, after a click away', () => {
    const editor = mount();
    editor.exec({ type: 'insertChart', chartType: 'columnClustered' });
    const chartId = editor.snapshot().chart!.drawingNodeId;
    expect(editor.exec({ type: 'setChartType', chartType: 'line' }).ok).toBe(true);
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    expect(editor.snapshot().chart).toBeNull();
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.snapshot().chart?.drawingNodeId).toBe(chartId);
  });

  test('every chart type has an icon', () => {
    for (const type of CHART_TYPES) expect(chartTypeIconPaths(type).length).toBeGreaterThan(0);
    expect(chartTypeIconPaths('pie')).not.toEqual(chartTypeIconPaths('columnClustered'));
  });

  test('a chart inserts at a caret just before another chart', async () => {
    const editor = mount();
    expect(editor.exec({ type: 'insertChart', chartType: 'pie' }).ok).toBe(true);
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    expect(editor.exec({ type: 'insertChart', chartType: 'line' }).ok).toBe(true);
    const reopened = await reopen(editor);
    const xml = JSON.stringify(
      reopened.surface!.session.currentPackage().parts.get('/word/document.xml')!.root
    );
    expect(xml.match(/"localName":"chart"/g)?.length).toBe(2);
  });

  test('a chart pane is available while the host listens for pane requests', () => {
    const editor = mount();
    expect(chartPaneAvailable(editor)).toBe(false);
    const stop = listenPaneRequests(editor, () => {});
    expect(chartPaneAvailable(editor)).toBe(true);
    stop();
    expect(chartPaneAvailable(editor)).toBe(false);
    expect(chartPaneAvailable(null)).toBe(false);
  });
});

for (const [properties, blocked] of [
  ['<w:lock w:val="contentLocked"/>', true],
  ['<w:lock w:val="sdtContentLocked"/>', true],
  [
    '<w:dataBinding w:storeItemID="{11111111-1111-1111-1111-111111111111}" w:xpath="/chart"/>',
    true,
  ],
  ['<w:lock w:val="sdtLocked"/>', false],
] as const) {
  test(`chart edits respect control properties: ${properties}`, async () => {
    const source = mount();
    expect(source.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    const entries = unzipSync(new Uint8Array(await source.save()));
    source.destroy();
    const xml = strFromU8(entries['word/document.xml']!);
    entries['word/document.xml'] = strToU8(
      xml.replace(
        /(<w:p[ >][\s\S]*?<\/w:p>)/,
        `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>$1</w:sdtContent></w:sdt>`
      )
    );
    const editor = mount(zipSync(entries));
    try {
      const surface = editor.surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      const drawingId = surface.session.part().root.children.flatMap(function walk(node): string[] {
        if (node.kind === 'textValue') return [];
        return [...(node.kind === 'drawing' ? [node.id] : []), ...node.children.flatMap(walk)];
      })[0]!;
      expect(drawingId).toBeDefined();
      surface.selectDrawing(drawingId, paragraphId);
      expect(editor.snapshot().chart).toMatchObject({ editable: !blocked, formattable: !blocked });
      if (blocked) {
        const before = surface.session.currentPackage();
        let called = false;
        expect(
          surface.editChart(drawingId, (_pkg, target) => {
            called = true;
            return { chartSpace: target.chartSpace };
          }).ok
        ).toBe(false);
        expect(called).toBe(false);
        expect(surface.session.currentPackage()).toBe(before);
      }
      const read = editor.query({ type: 'chartData', drawingNodeId: drawingId });
      if (!read.ok) throw new Error(read.reason);
      const commands: Parameters<typeof editor.exec>[0][] = [
        { type: 'setChartFormat', drawingNodeId: drawingId, format: { title: 'Changed' } },
        { type: 'setChartColor', drawingNodeId: drawingId, index: 0, color: '#FF0000' },
        { type: 'setChartType', drawingNodeId: drawingId, chartType: 'line' },
        {
          type: 'setChartData',
          drawingNodeId: drawingId,
          data: {
            ...read.data,
            series: read.data.series.map((series) => ({ ...series, name: 'Changed' })),
          },
        },
      ];
      for (const command of commands) {
        const before = surface.session.currentPackage();
        expect(editor.can(command).ok).toBe(!blocked);
        expect(editor.exec(command).ok).toBe(!blocked);
        if (blocked) expect(surface.session.currentPackage()).toBe(before);
      }
    } finally {
      editor.destroy();
    }
  });
}
