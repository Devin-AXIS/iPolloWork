// The ruler's four indent handles, as a props component.
//
// Deliberately NOT mounted against a document: the handles are pure props, and the
// engine-side behaviour (the effective read, the hanging-wins collapse, the write) is
// pinned in core's own suite. What is only observable here is the CHROME contract —
// which handles exist, whether they are operable, and what they announce.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { RulerIndent } from '@docx-editor.dev/core/editor';
import { HorizontalRuler, type RulerPageSetup } from '../src/components/ui/HorizontalRuler.tsx';

afterEach(cleanup);

/** US Letter, one-inch margins. */
const PAGE_SETUP = {
  pageWidthTwips: 12240,
  pageHeightTwips: 15840,
  orientation: 'portrait',
  marginsTwips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
} as unknown as RulerPageSetup;

const FLUSH: RulerIndent = { left: 0, right: 0, firstLine: 0 };

function handles(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.docx-ruler-indent')];
}

function labelled(container: HTMLElement, label: string): HTMLElement {
  const found = handles(container).find((h) => h.getAttribute('aria-label') === label);
  if (!found) throw new Error(`no handle labelled ${label}`);
  return found;
}

describe('the four indent handles', () => {
  test('are absent until the host opts in', () => {
    // A ruler with no paragraph context must not show handles pinned at zero.
    const { container } = render(<HorizontalRuler pageSetup={PAGE_SETUP} />);
    expect(handles(container)).toHaveLength(0);
  });

  test('are all four, and announce themselves', () => {
    const { container } = render(
      <HorizontalRuler pageSetup={PAGE_SETUP} showIndentHandles indent={FLUSH} indentEditable />
    );
    expect(handles(container).map((h) => h.getAttribute('aria-label'))).toEqual([
      'First line indent',
      'Hanging indent',
      'Left indent',
      'Right indent',
    ]);
  });

  test('are RENDERED but not operable on a read-only document', () => {
    // Word shows the markers and refuses the drag. Hiding them would remove the only
    // place a reader can see the paragraph's indents.
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={FLUSH}
        indentEditable={false}
      />
    );
    expect(handles(container)).toHaveLength(4);
    for (const handle of handles(container)) {
      expect(handle.getAttribute('aria-disabled')).toBe('true');
      expect(handle.tabIndex).toBe(-1);
    }
  });

  test('carry a value, not just a role', () => {
    // `role="slider"` with no `aria-valuenow` describes nothing; the handles shipped that
    // way before this change.
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={{ left: 720, right: 360, firstLine: -360 }}
        indentEditable
      />
    );
    const left = labelled(container, 'Left indent');
    expect(left.getAttribute('role')).toBe('slider');
    expect(left.getAttribute('aria-valuenow')).toBe('720');
    expect(left.getAttribute('aria-valuetext')).toBe('0.50"');
    expect(labelled(container, 'First line indent').getAttribute('aria-valuetext')).toBe('-0.25"');
  });

  test('the container is a GROUP, since it contains sliders', () => {
    const { container } = render(
      <HorizontalRuler pageSetup={PAGE_SETUP} showIndentHandles indent={FLUSH} indentEditable />
    );
    const ruler = container.querySelector('.docx-horizontal-ruler')!;
    expect(ruler.getAttribute('role')).toBe('group');
  });

  test('the hanging triangle and the left box sit at the same x', () => {
    // Coincident by design, as in Word — they differ in what a drag takes with them, and
    // are separated vertically rather than horizontally so they can both be hit.
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={{ left: 720, right: 0, firstLine: 0 }}
        indentEditable
      />
    );
    expect(labelled(container, 'Hanging indent').style.left).toBe(
      labelled(container, 'Left indent').style.left
    );
  });
});

describe('keyboard operation', () => {
  test('an arrow key nudges a focused handle and commits', () => {
    // A focusable slider that cannot be operated fails WCAG 2.1.1, which is what four
    // `tabIndex=0` handles with no key handler would have shipped.
    const seen: RulerIndent[] = [];
    let commits = 0;
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={FLUSH}
        indentEditable
        onIndentChange={(next) => seen.push(next)}
        onIndentDragEnd={() => (commits += 1)}
      />
    );
    fireEvent.keyDown(labelled(container, 'Left indent'), { key: 'ArrowRight' });
    // One eighth-inch grid step.
    expect(seen).toEqual([{ left: 180, right: 0, firstLine: 0 }]);
    // No drag to release, so a keypress commits on the spot — one undo entry each.
    expect(commits).toBe(1);
  });

  test('Shift makes the nudge fine', () => {
    const seen: RulerIndent[] = [];
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={FLUSH}
        indentEditable
        onIndentChange={(next) => seen.push(next)}
      />
    );
    fireEvent.keyDown(labelled(container, 'Left indent'), { key: 'ArrowRight', shiftKey: true });
    expect(seen[0]!.left).toBe(1);
  });

  test('a read-only handle ignores the key', () => {
    const seen: RulerIndent[] = [];
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={FLUSH}
        indentEditable={false}
        onIndentChange={(next) => seen.push(next)}
      />
    );
    fireEvent.keyDown(labelled(container, 'Left indent'), { key: 'ArrowRight' });
    expect(seen).toEqual([]);
  });

  test('an unrelated key is left alone', () => {
    const seen: RulerIndent[] = [];
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={FLUSH}
        indentEditable
        onIndentChange={(next) => seen.push(next)}
      />
    );
    fireEvent.keyDown(labelled(container, 'Left indent'), { key: 'a' });
    expect(seen).toEqual([]);
  });
});

describe('drag lifecycle', () => {
  test('a press with NO movement commits nothing', () => {
    // The press must not be mistaken for a zero-length drag: that would write an undo
    // entry for a click that changed nothing.
    let commits = 0;
    const seen: RulerIndent[] = [];
    const { container } = render(
      <HorizontalRuler
        pageSetup={PAGE_SETUP}
        showIndentHandles
        indent={FLUSH}
        indentEditable
        onIndentChange={(next) => seen.push(next)}
        onIndentDragEnd={() => (commits += 1)}
      />
    );
    const handle = labelled(container, 'Left indent');
    // happy-dom has no pointer capture; the component guards on its presence.
    (handle as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
    (handle as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture =
      () => {};
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });
    expect(seen).toEqual([]);
    // The release still fires, and the HOST decides an empty pending set is a no-op.
    expect(commits).toBe(1);
  });
});
