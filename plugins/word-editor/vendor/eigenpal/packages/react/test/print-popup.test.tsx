import './dom-setup.ts';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import type { ChromeExportHandlers } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorMenu } from '../src/editor/menu';
import {
  DocxEditorPrintDialog,
  type DocxEditorPrintDialogProps,
} from '../src/editor/DocxEditorPrintDialog';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import { definePopup } from '../src/editor/popup-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom cannot navigate a frame to a blob URL. Tests load the print frame themselves.
(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true;
afterEach(() => {
  cleanup();
  for (const frame of document.querySelectorAll('[data-docx-print-frame]')) frame.remove();
});

const PDF = new TextEncoder().encode('%PDF-1.7\n');

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

/** Opens the File menu and returns its Print row. */
function printRow(view: ReturnType<typeof render>) {
  act(() => {
    fireEvent.click(view.container.querySelector('[data-menu="file"] > button')!);
  });
  return view.container.querySelector<HTMLButtonElement>('[data-slot="file.print"]')!;
}

/** Selects File > Print and leaves any settings step open. */
async function openPrint(view: ReturnType<typeof render>) {
  const row = printRow(view);
  await act(async () => {
    fireEvent.click(row);
  });
}

/** Selects File > Print and confirms the settings step when it shows. */
async function selectPrint(view: ReturnType<typeof render>) {
  const row = printRow(view);
  await act(async () => {
    fireEvent.click(row);
  });
  const settings = view.container.querySelector('[data-docx-part="print-settings"]');
  if (!settings) return;
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Print' }));
  });
}

/** Loads the hidden print frame with a window that records print calls. */
async function loadPrintFrame(calls: string[]) {
  await act(async () => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-docx-print-frame]')!;
    // A modal dialog would make the print frame inert, so it must be closed by now.
    const target = {
      focus: () => calls.push('focus'),
      print: () =>
        calls.push(document.querySelector('dialog[open]') ? 'print-under-modal' : 'print'),
    };
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => target });
    frame.dispatchEvent(new Event('load'));
  });
}

/** Makes the browser report no PDF viewer until the returned function runs. */
function withoutPdfViewer() {
  Object.defineProperty(navigator, 'pdfViewerEnabled', { configurable: true, value: false });
  return () => delete (navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
}

for (const packaged of [false, true]) {
  test(`File > Print converts, opens the print dialog, and closes (packaged=${packaged})`, async () => {
    let finish!: (value: { bytes: Uint8Array }) => void;
    const view = mount(packaged, {}, { pdf: () => new Promise((resolve) => (finish = resolve)) });
    await selectPrint(view);
    const dialog = view.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Preparing to print…');
    expect(dialog.getAttribute('data-docx-dialog')).toBe('print');
    expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    await act(async () => finish({ bytes: PDF }));
    const calls: string[] = [];
    await loadPrintFrame(calls);
    expect(calls).toEqual(['focus', 'print']);
    // The browser print dialog replaces the editor popup.
    expect(view.queryByRole('dialog')).toBeNull();
    // The frame stays while the browser prints from it, inside the editor.
    expect(document.querySelectorAll('[data-docx-print-frame]')).toHaveLength(1);
    expect(
      document.querySelector('[data-docx-print-frame]')?.closest('.docx-editor')
    ).not.toBeNull();

    const again = printRow(view);
    expect(again.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(again);
    });
    // A new print replaces the previous frame.
    expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
  });

  test(`Cancel discards a conversion that finishes later (packaged=${packaged})`, async () => {
    let finish!: (value: { bytes: Uint8Array }) => void;
    const view = mount(packaged, {}, { pdf: () => new Promise((resolve) => (finish = resolve)) });
    await selectPrint(view);
    act(() => {
      fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    });
    expect(view.queryByRole('dialog')).toBeNull();
    await act(async () => finish({ bytes: PDF }));
    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
    expect(printRow(view).disabled).toBe(false);
  });

  test(`a missing PDF handler shows setup instructions (packaged=${packaged})`, async () => {
    const view = mount(packaged, {});
    await selectPrint(view);
    expect(view.getByRole('alertdialog').getAttribute('aria-label')).toBe('Print failed');
    expect(view.getByRole('alert').textContent).toContain(
      'Install @docx-editor.dev/docx-to-pdf on your Node.js server and configure menu.exporters.pdf.'
    );
    expect(view.queryByRole('link', { name: 'Open PDF' })).toBeNull();
    act(() => {
      fireEvent.click(view.getByRole('button', { name: 'Close' }));
    });
    expect(view.queryByRole('alertdialog')).toBeNull();
  });

  test(`without a PDF viewer the dialog offers the PDF (packaged=${packaged})`, async () => {
    const restore = withoutPdfViewer();
    try {
      const view = mount(packaged, {}, { pdf: async () => ({ bytes: PDF }) });
      await selectPrint(view);
      expect(view.getByRole('alert').textContent).toContain('cannot print PDF files');
      const open = view.getByRole('link', { name: 'Open PDF' });
      expect(open.getAttribute('href')).toStartWith('blob:');
      expect(open.getAttribute('rel')).toContain('noopener');
      expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
      act(() => {
        fireEvent.click(view.getByRole('button', { name: 'Close' }));
      });
      expect(view.queryByRole('alertdialog')).toBeNull();
    } finally {
      restore();
    }
  });

  test(`a print override keeps component state from progress to failure (packaged=${packaged})`, async () => {
    let fail!: (reason: Error) => void;
    let latest!: DocxEditorPrintDialogProps;
    function CustomPrint(props: DocxEditorPrintDialogProps) {
      latest = props;
      const [count, setCount] = useState(0);
      return (
        <DocxEditorPrintDialog {...props} className="custom-print" style={{ maxWidth: 420 }}>
          <p>{props.pending ? 'Converting' : props.error}</p>
          <button onClick={() => setCount(count + 1)}>Count {count}</button>
          <button onClick={props.onClose}>Done</button>
        </DocxEditorPrintDialog>
      );
    }
    const view = mount(
      packaged,
      { print: definePopup(CustomPrint) },
      { pdf: () => new Promise((_resolve, reject) => (fail = reject)) }
    );
    await selectPrint(view);
    expect(latest).toMatchObject({ open: true, pending: true, error: '', url: '' });
    expect(view.container.querySelector('.custom-print')?.getAttribute('style')).toContain('420px');
    act(() => {
      fireEvent.click(view.getByText('Count 0'));
    });
    await act(async () => fail(new Error('PDF service unavailable')));
    expect(latest.pending).toBe(false);
    expect(latest.error).toContain('PDF service unavailable');
    expect(view.getByText('Count 1')).toBeTruthy();
    act(() => {
      fireEvent.click(view.getByText('Done'));
    });
    expect(view.container.querySelector('dialog')).toBeNull();
    await selectPrint(view);
    expect(view.getByText('Count 0')).toBeTruthy();
  });

  test(`false hides feedback and still prints (packaged=${packaged})`, async () => {
    let conversions = 0;
    const view = mount(
      packaged,
      { print: false },
      {
        pdf: async () => {
          conversions++;
          return { bytes: PDF };
        },
      }
    );
    await selectPrint(view);
    expect(view.container.querySelector('dialog')).toBeNull();
    const calls: string[] = [];
    await loadPrintFrame(calls);
    expect(calls).toEqual(['focus', 'print']);
    const again = printRow(view);
    expect(again.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(again);
    });
    expect(conversions).toBe(2);
  });
}

test('with no popup, a failed print does not lock File > Print', async () => {
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  let conversions = 0;
  const view = mount(
    false,
    { print: false },
    {
      pdf: async () => {
        conversions++;
        throw new Error('Handled by the host');
      },
    }
  );
  await selectPrint(view);
  expect(view.container.querySelector('dialog')).toBeNull();
  const again = printRow(view);
  expect(again.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(again);
  });
  expect(conversions).toBe(2);
  // No popup reports the failure, so the console does.
  expect(logged).toHaveBeenCalledWith('[docx-editor] print failed', expect.any(Error));
  logged.mockRestore();
});

test('the print shortcut inside the progress dialog does not print the page', async () => {
  const view = mount(false, {}, { pdf: () => new Promise(() => {}) });
  await selectPrint(view);
  const cancel = view.getByRole('button', { name: 'Cancel' });
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    code: 'KeyP',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    cancel.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
});

test('the default dialog links only to blob URLs', () => {
  const view = render(
    <DocxEditorPrintDialog
      open
      pending={false}
      error="Print failed"
      url="javascript:alert(1)"
      onClose={() => {}}
    />
  );
  expect(view.queryByRole('link')).toBeNull();
});

test('Cancel while the PDF loads stops before the print dialog opens', async () => {
  let finish!: (value: { bytes: Uint8Array }) => void;
  const view = mount(false, {}, { pdf: () => new Promise((resolve) => (finish = resolve)) });
  await selectPrint(view);
  await act(async () => finish({ bytes: PDF }));
  // Conversion is done and the frame loads; the progress popup still shows.
  expect(document.querySelector('[data-docx-print-frame]')).not.toBeNull();
  act(() => {
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  });
  const calls: string[] = [];
  await loadPrintFrame(calls);
  expect(calls).toEqual([]);
  expect(view.queryByRole('dialog')).toBeNull();
  expect(printRow(view).disabled).toBe(false);
});

test('the Print row shows its shortcut only with a PDF handler', () => {
  const configured = mount(false, {}, { pdf: async () => ({ bytes: PDF }) });
  expect(printRow(configured).textContent).toContain('Ctrl+P');
  cleanup();
  const unconfigured = mount(false, {});
  expect(printRow(unconfigured).textContent).not.toContain('Ctrl+P');
});

test('with no popup, a busy print leaves the shortcut to the browser', async () => {
  const view = mount(false, { print: false }, { pdf: () => new Promise(() => {}) });
  await selectPrint(view);
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    code: 'KeyP',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    view.container.querySelector('[data-testid="docx-menubar"]')!.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
});

test('unmounting during conversion discards the PDF', async () => {
  let finish!: (value: { bytes: Uint8Array }) => void;
  const view = mount(false, {}, { pdf: () => new Promise((resolve) => (finish = resolve)) });
  await selectPrint(view);
  view.unmount();
  await act(async () => finish({ bytes: PDF }));
  expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
});

test('Ctrl+P prints from the editor only when a PDF handler is configured', async () => {
  const configured = mount(false, {}, { pdf: () => new Promise(() => {}) });
  await act(async () => {
    await Promise.resolve();
  });
  const surface = configured.container.querySelector('[data-testid="docx-menubar"]')!;
  let event = new KeyboardEvent('keydown', {
    key: 'p',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    surface.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(configured.getByRole('dialog').getAttribute('aria-label')).toBe('Print');
  cleanup();

  const unconfigured = mount(false, {});
  await act(async () => {
    await Promise.resolve();
  });
  event = new KeyboardEvent('keydown', {
    key: 'p',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    unconfigured.container.querySelector('[data-testid="docx-menubar"]')!.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(unconfigured.queryByRole('dialog')).toBeNull();
});

test('the public print dialog respects controlled visibility', () => {
  const view = render(
    <DocxEditorPrintDialog open={false} pending error="" url="" onClose={() => {}} />
  );
  expect(view.container.querySelector('dialog')).toBeNull();
  expect(DocxEditor.PrintDialog).toBe(DocxEditorPrintDialog);
  expect(DocxEditorMenu.Print.docxSlot).toBe('file.print');
});

for (const packaged of [false, true]) {
  test(`File > Print asks which markup and comments to print (packaged=${packaged})`, async () => {
    const views: unknown[] = [];
    const view = mount(
      packaged,
      {},
      {
        pdf: async (_bytes, printed) => {
          views.push(printed);
          return { bytes: PDF };
        },
      }
    );
    await openPrint(view);
    // Nothing converts until the user confirms.
    expect(views).toEqual([]);
    const dialog = view.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Print');
    const radio = (name: string) => view.getByRole('radio', { name }) as HTMLInputElement;
    const comments = () =>
      view.getByRole('checkbox', { name: 'Print comments' }) as HTMLInputElement;
    // The form starts from the editor's current view, with comments shown.
    expect(radio('No Markup').checked).toBe(true);
    expect(comments().disabled).toBe(false);
    expect(comments().checked).toBe(true);
    // Outside All Markup, comments print as notes on the text, not in a pane.
    expect(
      view.getByText('Outside All Markup, comments print as notes on the commented text.')
    ).toBeTruthy();
    // The modes follow the Review menu order.
    expect(view.getAllByRole('radio').map((input) => input.parentElement?.textContent)).toEqual([
      'Simple Markup',
      'All Markup',
      'No Markup',
      'Original',
    ]);

    act(() => {
      fireEvent.click(radio('All Markup'));
    });
    expect(
      view.queryByText('Outside All Markup, comments print as notes on the commented text.')
    ).toBeNull();
    act(() => {
      fireEvent.click(comments());
    });
    expect(comments().checked).toBe(false);

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Print' }));
    });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ displayMode: 'all-markup', comments: false });
    // The progress view takes focus from the removed Print button.
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  test(`Cancel on the settings step prints nothing (packaged=${packaged})`, async () => {
    let conversions = 0;
    const view = mount(
      packaged,
      {},
      {
        pdf: async () => {
          conversions++;
          return { bytes: PDF };
        },
      }
    );
    await openPrint(view);
    act(() => {
      fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    });
    expect(view.queryByRole('dialog')).toBeNull();
    expect(conversions).toBe(0);
    expect(printRow(view).disabled).toBe(false);
  });
}

test('printSettings={false} prints the current view without asking', async () => {
  const views: unknown[] = [];
  const view = render(
    <DocxEditorRoot document="blank">
      <DocxEditorMenu
        printSettings={false}
        exporters={{
          pdf: async (_bytes, printed) => {
            views.push(printed);
            return { bytes: PDF };
          },
        }}
      />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await openPrint(view);
  expect(view.queryByRole('radio')).toBeNull();
  expect(views).toHaveLength(1);
  expect(views[0]).not.toHaveProperty('comments');
});

test('a custom print popup gets the settings step only when it opts in', async () => {
  let latest!: DocxEditorPrintDialogProps;
  const popups: DocxEditorPopups = {
    print: definePopup((props: DocxEditorPrintDialogProps) => {
      latest = props;
      return <DocxEditorPrintDialog {...props} />;
    }),
  };
  const pdf = () => new Promise<{ bytes: Uint8Array }>(() => {});
  const view = mount(false, popups, { pdf });
  await openPrint(view);
  expect(latest.choosing).toBe(false);
  expect(latest.pending).toBe(true);
  cleanup();

  const optedIn = render(
    <DocxEditorRoot document="blank" popups={popups}>
      <DocxEditorMenu printSettings exporters={{ pdf }} />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await openPrint(optedIn);
  expect(latest.choosing).toBe(true);
  expect(latest.pending).toBe(false);
  expect(latest.settings).toEqual({ displayMode: 'proposed', comments: true });
  act(() => latest.onSettingsChange?.({ displayMode: 'all-markup' }));
  act(() => latest.onSettingsChange?.({ comments: false }));
  expect(latest.settings).toEqual({ displayMode: 'all-markup', comments: false });
  await act(async () => latest.onPrint?.());
  expect(latest.choosing).toBe(false);
  expect(latest.pending).toBe(true);
});

test('the print shortcut on the settings step starts printing', async () => {
  let conversions = 0;
  const view = mount(
    false,
    {},
    {
      pdf: () => {
        conversions++;
        return new Promise(() => {});
      },
    }
  );
  await openPrint(view);
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    code: 'KeyP',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    view.getByRole('radio', { name: 'No Markup' }).dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(conversions).toBe(1);
  expect(view.getByRole('dialog').getAttribute('aria-label')).toBe('Preparing to print…');
});

test('a double click on Print converts once', async () => {
  let conversions = 0;
  const view = mount(
    false,
    {},
    {
      pdf: () => {
        conversions++;
        return new Promise(() => {});
      },
    }
  );
  await openPrint(view);
  const print = view.getByRole('button', { name: 'Print' });
  await act(async () => {
    fireEvent.click(print);
    fireEvent.click(print);
  });
  expect(conversions).toBe(1);
});

test('an auto-repeated print shortcut does not confirm the settings', async () => {
  let conversions = 0;
  const view = mount(
    false,
    {},
    {
      pdf: () => {
        conversions++;
        return new Promise(() => {});
      },
    }
  );
  await openPrint(view);
  const held = new KeyboardEvent('keydown', {
    key: 'p',
    code: 'KeyP',
    ctrlKey: true,
    repeat: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    view.getByRole('radio', { name: 'No Markup' }).dispatchEvent(held);
  });
  expect(held.defaultPrevented).toBe(true);
  expect(conversions).toBe(0);
  expect(view.getByRole('dialog').getAttribute('aria-label')).toBe('Print');
});
