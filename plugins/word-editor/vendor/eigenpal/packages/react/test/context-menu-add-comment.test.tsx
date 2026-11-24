// The context menu's Add comment row: its slot, slot ids on overrides, and the
// warnings for overrides that do nothing.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, mock, test } from 'bun:test';
import { useContext, useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ReviewRailContext } from '../src/editor/context.ts';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';
import { testReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>`
  ),
});
const t = (key: string): string => key;

afterEach(cleanup);

/** A mounted review rail that serves comment drafts. */
function FakeRail() {
  const rail = useContext(ReviewRailContext);
  useEffect(() => rail?.register(), [rail?.register]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => rail?.registerCommentDraft(() => {}), [rail]);
  return null;
}

function mount(menu: ReactNode, withRail = true) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      modules={[testReviewModule()]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
        // happy-dom lays nothing out, so the selection has no place on the page by itself.
        (instance as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement =
          () => ({ anchorY: 10 });
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        {withRail ? <FakeRail /> : null}
        {menu}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  act(() => {
    const surface = view.container.querySelector('.docx-paginated-surface')!;
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  return { view, editor: () => instance! };
}

const row = (view: ReturnType<typeof render>, slot: string) =>
  view.container.querySelector<HTMLElement>(`[role="menu"] [data-slot="${slot}"]`);

function capturingWarnings<T>(run: () => T): { result: T; messages: string[] } {
  const warn = mock(() => {});
  const original = console.warn;
  console.warn = warn;
  try {
    const result = run();
    return { result, messages: warn.mock.calls.map((call) => String((call as unknown[])[0])) };
  } finally {
    console.warn = original;
  }
}

test('the row shows only while a review rail is mounted', () => {
  expect(row(mount(<ContextMenu t={t} />).view, 'review.addComment')).not.toBeNull();
  cleanup();
  expect(row(mount(<ContextMenu t={t} />, false).view, 'review.addComment')).toBeNull();
});

test('slotId names a row, the old slot prop still does, with a warning', () => {
  const { result, messages } = capturingWarnings(() =>
    mount(
      <ContextMenu t={t}>
        <ContextMenu.Slot slotId="edit.cut" hidden />
        <ContextMenu.Slot slot="edit.copy" hidden />
      </ContextMenu>
    )
  );
  expect(row(result.view, 'edit.cut')).toBeNull();
  expect(row(result.view, 'edit.copy')).toBeNull();
  expect(messages.some((text) => text.includes('slot="edit.copy"'))).toBe(true);
});

test('a hidden override that names no row warns that it removes nothing', () => {
  const { messages } = capturingWarnings(() =>
    mount(
      <ContextMenu t={t}>
        <ContextMenu.Slot slotId="format.clear" hidden />
      </ContextMenu>
    )
  );
  expect(messages.some((text) => text.includes('"format.clear"'))).toBe(true);
});

test('in viewing mode the row explains itself with the translated viewing hint', () => {
  const { view, editor } = mount(<ContextMenu t={t} />);
  act(() => {
    editor().exec({ type: 'setEditingMode', mode: 'viewing' });
  });
  act(() => {
    const surface = view.container.querySelector('.docx-paginated-surface')!;
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  const addComment = row(view, 'review.addComment')!;
  expect(addComment.getAttribute('aria-disabled')).toBe('true');
  expect(addComment.getAttribute('title')).toBe('editingMode.viewingHint');
});

test('a slot override with no slotId warns that it renders nothing', () => {
  // The props type refuses it; a host composing from untyped data can still reach it.
  const Untyped = ContextMenu.Slot as unknown as (props: { labelKey?: string }) => ReactNode;
  const { messages } = capturingWarnings(() =>
    mount(
      <ContextMenu t={t}>
        <Untyped labelKey="nothing" />
      </ContextMenu>
    )
  );
  expect(messages.some((text) => text.includes('has no slotId'))).toBe(true);
});

test('the deprecated review.comments id still hides the Add comment row, with a warning', () => {
  const { result, messages } = capturingWarnings(() =>
    mount(
      <ContextMenu t={t}>
        <ContextMenu.Slot slotId="review.comments" hidden />
      </ContextMenu>
    )
  );
  expect(row(result.view, 'review.addComment')).toBeNull();
  // The override matched the packaged row, so it is not reported as matching nothing.
  expect(messages.some((text) => text.includes('now "review.addComment"'))).toBe(true);
  expect(messages.some((text) => text.includes('no packaged row'))).toBe(false);
});

test('a replacement under the deprecated review.comments id takes the row in place', () => {
  function HostCommentRow() {
    return (
      <button type="button" role="menuitem" data-testid="host-comment-row">
        Discuss
      </button>
    );
  }
  HostCommentRow.docxRow = 'review.comments';
  const { view } = mount(
    <ContextMenu t={t}>
      <HostCommentRow />
    </ContextMenu>
  );
  const menu = view.container.querySelector('[role="menu"]')!;
  const host = menu.querySelector('[data-testid="host-comment-row"]');
  expect(host).not.toBeNull();
  expect(row(view, 'review.addComment')).toBeNull();
  // In place: right after the link row, not appended after the last row.
  const link = row(view, 'text.link')!;
  const rows = [...menu.querySelectorAll('[data-slot], [data-testid="host-comment-row"]')];
  expect(rows.indexOf(host!)).toBe(rows.indexOf(link) + 1);
});
