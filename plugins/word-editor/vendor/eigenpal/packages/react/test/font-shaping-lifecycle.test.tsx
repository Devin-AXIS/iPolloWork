import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import type { FontShapingOptions } from '@docx-editor.dev/core';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

afterEach(cleanup);

test('equal font shaping values preserve edits and undo; changed values remount', async () => {
  const instances: DocxEditorInstance[] = [];
  const tree = (fontShaping?: FontShapingOptions) => (
    <DocxEditorRoot
      document="blank"
      fontShaping={fontShaping}
      onReady={(editor) => instances.push(editor as DocxEditorInstance)}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const view = render(tree());
  expect(instances).toHaveLength(1);
  const first = instances[0]!;
  await act(async () => {
    expect(first.exec({ type: 'insertText', text: 'kept' }).ok).toBe(true);
  });
  const edited = first.surface!.session.bodyText();
  const selection = first.surface!.state().selection;
  for (const equal of [{}, {}, undefined]) {
    await act(async () => view.rerender(tree(equal)));
    expect(instances).toHaveLength(1);
    expect(first.surface!.session.bodyText()).toBe(edited);
    expect(first.surface!.state().selection).toEqual(selection);
    expect(first.snapshot().canUndo).toBe(true);
  }
  await act(async () => {
    first.surface!.undo();
  });
  expect(first.surface!.session.bodyText()).not.toBe(edited);
  await act(async () => view.rerender(tree({ maxFontBytes: 20 * 1024 * 1024 })));
  expect(instances).toHaveLength(2);
  const second = instances[1]!;
  expect(second).not.toBe(first);
  await act(async () => {
    expect(second.exec({ type: 'insertText', text: 'second' }).ok).toBe(true);
  });
  const secondText = second.surface!.session.bodyText();
  await act(async () => view.rerender(tree({ maxFontBytes: 20 * 1024 * 1024 })));
  expect(instances).toHaveLength(2);
  expect(second.surface!.session.bodyText()).toBe(secondText);
  expect(second.snapshot().canUndo).toBe(true);
});
