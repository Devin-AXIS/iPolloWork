// `editorInstanceScope`: the instance scope, distinct from the styling scope.
//
// The chrome parts self-emit `.docx-editor` (styling), so a bare `closest('.docx-editor')` from
// inside the toolbar or menu bar matches the part's own root — which contains no pages —
// and Cmd+S scoping and focus-return silently broke. This pins the climb: past
// styling-only roots to the container that actually holds the painted pages.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';
import { editorInstanceScope } from '@docx-editor.dev/core/editor';

import { afterEach, describe, expect, test } from 'bun:test';

function el(className: string, parent: Element): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  parent.appendChild(node);
  return node;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('editorInstanceScope', () => {
  test('climbs past a self-scoped chrome root to the instance container', () => {
    // The packaged arrangement: wrapper(.docx-editor) > [toolbar(.docx-editor), viewport(.docx-editor) > pages]
    const wrapper = el('docx-editor', document.body);
    const toolbar = el('docx-editor docx-toolbar', wrapper);
    const button = el('docx-toolbar__button', toolbar);
    const viewport = el('docx-editor docx-editor-viewport', wrapper);
    el('docx-pages', viewport);

    // From inside the toolbar: NOT the toolbar's own styling root — the wrapper.
    expect(editorInstanceScope(button)).toBe(wrapper);
    expect(editorInstanceScope(toolbar)).toBe(wrapper);
    // From inside the viewport the viewport itself qualifies; it contains the pages.
    expect(editorInstanceScope(viewport)).toBe(viewport);
  });

  test('a bare composition with no instance container resolves to null', () => {
    const toolbar = el('docx-editor docx-toolbar', document.body);
    const button = el('docx-toolbar__button', toolbar);
    expect(editorInstanceScope(button)).toBeNull();
    expect(editorInstanceScope(null)).toBeNull();
  });
});
