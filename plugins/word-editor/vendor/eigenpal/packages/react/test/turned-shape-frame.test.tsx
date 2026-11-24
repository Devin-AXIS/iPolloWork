// The selection frame of a turned shape rings its unturned extent, turned about its centre.
// An upright shape keeps an unturned frame. The Vue twin is `turned-shape-frame.test.ts`.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import {
  SHAPE_PANE_CASES,
  TURNED_DRAWING,
  selectParityShape,
  shapePaneDocx,
} from './shape-pane-parity.ts';

afterEach(() => cleanup());

async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function selectedFrame(source: Uint8Array) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  for (let attempt = 0; attempt < 50 && !instance; attempt++) await flush();
  await act(async () => selectParityShape(instance!));
  await flush();
  const frame = view.container.querySelector<HTMLElement>('.docx-image-selection-overlay__frame');
  if (!frame) throw new Error('no selection frame');
  return { frame, paintScale: instance!.surface!.overlayCoordinates().paintScale };
}

test('a turned shape frame is its unturned extent, turned', async () => {
  const { frame, paintScale } = await selectedFrame(shapePaneDocx('', TURNED_DRAWING));
  expect(frame.style.transform).toBe('rotate(30deg)');
  // The turned frame carries the hit band that keeps a thin turned line easy to drag.
  expect(frame.getAttribute('data-turned')).toBe('true');
  expect(parseFloat(frame.style.width)).toBeCloseTo(144 * paintScale, 3);
  expect(parseFloat(frame.style.height)).toBeCloseTo(36 * paintScale, 3);
});

test('an upright shape frame has no turn', async () => {
  const { frame, paintScale } = await selectedFrame(shapePaneDocx(SHAPE_PANE_CASES.solid));
  expect(frame.style.transform).toBe('');
  expect(frame.hasAttribute('data-turned')).toBe(false);
  expect(parseFloat(frame.style.width)).toBeCloseTo(144 * paintScale, 3);
  expect(parseFloat(frame.style.height)).toBeCloseTo(36 * paintScale, 3);
});
