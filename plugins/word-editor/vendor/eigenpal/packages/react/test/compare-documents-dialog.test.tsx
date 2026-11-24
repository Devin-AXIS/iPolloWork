import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import type {
  CompareDocumentsDialogSession,
  CompareDocumentsOutcome,
  CompareDocumentsProgress,
  DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import en from '../../i18n/en.json' with { type: 'json' };
import { LocaleProvider } from '../src/i18n/LocaleContext';
import { reviewModule } from '../../pro/src/index';
import { zipDocument } from '../../pro/src/collaboration/__tests__/document-peer-support';
import {
  answeringCompareWorker,
  LOCKED_CONTENT_REFUSAL,
} from '../../pro/src/compare/__tests__/support/fake-compare-worker';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import {
  DocxEditorCompareDocumentsDialog as Dialog,
  useCompareDocumentsDialog,
} from '../src/editor/DocxEditorCompareDocumentsDialog';
import type { DocxEditorPopups } from '../src/editor/popup-config';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const ORIGINAL = zipDocument(paragraph('The quick brown fox.'));
const REVISED = zipDocument(paragraph('The quick red fox.'));

function mount(popups?: DocxEditorPopups, review: Parameters<typeof reviewModule>[0] = {}) {
  let instance: DocxEditorInstance;
  const view = render(
    <StrictMode>
      <DocxEditorRoot
        document={ORIGINAL}
        author="Reviewer"
        modules={[reviewModule(review)]}
        popups={popups}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    </StrictMode>
  );
  return { view, editor: () => instance! };
}

function chooseFile(input: HTMLElement, bytes: Uint8Array) {
  const file = new File([new Uint8Array(bytes)], 'revised.docx');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

test('the packaged React dialog compares into the open document as one undo step', async () => {
  const { view, editor } = mount();
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    expect(editor().exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
  });
  const dialog = view.getByRole('dialog', { name: 'Compare documents' });
  expect(dialog.getAttribute('data-docx-dialog')).toBe('compareDocuments');
  expect((view.getByLabelText('Author of the changes') as HTMLInputElement).value).toBe('Reviewer');
  expect((view.getByLabelText('Include formatting changes') as HTMLInputElement).checked).toBe(
    true
  );
  const compare = view.getByText('Compare') as HTMLButtonElement;
  expect(compare.disabled).toBe(true);
  await act(async () => chooseFile(view.getByLabelText('Compare with'), REVISED));
  expect(compare.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(compare);
  });
  await waitFor(
    () => {
      if (view.container.querySelector('dialog')) throw new Error('the dialog is still open');
    },
    { timeout: 5000 }
  );
  const session = editor().surface!.session;
  expect(session.reviewItems().length).toBeGreaterThan(0);
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(session.reviewItems()).toHaveLength(0);
  expect(session.bodyText()).toBe('The quick brown fox.');
});

test('a refused compare shows its reason in the error part', async () => {
  const { view, editor } = mount();
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Compare with'), new Uint8Array([1])));
  await act(async () => {
    fireEvent.click(view.getByText('Compare'));
  });
  await waitFor(
    () => {
      const text = view.container.querySelector('[data-docx-part="error"]')?.textContent ?? '';
      if (!text.includes('not a document that can be compared')) throw new Error(text);
    },
    { timeout: 5000 }
  );
  expect(view.getByRole('dialog')).toBeTruthy();
});

test('a compare with no differences says so and keeps the dialog open', async () => {
  const { view, editor } = mount();
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Compare with'), ORIGINAL));
  await act(async () => {
    fireEvent.click(view.getByText('Compare'));
  });
  await waitFor(
    () => {
      const text = view.container.querySelector('[data-docx-part="notice"]')?.textContent ?? '';
      if (!text.includes('The documents have no differences.')) throw new Error(text);
    },
    { timeout: 5000 }
  );
  // A notice, not an error.
  expect(view.container.querySelector('[data-docx-part="error"]')?.textContent).toBe('');
  expect(view.getByRole('status').textContent).toBe('The documents have no differences.');
  expect(view.getByRole('dialog')).toBeTruthy();
  // Nothing remains to cancel: the button closes the dialog.
  expect(view.getByRole('button', { name: 'Close' })).toBeTruthy();
});

test('named parts replace defaults; popup false and replacements get cancellable sessions', async () => {
  function AuthorEcho() {
    return <span>Author: {useCompareDocumentsDialog().values.authorName}</span>;
  }
  const custom = mount({
    compareDocuments: (props) => (
      <Dialog {...props}>
        <Dialog.Title>Custom compare</Dialog.Title>
        <Dialog.Field name="detectFormatChanges" hidden />
        <AuthorEcho />
      </Dialog>
    ),
  });
  await waitFor(() => expect(custom.editor()).toBeTruthy());
  await act(async () => {
    custom.editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  expect(custom.view.getByText('Custom compare')).toBeTruthy();
  expect(custom.view.queryByLabelText('Include formatting changes')).toBeNull();
  expect(custom.view.getByText('Author: Reviewer')).toBeTruthy();
  await act(async () => {
    fireEvent.click(custom.view.getByText('Cancel'));
  });
  expect(custom.view.queryByRole('dialog')).toBeNull();
  custom.view.unmount();

  const disabled = mount({ compareDocuments: false });
  await waitFor(() => expect(disabled.editor()).toBeTruthy());
  await act(async () => {
    disabled.editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  expect(disabled.view.queryByRole('dialog')).toBeNull();
  disabled.view.unmount();

  let session: CompareDocumentsDialogSession | null = null;
  const replaced = mount({
    compareDocuments: (props) => {
      session = props.session;
      return <button onClick={() => props.session?.cancel()}>Custom popup</button>;
    },
  });
  await waitFor(() => expect(replaced.editor()).toBeTruthy());
  await act(async () => {
    replaced.editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  expect(replaced.view.getByText('Custom popup')).toBeTruthy();
  expect(session!.signal.aborted).toBe(false);
  await act(async () => {
    fireEvent.click(replaced.view.getByText('Custom popup'));
  });
  expect(session!.signal.aborted).toBe(true);
});

const WORKER = new URL('../../pro/src/compare-worker.ts', import.meta.url).href;

test('with the compare worker, the dialog shows progress and compares off the main thread', async () => {
  const { view, editor } = mount(undefined, {
    compareWorker: () => new Worker(WORKER, { type: 'module' }),
  });
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Compare with'), REVISED));
  await act(async () => {
    fireEvent.click(view.getByText('Compare'));
  });
  await waitFor(
    () => {
      if (view.container.querySelector('dialog')) throw new Error('the dialog is still open');
    },
    { timeout: 10000 }
  );
  expect(editor().surface!.session.reviewItems().length).toBeGreaterThan(0);
});

test('Cancel stops a running background compare and leaves the document as it was', async () => {
  const ended: string[] = [];
  // A worker that never answers: the compare runs until Cancel.
  const silent = () =>
    ({
      postMessage() {},
      addEventListener() {},
      terminate: () => ended.push('terminated'),
    }) as unknown as Worker;
  const { view, editor } = mount(undefined, { compareWorker: silent });
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Compare with'), REVISED));
  await act(async () => {
    fireEvent.click(view.getByText('Compare'));
  });
  await waitFor(() => {
    if (!view.container.querySelector('[data-docx-part="progress"]')) throw new Error('no bar');
  });
  const cancel = view.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(cancel);
  });
  await waitFor(() => expect(ended).toEqual(['terminated']));
  expect(view.queryByRole('dialog')).toBeNull();
  expect(editor().surface!.session.bodyText()).toBe('The quick brown fox.');
  expect(editor().can({ type: 'undo' }).ok).toBe(false);
});

test('a refusal with a reason shows the message for that reason', async () => {
  const { view, editor } = mount(undefined, {
    compareWorker: answeringCompareWorker(LOCKED_CONTENT_REFUSAL),
  });
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Compare with'), REVISED));
  await act(async () => {
    fireEvent.click(view.getByText('Compare'));
  });
  await waitFor(
    () => {
      const text = view.container.querySelector('[data-docx-part="error"]')?.textContent ?? '';
      if (!text.includes('locked or linked to data')) throw new Error(text);
    },
    { timeout: 5000 }
  );
  expect(editor().surface!.session.bodyText()).toBe('The quick brown fox.');
});

/** A session the test drives by hand: `apply` waits until the test answers it. */
function heldSession(cancelable: boolean, originalHasTrackedChanges = false) {
  const controller = new AbortController();
  const calls: {
    readonly onProgress?: (progress: CompareDocumentsProgress) => void;
    readonly answer: (outcome: CompareDocumentsOutcome) => void;
  }[] = [];
  const session: CompareDocumentsDialogSession = {
    signal: controller.signal,
    defaultAuthor: 'Reviewer',
    originalHasTrackedChanges,
    cancelable,
    canApply: () => !controller.signal.aborted,
    apply: (_request, options) =>
      new Promise((answer) => calls.push({ onProgress: options?.onProgress, answer })),
    cancel: () => controller.abort(),
  };
  return { session, calls };
}

// The source catalog, so the tests read strings this change adds before a build.
const inLocale = (node: ReactNode) => <LocaleProvider i18n={en as never}>{node}</LocaleProvider>;
const renderDialog = (node: ReactNode) => render(inLocale(node));

async function startCompare(view: ReturnType<typeof render>) {
  await act(async () => chooseFile(view.getByLabelText('Compare with'), REVISED));
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Compare' }));
  });
}

test('a new session starts a fresh form: no busy state, progress, or draft carries over', async () => {
  const first = heldSession(true);
  const second = heldSession(true);
  const view = renderDialog(<Dialog session={first.session} />);
  await startCompare(view);
  expect(view.getByRole('button', { name: 'Comparing…' })).toBeTruthy();
  await act(async () => view.rerender(inLocale(<Dialog session={second.session} />)));
  const compare = view.getByRole('button', { name: 'Compare' }) as HTMLButtonElement;
  // No file is chosen in the new session's draft.
  expect(compare.disabled).toBe(true);
  expect(view.container.querySelector('[data-docx-part="progress"]')).toBeNull();
  expect(first.session.signal.aborted).toBe(true);
  expect(second.calls).toHaveLength(0);
});

test('apply ignores a second submission while a compare runs', async () => {
  const held = heldSession(true);
  let state: ReturnType<typeof useCompareDocumentsDialog> | null = null;
  function Capture() {
    state = useCompareDocumentsDialog();
    return null;
  }
  const view = renderDialog(
    <Dialog session={held.session}>
      <Capture />
    </Dialog>
  );
  await startCompare(view);
  expect(state!.busy).toBe(true);
  await act(async () => state!.apply());
  expect(held.calls).toHaveLength(1);
  await act(async () => held.calls[0]!.answer({ ok: true, revisionCount: 0, changed: false }));
});

test('the running step shows in words, with the bar, and the bar waits for the first step', async () => {
  const held = heldSession(true);
  const view = renderDialog(<Dialog session={held.session} />);
  await startCompare(view);
  const progress = () => view.container.querySelector('progress')!;
  const phase = () => view.container.querySelector('.docx-compare-documents-phase')!;
  // Indeterminate until the first step arrives.
  expect(progress().hasAttribute('value')).toBe(false);
  expect(phase().textContent).toBe(en.compareDocuments.comparing);
  await act(async () => held.calls[0]!.onProgress?.({ phase: 'checking', fraction: 0.6 }));
  expect(phase().textContent).toBe('Checking the result…');
  expect(progress().getAttribute('aria-valuetext')).toBe('Checking the result…');
});

test('focus moves to Cancel or the busy status while busy, and to the file after a refusal', async () => {
  const background = heldSession(true);
  const view = renderDialog(<Dialog session={background.session} />);
  await startCompare(view);
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'Cancel' }));
  view.unmount();

  const main = heldSession(false);
  const second = renderDialog(<Dialog session={main.session} />);
  await startCompare(second);
  expect(document.activeElement?.classList.contains('docx-compare-documents-phase')).toBe(true);
  await act(async () => main.calls[0]!.answer({ ok: false, code: 'busy', message: 'busy' }));
  expect(second.container.querySelector('[data-docx-part="error"]')?.textContent).toBe(
    en.compareDocuments.errors.busy
  );
  expect(document.activeElement).toBe(second.getByLabelText('Compare with'));
});

test('Progress and Notice are named parts', async () => {
  const held = heldSession(true);
  const view = renderDialog(
    <Dialog session={held.session}>
      <Dialog.Progress className="host-progress" />
      <Dialog.Notice className="host-notice" />
    </Dialog>
  );
  expect(view.container.querySelector('.host-notice')?.getAttribute('role')).toBe('status');
  await startCompare(view);
  expect(view.container.querySelector('.host-progress progress')).not.toBeNull();
});

test('Compare follows the editor state without a re-render from the host', async () => {
  const { view, editor } = mount();
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Compare with'), REVISED));
  const compare = view.getByRole('button', { name: 'Compare' }) as HTMLButtonElement;
  expect(compare.disabled).toBe(false);
  await act(async () => {
    editor().exec({ type: 'setEditingMode', mode: 'viewing' });
  });
  await waitFor(() => expect(compare.disabled).toBe(true));
});

test('the dialog says before a compare that the open tracked changes count as accepted', () => {
  const noteOf = (tracked: boolean) => {
    const view = renderDialog(<Dialog session={heldSession(true, tracked).session} />);
    const dialog = view.container.ownerDocument.querySelector('dialog')!;
    const note = dialog.querySelector('[data-docx-part="trackedChanges"]');
    const result = {
      text: note?.textContent ?? null,
      described: note ? (dialog.getAttribute('aria-describedby') ?? '').includes(note.id) : false,
    };
    view.unmount();
    return result;
  };
  expect(noteOf(true)).toEqual({
    text: 'The open document has tracked changes. The compare treats them as accepted.',
    described: true,
  });
  expect(noteOf(false)).toEqual({ text: null, described: false });
});
