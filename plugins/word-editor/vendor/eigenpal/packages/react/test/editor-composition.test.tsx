// The provider-first React composition layer (Tier 3): Root/Viewport/Content + hooks.
//
// What these pin down, against the REAL engine (happy-dom, painted pages, committed
// ops): the Root owns the facade's lifetime and survives StrictMode's double-invoked
// effects; Content attaches the mount point and the pages appear; `useEditorState`
// re-renders a consumer ONLY when its slice moves; `useEditorCommand` is live state
// plus a safe action; the sugar `<DocxEditor>` remains the same seven-member-ref host
// it was before it became sugar; and the server-snapshot path answers without a DOM.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

// React's `act` refuses to run outside an act-configured environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { StrictMode, createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type {
  Editor,
  EditorSnapshot,
  FontConfiguration,
} from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot, provideDocxEditor } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorPageNumber } from '../src/editor/DocxEditorPageNumber.tsx';
import { useDocxEditor } from '../src/editor/context.ts';
import { useEditorState } from '../src/editor/useEditorState.ts';
import { useEditorCommand, type EditorCommandState } from '../src/editor/useEditorCommand.ts';
import { useEditorEvent } from '../src/editor/useEditorEvent.ts';
import { useEditorCaret, type EditorCaret } from '../src/editor/useEditorCaret.ts';
import { useReviewAuthors } from '../src/editor/useReviewAuthors.ts';
import {
  DocxEditorColorByChangeType,
  DocxEditorAuthorStyle,
} from '../src/editor/DocxEditorAuthorStyle.tsx';
import type { DocxEditorRef } from '../src/types.ts';

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

/** Stable selectors, so the memoization under test is the cross-event one. */
const selectPage = (snapshot: EditorSnapshot) => snapshot.page;

afterEach(() => {
  cleanup();
});

describe('DocxEditor.Root lifecycle', () => {
  test('creates the facade, paints through Content, and destroys on unmount — StrictMode safe', () => {
    const ready: Editor[] = [];
    const view = render(
      <StrictMode>
        <DocxEditorRoot document={SOURCE} onReady={(editor) => ready.push(editor)}>
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
        </DocxEditorRoot>
      </StrictMode>
    );
    // StrictMode double-invokes the mount effect: the first instance is destroyed by
    // its own cleanup and never announced; exactly one editor reaches the tree.
    expect(ready.length).toBe(1);
    // Content attached under the Viewport: the engine painted real pages, and its
    // scroller discovery finds the Viewport's scroll-container class above the surface.
    expect(view.container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    expect(view.container.textContent).toContain('hello world');
    const surface = view.container.querySelector('.docx-paginated-surface')!;
    expect(surface.closest('.docx-editor__scroll-container')).not.toBeNull();

    view.unmount();
    expect(document.querySelectorAll('.docx-page').length).toBe(0);
  });

  test('useDocxEditor answers null outside a Root and pre-mount, never throwing', () => {
    let seen: unknown = 'unset';
    function Probe() {
      seen = useDocxEditor();
      return null;
    }
    render(<Probe />);
    expect(seen).toBeNull();
  });

  test('provideDocxEditor composes a Root and exposes its live instance', () => {
    let seen: DocxEditorInstance | null = null;
    function Host() {
      const provided = provideDocxEditor({ document: SOURCE });
      seen = provided.editorRef;
      const Root = provided.DocxEditorRoot;
      return (
        <Root {...provided.rootProps} {...provided.rootListeners}>
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
        </Root>
      );
    }
    const view = render(<Host />);
    expect(seen).not.toBeNull();
    expect(view.container.querySelector('.docx-page')).not.toBeNull();
  });
});

describe('useEditorState', () => {
  test('re-renders a consumer only when its slice changes', async () => {
    let pageRenders = 0;
    let instance: DocxEditorInstance | null = null;
    function PageProbe() {
      pageRenders += 1;
      const page = useEditorState(selectPage);
      return <span data-testid="page-count">{`${page.current} / ${page.total}`}</span>;
    }
    function BoldProbe() {
      const bold = useEditorCommand('text.bold');
      return (
        <button
          data-testid="bold"
          aria-pressed={bold.isActive}
          disabled={!bold.isEnabled}
          onClick={bold.execute}
        />
      );
    }
    const view = render(
      <DocxEditorRoot
        document={SOURCE}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <PageProbe />
        <BoldProbe />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const editor = instance!;
    expect(view.getByTestId('page-count').textContent).toBe('1 / 1');

    // Store notifications are normally coalesced to a microtask (see useEditorState), so async
    // act is what flushes them.
    await act(async () => {
      editor.surface!.selectAll();
    });
    const rendersBeforeBold = pageRenders;

    const bold = view.getByTestId('bold') as HTMLButtonElement;
    expect(bold.disabled).toBe(false);
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      bold.click();
    });
    // The bold consumer saw its slice move…
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(editor.getSelectionFormatting()?.bold).toBe(true);
    // …while the page consumer's slice (the reference-stable `page` sub-object of the
    // version-cached snapshot) did not, so it did not re-render.
    expect(pageRenders).toBe(rendersBeforeBold);
  });

  test('outside a Root it answers the frozen loading snapshot', () => {
    let page: EditorSnapshot['page'] | null = null;
    let loading = false;
    function Bare() {
      page = useEditorState(selectPage);
      loading = useEditorState((snapshot) => snapshot.isLoading);
      return null;
    }
    render(<Bare />);
    expect(page).toEqual({ current: 0, total: 0 });
    expect(loading).toBe(true);
  });

  test('server rendering takes the server-snapshot path without a DOM editor', () => {
    function Probe() {
      const page = useEditorState(selectPage);
      return <span>{`${page.current} / ${page.total}`}</span>;
    }
    const html = renderToString(
      <DocxEditorRoot>
        <Probe />
      </DocxEditorRoot>
    );
    expect(html).toContain('0 / 0');
  });
});

describe('useEditorCommand', () => {
  test('an unwired slot is disabled with the engine reason and execute is a safe no-op', () => {
    let binding: EditorCommandState | null = null;
    let instance: DocxEditorInstance | null = null;
    function Probe() {
      binding = useEditorCommand('zoom.level');
      return null;
    }
    render(
      <DocxEditorRoot
        document={SOURCE}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <Probe />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(binding!.isEnabled).toBe(false);
    expect(binding!.disabledReason).toBe('This control is not connected to an editor command');
    expect(binding!.isActive).toBe(false);
    const before = instance!.surface!.session.bodyText();
    expect(() =>
      act(() => {
        binding!.execute();
      })
    ).not.toThrow();
    expect(instance!.surface!.session.bodyText()).toBe(before);
  });
});

describe('useEditorEvent', () => {
  test('subscribes for the component lifetime and calls the latest handler', () => {
    const changes: number[] = [];
    let instance: DocxEditorInstance | null = null;
    function Probe() {
      useEditorEvent('change', (change) => {
        changes.push(change.revision);
      });
      return null;
    }
    render(
      <DocxEditorRoot
        document={SOURCE}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <Probe />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const countAfterMount = changes.length;
    act(() => {
      instance!.exec({ type: 'insertText', text: 'X' });
    });
    expect(changes.length).toBe(countAfterMount + 1);
  });

  test('reports the paragraphs an edit changed', () => {
    const changed: string[][] = [];
    let instance: DocxEditorInstance | null = null;
    function Probe() {
      useEditorEvent('paragraphsChange', (event) => {
        changed.push([...event.changed]);
      });
      return null;
    }
    render(
      <DocxEditorRoot
        document={SOURCE}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <Probe />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(changed).toEqual([]);
    act(() => {
      instance!.exec({ type: 'insertText', text: 'X' });
    });
    const [first] = instance!.getParagraphs();
    expect(changed).toEqual([[first!.blockId]]);
  });
});

describe('useEditorCaret', () => {
  test('names the caret paragraph as the selection read does', () => {
    const carets: Array<EditorCaret | null> = [];
    let instance: DocxEditorInstance | null = null;
    function Probe() {
      carets.push(useEditorCaret());
      return null;
    }
    render(
      <DocxEditorRoot
        document={SOURCE}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <Probe />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    act(() => {
      instance!.focus();
      instance!.exec({ type: 'insertText', text: 'X' });
    });
    const caret = carets.at(-1)!;
    const head = instance!.getSelectionRange()!.head;
    expect(caret).toEqual({
      blockId: head.blockId,
      paragraphId: head.blockId,
      offset: head.offset,
    });
  });
});

describe('the sugar <DocxEditor> (namespace + ref parity)', () => {
  test('the namespace statics ARE the primitives', () => {
    expect(DocxEditor.Root).toBe(DocxEditorRoot);
    expect(DocxEditor.Viewport).toBe(DocxEditorViewport);
    expect(DocxEditor.Content).toBe(DocxEditorContent);
    expect(DocxEditor.PageNumber).toBe(DocxEditorPageNumber);
  });

  test('the target provider-first usage works through the namespace', async () => {
    let instance: DocxEditorInstance | null = null;
    function Capture() {
      instance = useDocxEditor();
      return null;
    }
    function MyToolbar() {
      const bold = useEditorCommand('text.bold');
      const page = useEditorState(selectPage);
      return (
        <>
          <button
            data-testid="ns-bold"
            aria-pressed={bold.isActive}
            disabled={!bold.isEnabled}
            onClick={bold.execute}
          />
          <span data-testid="ns-page">{`${page.current} / ${page.total}`}</span>
        </>
      );
    }
    const view = render(
      <DocxEditor.Root document={SOURCE}>
        <Capture />
        <MyToolbar />
        <DocxEditor.Viewport>
          <DocxEditor.Content />
        </DocxEditor.Viewport>
      </DocxEditor.Root>
    );
    expect(view.getByTestId('ns-page').textContent).toBe('1 / 1');
    // A collapsed caret is live too: pressing Bold there arms the stored-marks lane
    // (formatting for the next characters typed), so the control never greys out at a
    // caret the way it does over an unwritable selection.
    expect((view.getByTestId('ns-bold') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      instance!.surface!.selectAll();
    });
    expect((view.getByTestId('ns-bold') as HTMLButtonElement).disabled).toBe(false);
    expect(view.container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
  });

  test('the sugar component still satisfies the seven-member imperative ref', async () => {
    const ref = createRef<DocxEditorRef>();
    render(
      <DocxEditor ref={ref} document={SOURCE} fonts={undefined as unknown as FontConfiguration} />
    );
    const handle = ref.current!;
    expect(Object.keys(handle).sort()).toEqual(
      ['exec', 'focus', 'getDocumentHandle', 'getEditor', 'load', 'save', 'snapshot'].sort()
    );
    expect(handle.getEditor()).not.toBeNull();
    expect(handle.snapshot().page).toEqual({ current: 1, total: 1 });
    expect(handle.snapshot().isLoading).toBe(false);
    act(() => {
      expect(handle.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    });
    const buffer = await handle.save();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    act(() => {
      handle.focus();
    });
    expect(handle.getDocumentHandle()).not.toBeNull();
  });
});

describe('declarative revision styles', () => {
  const TRACKED = docx(
    '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
      '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
  );
  const ink = (view: { container: HTMLElement }) =>
    view.container.querySelector<HTMLElement>('.docx-revision')?.style.color;

  test('AuthorStyle overrides one author; unmounting returns them to the ramp', async () => {
    const view = render(
      <DocxEditorRoot document={TRACKED}>
        <DocxEditorAuthorStyle author="Ada Lovelace" color="var(--brand-ada)" />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    // Declared at mount, so it reached the engine as construction config: the FIRST paint
    // is already styled, with no pass in the kind colours.
    expect(ink(view)).toBe('var(--brand-ada)');
    await act(async () => {
      view.rerender(
        <DocxEditorRoot document={TRACKED}>
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
        </DocxEditorRoot>
      );
    });
    // Later changes are coalesced into one write at the end of the effect flush, so this
    // lands a microtask after the unmount rather than synchronously with it.
    expect(ink(view)).toBe('var(--doc-review-author-0)');
  });

  test('a changed colour is one repaint, with no pass through the kind colours', async () => {
    const seen: string[] = [];
    const view = render(
      <DocxEditorRoot document={TRACKED}>
        <DocxEditorAuthorStyle author="Ada Lovelace" color="var(--brand-one)" />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    // React runs a changed declaration as cleanup-then-effect. Unbatched, the cleanup would
    // take the document to the kind colours and the effect would bring it back — two full
    // repaints and a visible flash for every step of a colour-picker drag.
    await act(async () => {
      view.rerender(
        <DocxEditorRoot document={TRACKED}>
          <DocxEditorAuthorStyle author="Ada Lovelace" color="var(--brand-two)" />
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
        </DocxEditorRoot>
      );
      seen.push(ink(view) ?? '');
    });
    expect(seen).toEqual(['var(--brand-one)']);
    expect(ink(view)).toBe('var(--brand-two)');
  });

  test('by default an author takes the ramp, with no declaration at all', () => {
    const view = render(
      <DocxEditorRoot document={TRACKED}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(ink(view)).toBe('var(--doc-review-author-0)');
  });

  test('ColorByChangeType opts out to the kind colours while mounted', () => {
    const view = render(
      <DocxEditorRoot document={TRACKED}>
        <DocxEditorColorByChangeType />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(ink(view)).toBe('var(--doc-revision-insertion)');
  });
});

describe('useReviewAuthors', () => {
  const TRACKED_SOURCE = docx(
    '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
      '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
  );

  test('lists the loaded document’s authors and follows setRevisionStyles live', async () => {
    let instance: DocxEditorInstance | null = null;
    function Legend() {
      const authors = useReviewAuthors();
      return (
        <div data-testid="legend">
          {authors.map((entry) => `${entry.author}:${entry.color}`).join('|')}
        </div>
      );
    }
    const view = render(
      <DocxEditorRoot
        document={TRACKED_SOURCE}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <Legend />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    // Discovery: the authors come from the FILE, so the legend could not have been
    // configured — it reads them.
    expect(view.getByTestId('legend').textContent).toBe('Ada Lovelace:var(--doc-review-author-0)');
    // Live: a colour picker's write re-renders the legend without any remount.
    await act(async () => {
      instance!.setRevisionStyles({ authors: { 'Ada Lovelace': '#7c3aed' } });
    });
    expect(view.getByTestId('legend').textContent).toBe('Ada Lovelace:#7c3aed');
  });
});

describe('the opening mode through the composable Root', () => {
  // The engine's mode semantics are pinned in core; what THESE tests pin is the ADAPTER:
  // the Root forwards an explicit `mode` (and forwards nothing when the prop is omitted,
  // which is what lets the document decide), and the sugar keeps its opinionated default.
  test("mode='view' reaches the facade: read-only, and every write is refused", () => {
    let instance: Editor | null = null;
    render(
      <DocxEditorRoot
        document={SOURCE}
        mode="view"
        onReady={(editor) => {
          instance = editor;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(instance!.getEditingMode()).toBe('viewing');
    expect(instance!.snapshot().editable).toBe(false);
    expect(instance!.exec({ type: 'insertText', text: 'X' }).ok).toBe(false);
  });

  test('omitted on the Root, a document that asks for nothing opens editing; the sugar defaults to edit', () => {
    let composed: Editor | null = null;
    render(
      <DocxEditorRoot
        document={SOURCE}
        onReady={(editor) => {
          composed = editor;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(composed!.getEditingMode()).toBe('editing');

    const ref = createRef<DocxEditorRef>();
    render(<DocxEditor ref={ref} document={SOURCE} />);
    expect(ref.current!.getEditor()!.getEditingMode()).toBe('editing');
  });
});
