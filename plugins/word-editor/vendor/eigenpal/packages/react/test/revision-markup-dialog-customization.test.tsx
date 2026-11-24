import { useDialogHost } from '../src/editor/dialog-host';
import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import type { DocxEditorInstance, RevisionMarkupDialogSession } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../../pro/src/index';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import {
  DocxEditorRevisionMarkupDialog as Dialog,
  useRevisionMarkupDialog,
} from '../src/editor/DocxEditorRevisionMarkupDialog';
import type { DocxEditorPopups } from '../src/editor/popup-config';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);
function mount(popups?: DocxEditorPopups) {
  let instance: DocxEditorInstance;
  const view = render(
    <StrictMode>
      <DocxEditorRoot
        document="blank"
        modules={[reviewModule({})]}
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
test('React named markup parts replace defaults, hide fields, and apply through asChild', async () => {
  let clicks = 0;
  const { view, editor } = mount({
    revisionMarkup: (props) => (
      <Dialog {...props}>
        <Dialog.Title>Custom review preferences</Dialog.Title>
        <Dialog.Field name="movedFrom" hidden />
        <Dialog.Apply asChild>
          <button onClick={() => clicks++}>Save preferences</button>
        </Dialog.Apply>
      </Dialog>
    ),
  });
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  expect(view.getByText('Custom review preferences')).toBeTruthy();
  expect(view.queryByLabelText('Moved from')).toBeNull();
  expect(view.container.querySelectorAll('[data-docx-part="apply"]')).toHaveLength(1);
  fireEvent.change(view.getByLabelText('Insertions'), { target: { value: 'bold' } });
  expect(editor().snapshot().revisionMarkup.insertions.mark).toBe('underline');
  await act(async () => {
    fireEvent.click(view.getByText('Save preferences'));
  });
  expect(editor().snapshot().revisionMarkup.insertions.mark).toBe('bold');
  expect(clicks).toBe(1);
  expect(view.queryByRole('dialog')).toBeNull();
});
function CustomFields() {
  const state = useRevisionMarkupDialog();
  return (
    <>
      <output>{state.values.insertions.mark}</output>
      <button
        onClick={() =>
          state.setValue('insertions', { mark: 'italic', color: 'blue', background: 'none' })
        }
      >
        Set italic
      </button>
      <button onClick={state.reset}>Restore draft</button>
    </>
  );
}
test('React preset false exposes live draft hooks, Reset, and external updates', async () => {
  const { view, editor } = mount({
    revisionMarkup: (props) => (
      <Dialog {...props} preset={false}>
        <Dialog.Title>Preferences</Dialog.Title>
        <CustomFields />
        <Dialog.Reset />
        <Dialog.Apply />
        <Dialog.Cancel />
      </Dialog>
    ),
  });
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  expect(view.queryByLabelText('Insertions')).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByText('Set italic'));
  });
  expect(view.getByText('italic')).toBeTruthy();
  await act(async () => {
    editor().setRevisionMarkup({ insertions: { mark: 'bold' } });
  });
  expect(view.getByText('bold')).toBeTruthy();
  await act(async () => {
    fireEvent.click(view.getByText('Reset to defaults'));
  });
  expect(view.getByText('underline')).toBeTruthy();
  await act(async () => {
    fireEvent.click(view.getByText('Cancel'));
  });
  expect(editor().snapshot().revisionMarkup.insertions.mark).toBe('bold');
});
test('React popup false suppresses markup dialog and replacements receive cancellable sessions', async () => {
  const disabled = mount({ revisionMarkup: false });
  await act(async () => {
    disabled.editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  expect(disabled.view.queryByRole('dialog')).toBeNull();
  disabled.view.unmount();
  let session: RevisionMarkupDialogSession | null = null;
  const custom = mount({
    revisionMarkup: (props) => {
      session = props.session;
      return <button onClick={() => props.session?.cancel()}>Custom popup</button>;
    },
  });
  await act(async () => {
    custom.editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  expect(custom.view.getByText('Custom popup')).toBeTruthy();
  expect(session!.signal.aborted).toBe(false);
  await act(async () => {
    custom.view.unmount();
  });
  expect(session!.signal.aborted).toBe(true);
});
test('React default markup palette retains keyboard selection and restores focus', async () => {
  const { view, editor } = mount();
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  const trigger = view.getByRole('button', { name: 'Insertions color By author' });
  fireEvent.click(trigger);
  const group = view.getByRole('group', { name: 'Insertions color' });
  const blue = group.querySelector<HTMLButtonElement>('[data-value="blue"]')!;
  blue.focus();
  fireEvent.keyDown(blue, { key: 'ArrowRight' });
  expect(document.activeElement).not.toBe(blue);
  fireEvent.click(blue);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  await act(async () => {
    fireEvent.click(view.getByText('OK'));
  });
  expect(editor().snapshot().revisionMarkup.insertions.color).toBe('blue');
});

test('React palettes close on focus exit and outside presses without moving focus', async () => {
  const { view, editor } = mount();
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  const first = view.getByRole('button', { name: 'Insertions color By author' });
  const second = view.getByRole('button', { name: 'Deletions color By author' });
  fireEvent.click(first);
  expect(first.getAttribute('aria-expanded')).toBe('true');
  await act(async () => {
    second.focus();
  });
  expect(first.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(second);
  fireEvent.click(second);
  expect(second.getAttribute('aria-expanded')).toBe('true');
  fireEvent.pointerDown(view.getByText('Markup'));
  expect(second.getAttribute('aria-expanded')).toBe('false');
  for (const label of ['Track moves', 'Track formatting']) {
    const control = view.getByLabelText(label);
    const note = control.ownerDocument.getElementById(control.getAttribute('aria-describedby')!);
    expect(note?.textContent?.length).toBeGreaterThan(0);
  }
});
test('React hosts can hide the changed-lines field', async () => {
  const { view, editor } = mount({
    revisionMarkup: (props) => (
      <Dialog {...props}>
        <Dialog.Field name="changedLines" hidden />
      </Dialog>
    ),
  });
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  expect(view.queryByLabelText('Changed lines')).toBeNull();
  expect(view.queryByRole('img')).toBeNull();
});

test('React equivalent controlled props preserve an open draft across unrelated renders', async () => {
  let editor: DocxEditorInstance;
  const modules = [reviewModule({})];
  function Host() {
    const [count, setCount] = useState(0);
    return (
      <DocxEditorRoot
        document="blank"
        modules={modules}
        revisionMarkup={{ insertions: { mark: 'bold' } }}
        onReady={(value) => {
          editor = value as DocxEditorInstance;
        }}
      >
        <button onClick={() => setCount(count + 1)}>Render {count}</button>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
  }
  const view = render(<Host />);
  await act(async () => {
    editor!.exec({ type: 'openRevisionMarkupDialog' });
  });
  fireEvent.change(view.getByLabelText('Insertions'), { target: { value: 'italic' } });
  fireEvent.click(view.getByText('Render 0'));
  expect((view.getByLabelText('Insertions') as HTMLSelectElement).value).toBe('italic');
  expect(editor!.snapshot().revisionMarkup.insertions.mark).toBe('bold');
});

test('React markup dialog returns focus to the opener after Cancel, Apply, Escape, and unmount', async () => {
  const opener = document.createElement('button');
  opener.textContent = 'Review options opener';
  document.body.append(opener);
  const { view, editor } = mount();
  try {
    for (const action of ['Cancel', 'OK', 'Escape']) {
      opener.focus();
      await act(async () => {
        editor().exec({ type: 'openRevisionMarkupDialog' });
      });
      expect(document.activeElement).not.toBe(opener);
      await act(async () => {
        if (action === 'Escape') fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' });
        else fireEvent.click(view.getByRole('button', { name: action, exact: true }));
      });
      expect(document.activeElement).toBe(opener);
    }
    opener.focus();
    await act(async () => {
      editor().exec({ type: 'openRevisionMarkupDialog' });
    });
    await act(async () => {
      view.unmount();
    });
    expect(document.activeElement).toBe(opener);
  } finally {
    opener.remove();
  }
});

function SwitchToParagraph() {
  const host = useDialogHost();
  return <button onClick={() => host?.open('paragraph')}>Open paragraph options</button>;
}
test('React markup focus cleanup does not steal focus from a replacement dialog', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  const { view, editor } = mount({
    revisionMarkup: (props) => (
      <Dialog {...props}>
        <SwitchToParagraph />
      </Dialog>
    ),
  });
  try {
    opener.focus();
    await act(async () => {
      editor().exec({ type: 'openRevisionMarkupDialog' });
    });
    await act(async () => {
      fireEvent.click(view.getByText('Open paragraph options'));
    });
    const paragraph = view.container.querySelector('[data-docx-dialog="paragraph"]');
    expect(paragraph).not.toBeNull();
    expect(paragraph!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(opener);
  } finally {
    view.unmount();
    opener.remove();
  }
});

test.each([
  ['byAuthor', 'By author'],
  ['lightPurple', 'Light purple'],
  ['lightGreen', 'Light green'],
  ['gray', 'Gray'],
] as const)('React cell palette applies %s', async (value, label) => {
  const { view, editor } = mount();
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  fireEvent.click(view.getByRole('button', { name: 'Inserted cells Light blue' }));
  const group = view.getByRole('group', { name: 'Inserted cells' });
  const radio = Array.from(group.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label
  )!;
  expect(radio).toBeTruthy();
  await act(async () => {
    fireEvent.click(radio, { detail: 1 });
  });
  expect(editor().snapshot().revisionMarkup.cells.inserted).toBe('lightBlue');
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'OK' }));
  });
  expect(editor().snapshot().revisionMarkup.cells.inserted).toBe(value);
});

test('React backgrounds stage, apply, reset, and follow external preferences', async () => {
  const { view, editor } = mount();
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  for (const name of ['Insertions', 'Deletions', 'Moved from', 'Moved to', 'Formatting']) {
    fireEvent.click(view.getByRole('button', { name: `${name} background None` }));
    const group = view.getByRole('group', { name: `${name} background` });
    fireEvent.click(group.querySelector<HTMLButtonElement>('[data-value="lightYellow"]')!, {
      detail: 1,
    });
  }
  expect(editor().snapshot().revisionMarkup.insertions.background).toBe('none');
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'OK', exact: true }));
  });
  for (const key of ['insertions', 'deletions', 'movedFrom', 'movedTo', 'formatting'] as const)
    expect(editor().snapshot().revisionMarkup[key].background).toBe('lightYellow');
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
  });
  fireEvent.click(view.getByRole('button', { name: 'Reset to defaults' }));
  expect(view.getByRole('button', { name: 'Insertions background None' })).toBeTruthy();
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Cancel', exact: true }));
  });
  expect(editor().snapshot().revisionMarkup.insertions.background).toBe('lightYellow');
  await act(async () => {
    editor().exec({ type: 'openRevisionMarkupDialog' });
    editor().setRevisionMarkup({ insertions: { background: 'byAuthor' }, trackMoves: false });
  });
  expect(view.getByRole('button', { name: 'Insertions background By author' })).toBeTruthy();
  expect(
    (view.getByRole('button', { name: 'Moved from background Light yellow' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
