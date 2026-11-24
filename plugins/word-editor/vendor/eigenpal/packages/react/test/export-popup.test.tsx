import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import type { ChromeExportHandlers } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorMenu } from '../src/editor/menu';
import {
  DocxEditorExportDialog,
  type DocxEditorExportDialogProps,
} from '../src/editor/DocxEditorExportDialog';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import { definePopup } from '../src/editor/popup-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

function mount(packaged: boolean, popups: DocxEditorPopups, exporters?: ChromeExportHandlers) {
  return render(
    packaged ? (
      <DocxEditor document="blank" popups={popups} menu={{ exporters }} />
    ) : (
      <DocxEditorRoot document="blank" popups={popups}>
        <DocxEditorMenu exporters={exporters} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    )
  );
}

async function exportPdf(view: ReturnType<typeof render>) {
  act(() => {
    fireEvent.click(view.container.querySelector('[data-menu="file"] > button')!);
  });
  act(() => {
    fireEvent.mouseEnter(view.container.querySelector('.docx-menubar__submenu')!);
  });
  await act(async () => {
    fireEvent.click(view.container.querySelector('[data-slot="file.exportPdf"]')!);
  });
}

for (const packaged of [false, true]) {
  test(`export override keeps component state from progress to failure (packaged=${packaged})`, async () => {
    let fail!: (reason: Error) => void;
    const conversion = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    let latest!: DocxEditorExportDialogProps;
    function CustomExport(props: DocxEditorExportDialogProps) {
      latest = props;
      const [count, setCount] = useState(0);
      return (
        <DocxEditorExportDialog {...props} className="custom-export" style={{ maxWidth: 420 }}>
          <p>{props.error || props.format}</p>
          <button onClick={() => setCount(count + 1)}>Count {count}</button>
          <button onClick={props.onClose}>Dismiss export</button>
        </DocxEditorExportDialog>
      );
    }
    const view = mount(packaged, { export: definePopup(CustomExport) }, { pdf: () => conversion });
    await exportPdf(view);
    expect(latest.open).toBe(true);
    expect(latest.format).toBe('pdf');
    expect(latest.pending).toBe(true);
    expect(latest.error).toBe('');
    expect(view.container.querySelectorAll('dialog')).toHaveLength(1);
    expect(view.container.querySelector('.custom-export')?.getAttribute('style')).toContain(
      '420px'
    );
    act(() => {
      fireEvent.click(view.getByText('Count 0'));
    });
    await act(async () => {
      fail(new Error('PDF service unavailable'));
    });
    expect(latest.pending).toBe(false);
    expect(latest.error).toContain('PDF service unavailable');
    expect(view.getByText('Count 1')).toBeTruthy();
    act(() => {
      fireEvent.click(view.getByText('Dismiss export'));
    });
    expect(view.container.querySelector('dialog')).toBeNull();
    await exportPdf(view);
    expect(view.getByText('Count 0')).toBeTruthy();
  });

  test(`export callbacks receive missing PDF setup errors (packaged=${packaged})`, async () => {
    const view = mount(packaged, {
      export: (props) => <DocxEditorExportDialog {...props} className="callback-export" />,
    });
    await exportPdf(view);
    expect(view.getByRole('alert').textContent).toContain(
      'Install @docx-editor.dev/docx-to-pdf on your Node.js server and configure menu.exporters.pdf.'
    );
    expect(view.getByRole('alertdialog').classList.contains('callback-export')).toBe(true);
    act(() => {
      fireEvent.click(view.getByRole('button', { name: 'Close' }));
    });
    expect(view.queryByRole('alertdialog')).toBeNull();
  });

  test(`false hides feedback without disabling conversion (packaged=${packaged})`, async () => {
    let calls = 0;
    const view = mount(
      packaged,
      { export: false },
      {
        pdf: async () => {
          calls++;
          throw new Error('Handled by the host');
        },
      }
    );
    await exportPdf(view);
    expect(calls).toBe(1);
    expect(view.container.querySelector('dialog')).toBeNull();
    await exportPdf(view);
    expect(calls).toBe(2);
  });
}

test('the public export dialog respects controlled visibility', () => {
  const view = render(
    <DocxEditorExportDialog open={false} pending format="markdown" error="" onClose={() => {}} />
  );
  expect(view.container.querySelector('dialog')).toBeNull();
  expect(DocxEditor.ExportDialog).toBe(DocxEditorExportDialog);
});
