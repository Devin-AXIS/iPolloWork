// A file that is not a supported picture shows an editor dialog, never a page-blocking browser
// alert, and `popups.imageInsertError` replaces or hides it. The Vue twin is
// `packages/vue/test/image-insert-refusal.test.ts`.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import type { DocxEditorPopups } from '../src/editor/popup-config';

afterEach(cleanup);

async function mount(popups?: DocxEditorPopups) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document="blank"
      popups={popups}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  for (let attempt = 0; attempt < 50 && !instance?.surface; attempt++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  if (!instance) throw new Error('editor did not mount');
  return { view, editor: instance as DocxEditorInstance };
}

async function chooseNonImage(view: ReturnType<typeof render>): Promise<void> {
  const input = view.container.querySelector('.docx-image-insert__input') as HTMLInputElement;
  const file = new File([strToU8('PK not a picture')], 'report.docx');
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const refusalDialog = () => document.querySelector('[data-docx-dialog="imageInsertError"]');

describe('picture refusal', () => {
  test('a refused file shows an editor dialog, never a browser alert', async () => {
    const original = window.alert;
    let alerted = false;
    window.alert = () => {
      alerted = true;
    };
    try {
      const { view, editor } = await mount();
      const beforeRevision = editor.surface!.session.packageRevision();
      await chooseNonImage(view);
      expect(alerted).toBe(false);
      const dialog = refusalDialog() as HTMLDialogElement;
      expect(dialog.getAttribute('role')).toBe('alertdialog');
      expect(dialog.textContent).toContain('The file is not a supported PNG, JPEG, or GIF image.');
      expect(editor.surface!.session.packageRevision()).toBe(beforeRevision);
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      });
      expect(refusalDialog()).toBeNull();
    } finally {
      window.alert = original;
    }
  });

  test('an unreadable file shows a refusal without an unhandled rejection', async () => {
    const { view, editor } = await mount();
    const before = editor.getDocumentHandle().revision;
    const file = new File([], 'unreadable.png', { type: 'image/png' });
    file.arrayBuffer = async () => {
      throw new Error('read failed');
    };
    await act(async () => {
      fireEvent.change(view.container.querySelector('.docx-image-insert__input')!, {
        target: { files: [file] },
      });
    });
    expect(view.container.querySelector('[data-docx-dialog="imageInsertError"]')).not.toBeNull();
    expect(editor.getDocumentHandle().revision).toBe(before);
  });

  test('popups.imageInsertError replaces the refusal dialog, and false shows nothing', async () => {
    const custom = await mount({
      imageInsertError: ({ message }) => <p data-testid="own-refusal">{message}</p>,
    });
    await chooseNonImage(custom.view);
    expect(custom.view.getByTestId('own-refusal').textContent).toContain('PNG, JPEG, or GIF');
    expect(refusalDialog()).toBeNull();
    cleanup();
    const silent = await mount({ imageInsertError: false });
    await chooseNonImage(silent.view);
    expect(refusalDialog()).toBeNull();
  });
});
