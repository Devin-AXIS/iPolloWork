// `DocxEditor.OpenFailure` — the dialog for a file the editor refused to open.
//
// What these pin down: nothing shows for a document that opens; a refused open shows the
// packaged generic message and the stable code; Close hides it and a later refusal of the
// same bytes shows it again; the host can replace the message, hide the code, and add its
// own actions; `<DocxEditor>` mounts it by default and `openFailure={false}` removes it;
// `useOpenFailure` gives a host the same state for its own UI.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { blankDocumentBytes } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useDocxEditor } from '../src/editor/context.ts';
import { DocxEditorOpenFailure, useOpenFailure } from '../src/editor/DocxEditorOpenFailure.tsx';

const BROKEN = strToU8('not a zip');
const DIALOG = '[data-docx-dialog="openFailure"]';

afterEach(() => {
  cleanup();
});

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(DIALOG);
}

function CaptureEditor({ onEditor }: { onEditor: (editor: DocxEditorInstance) => void }) {
  const editor = useDocxEditor();
  if (editor) onEditor(editor as DocxEditorInstance);
  return null;
}

describe('DocxEditor.OpenFailure', () => {
  test('shows nothing for a document that opens', () => {
    render(
      <DocxEditorRoot document={blankDocumentBytes()}>
        <DocxEditorOpenFailure />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(dialog()).toBeNull();
  });

  test('a refused open shows the generic message and the stable code', () => {
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const el = dialog();
    expect(el).not.toBeNull();
    expect(el!.getAttribute('role')).toBe('alertdialog');
    expect(el!.textContent).toContain('This file did not open');
    expect(el!.textContent).toContain('The file could not be read.');
    expect(el!.textContent).toContain('Error code: open.zip-corrupt');
    expect(el!.textContent).not.toContain('@');
  });

  test('Close hides it, and a later refusal of the same bytes shows it again', async () => {
    let editor: DocxEditorInstance | null = null;
    const dismissed: string[] = [];
    render(
      <DocxEditorRoot document={BROKEN}>
        <CaptureEditor onEditor={(e) => (editor = e)} />
        <DocxEditorOpenFailure onDismiss={(failure) => dismissed.push(failure.code)} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const close = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Close');
    act(() => fireEvent.click(close!));
    expect(dialog()).toBeNull();
    expect(dismissed).toEqual(['open.zip-corrupt']);

    await act(async () => editor!.load(BROKEN));
    expect(dialog()).not.toBeNull();

    await act(async () => editor!.load(blankDocumentBytes()));
    expect(dialog()).toBeNull();
  });

  test('the host replaces the message, hides the code, and adds its own action', () => {
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure
          title="We could not open that"
          message={(failure) => `Reason: ${failure.reason}`}
          showCode={false}
          actions={({ failure }) => <a href={`/help?code=${failure.code}`}>Get help</a>}
        />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const el = dialog()!;
    expect(el.textContent).toContain('We could not open that');
    expect(el.textContent).toContain('Reason: damaged');
    expect(el.textContent).not.toContain('Error code');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/help?code=open.zip-corrupt');
  });

  test('Action styles host buttons and links, and can close the dialog', () => {
    const clicks: string[] = [];
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure
          closeLabel="Not now"
          actions={({ failure }) => (
            <>
              <DocxEditorOpenFailure.Action asChild>
                <a href={`/help?code=${failure.code}`}>Get help</a>
              </DocxEditorOpenFailure.Action>
              <DocxEditorOpenFailure.Action
                variant="primary"
                dismiss
                onClick={() => clicks.push(failure.code)}
              >
                Report
              </DocxEditorOpenFailure.Action>
            </>
          )}
        />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const el = dialog()!;
    const link = el.querySelector('a')!;
    expect(link.className).toBe('docx-dialog__button');
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Report', 'Not now']);
    expect(buttons[0]!.className).toContain('docx-dialog__button--primary');
    // Beside the host's own action, Close is outlined.
    expect(buttons[1]!.className).not.toContain('--primary');
    act(() => fireEvent.click(buttons[0]!));
    expect(clicks).toEqual(['open.zip-corrupt']);
    expect(dialog()).toBeNull();
  });

  test('an Action whose handler prevents default keeps the dialog open', () => {
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure
          showClose={false}
          actions={() => (
            <DocxEditorOpenFailure.Action dismiss onClick={(event) => event.preventDefault()}>
              Stay
            </DocxEditorOpenFailure.Action>
          )}
        />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const buttons = [...dialog()!.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Stay']);
    act(() => fireEvent.click(buttons[0]!));
    expect(dialog()).not.toBeNull();
  });

  test('Escape closes it and calls onDismiss', () => {
    const dismissed: string[] = [];
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure onDismiss={(failure) => dismissed.push(failure.code)} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    act(() => {
      dialog()!.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(dialog()).toBeNull();
    expect(dismissed).toEqual(['open.zip-corrupt']);
  });

  test('children replace the packaged content and receive dismiss', () => {
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure>
          {({ message, dismiss }) => (
            <button type="button" onClick={dismiss}>
              {message}
            </button>
          )}
        </DocxEditorOpenFailure>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const button = dialog()!.querySelector('button')!;
    expect(button.textContent).toContain('The file could not be read.');
    act(() => fireEvent.click(button));
    expect(dialog()).toBeNull();
  });

  test('is reachable as a namespace static', () => {
    expect(DocxEditor.OpenFailure).toBe(DocxEditorOpenFailure);
    expect(DocxEditor.OpenFailure.Action).toBeDefined();
  });
});

describe('<DocxEditor openFailure>', () => {
  test('mounts the dialog by default, with and without chrome', () => {
    const view = render(<DocxEditor document={BROKEN} />);
    expect(dialog()).not.toBeNull();
    view.unmount();
    render(<DocxEditor document={BROKEN} chrome={false} />);
    expect(dialog()).not.toBeNull();
  });

  test('passes an object through to the part', () => {
    render(<DocxEditor document={BROKEN} openFailure={{ title: 'Custom title' }} />);
    expect(dialog()!.textContent).toContain('Custom title');
  });

  test('openFailure={false} removes it', () => {
    render(<DocxEditor document={BROKEN} openFailure={false} />);
    expect(dialog()).toBeNull();
  });
});

describe('open-failure dialog details', () => {
  test('the message describes the alert, and a backdrop click does not close it', () => {
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const el = dialog()!;
    const id = el.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)!.textContent).toContain('The file could not be read.');
    act(() => fireEvent.click(el));
    expect(dialog()).not.toBeNull();
  });

  test('actions that render nothing leave Close as the primary button', () => {
    render(
      <DocxEditorRoot document={BROKEN}>
        <DocxEditorOpenFailure actions={() => <>{false}</>} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(dialog()!.querySelector('button')!.className).toContain('--primary');
  });

  test('keeps its token scope when the colour mode changes while it is open', () => {
    const view = render(<DocxEditor document={BROKEN} colorMode="light" />);
    expect(dialog()!.classList.contains('docx-editor')).toBe(true);
    view.rerender(<DocxEditor document={BROKEN} colorMode="dark" />);
    expect(dialog()!.classList.contains('docx-editor')).toBe(true);
    expect(dialog()!.classList.contains('dark')).toBe(true);
  });

  test('renderOpenFailureActions adds buttons to the packaged dialog', () => {
    render(
      <DocxEditor
        document={BROKEN}
        renderOpenFailureActions={() => (
          <DocxEditor.OpenFailure.Action variant="primary">Mine</DocxEditor.OpenFailure.Action>
        )}
      />
    );
    const labels = [...dialog()!.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Mine', 'Close']);
  });
});

describe('a stale dismiss', () => {
  test('does not hide a newer refusal', async () => {
    let editor: DocxEditorInstance | null = null;
    let api: ReturnType<typeof useOpenFailure> | null = null;
    function Probe() {
      api = useOpenFailure();
      return null;
    }
    render(
      <DocxEditorRoot document={BROKEN}>
        <CaptureEditor onEditor={(e) => (editor = e)} />
        <Probe />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const first = api!.failure!;
    await act(async () => editor!.load(BROKEN));
    const second = api!.failure!;
    expect(second).not.toBe(first);
    act(() => api!.dismiss(first));
    expect(api!.failure).toBe(second);
    act(() => api!.dismiss(second));
    expect(api!.failure).toBeNull();
  });
});

describe('a crashed open', () => {
  test('shows the dialog instead of unmounting the editor', () => {
    const throwingReview = {
      id: 'review',
      review: {
        displayModes: ['all-markup', 'proposed', 'original'] as const,
        collectReviewItems: () => {
          throw new Error('review failed');
        },
        revisionItemsOfParagraph: () => [],
      },
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      render(<DocxEditor document={blankDocumentBytes()} modules={[throwingReview as never]} />);
    } finally {
      console.error = original;
    }
    const el = dialog();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('Something went wrong while opening this file.');
    expect(el!.textContent).toContain('open.failed');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('useOpenFailure', () => {
  test('gives a host the failure and the packaged message for its own UI', () => {
    function Toast() {
      const { failure, message, dismiss } = useOpenFailure();
      if (!failure) return null;
      return (
        <div role="alert">
          {message} ({failure.code})
          <button type="button" onClick={dismiss}>
            x
          </button>
        </div>
      );
    }
    const view = render(
      <DocxEditorRoot document={BROKEN}>
        <Toast />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const alert = view.getByRole('alert');
    expect(alert.textContent).toContain('The file could not be read. ');
    expect(alert.textContent).toContain('(open.zip-corrupt)');
    act(() => fireEvent.click(view.getByText('x')));
    expect(view.queryByRole('alert')).toBeNull();
  });
});
