// Copy, cut and rich paste refuse content that holds a chart. A chart's parts cannot travel
// in a clipboard fragment, and its fallback picture alone is not the chart, so the whole
// transfer refuses with the chart reason: nothing is written, and cut deletes nothing.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  chartexDocx,
  chartexPackage,
  classicBarChartSpace,
  waterfallChartSpace,
} from '../../store/__tests__/chartex-fixture.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import type { OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { extractFragmentPackage } from '../../store/store/clipboard-fragment-extract.ts';
import { mergeFragmentIntoPackage } from '../../store/store/clipboard-fragment-merge.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { CHART_CLIPBOARD_REASON } from '../clipboard-object-selection.ts';
import { wrapInteropHtml } from '../clipboard-fragment-codec.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

type ChartShape = 'bare classic' | 'bare chartex' | 'wrapped with fallback' | 'wrapped, empty';

/** One paragraph: `A`, the chart, `Z`. */
function chartDocument(shape: ChartShape): Uint8Array {
  const bytes =
    shape === 'bare classic'
      ? chartexDocx(classicBarChartSpace(), { classic: true })
      : chartexDocx(waterfallChartSpace(), {
          alternateContent: shape.startsWith('wrapped'),
          emptyFallback: shape === 'wrapped, empty',
        });
  const files = unzipSync(bytes);
  const document = strFromU8(files['word/document.xml']!)
    .replace('<w:p><w:r>', '<w:p><w:r><w:t>A</w:t></w:r><w:r>')
    .replace('</w:r></w:p>', '</w:r><w:r><w:t>Z</w:t></w:r></w:p>');
  files['word/document.xml'] = strToU8(document);
  return zipSync(files);
}

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function texts(editor: DocxEditorInstance): string[] {
  const surface = editor.surface!;
  const part = surface.session.part();
  return surface.session.paragraphIds().map((id) => paragraphTextOf(part, id) ?? '');
}

function selectInFirst(editor: DocxEditorInstance, start: number, end: number): void {
  const surface = editor.surface!;
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: start },
    head: { paragraphId: id, offset: end },
  });
}

let written: string[] = [];
let restoreClipboard: (() => void) | undefined;

beforeEach(() => {
  written = [];
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: {
      writeText: async (text: string) => {
        written.push(text);
      },
    },
    configurable: true,
  });
  restoreClipboard = () => {
    if (original) Object.defineProperty(globalThis.navigator, 'clipboard', original);
    else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
  };
});

afterEach(() => {
  restoreClipboard?.();
  restoreClipboard = undefined;
});

const SHAPES: readonly ChartShape[] = [
  'bare classic',
  'bare chartex',
  'wrapped with fallback',
  'wrapped, empty',
];

describe('copy and cut of a selection with a chart', () => {
  for (const shape of SHAPES) {
    test(`refuse with the chart reason and keep the text: ${shape}`, () => {
      const editor = mount(chartDocument(shape));
      try {
        const before = texts(editor);
        expect(before[0]).toHaveLength(3);
        for (const [start, end] of [
          [1, 2],
          [0, 3],
        ] as const) {
          selectInFirst(editor, start, end);
          for (const type of ['copy', 'cut'] as const) {
            expect(editor.exec({ type })).toEqual({
              ok: false,
              code: 'unsupported',
              reason: CHART_CLIPBOARD_REASON,
            });
            expect(texts(editor)).toEqual(before);
          }
          expect(editor.surface!.copyFlavours()).toEqual({
            text: '',
            html: null,
            reason: 'chart-content',
          });
          // The keyboard path reports the same sentence hosts translate.
          expect(editor.snapshot().lastRejection).toBe(CHART_CLIPBOARD_REASON);
        }
        expect(written).toEqual([]);
      } finally {
        editor.destroy();
      }
    });
  }

  test('a selection beside the chart still copies', () => {
    const editor = mount(chartDocument('wrapped with fallback'));
    try {
      selectInFirst(editor, 2, 3);
      expect(editor.exec({ type: 'copy' })).toEqual({ ok: true, changed: false });
      expect(written).toEqual(['Z']);
    } finally {
      editor.destroy();
    }
  });
});

describe('fragments with a chart', () => {
  test('the fragment extractor refuses a chart rather than dropping it', () => {
    for (const shape of SHAPES) {
      const read = readOoxmlPackage(chartDocument(shape));
      if (!read.ok) throw new Error('package rejected');
      const pkg = read.package;
      const body = pkg.parts.get(pkg.mainDocumentPart)!.root;
      const paragraph = (function find(node: OoxmlNode): string | null {
        if (node.kind === 'paragraph') return node.id;
        if (node.kind === 'textValue') return null;
        for (const child of node.children) {
          const id = find(child);
          if (id) return id;
        }
        return null;
      })(body);
      const result = extractFragmentPackage(pkg, {
        partName: pkg.mainDocumentPart,
        paragraphIds: [paragraph!],
        startOffset: 0,
        endOffset: 3,
        coveredParagraphIds: [],
        fullyCoveredBlockIds: [],
        lastMarkCovered: false,
      });
      expect(result).toEqual({ ok: false, reason: 'unsupported-content' });
    }
  });

  test('the fragment merge refuses a chart, bare or wrapped', () => {
    const target = chartexPackage(waterfallChartSpace());
    for (const shape of SHAPES) {
      const read = readOoxmlPackage(chartDocument(shape));
      if (!read.ok) throw new Error('package rejected');
      expect(mergeFragmentIntoPackage(target, read.package, target.mainDocumentPart)).toMatchObject(
        { ok: false, reason: 'unsupported-content' }
      );
    }
  });

  test('rich paste of a fragment with a chart refuses and keeps the target', () => {
    for (const shape of SHAPES) {
      const html = wrapInteropHtml('<p>AZ</p>', {
        bytes: chartDocument(shape),
        lastMarkCovered: true,
      });
      const editor = mount(chartexDocx(waterfallChartSpace()));
      try {
        const before = texts(editor);
        selectInFirst(editor, 0, 1);
        expect(editor.exec({ type: 'paste', html, text: 'AZ' })).toEqual({
          ok: false,
          code: 'unsupported',
          reason: CHART_CLIPBOARD_REASON,
        });
        expect(texts(editor)).toEqual(before);
        // The paste event path refuses with the same sentence.
        expect(editor.surface!.pasteRich('AZ', html)).toBe(false);
        expect(editor.snapshot().lastRejection).toBe(CHART_CLIPBOARD_REASON);
        expect(texts(editor)).toEqual(before);
      } finally {
        editor.destroy();
      }
    }
  });
});
