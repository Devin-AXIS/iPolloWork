// A chart that shows its saved fallback picture is selectable like a picture, but the picture
// commands refuse with the engine's reason, its capability flags and toolbar controls report
// disabled, and delete removes the chart with its fallback as one undo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createT, en, localizeDisabledReason } from '@docx-editor.dev/i18n';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { chartexDocx, waterfallChartSpace } from '../../store/__tests__/chartex-fixture.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { CHART_DRAWING_REASON } from '../image-state-rules.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import type { EditorCommand } from '../../contracts/editor.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/** The wrapped chartex chart first in its paragraph, with text after it. */
function chartDocument(): Uint8Array {
  const files = unzipSync(chartexDocx(waterfallChartSpace(), { alternateContent: true }));
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '</mc:AlternateContent></w:r>',
      '</mc:AlternateContent></w:r><w:r><w:t>after</w:t></w:r>'
    )
  );
  return zipSync(files);
}

function mountWithChartSelected(): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: chartDocument(),
  });
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
  return editor;
}

async function documentXml(editor: DocxEditorInstance): Promise<string> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(files['word/document.xml']!);
}

const REFUSED: readonly EditorCommand[] = [
  { type: 'setImageWrapType', target: 'square' },
  { type: 'transformImage', action: 'rotateCW' },
  { type: 'setImagePosition', horizontalEmu: 0 },
  { type: 'setImageProperties', widthEmu: 914400 },
  { type: 'setImageProperties', crop: { left: 10, top: 0, right: 0, bottom: 0 } },
  { type: 'setImageProperties', description: 'alt text' },
] as readonly EditorCommand[];

test('picture commands on a chart fallback refuse with the engine reason', async () => {
  const editor = mountWithChartSelected();
  try {
    const image = editor.getSelectedImage!();
    expect(image).toMatchObject({
      canResize: false,
      canMove: false,
      canChangeWrap: false,
      canCrop: false,
    });
    const before = await documentXml(editor);
    for (const command of REFUSED) {
      expect(editor.can(command)).toEqual({
        ok: false,
        code: 'unsupported',
        reason: CHART_DRAWING_REASON,
      });
      expect(editor.exec(command)).toMatchObject({ ok: false, reason: CHART_DRAWING_REASON });
    }
    expect(
      editor.canExecuteImageCommand!({ type: 'replaceImage', data: PNG_1X1, mime: 'image/png' })
    ).toMatchObject({ ok: false, reason: CHART_DRAWING_REASON });
    for (const slot of ['image.wrap', 'image.altText', 'image.properties'] as const) {
      expect(toolbarCommandState(editor, slot)).toMatchObject({
        enabled: false,
        disabledReason: CHART_DRAWING_REASON,
      });
    }
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toMatchObject({
      canResize: false,
      canMove: false,
    });
    expect(await documentXml(editor)).toBe(before);
  } finally {
    editor.destroy();
  }
});

test('delete removes the chart and its fallback as one undo step', async () => {
  const editor = mountWithChartSelected();
  try {
    expect(editor.can({ type: 'deleteImage' })).toEqual({ ok: true });
    const before = await documentXml(editor);
    expect(before).toContain('<mc:Choice');
    expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
    const deleted = await documentXml(editor);
    expect(deleted).not.toContain('AlternateContent');
    expect(deleted).not.toContain('cx:chart');
    expect(deleted).toContain('after');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    const restored = await documentXml(editor);
    expect(restored).toContain('<mc:Choice');
    expect(restored).toContain('<mc:Fallback>');
    expect(restored).toContain('cx:chart');
  } finally {
    editor.destroy();
  }
});

test('the chart refusal reaches every locale through the disabled-reason catalog', () => {
  const t = createT(en);
  expect(localizeDisabledReason(CHART_DRAWING_REASON, t)).toBe(t('disabledReason.chartDrawing'));
  expect(localizeDisabledReason(CHART_DRAWING_REASON, t)).not.toBe(CHART_DRAWING_REASON);
});
