// A chart selects as an object in every state: drawn by a renderer, shown by its saved
// fallback picture, or shown as the labelled chart placeholder. A press on the painted chart
// selects it with no resize, move or crop handles; picture commands report the chart reason;
// Delete removes the whole chart as one undo step. A fallback picture that does not load
// shows the chart placeholder at the fallback's extent.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { forEachSemanticDrawing } from '../../layout/semantic-record-queries.ts';
import {
  drawingRenderers,
  installDrawingRenderers,
} from '../../store/package/drawing-renderers.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { chartexDocx, waterfallChartSpace } from '../../store/__tests__/chartex-fixture.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { CHART_DRAWING_REASON } from '../image-state-rules.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';

const before = drawingRenderers();
afterEach(() => installDrawingRenderers({ chart: before.chart }));

const decodePort: ImageDecodePort = Object.freeze({
  async decode(bytes: Uint8Array, mime: Parameters<ImageDecodePort['decode']>[1]) {
    const header = validateRasterHeader(bytes, mime);
    if (!header) throw new Error('invalid image');
    return Object.freeze({
      pixelWidth: header.pixelWidth,
      pixelHeight: header.pixelHeight,
      dpiX: 96,
      dpiY: 96,
    });
  },
}) as ImageDecodePort;

/** A renderer that draws every chart as one filled triangle. */
function installTriangleRenderer(): void {
  installDrawingRenderers({
    chart: (_anchor, extent) => ({
      vectorShape: {
        extentEmu: { cx: extent.cx, cy: extent.cy },
        subpathsEmu: [],
        fillHex: null,
        strokeHex: null,
        strokeWidthEmu: 0,
        components: [
          {
            subpathsEmu: [
              [
                { x: 0, y: 0 },
                { x: extent.cx, y: 0 },
                { x: 0, y: extent.cy },
              ],
            ],
            fillHex: 'FF0000',
            fillAlpha: 1,
            strokeHex: null,
            strokeAlpha: 1,
            strokeWidthEmu: 0,
          },
        ],
      },
      groupTextboxes: null,
    }),
  });
}

type FallbackKind = 'picture' | 'empty' | 'missing' | 'linked';

/** The wrapped chart first in its paragraph, text after it, and the named fallback. */
function chartDocument(fallback: FallbackKind, frameLocks?: string): Uint8Array {
  const files = unzipSync(
    chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
      alternateContent: true,
      emptyFallback: fallback === 'empty',
      ...(frameLocks ? { frameLocks } : {}),
    })
  );
  let document = strFromU8(files['word/document.xml']!).replace(
    '</mc:AlternateContent></w:r>',
    '</mc:AlternateContent></w:r><w:r><w:t>after</w:t></w:r>'
  );
  if (fallback === 'missing') delete files['word/media/fallback.png'];
  if (fallback === 'linked') {
    document = document.replace('r:embed="rId11"', 'r:link="rId11"');
    files['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(files['word/_rels/document.xml.rels']!).replace(
        'Target="media/fallback.png"',
        'Target="https://example.invalid/fallback.png" TargetMode="External"'
      )
    );
  }
  files['word/document.xml'] = strToU8(document);
  return zipSync(files);
}

function mount(
  fallback: FallbackKind,
  frameLocks?: string
): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: chartDocument(fallback, frameLocks),
    imageDecodePort: decodePort,
  });
  return { editor, container };
}

async function settle(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface!.layout();
  }
}

function chartRecords(editor: DocxEditorInstance) {
  const records: {
    shownAs: string | undefined;
    kind: string | null;
    width: number;
    resource: string;
  }[] = [];
  forEachSemanticDrawing(editor.surface!.layout(), ({ drawing }) => {
    records.push({
      shownAs: drawing.chart?.shownAs,
      kind: drawing.placeholderGraphicKind,
      width: drawing.width,
      resource: drawing.resource.kind,
    });
  });
  return records;
}

async function savedDocument(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

const STATES = [
  { name: 'a drawn chart', fallback: 'picture', drawn: true, shownAs: 'chart' },
  { name: 'a chart shown by its fallback', fallback: 'picture', drawn: false, shownAs: 'fallback' },
  { name: 'a chart placeholder', fallback: 'empty', drawn: false, shownAs: 'placeholder' },
] as const;

for (const state of STATES) {
  test(`${state.name} selects as an object, refuses picture edits, and deletes whole`, async () => {
    if (state.drawn) installTriangleRenderer();
    else installDrawingRenderers({ chart: undefined });
    const { editor, container } = mount(state.fallback);
    try {
      await settle(editor);
      expect(chartRecords(editor).map((record) => record.shownAs)).toEqual([state.shownAs]);
      // The object-selection gesture: a primary press on the painted chart.
      const painted = container.querySelector<HTMLElement>('[data-drawing-node-id]')!;
      painted.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(editor.surface!.drawingSelectionIntent().kind).toBe('pointer');
      expect(editor.getSelectedImage!()).toMatchObject({
        canResize: false,
        canMove: false,
        canChangeWrap: false,
        canCrop: false,
      });
      expect(selectedDrawingOverlayTargetOf(editor.surface)).toMatchObject({
        canResize: false,
        canMove: false,
        aspectLocked: true,
      });
      expect(editor.can({ type: 'setImageWrapType', target: 'square' })).toEqual({
        ok: false,
        code: 'unsupported',
        reason: CHART_DRAWING_REASON,
      });
      for (const slot of ['image.wrap', 'image.altText', 'image.properties'] as const) {
        expect(toolbarCommandState(editor, slot)).toMatchObject({
          enabled: false,
          disabledReason: CHART_DRAWING_REASON,
        });
      }
      expect(editor.can({ type: 'deleteImage' })).toEqual({ ok: true });

      // Delete on the selected chart removes the wrapper with both branches.
      painted.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
      );
      const deleted = await savedDocument(editor);
      expect(deleted).not.toContain('AlternateContent');
      expect(deleted).toContain('after');
      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
      const restored = await savedDocument(editor);
      expect(restored).toContain('<mc:Choice');
      expect(restored).toContain('<mc:Fallback');
    } finally {
      editor.destroy();
      container.remove();
    }
  });
}

for (const fallback of ['missing', 'linked'] as const) {
  test(`a ${fallback} fallback picture shows the chart placeholder at its extent`, async () => {
    installDrawingRenderers({ chart: undefined });
    const shown = mount('picture');
    const failed = mount(fallback);
    try {
      await settle(shown.editor);
      await settle(failed.editor);
      const [picture] = chartRecords(shown.editor);
      expect(picture).toMatchObject({ shownAs: 'fallback', kind: null, resource: 'ready' });
      const [placeholder] = chartRecords(failed.editor);
      expect(placeholder).toMatchObject({ shownAs: 'placeholder', kind: 'chart' });
      expect(placeholder!.width).toBe(picture!.width);
      expect(failed.container.querySelector('.docx-drawing-placeholder')).not.toBeNull();
      // The placeholder selects as a chart too.
      failed.container
        .querySelector<HTMLElement>('[data-drawing-node-id]')!
        .dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(failed.editor.getSelectedImage!()).toMatchObject({ canResize: false });
      expect(failed.editor.can({ type: 'deleteImage' })).toEqual({ ok: true });
    } finally {
      shown.editor.destroy();
      shown.container.remove();
      failed.editor.destroy();
      failed.container.remove();
    }
  });
}

test('the chart drawing locks gate selection in every state, as the store reads them', async () => {
  installDrawingRenderers({ chart: undefined });
  // The chart drawing in the Choice is select-locked; the fallback picture is not.
  const { editor, container } = mount('picture', 'noSelect="1"');
  try {
    await settle(editor);
    expect(chartRecords(editor).map((record) => record.shownAs)).toEqual(['fallback']);
    container
      .querySelector<HTMLElement>('[data-drawing-node-id]')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(editor.getSelectedImage!()).toBeNull();
    const can = editor.can({ type: 'deleteImage' });
    expect(can.ok).toBe(false);
    expect(editor.exec({ type: 'deleteImage' }).ok).toBe(false);
    expect(await savedDocument(editor)).toContain('AlternateContent');
  } finally {
    editor.destroy();
    container.remove();
  }
});
