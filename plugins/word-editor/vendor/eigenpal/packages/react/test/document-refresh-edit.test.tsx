// An undoable document update through the React adapter: the toolbar's undo and redo commands
// see the update as one step, and hook consumers re-render when it lands.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { createDocumentRefresh } from '../src/index.ts';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';
import {
  BASE,
  EDITED,
  updateFixture,
} from '../../core/src/store/__tests__/package-update-fixture.ts';

afterEach(() => cleanup());

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('one undo reverts an applied update and one redo restores it', async () => {
  let editor: DocxEditorInstance | null = null;
  let undo!: ReturnType<typeof useEditorCommand>;
  let redo!: ReturnType<typeof useEditorCommand>;
  function Probe() {
    undo = useEditorCommand('history.undo');
    redo = useEditorCommand('history.redo');
    return null;
  }
  render(
    <DocxEditorRoot document={updateFixture(BASE)} onReady={(i) => (editor = i as never)}>
      <DocxEditorViewport>
        <Probe />
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await act(async () => wait(20));
  expect(editor).not.toBeNull();
  const text = () => editor!.surface!.session.bodyText();
  expect(undo.isEnabled).toBe(false);

  const refresh = createDocumentRefresh(editor!);
  const submission = await refresh.capture();
  let result: Awaited<ReturnType<typeof refresh.applyUpdate>> | undefined;
  await act(async () => {
    result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    });
  });
  expect(result).toMatchObject({ ok: true, mode: 'edit' });
  expect(text()).toContain('Goal of this agreement.');
  expect(undo.isEnabled).toBe(true);

  await act(async () => {
    undo.execute();
  });
  expect(text()).toContain('Purpose of this agreement.');
  expect(undo.isEnabled).toBe(false);
  expect(redo.isEnabled).toBe(true);

  await act(async () => {
    redo.execute();
  });
  expect(text()).toContain('Goal of this agreement.');
});
