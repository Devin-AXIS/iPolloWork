// Chrome mounted in another window (a pop-out opened with `window.open`, or an iframe) listens
// on, measures against, and times through THAT window, not the script's globals.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { useFixedDropdown } from '../src/hooks/useFixedDropdown.ts';
import { download } from '../src/editor/menu/download.ts';
import { createPortal } from 'react-dom';
import { blankDocumentBytes } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useImageInsert } from '../src/editor/images/ImageInsert.tsx';
import { isPoppedOutEditorTarget } from '../src/editor/menu/menu-keyboard.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../src/components/ui/Select.tsx';
import { DocxEditorWindow } from '../src/editor/DocxEditorWindow.tsx';
import { StrictMode } from 'react';

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  cleanup();
  for (const frame of frames.splice(0)) frame.remove();
});

/** A second window with its own document and constructors, as `window.open` would give. */
function popout(): Window & typeof globalThis {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!view || view.document === document) throw new Error('no second window');
  return view;
}

function Dropdown({ onClose }: { onClose: () => void }) {
  const { containerRef, dropdownRef } = useFixedDropdown({ isOpen: true, onClose });
  return (
    <div ref={containerRef} data-testid="trigger">
      <div ref={dropdownRef}>menu</div>
    </div>
  );
}

describe('chrome in another window', () => {
  test('an outside press in the pop-out closes the dropdown; one in the opener does not', () => {
    const view = popout();
    const container = view.document.createElement('div');
    view.document.body.append(container);
    let closed = 0;
    render(<Dropdown onClose={() => (closed += 1)} />, { container });

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(closed).toBe(0);

    act(() => {
      view.document.body.dispatchEvent(new view.PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(closed).toBe(1);
  });

  test('Escape in the pop-out closes the dropdown', () => {
    const view = popout();
    const container = view.document.createElement('div');
    view.document.body.append(container);
    let closed = 0;
    render(<Dropdown onClose={() => (closed += 1)} />, { container });
    act(() => {
      view.document.dispatchEvent(
        new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(closed).toBe(1);
  });

  test('a download creates its link in the owner document', () => {
    const view = popout();
    const owner = view.document.createElement('div');
    view.document.body.append(owner);
    const created: string[] = [];
    const popoutCreate = view.document.createElement.bind(view.document);
    view.document.createElement = ((tag: string) => {
      created.push(`popout:${tag}`);
      const element = popoutCreate(tag);
      // No navigation in the test window: only WHERE the link is made matters.
      element.click = () => {};
      return element;
    }) as typeof view.document.createElement;
    const openerCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      created.push(`opener:${tag}`);
      const element = openerCreate(tag);
      element.click = () => {};
      return element;
    }) as typeof document.createElement;
    try {
      download(new ArrayBuffer(1), 'a.docx', undefined, owner);
    } finally {
      delete (document as { createElement?: unknown }).createElement;
      delete (view.document as { createElement?: unknown }).createElement;
    }
    expect(created).toEqual(['popout:a']);
  });

  test('the image picker opens in the window the editor is in', async () => {
    const view = popout();
    const slot = view.document.createElement('div');
    view.document.body.append(slot);
    let open: (() => void) | null = null;
    let enabled = false;
    function Probe() {
      const insert = useImageInsert();
      open = insert.openFilePicker;
      enabled = insert.isEnabled;
      return null;
    }
    render(
      <DocxEditorRoot document={blankDocumentBytes()}>
        <Probe />
        {createPortal(
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>,
          slot
        )}
      </DocxEditorRoot>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(enabled).toBe(true);
    let clicked: Document | null = null;
    const click = view.HTMLInputElement.prototype.click;
    view.HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      clicked = this.ownerDocument;
    };
    try {
      act(() => open!());
    } finally {
      view.HTMLInputElement.prototype.click = click;
    }
    // Made and clicked in the pop-out's document, where the click gave transient activation.
    expect(clicked).toBe(view.document);
    expect(view.document.querySelector('input[type="file"]')).not.toBeNull();
  });
});

describe('menu shortcuts from a pop-out', () => {
  test('a key in one popped-out editor belongs to that editor only', () => {
    const view = popout();
    const first = view.document.createElement('div');
    const second = view.document.createElement('div');
    const typedIn = view.document.createElement('span');
    second.append(typedIn);
    view.document.body.append(first, second);
    expect(isPoppedOutEditorTarget(typedIn, document, second)).toBe(true);
    expect(isPoppedOutEditorTarget(typedIn, document, first)).toBe(false);
    // An editor in the bar's own window is the bar's ordinary scope test, not this one.
    expect(isPoppedOutEditorTarget(typedIn, view.document, second)).toBe(false);
    expect(isPoppedOutEditorTarget(typedIn, document, null)).toBe(false);
  });
});

describe('select lists in a pop-out', () => {
  test('ArrowDown moves to the next option, not past it', async () => {
    const view = popout();
    const container = view.document.createElement('div');
    view.document.body.append(container);
    render(
      <Select defaultValue="A" defaultOpen>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="A">A</SelectItem>
          <SelectItem value="B">B</SelectItem>
          <SelectItem value="C">C</SelectItem>
        </SelectContent>
      </Select>,
      { container }
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    const options = Array.from(view.document.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options.length).toBe(3);
    options[0]!.focus();
    await act(async () => {
      options[0]!.dispatchEvent(
        new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(view.document.activeElement?.textContent).toBe('B');
  });
});

test('ArrowDown from a freshly opened pop-out list moves from the selected option', async () => {
  const view = popout();
  const container = view.document.createElement('div');
  view.document.body.append(container);
  render(
    <Select defaultValue="B" defaultOpen>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="A">A</SelectItem>
        <SelectItem value="B">B</SelectItem>
        <SelectItem value="C">C</SelectItem>
      </SelectContent>
    </Select>,
    { container }
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  const list = view.document.querySelector<HTMLElement>('[role="listbox"]')!;
  list.focus();
  await act(async () => {
    list.dispatchEvent(
      new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(view.document.activeElement?.textContent).toBe('C');
});

describe('DocxEditor.Window', () => {
  test('StrictMode opens the window once and keeps it open', async () => {
    const view = popout();
    let closes = 0;
    view.close = () => void (closes += 1);
    const original = window.open;
    let opens = 0;
    window.open = (() => ((opens += 1), view)) as typeof window.open;
    try {
      const host = document.createElement('div');
      document.body.append(host);
      render(
        <StrictMode>
          <DocxEditorWindow open>
            <p data-testid="panel">panel</p>
          </DocxEditorWindow>
        </StrictMode>,
        { container: host }
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(opens).toBe(1);
      expect(closes).toBe(0);
      expect(view.document.querySelector('[data-testid="panel"]')).not.toBeNull();
      host.remove();
    } finally {
      window.open = original;
    }
  });

  test('turning open off moves the panel back before the window closes', async () => {
    const view = popout();
    const original = window.open;
    window.open = (() => view) as typeof window.open;
    let backWhenClosed = null as boolean | null;
    const host = document.createElement('div');
    document.body.append(host);
    view.close = () => {
      backWhenClosed = host.querySelector('[data-testid="panel"]') !== null;
    };
    try {
      const { rerender } = render(
        <DocxEditorWindow open>
          <p data-testid="panel">panel</p>
        </DocxEditorWindow>,
        { container: host }
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(view.document.querySelector('[data-testid="panel"]')).not.toBeNull();
      rerender(
        <DocxEditorWindow open={false}>
          <p data-testid="panel">panel</p>
        </DocxEditorWindow>
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(backWhenClosed).toBe(true);
      host.remove();
    } finally {
      window.open = original;
    }
  });

  test('renders in the pop-out while open, and back in place when it closes', async () => {
    const view = popout();
    view.close = () => {};
    const original = window.open;
    window.open = (() => view) as typeof window.open;
    let closed = 0;
    try {
      const host = document.createElement('div');
      document.body.append(host);
      function Panel() {
        return <p data-testid="panel">panel</p>;
      }
      const { rerender } = render(
        <DocxEditorWindow open onClose={() => (closed += 1)}>
          <Panel />
        </DocxEditorWindow>,
        { container: host }
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(view.document.querySelector('[data-testid="panel"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="panel"]')).toBeNull();

      act(() => {
        view.dispatchEvent(new view.Event('pagehide'));
      });
      expect(closed).toBe(1);
      expect(host.querySelector('[data-testid="panel"]')).not.toBeNull();
      rerender(
        <DocxEditorWindow open={false}>
          <Panel />
        </DocxEditorWindow>
      );
      host.remove();
    } finally {
      window.open = original;
    }
  });
});
