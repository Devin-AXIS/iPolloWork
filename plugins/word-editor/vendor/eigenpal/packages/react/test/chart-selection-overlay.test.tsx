// A press on a chart placeholder selects the chart as an object: the overlay draws its
// selection frame with no resize handles, and the image toolbar controls report the chart.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

afterEach(() => cleanup());

async function flush(editor: () => DocxEditorInstance | null): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
      editor()?.surface?.layout();
    });
  }
}

test('a chart placeholder selects with a frame and no resize handles', async () => {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={chartexDocx(waterfallChartSpace({ title: 'Net' }), {
        alternateContent: true,
        emptyFallback: true,
      })}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await flush(() => instance);
  const painted = view.container.querySelector<HTMLElement>('.docx-drawing-placeholder')!;
  expect(painted).not.toBeNull();
  await act(async () => {
    painted.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
  await flush(() => instance);
  expect(instance!.getSelectedImage()).toMatchObject({ canResize: false, canMove: false });
  expect(view.container.querySelector('.docx-image-selection-overlay__frame')).not.toBeNull();
  expect(view.container.querySelectorAll('.docx-image-selection-overlay__handle')).toHaveLength(0);
});
