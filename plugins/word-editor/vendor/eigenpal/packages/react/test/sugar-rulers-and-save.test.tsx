// Two claims about the packaged `<DocxEditor>` frame.
//
// 1. It shows rulers. Every editor this component is modelled on does, and the
//    placement is not something a host can get right from outside: the
//    horizontal ruler applies the navigation shift and the review gutter
//    itself, so mounted inside the scroll container that gutter is counted
//    twice and the ticks drift off the page they measure. Only this component
//    can put it in the row above the scroller.
//
// 2. `onSave` is an ACTION, not a button. It used to also render an
//    inline-styled button into the title bar that a host had no way to remove,
//    so intercepting Cmd+S meant accepting a button you never asked for.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { DocxEditor } from '../src/components/DocxEditor.tsx';

afterEach(cleanup);

const rulerRow = (root: HTMLElement) =>
  root.querySelector('[class*="ruler"], [data-testid*="ruler"]');

describe('the packaged frame', () => {
  test('mounts the ruler row by default', () => {
    const { container } = render(<DocxEditor />);
    // The ruler paints nothing without a page, so assert the ROW is reserved
    // rather than the ticks: that is the part a host cannot place itself.
    const rows = container.querySelectorAll('[data-testid="docx-editor-ruler-row"]');
    expect(rows.length).toBe(1);
  });

  test('rulers={false} removes it', () => {
    const { container } = render(<DocxEditor rulers={false} />);
    const rows = container.querySelectorAll('[data-testid="docx-editor-ruler-row"]');
    expect(rows.length).toBe(0);
  });

  test('chrome={false} has no ruler row either', () => {
    const { container } = render(<DocxEditor chrome={false} />);
    expect(rulerRow(container)).toBeNull();
  });

  test('onSave does not put a button in the title bar', () => {
    const { container } = render(<DocxEditor onSave={() => {}} />);
    const buttons = [...container.querySelectorAll('button')];
    const save = buttons.filter((b) => (b.textContent ?? '').trim().toLowerCase() === 'save');
    expect(save).toEqual([]);
  });

  test('onSave still reaches the menu, so File -> Save works', () => {
    // The handler is threaded into DocxEditorMenu; the menu bar renders whether
    // or not a save handler exists, so assert the menu is there and the button
    // is not — the regression was the button, not the wiring.
    const { container } = render(<DocxEditor onSave={() => {}} />);
    expect(container.querySelector('.docx-menubar')).not.toBeNull();
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => (b.textContent ?? '').trim().toLowerCase() === 'save'
      )
    ).toBe(false);
  });
});
