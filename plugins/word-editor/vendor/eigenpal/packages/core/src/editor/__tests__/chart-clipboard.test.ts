import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../../store/package/ooxml-package.ts';
import { binaryPartBytes } from '../../store/package/chart-edit/data.ts';
import { CHART_CLIPBOARD_REASON } from '../clipboard-object-selection.ts';
import { CHART_CLIPBOARD_STALE_REASON, resetChartClipboard } from '../chart-clipboard.ts';
import { CHART_SUGGESTING_REFUSAL } from '../surface-chart-ops.ts';
import { createClipboardHandlers } from '../surface-input.ts';
import { stubReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>world</w:t></w:r></w:p></w:body></w:document>'
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
  caretAt(editor, 0, 5);
  return editor;
}

function caretAt(editor: DocxEditorInstance, paragraph: number, offset: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

const chartParts = (pkg: OoxmlPackage): string[] =>
  [...pkg.parts.keys()].filter((name) => /^\/word\/charts\/chart\d+\.xml$/.test(name)).sort();

/** The chart drawings the main story holds. */
const chartDrawings = (editor: DocxEditorInstance): number =>
  JSON.stringify(
    editor.surface!.session.currentPackage().parts.get('/word/document.xml')!.root
  ).split('"localName":"chart"').length - 1;

const workbooks = (pkg: OoxmlPackage): string[] =>
  [...pkg.partBytes.keys()].filter((name) => /\.xlsx$/.test(name)).sort();

/** A chart with edited data, selected, and its clipboard flavours. */
function copiedChart(editor: DocxEditorInstance) {
  expect(editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
  const read = editor.query({ type: 'chartData' });
  if (!read.ok) throw new Error(read.reason);
  const edited = editor.exec({
    type: 'setChartData',
    data: {
      kind: read.data.kind,
      categories: read.data.categories,
      series: read.data.series.map((s, i) => ({ ...s, values: s.values.map((v) => v + i) })),
    },
  });
  expect(edited.ok).toBe(true);
  expect(editor.can({ type: 'copy' }).ok).toBe(true);
  expect(editor.can({ type: 'cut' }).ok).toBe(true);
  const flavours = editor.surface!.copyFlavours();
  expect(flavours.reason).toBeUndefined();
  expect(flavours.html).toContain('data-docx-editor-chart=');
  expect(flavours.chartDrawingNodeId).toBe(editor.snapshot().chart!.drawingNodeId);
  return flavours;
}

afterEach(() => resetChartClipboard());

describe('chart clipboard', () => {
  test('copy and paste in one editor copies every chart part, in one undo step', () => {
    const editor = mount();
    const flavours = copiedChart(editor);
    const source = editor.snapshot().chart!.drawingNodeId;
    const before = editor.surface!.session.currentPackage();
    const sourceData = editor.query({ type: 'chartData' });
    caretAt(editor, 1, 5);
    expect(editor.surface!.pasteRich(flavours.text, flavours.html)).toBe(true);

    const pkg = editor.surface!.session.currentPackage();
    expect(chartParts(pkg)).toHaveLength(2);
    expect(workbooks(pkg)).toHaveLength(2);
    const [first, second] = workbooks(pkg);
    expect(binaryPartBytes(pkg, `/${first!.replace(/^\//, '')}`)).toEqual(
      binaryPartBytes(pkg, `/${second!.replace(/^\//, '')}`)!
    );
    // The copy's own relationship names its own workbook, never the source's.
    const copyPart = chartParts(pkg).find((name) => !before.parts.has(name))!;
    const rels = pkg.relationships.get(copyPart) ?? [];
    expect(rels.some((r) => r.rawTarget.endsWith('.xlsx'))).toBe(true);
    expect(rels.every((r) => !workbooks(before).some((w) => w.endsWith(r.rawTarget)))).toBe(true);
    // The pasted chart is selected and reads the same data.
    const pasted = editor.snapshot().chart;
    expect(pasted).not.toBeNull();
    expect(pasted!.drawingNodeId).not.toBe(source);
    const pastedData = editor.query({ type: 'chartData' });
    expect(pastedData.ok && sourceData.ok).toBe(true);
    if (pastedData.ok && sourceData.ok)
      expect(pastedData.data.series.map((s) => s.values)).toEqual(
        sourceData.data.series.map((s) => s.values)
      );

    // An edit of the copy leaves the source part alone.
    const sourcePart = chartParts(before).find((name) => pkg.parts.has(name))!;
    const sourceRoot = pkg.parts.get(sourcePart)!.root;
    expect(editor.exec({ type: 'setChartType', chartType: 'line' }).ok).toBe(true);
    expect(editor.surface!.session.currentPackage().parts.get(sourcePart)!.root).toBe(sourceRoot);

    editor.exec({ type: 'undo' });
    editor.exec({ type: 'undo' });
    const undone = editor.surface!.session.currentPackage();
    expect(chartParts(undone)).toEqual(chartParts(before));
    expect(workbooks(undone)).toEqual(workbooks(before));
  });

  test('a pasted chart survives save and reopen next to its source', async () => {
    const editor = mount();
    const flavours = copiedChart(editor);
    caretAt(editor, 1, 0);
    expect(editor.surface!.pasteRich(flavours.text, flavours.html)).toBe(true);
    const bytes = new Uint8Array(await editor.save());
    const read = readOoxmlPackage(bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(chartParts(read.package)).toHaveLength(2);
    const docPrIds = JSON.stringify(read.package.parts.get('/word/document.xml')!.root).match(
      /"localName":"docPr"[^\]]*?"localName":"id","value":"(\d+)"/g
    );
    expect(new Set(docPrIds ?? []).size).toBe(docPrIds?.length ?? 0);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
    });
    expect(reopened.surface).toBeTruthy();
  });

  test('a chart copied in one editor pastes into another', () => {
    const source = mount();
    const flavours = copiedChart(source);
    const target = mount();
    expect(target.exec({ type: 'paste', text: flavours.text, html: flavours.html! }).ok).toBe(true);
    const pkg = target.surface!.session.currentPackage();
    expect(chartParts(pkg)).toHaveLength(1);
    expect(workbooks(pkg)).toHaveLength(1);
    expect(target.snapshot().chart).not.toBeNull();
    const a = source.query({ type: 'chartData' });
    const b = target.query({ type: 'chartData' });
    if (!a.ok || !b.ok) throw new Error('chart data did not read');
    expect(b.data.series.map((s) => s.values)).toEqual(a.data.series.map((s) => s.values));
  });

  test('cut removes the chart, and a paste brings it back', () => {
    const editor = mount();
    copiedChart(editor);
    const written: Record<string, string> = {};
    const nav = globalThis.navigator as unknown as { clipboard?: unknown };
    const previous = nav.clipboard;
    const realm = globalThis as unknown as { ClipboardItem?: unknown };
    const previousItem = realm.ClipboardItem;
    class Item {
      constructor(readonly items: Record<string, Blob>) {}
    }
    realm.ClipboardItem = Item;
    let pending: Promise<void> = Promise.resolve();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        write: (items: Item[]) => {
          pending = Promise.all(
            Object.entries(items[0]!.items).map(async ([type, blob]) => {
              written[type] = await blob.text();
            })
          ).then(() => undefined);
          return pending;
        },
        writeText: async (text: string) => {
          written['text/plain'] = text;
        },
      },
    });
    try {
      expect(editor.exec({ type: 'cut' }).ok).toBe(true);
    } finally {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: previous,
      });
      realm.ClipboardItem = previousItem;
    }
    expect(chartDrawings(editor)).toBe(0);
    return pending.then(() => {
      expect(written['text/html']).toContain('data-docx-editor-chart=');
      caretAt(editor, 1, 5);
      expect(
        editor.exec({
          type: 'paste',
          text: written['text/plain'] ?? '',
          html: written['text/html']!,
        }).ok
      ).toBe(true);
      expect(chartDrawings(editor)).toBe(1);
    });
  });

  test('an older copy refuses, and so does a paste while suggesting', () => {
    const editor = mount();
    const older = copiedChart(editor);
    const latest = editor.surface!.copyFlavours();
    caretAt(editor, 1, 5);
    expect(editor.surface!.pasteRich(older.text, older.html)).toBe(false);
    expect(editor.surface!.state().lastRejection).toBe(CHART_CLIPBOARD_STALE_REASON);
    expect(chartParts(editor.surface!.session.currentPackage())).toHaveLength(1);

    expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    caretAt(editor, 1, 5);
    expect(editor.surface!.pasteRich(latest.text, latest.html)).toBe(false);
    expect(editor.surface!.state().lastRejection).toBe(CHART_SUGGESTING_REFUSAL);
    expect(chartParts(editor.surface!.session.currentPackage())).toHaveLength(1);
  });

  test('a paste replaces a range selection in the same undo step', () => {
    const editor = mount();
    const flavours = copiedChart(editor);
    const paragraphId = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    expect(editor.surface!.pasteRich(flavours.text, flavours.html)).toBe(true);
    expect(editor.surface!.selectedText()).toBe('');
    const text = () =>
      JSON.stringify(
        editor.surface!.session.currentPackage().parts.get('/word/document.xml')!.root
      );
    expect(text()).not.toContain('"world"');
    editor.exec({ type: 'undo' });
    expect(text()).toContain('world');
    expect(chartParts(editor.surface!.session.currentPackage())).toHaveLength(1);
  });

  test('a selection of a chart with text still refuses', () => {
    const editor = mount();
    copiedChart(editor);
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 6 },
    });
    const flavours = editor.surface!.copyFlavours();
    expect(flavours.reason).toBe('chart-content');
    const copy = editor.exec({ type: 'copy' });
    expect(copy.ok).toBe(false);
    if (!copy.ok) expect(copy.reason).toBe(CHART_CLIPBOARD_REASON);
  });

  test('the cut and paste events carry the chart through the clipboard', () => {
    const editor = mount();
    copiedChart(editor);
    const handlers = createClipboardHandlers(editor.surface!);
    const data = new Map<string, string>();
    let prevented = 0;
    const event = {
      clipboardData: {
        setData: (type: string, value: string) => data.set(type, value),
        getData: (type: string) => data.get(type) ?? '',
        types: [] as string[],
        items: [] as unknown[],
      },
      preventDefault: () => {
        prevented += 1;
      },
    } as unknown as ClipboardEvent;
    handlers.onCut(event);
    expect(prevented).toBe(1);
    expect(data.get('text/html')).toContain('data-docx-editor-chart=');
    expect(chartDrawings(editor)).toBe(0);
    caretAt(editor, 1, 5);
    handlers.onPaste(event);
    expect(chartDrawings(editor)).toBe(1);
    expect(editor.snapshot().chart).not.toBeNull();
  });

  test('the copy and cut chords keep the chart selected for the clipboard event', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: documentBytes() });
    caretAt(editor, 0, 5);
    expect(editor.exec({ type: 'insertChart', chartType: 'pie' }).ok).toBe(true);
    const pages = container.querySelector('.docx-pages');
    if (!pages) throw new Error('no pages layer');
    const press = (init: KeyboardEventInit) =>
      pages.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    press({ key: 'c', metaKey: true });
    press({ key: 'x', ctrlKey: true });
    press({ key: 'Insert', ctrlKey: true });
    expect(editor.snapshot().chart).not.toBeNull();
    // Any other key still leaves the object selection, as before.
    press({ key: 'b', ctrlKey: true });
    expect(editor.snapshot().chart).toBeNull();
  });
});
