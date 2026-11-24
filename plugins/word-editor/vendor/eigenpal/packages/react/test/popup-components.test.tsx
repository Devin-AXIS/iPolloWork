import { definePopup } from '../src/editor/popup-renderer';
import './dom-setup';
import { useEffect, useState } from 'react';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DocxEditor } from '../src/components/DocxEditor';
import {
  DocxEditorPageSetupDialog as Page,
  type DocxEditorPageSetupDialogProps,
} from '../src/editor/DocxEditorPageSetup';
import type { DocxEditorContextMenuProps } from '../src/editor/contextmenu';

afterEach(cleanup);

async function openPage(view: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.click(view.getByRole('menuitem', { name: 'File', exact: true }));
  });
  await act(async () => {
    fireEvent.click(view.getByRole('menuitem', { name: /Page setup/i }));
  });
}

test('component popup preserves hook state across recreated registrations and owns opening', async () => {
  let mounts = 0;
  let unmounts = 0;
  let legacy = 0;
  function CustomPage(props: DocxEditorPageSetupDialogProps) {
    const [draft, setDraft] = useState('initial');
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return (
      <Page {...props}>
        <Page.Body>
          <input
            aria-label="Custom draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Page.Body>
      </Page>
    );
  }
  const tree = (disabled = false) => (
    <DocxEditor
      document="blank"
      menu={{ onPageSetup: () => legacy++ }}
      popups={{ pageSetup: disabled ? false : definePopup(CustomPage) }}
    />
  );
  const view = render(tree());
  await act(async () => {});
  await openPage(view);
  const input = view.getByLabelText('Custom draft') as HTMLInputElement;
  act(() => {
    fireEvent.change(input, { target: { value: 'unfinished' } });
  });
  await act(async () => {
    view.rerender(tree());
  });
  expect(view.getByLabelText('Custom draft')).toBe(input);
  expect(input.value).toBe('unfinished');
  expect(mounts).toBe(1);
  expect(legacy).toBe(0);
  expect(view.container.querySelectorAll('dialog')).toHaveLength(1);
  await act(async () => {
    view.rerender(tree(true));
  });
  expect(view.container.querySelector('dialog')).toBeNull();
  expect(unmounts).toBe(1);
  await act(async () => {
    view.rerender(tree());
  });
  await openPage(view);
  expect((view.getByLabelText('Custom draft') as HTMLInputElement).value).toBe('initial');
  expect(mounts).toBe(2);
});

test('context-menu component retains state and receives current editor translation', async () => {
  function CustomMenu(props: DocxEditorContextMenuProps) {
    const [clicks, setClicks] = useState(0);
    return (
      <button onClick={() => setClicks(clicks + 1)}>
        {props.t?.('menu.copy')} {clicks}
      </button>
    );
  }
  const tree = (label: string) => (
    <DocxEditor
      document="blank"
      contextMenu={false}
      t={() => label}
      popups={{ contextMenu: definePopup(CustomMenu) }}
    />
  );
  const view = render(tree('first'));
  await act(async () => {});
  act(() => {
    fireEvent.click(view.getByText('first 0'));
  });
  await act(async () => {
    view.rerender(tree('second'));
  });
  expect(view.getByText('second 1')).toBeTruthy();
  expect(view.queryByText('first 1')).toBeNull();
});

test('a replacement field session resets component drafts while registration rerenders preserve them', async () => {
  const { formFieldDocx } = await import('../../core/src/editor/__tests__/form-field-docx.fixture');
  let editor: import('@docx-editor.dev/core/editor').DocxEditorInstance | undefined;
  let current: import('@docx-editor.dev/core/editor').TextFormFieldDialogSession | undefined;
  function CustomField({
    session,
  }: {
    session: import('@docx-editor.dev/core/editor').TextFormFieldDialogSession;
  }) {
    current = session;
    const [draft, setDraft] = useState(session.field.defaultText);
    return (
      <input
        aria-label="Session draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const bytes = formFieldDocx();
  const tree = () => (
    <DocxEditor
      document={bytes}
      onReady={(value) => {
        editor = value;
      }}
      popups={{ textFormField: definePopup(CustomField) }}
    />
  );
  const view = render(tree());
  await act(async () => {});
  const surface = editor!.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  await act(async () => {
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 10 } });
    expect(surface.editTextFormField()).toBe(true);
  });
  const input = view.getByLabelText('Session draft') as HTMLInputElement;
  const original = input.value;
  const firstSession = current!;
  act(() => {
    fireEvent.change(input, { target: { value: 'unfinished' } });
  });
  await act(async () => {
    view.rerender(tree());
  });
  expect(view.getByLabelText('Session draft')).toBe(input);
  expect(input.value).toBe('unfinished');
  await act(async () => {
    expect(surface.editTextFormField()).toBe(true);
  });
  expect(current).not.toBe(firstSession);
  expect(firstSession.signal.aborted).toBe(true);
  expect(view.getByLabelText('Session draft')).not.toBe(input);
  expect((view.getByLabelText('Session draft') as HTMLInputElement).value).toBe(original);
});
