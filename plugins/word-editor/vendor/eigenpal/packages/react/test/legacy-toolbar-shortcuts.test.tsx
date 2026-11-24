// The exported legacy `Toolbar`'s own accelerators, and who owns a chord when two handlers
// want it.
//
// This component registers a `document`-level keydown listener in the BUBBLE phase and binds
// Word's Ctrl/Cmd `=` pair itself. `DocxEditor.Viewport` claims the same chord for live zoom
// during CAPTURE, which runs first — so a host that mounts this toolbar around the new viewport
// used to get the zoom AND the subscript toggle from one keystroke. The listener fails soft on
// an already-claimed event, like the shared engine keymap does.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { Toolbar, type FormattingAction } from '../src/components/Toolbar.tsx';

function Harness({ onFormat }: { onFormat: (action: FormattingAction) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <Toolbar onFormat={onFormat} editorRef={editorRef} />
      <div ref={editorRef} data-testid="editor-surface" />
    </>
  );
}

function mountLegacyToolbar(): {
  readonly actions: FormattingAction[];
  readonly surface: () => HTMLElement;
} {
  const actions: FormattingAction[] = [];
  const view = render(<Harness onFormat={(action) => actions.push(action)} />);
  return {
    actions,
    surface: () => view.getByTestId('editor-surface'),
  };
}

/** A keystroke inside the editor container, optionally claimed first the way zoom claims it. */
function press(
  target: HTMLElement,
  init: Pick<KeyboardEventInit, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  claimed = false
): KeyboardEvent {
  // The claim is a CAPTURE listener on the document, which is the phase order a host gets:
  // `DocxEditor.Viewport`'s `onKeyDownCapture` runs before this component's bubble listener.
  const claim = (event: Event): void => event.preventDefault();
  if (claimed) document.addEventListener('keydown', claim, true);
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  try {
    act(() => {
      target.dispatchEvent(event);
    });
  } finally {
    if (claimed) document.removeEventListener('keydown', claim, true);
  }
  return event;
}

afterEach(() => {
  cleanup();
});

describe('the legacy Toolbar accelerators', () => {
  test('an already-claimed Ctrl/Cmd = applies no script formatting', () => {
    const toolbar = mountLegacyToolbar();

    const subscriptChord = press(toolbar.surface(), { key: '=', ctrlKey: true }, true);
    const superscriptChord = press(
      toolbar.surface(),
      { key: '=', ctrlKey: true, shiftKey: true },
      true
    );
    const metaChord = press(toolbar.surface(), { key: '=', metaKey: true }, true);

    expect(subscriptChord.defaultPrevented).toBe(true);
    expect(superscriptChord.defaultPrevented).toBe(true);
    expect(metaChord.defaultPrevented).toBe(true);
    expect(toolbar.actions).toEqual([]);
  });

  test('an unclaimed chord still reaches subscript and superscript', () => {
    const toolbar = mountLegacyToolbar();

    press(toolbar.surface(), { key: '=', ctrlKey: true });
    press(toolbar.surface(), { key: '=', ctrlKey: true, shiftKey: true });

    expect(toolbar.actions).toEqual(['subscript', 'superscript']);
  });

  test('an unclaimed bold chord still reaches bold, so the guard is not a blanket refusal', () => {
    const toolbar = mountLegacyToolbar();

    const claimed = press(toolbar.surface(), { key: 'b', ctrlKey: true }, true);
    press(toolbar.surface(), { key: 'b', ctrlKey: true });

    expect(claimed.defaultPrevented).toBe(true);
    expect(toolbar.actions).toEqual(['bold']);
  });
});
