// The packaged frame's chrome band: the title bar and the toolbar sit on ONE
// `--doc-surface` surface, and the seam that closes it is under the TOOLBAR.
//
// The regression this pins: the seam used to be a border under the title bar,
// which cut the band in two and left the toolbar with no ground of its own. The
// toolbar paints a rounded pill, so flush against the band's edges the radius
// never showed and the row read as a second flat bar. Hosts worked around it
// with their own wrapper; the composed demo in `examples/vite` is where this
// layout came from.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { DocxEditor } from '../src/components/DocxEditor.tsx';

afterEach(cleanup);

const band = (container: HTMLElement) => {
  const toolbar = container.querySelector('.docx-toolbar');
  // toolbar -> inset row -> band
  return toolbar?.parentElement?.parentElement ?? null;
};

describe('the packaged frame chrome band', () => {
  test('title bar and toolbar share one surface', () => {
    const { container } = render(<DocxEditor />);
    const surface = band(container);
    expect(surface).not.toBeNull();
    expect(surface!.style.backgroundColor).toBe('var(--doc-surface)');
    // The menu bar lives in the title bar, so finding it under the same box is
    // what proves the two rows are one band and not siblings.
    expect(surface!.querySelector('.docx-menubar')).not.toBeNull();
  });

  test('the seam closes the band under the toolbar, not under the title bar', () => {
    const { container } = render(<DocxEditor />);
    const surface = band(container);
    expect(surface!.style.borderBottomWidth).toBe('1px');
    expect(surface!.style.borderBottomColor).toBe('var(--doc-border)');
    expect(surface!.style.boxShadow).toBe('0 1px 3px var(--doc-shadow-subtle)');

    // The title bar is the band's first row and carries no seam of its own.
    const titleBar = surface!.firstElementChild as HTMLElement;
    expect(titleBar.querySelector('.docx-menubar')).not.toBeNull();
    expect(titleBar.style.borderBottomWidth).toBe('');
    expect(titleBar.style.backgroundColor).toBe('');
  });

  test('the toolbar is inset, so its pill sits on the band', () => {
    const { container } = render(<DocxEditor />);
    const row = container.querySelector('.docx-toolbar')!.parentElement as HTMLElement;
    expect(row.style.padding).toBe('8px 12px');
  });

  test('the ruler row stays outside the band, on the workspace', () => {
    const { container } = render(<DocxEditor />);
    const rulerRow = container.querySelector<HTMLElement>('[data-testid="docx-editor-ruler-row"]');
    expect(rulerRow).not.toBeNull();
    expect(band(container)!.contains(rulerRow!)).toBe(false);
    expect(rulerRow!.style.backgroundColor).toBe('var(--doc-bg)');
  });

  test('chrome={false} renders no band at all', () => {
    const { container } = render(<DocxEditor chrome={false} />);
    expect(container.querySelector('.docx-toolbar')).toBeNull();
  });

  // The band is a stacking context, so it caps every popup inside it. A literal
  // below the chrome band (40) put the font picker and the File menu UNDER the
  // open navigation pane (#522); the overlay token keeps them above it.
  test('the band stacks in the overlay band, above ambient chrome', () => {
    const { container } = render(<DocxEditor />);
    expect(band(container)!.style.zIndex).toBe('var(--doc-z-overlay)');
  });
});
