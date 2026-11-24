import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import {
  DocxEditorPageSetupDialog as Page,
  usePageSetupDialog,
} from '../src/editor/DocxEditorPageSetup';
import {
  DocxEditorParagraphDialog as Paragraph,
  useParagraphDialog,
} from '../src/editor/DocxEditorParagraphDialog';
import { DocxEditorMenu } from '../src/editor/menu/DocxEditorMenu';
import type { DocxEditorPopups } from '../src/editor/popup-config';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);
function mount(children?: ReactNode, dialogs?: DocxEditorPopups) {
  let editor: DocxEditorInstance;
  const view = render(
    <DocxEditorRoot
      document="blank"
      popups={dialogs}
      onReady={(value) => {
        editor = value as DocxEditorInstance;
      }}
    >
      <DocxEditorMenu />
      <DocxEditorViewport>
        <DocxEditorContent />
        {children}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => editor! };
}
test('custom Apply preserves one default action and writes one undo step', async () => {
  let clicked = 0,
    closed = 0;
  const { view, editor } = mount(
    <Page open onClose={() => closed++}>
      <Page.Apply asChild className="paired-class">
        <button className="brand-button" onClick={() => clicked++}>
          Save page
        </button>
      </Page.Apply>
    </Page>
  );
  expect(view.container.querySelectorAll('[data-docx-part="apply"]').length).toBe(1);
  // `asChild` hands the look to the host: the packaged classes stay off its element.
  const brand = view.container.querySelector<HTMLButtonElement>('[data-docx-part="apply"]')!;
  expect(brand.classList.contains('brand-button')).toBe(true);
  expect(brand.classList.contains('paired-class')).toBe(true);
  expect(brand.classList.contains('docx-dialog__button')).toBe(false);
  await act(async () => {
    fireEvent.change(view.getByLabelText('Top'), { target: { value: '0.5' } });
  });
  await act(async () => {
    fireEvent.click(view.getByText('Save page'));
  });
  expect(clicked).toBe(1);
  expect(closed).toBe(1);
  expect(editor().getPageSetup()!.marginsTwips.top).toBe(720);
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(editor().getPageSetup()!.marginsTwips.top).toBe(1440);
});
test('a part forwards host attributes but keeps its own wiring', async () => {
  let hostClicked = 0;
  const { view, editor } = mount(
    <Page open onClose={() => {}}>
      <Page.Apply
        id="app-apply"
        aria-label="Save the page"
        data-testid="app-save"
        onClick={() => hostClicked++}
      />
    </Page>
  );
  const apply = view.container.querySelector<HTMLButtonElement>('[data-docx-part="apply"]')!;
  expect(apply.id).toBe('app-apply');
  expect(apply.getAttribute('aria-label')).toBe('Save the page');
  expect(apply.getAttribute('data-testid')).toBe('app-save');
  await act(async () => {
    fireEvent.change(view.getByLabelText('Top'), { target: { value: '0.5' } });
  });
  await act(async () => {
    fireEvent.click(apply);
  });
  // The packaged handler still runs, and the host's stray one never replaced it.
  expect(editor().getPageSetup()!.marginsTwips.top).toBe(720);
  expect(hostClicked).toBe(0);
});

test('full composition retains field wiring in the supplied order', async () => {
  const { view, editor } = mount(
    <Page open onClose={() => {}} preset={false}>
      <Page.Footer>
        <Page.Apply />
        <Page.Cancel />
      </Page.Footer>
      <Page.Body>
        <Page.Field name="marginLeft" />
        <Page.Field name="marginTop" />
      </Page.Body>
    </Page>
  );
  const dialog = view.getByRole('dialog');
  expect(dialog.firstElementChild?.getAttribute('data-docx-part')).toBe('footer');
  expect(view.queryByLabelText('Orientation')).toBeNull();
  expect(
    [...dialog.querySelectorAll('[data-docx-part="field"]')].map((e) =>
      e.getAttribute('data-docx-field')
    )
  ).toEqual(['marginLeft', 'marginTop']);
  await act(async () => {
    fireEvent.change(view.getByLabelText('Left'), { target: { value: '0.25' } });
  });
  await act(async () => {
    fireEvent.click(view.getByText('Apply'));
  });
  expect(editor().getPageSetup()!.marginsTwips.left).toBe(360);
});
function CustomMargin() {
  const dialog = usePageSetupDialog();
  return <button onClick={() => dialog.setValue('marginTop', 720)}>Half inch</button>;
}
test('custom value controls share the default draft and refusal handling', async () => {
  const { view, editor } = mount(
    <Page open onClose={() => {}}>
      <Page.Field name="marginTop">
        <CustomMargin />
      </Page.Field>
    </Page>
  );
  await act(async () => {
    fireEvent.click(view.getByText('Half inch'));
  });
  await act(async () => {
    fireEvent.click(view.getByText('Apply'));
  });
  expect(editor().getPageSetup()!.marginsTwips.top).toBe(720);
});
test('hidden controls are removed without removing other defaults', () => {
  const { view } = mount(
    <Page open onClose={() => {}}>
      <Page.Cancel hidden />
      <Page.Title>Page settings</Page.Title>
    </Page>
  );
  expect(view.queryByText('Cancel')).toBeNull();
  expect(view.getByText('Page settings')).toBeTruthy();
  expect(view.getByText('Apply')).toBeTruthy();
});
test('menu opening uses per-editor customization once', async () => {
  const { view } = mount(undefined, {
    pageSetup: (props) => (
      <Page {...props}>
        <Page.Apply>Save settings</Page.Apply>
      </Page>
    ),
  });
  await act(async () => {
    fireEvent.click(view.getByRole('menuitem', { name: 'File' }));
  });
  const row = [...view.container.querySelectorAll('[role="menuitem"]')].find((e) =>
    e.textContent?.toLowerCase().includes('page setup')
  )!;
  expect(!!row).toBe(true);
  await act(async () => {
    fireEvent.click(row);
  });
  expect(view.getByText('Save settings')).toBeTruthy();
  expect(view.container.querySelectorAll('[data-docx-dialog="pageSetup"]').length).toBe(1);
});
function CustomRule() {
  const dialog = useParagraphDialog();
  return (
    <>
      <button onClick={() => dialog.setValue('lineRule', 'exact')}>Exact</button>
      <output>{dialog.values.lineValue}</output>
    </>
  );
}
test('custom paragraph rule changes use the same unit rebasing', async () => {
  const { view } = mount(
    <Paragraph open onClose={() => {}}>
      <Paragraph.Field name="lineRule">
        <CustomRule />
      </Paragraph.Field>
    </Paragraph>
  );
  await act(async () => {
    fireEvent.click(view.getByText('Exact'));
  });
  expect(view.getByRole('status').textContent).toBe('12');
});
function CustomDirection() {
  const dialog = useParagraphDialog();
  return (
    <>
      <output>{dialog.values.direction}</output>
      <button onClick={() => dialog.setValue('direction', 'rtl')}>Make RTL</button>
    </>
  );
}
test('a custom paragraph layout reads and sets the direction', async () => {
  const { view, editor } = mount(
    <Paragraph open onClose={() => {}}>
      <Paragraph.Field name="direction">
        <CustomDirection />
      </Paragraph.Field>
    </Paragraph>
  );
  // The custom control replaces the packaged select, and reads the seeded draft.
  expect(view.queryByLabelText('Direction')).toBeNull();
  expect(view.getByRole('status').textContent).toBe('ltr');
  await act(async () => {
    fireEvent.click(view.getByText('Make RTL'));
  });
  expect(view.getByRole('status').textContent).toBe('rtl');
  await act(async () => {
    fireEvent.click(view.getByText('OK'));
  });
  expect(editor().snapshot().formatting?.direction).toBe('rtl');
});
function TogglePage() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open page</button>
      <Page open={open} onClose={() => setOpen(false)} />
    </>
  );
}
test('Cancel and Escape return focus to the opener without applying', async () => {
  const { view, editor } = mount(<TogglePage />);
  const opener = view.getByText('Open page');
  await act(async () => {
    opener.focus();
    fireEvent.click(opener);
  });
  await act(async () => {
    fireEvent.change(view.getByLabelText('Top'), { target: { value: '0.5' } });
  });
  await act(async () => {
    fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' });
  });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(document.activeElement === opener).toBe(true);
  expect(editor().getPageSetup()!.marginsTwips.top).toBe(1440);
});

test('fragment-wrapped extra content remains visible beside default parts', () => {
  const { view } = mount(
    <Page open onClose={() => {}}>
      <>
        <p>Settings affect the document.</p>
        <Page.Title>Layout</Page.Title>
      </>
    </Page>
  );
  expect(view.getByText('Settings affect the document.')).toBeTruthy();
  expect(view.getByText('Layout')).toBeTruthy();
  expect(view.getByText('Apply')).toBeTruthy();
});

test('reopening a controlled dialog clears the previous refusal', async () => {
  const { view } = mount(<TogglePage />);
  await act(async () => {
    fireEvent.click(view.getByText('Open page'));
  });
  await act(async () => {
    fireEvent.change(view.getByLabelText('Top'), { target: { value: '22' } });
  });
  await act(async () => {
    fireEvent.click(view.getByText('Apply'));
  });
  expect(view.getByRole('alert').textContent!.length > 0).toBe(true);
  await act(async () => {
    fireEvent.click(view.getByText('Cancel'));
  });
  await act(async () => {
    fireEvent.click(view.getByText('Open page'));
  });
  expect(view.getByRole('alert').textContent).toBe('');
});

function ToggleParagraph() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open paragraph</button>
      <Paragraph open={open} onClose={() => setOpen(false)} />
    </>
  );
}
test('loading a document cancels an open paragraph draft', async () => {
  const { view, editor } = mount(<ToggleParagraph />);
  await act(async () => {
    fireEvent.click(view.getByText('Open paragraph'));
  });
  await act(async () => {
    fireEvent.change(view.container.querySelector('[data-docx-field="alignment"] select')!, {
      target: { value: 'right' },
    });
  });
  await act(async () => {
    editor().load('blank');
  });
  await waitFor(() => expect(view.queryAllByRole('dialog').length).toBe(0));
  await act(async () => {
    fireEvent.click(view.getByText('Open paragraph'));
  });
  expect(
    (view.container.querySelector('[data-docx-field="alignment"] select')! as HTMLSelectElement)
      .value
  ).toBe('left');
});
