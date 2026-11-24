// React zoom shortcuts: editor-scoped key handling on the viewport, never a document listener.
//
// Mounted against the real editor so the assertions prove the keystrokes reach `Editor.setZoom`
// through a focused `.docx-pages` surface, and that non-shortcut targets still fall through.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

function mountShortcutHarness(includeInput = false): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
  pages: () => HTMLElement;
  viewport: () => HTMLElement;
  zoomText: () => string | null;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar />
      <DocxEditorViewport>
        {includeInput ? <input data-testid="viewport-input" type="text" /> : null}
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return {
    view,
    editor: () => instance!,
    pages: () => view.container.querySelector('.docx-pages') as HTMLElement,
    viewport: () =>
      view.container.querySelector('[data-testid="docx-editor-scroll"]') as HTMLElement,
    zoomText: () =>
      view.container.querySelector('[data-slot="zoom.level"] .docx-toolbar__stepper-value')
        ?.textContent ?? null,
  };
}

async function dispatchShortcut(
  target: EventTarget,
  init: Pick<KeyboardEventInit, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

function dispatchShortcutSync(
  target: EventTarget,
  init: Pick<KeyboardEventInit, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

async function setZoom(
  mounted: ReturnType<typeof mountShortcutHarness>,
  level: number
): Promise<void> {
  await act(async () => {
    mounted.editor().setZoom(level);
  });
  expect(mounted.zoomText()).toBe(`${Math.round(level * 100)}%▾`);
}

afterEach(() => {
  cleanup();
});

describe('React zoom shortcuts', () => {
  test('zoom-in shortcuts on the focused pages layer drive the editor for Ctrl and Meta', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();
    act(() => {
      pages.focus();
    });

    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = await dispatchShortcut(pages, { key: '=', ...modifier });
      expect(event.defaultPrevented).toBe(true);
      expect(mounted.editor().snapshot().zoom).toBe(1.25);
      expect(mounted.zoomText()).toBe('125%▾');
      await setZoom(mounted, 1);
    }
  });

  test('two synchronous zoom-in shortcuts advance from the editor-s current zoom before React rerenders', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();
    let first!: KeyboardEvent;
    let second!: KeyboardEvent;
    act(() => {
      pages.focus();
      first = dispatchShortcutSync(pages, { key: '=', ctrlKey: true });
      second = dispatchShortcutSync(pages, { key: '=', ctrlKey: true });
    });
    await act(async () => {});

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(mounted.editor().snapshot().zoom).toBe(1.5);
    expect(mounted.zoomText()).toBe('150%▾');
  });

  test('zoom-out and reset shortcuts step through the preset ladder', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();

    act(() => {
      pages.focus();
    });
    await setZoom(mounted, 1.25);
    const zoomOut = await dispatchShortcut(pages, { key: '-', ctrlKey: true });
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(mounted.editor().snapshot().zoom).toBe(1);
    expect(mounted.zoomText()).toBe('100%▾');

    await setZoom(mounted, 1.5);
    const reset = await dispatchShortcut(pages, { key: '0', ctrlKey: true });
    expect(reset.defaultPrevented).toBe(true);
    expect(mounted.editor().snapshot().zoom).toBe(1);
    expect(mounted.zoomText()).toBe('100%▾');
  });

  test('zoom-out at the ladder floor stays owned and keeps the zoom capped', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();
    act(() => {
      pages.focus();
    });

    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      await setZoom(mounted, 0.25);
      const event = await dispatchShortcut(pages, { key: '-', ...modifier });
      expect(event.defaultPrevented).toBe(true);
      expect(mounted.editor().snapshot().zoom).toBe(0.25);
      expect(mounted.zoomText()).toBe('25%▾');
    }
  });

  // 25% exists so this rung is reachable. A floored `'auto'` fit sits exactly on 50%, and
  // with 50% as the ladder's bottom every zoom-out affordance was dead in precisely the
  // case the floor exists for: a narrow screen with the comments rail open.
  test('zoom-out at the auto floor still has somewhere to go', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();
    act(() => {
      pages.focus();
    });
    await setZoom(mounted, 0.5);

    await dispatchShortcut(pages, { key: '-', ctrlKey: true });

    expect(mounted.editor().snapshot().zoom).toBe(0.25);
  });

  test('unrelated and Alt-modified keystrokes do not change zoom', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();
    act(() => {
      pages.focus();
    });

    const unrelated = await dispatchShortcut(pages, { key: 'x', ctrlKey: true });
    expect(unrelated.defaultPrevented).toBe(false);
    expect(mounted.editor().snapshot().zoom).toBe(1);

    const altModified = await dispatchShortcut(pages, { key: '=', metaKey: true, altKey: true });
    expect(mounted.editor().snapshot().zoom).toBe(1);
    // Dispatched on the viewport, where the zoom handler is the ONLY listener: Alt+Cmd+= is
    // an engine gesture, so the fact that nothing here prevented it is the assertion.
    const onViewport = await dispatchShortcut(mounted.viewport(), {
      key: '=',
      metaKey: true,
      altKey: true,
    });
    expect(onViewport.defaultPrevented).toBe(false);
    expect(mounted.editor().snapshot().zoom).toBe(1);
  });

  test('zoom shortcuts ignore a focused input child inside the viewport', async () => {
    const mounted = mountShortcutHarness(true);
    const input = mounted.view.getByTestId('viewport-input') as HTMLInputElement;
    act(() => {
      input.focus();
    });

    const event = await dispatchShortcut(input, { key: '=', ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(mounted.editor().snapshot().zoom).toBe(1);
  });

  // ZOOM WINS on Ctrl/Cmd + `=` / `+`. The engine keymap binds the same chord to
  // subscript/superscript, and both firing meant one keystroke zoomed AND rewrote the
  // selection's run properties. The zoom handler claims the event in the CAPTURE phase and
  // the keymap fails soft on an already-claimed one, so the mutation never happens.
  test('a zoom shortcut over a range selection zooms without scripting the selection', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();
    const editor = mounted.editor();
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    act(() => {
      pages.focus();
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 5 },
      });
    });
    const revisionBefore = editor.surface!.state().revision;

    const subscriptChord = await dispatchShortcut(pages, { key: '=', ctrlKey: true });

    expect(subscriptChord.defaultPrevented).toBe(true);
    expect(editor.snapshot().zoom).toBe(1.25);
    expect(editor.snapshot().formatting?.subscript).toBe(false);
    expect(editor.snapshot().formatting?.superscript).toBe(false);
    // No document edit at all: the revision is where it was and there is nothing to undo.
    expect(editor.surface!.state().revision).toBe(revisionBefore);
    expect(editor.can({ type: 'undo' }).ok).toBe(false);

    // The shifted spelling is Word's SUPERSCRIPT chord and reports `+` on a US layout.
    const superscriptChord = await dispatchShortcut(pages, {
      key: '+',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(superscriptChord.defaultPrevented).toBe(true);
    expect(editor.snapshot().zoom).toBe(1.5);
    expect(editor.snapshot().formatting?.superscript).toBe(false);
    expect(editor.snapshot().formatting?.subscript).toBe(false);
    expect(editor.surface!.state().revision).toBe(revisionBefore);
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
  });

  test('two mounted editors zoom independently', async () => {
    const first = mountShortcutHarness();
    const second = mountShortcutHarness();
    act(() => {
      second.pages().focus();
    });

    await dispatchShortcut(second.pages(), { key: '=', ctrlKey: true });

    expect(second.editor().snapshot().zoom).toBe(1.25);
    expect(second.zoomText()).toBe('125%▾');
    expect(first.editor().snapshot().zoom).toBe(1);
    expect(first.zoomText()).toBe('100%▾');
    expect(first.editor()).not.toBe(second.editor());
  });

  test('zoom-in at 200% stays owned and keeps the zoom capped', async () => {
    const mounted = mountShortcutHarness();
    const pages = mounted.pages();
    act(() => {
      pages.focus();
    });
    await setZoom(mounted, 2);

    const event = await dispatchShortcut(pages, { key: '+', ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(mounted.editor().snapshot().zoom).toBe(2);
    expect(mounted.zoomText()).toBe('200%▾');
  });
});
