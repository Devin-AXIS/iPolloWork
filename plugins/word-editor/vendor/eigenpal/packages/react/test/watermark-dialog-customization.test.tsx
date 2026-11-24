// The Watermark dialog follows the shared dialog customization ladder, as Page Setup does:
// `asChild` parts, a custom control on the shared draft, a full composition with
// `preset={false}`, and a `popups.watermark` renderer that the Insert menu opens.

import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import {
  DocxEditorWatermarkDialog as Mark,
  useWatermarkDialog,
} from '../src/editor/DocxEditorWatermark';
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

function CustomText() {
  const dialog = useWatermarkDialog();
  return (
    <button
      onClick={() => {
        dialog.setValue('kind', 'text');
        dialog.setValue('text', 'INTERNAL USE');
      }}
    >
      Internal
    </button>
  );
}

test('an asChild Apply keeps the one packaged action and one undo step', async () => {
  let closed = 0;
  const { view, editor } = mount(
    <Mark open onClose={() => closed++}>
      <Mark.Field name="text">
        <CustomText />
      </Mark.Field>
      <Mark.Apply asChild className="paired-class">
        <button className="brand-button">Stamp</button>
      </Mark.Apply>
    </Mark>
  );
  const apply = view.container.querySelector<HTMLButtonElement>('[data-docx-part="apply"]')!;
  expect(apply.classList.contains('brand-button')).toBe(true);
  expect(apply.classList.contains('docx-dialog__button')).toBe(false);
  await act(async () => {
    fireEvent.click(view.getByText('Internal'));
  });
  await act(async () => {
    fireEvent.click(view.getByText('Stamp'));
  });
  expect(closed).toBe(1);
  expect(editor().getWatermark()).toMatchObject({ kind: 'text', text: 'INTERNAL USE' });
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(editor().getWatermark()).toBeNull();
});

test('a full composition renders only the named fields, in order', async () => {
  const { view, editor } = mount(
    <Mark open onClose={() => {}} preset={false}>
      <Mark.Body>
        <Mark.Field name="textWatermark" />
        <Mark.Field name="text" />
      </Mark.Body>
      <Mark.Footer>
        <Mark.Apply />
      </Mark.Footer>
    </Mark>
  );
  const dialog = view.getByRole('dialog');
  expect(
    [...dialog.querySelectorAll('[data-docx-part="field"]')].map((e) =>
      e.getAttribute('data-docx-field')
    )
  ).toEqual(['textWatermark', 'text']);
  expect(dialog.querySelector('[data-docx-field="picture"]')).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByLabelText('Text watermark'));
  });
  await act(async () => {
    fireEvent.click(view.getByText('Apply'));
  });
  expect(editor().getWatermark()).toMatchObject({ kind: 'text', text: 'DRAFT' });
});

test('a full composition places the preview part, which follows the draft', async () => {
  const { view } = mount(
    <Mark open onClose={() => {}} preset={false}>
      <Mark.Body>
        <Mark.Field name="textWatermark" />
        <Mark.Preview className="host-preview" />
      </Mark.Body>
    </Mark>
  );
  const dialog = view.getByRole('dialog');
  const preview = dialog.querySelector<HTMLElement>('[data-docx-part="preview"]')!;
  expect(preview.classList.contains('host-preview')).toBe(true);
  expect(preview.classList.contains('docx-dialog__preview')).toBe(true);
  expect(preview.getAttribute('aria-hidden')).toBe('true');
  expect(preview.querySelector('[data-docx-watermark-preview]')).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByLabelText('Text watermark'));
  });
  expect(
    dialog.querySelector('[data-docx-part="preview"] [data-docx-watermark-preview="text"]')
      ?.textContent
  ).toBe('DRAFT');
});

test('a hidden preview leaves the default arrangement without it', () => {
  const { view } = mount(
    <Mark open onClose={() => {}}>
      <Mark.Preview hidden />
    </Mark>
  );
  expect(view.getByRole('dialog').querySelector('[data-docx-part="preview"]')).toBeNull();
  expect(view.getByText('Apply')).toBeTruthy();
});

test('hidden parts go away and the other defaults stay', () => {
  const { view } = mount(
    <Mark open onClose={() => {}}>
      <Mark.Cancel hidden />
      <Mark.Title>Stamp the document</Mark.Title>
    </Mark>
  );
  expect(view.queryByText('Cancel')).toBeNull();
  expect(view.getByText('Stamp the document')).toBeTruthy();
  expect(view.getByText('Apply')).toBeTruthy();
});

test('the Insert menu opens the popups.watermark renderer', async () => {
  const { view } = mount(undefined, {
    watermark: (props) => (
      <Mark {...props} presets={['INTERNAL']}>
        <Mark.Apply>Stamp it</Mark.Apply>
      </Mark>
    ),
  });
  await act(async () => {
    fireEvent.click(view.getByRole('menuitem', { name: 'Insert' }));
  });
  const row = view.container.querySelector<HTMLElement>('[data-slot="insert.watermark"]')!;
  await act(async () => {
    fireEvent.click(row);
  });
  expect(view.getByText('Stamp it')).toBeTruthy();
  expect(view.container.querySelectorAll('[data-docx-dialog="watermark"]').length).toBe(1);
});
