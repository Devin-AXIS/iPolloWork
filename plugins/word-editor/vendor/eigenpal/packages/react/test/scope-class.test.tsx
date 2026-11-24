// `.docx-editor` must identify exactly ONE element: the editor's own root.
//
// The class is the Tailwind scope (the `important` strategy in
// packages/core/tailwind.dist.config.cjs) and the carrier of the `--doc-*`
// tokens, so a chrome part rendered with no scoped ancestor has to add it
// itself — `DocxEditor.Root` is container-less, so in the composition path
// there is no ancestor to inherit from.
//
// Under the packaged `<DocxEditor>` there IS one, and the parts adding it again
// put `.docx-editor` on four more elements. That broke ordinary consumer CSS:
//
//   .my-shell .docx-editor { height: 100% }
//
// is the rule the docs ask a host to write ("give it a box with a real
// height"), and it silently matched the toolbar and menu bar too, stretching
// the toolbar to the full editor height while the page area collapsed to zero.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { ScopedByAncestorContext } from '../src/editor/scope-context.ts';

afterEach(cleanup);

const scoped = (root: HTMLElement) => root.querySelectorAll('.docx-editor');

describe('the .docx-editor scope class', () => {
  test('a chrome part with no scoped ancestor scopes itself', () => {
    // The composition path: `Root` renders providers and no DOM node, so the
    // toolbar is the only thing that can carry the class.
    const { container } = render(
      <DocxEditorRoot>
        <DocxEditorToolbar />
      </DocxEditorRoot>
    );
    expect(scoped(container).length).toBe(1);
    expect(container.querySelector('.docx-toolbar')).toHaveProperty('className');
    expect(container.querySelector('.docx-toolbar')?.className).toContain('docx-editor');
  });

  test('a chrome part inside a scoped ancestor does NOT repeat the class', () => {
    const { container } = render(
      <DocxEditorRoot>
        {/* Stands in for the packaged host's wrapper, which carries the class
            and announces it. */}
        <div className="docx-editor">
          <ScopedByAncestorContext.Provider value={true}>
            <DocxEditorToolbar />
            <DocxEditorMenu />
          </ScopedByAncestorContext.Provider>
        </div>
      </DocxEditorRoot>
    );

    // Exactly the wrapper — not the toolbar, not the menu bar.
    expect(scoped(container).length).toBe(1);
    expect(container.querySelector('.docx-toolbar')?.className).not.toContain('docx-editor');
    expect(container.querySelector('.docx-menubar')?.className).not.toContain('docx-editor');
  });

  test('a consumer sizing rule cannot reach past the root', () => {
    // The regression itself, expressed the way a host writes it.
    const { container } = render(
      <DocxEditorRoot>
        <div className="my-shell">
          <div className="docx-editor">
            <ScopedByAncestorContext.Provider value={true}>
              <DocxEditorToolbar />
            </ScopedByAncestorContext.Provider>
          </div>
        </div>
      </DocxEditorRoot>
    );
    const matches = container.querySelectorAll('.my-shell .docx-editor');
    expect(matches.length).toBe(1);
    expect(matches[0]?.classList.contains('docx-toolbar')).toBe(false);
  });
});
