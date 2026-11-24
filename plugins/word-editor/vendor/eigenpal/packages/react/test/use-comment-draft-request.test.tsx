// `useCommentDraftRequest` and the `review.addComment` control: a host's own Add comment button
// is enabled only while something can open the draft, the packaged rail's registration still
// serves it, and unmounting either one disables it again.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, mock, test } from 'bun:test';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { en } from '@docx-editor.dev/i18n';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ReviewRailContext } from '../src/editor/context.ts';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';
import { useCommentDraftRequest } from '../src/editor/useCommentDraftRequest.ts';
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

afterEach(cleanup);

/** A host's own Add comment button over the slot. */
function HostButton() {
  const addComment = useEditorCommand('review.addComment');
  return (
    <button
      type="button"
      data-testid="host-add-comment"
      disabled={!addComment.isEnabled}
      title={addComment.disabledReason ?? ''}
      onClick={() => addComment.execute()}
    >
      Add comment
    </button>
  );
}

/** A host's own comment UI that serves the drafts. */
function HostDraft({ onDraft }: { onDraft: () => void }) {
  useCommentDraftRequest(onDraft);
  return null;
}

/** A mounted review rail that serves comment drafts through the registry. */
function FakeRail({ onDraft }: { onDraft: () => void }) {
  const rail = useContext(ReviewRailContext);
  useEffect(() => rail?.register(), [rail?.register]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => rail?.registerCommentDraft(onDraft), [rail, onDraft]);
  return null;
}

let show: ((value: boolean) => void) | null = null;

function Toggle({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  show = setVisible;
  return visible ? <>{children}</> : null;
}

function mount(server: ReactNode) {
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
      <HostButton />
      <Toggle>{server}</Toggle>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const button = () => view.getByTestId('host-add-comment') as HTMLButtonElement;
  return { view, button, editor: () => instance! };
}

test('with nothing to open the draft, the host button is disabled with a reason', async () => {
  const { button, editor } = mount(null);
  await waitFor(() => expect(editor()?.surface).toBeTruthy());
  expect(button().disabled).toBe(true);
  expect(button().title).toBe(en.disabledReason.noCommentDraftView);
});

test('useCommentDraftRequest enables the button, serves the press, and unmounting disables it', async () => {
  const onDraft = mock(() => {});
  const { button, editor } = mount(<HostDraft onDraft={onDraft} />);
  await waitFor(() => expect(editor()?.surface).toBeTruthy());
  await waitFor(() => expect(button().disabled).toBe(false));
  await act(async () => {
    button().click();
  });
  expect(onDraft).toHaveBeenCalledTimes(1);
  await act(async () => {
    show!(false);
  });
  await waitFor(() => expect(button().disabled).toBe(true));
  expect(button().title).toBe(en.disabledReason.noCommentDraftView);
});

test('a review rail registered through the registry still serves the press', async () => {
  const onDraft = mock(() => {});
  const { button, editor } = mount(<FakeRail onDraft={onDraft} />);
  await waitFor(() => expect(editor()?.surface).toBeTruthy());
  await waitFor(() => expect(button().disabled).toBe(false));
  await act(async () => {
    button().click();
  });
  expect(onDraft).toHaveBeenCalledTimes(1);
  await act(async () => {
    show!(false);
  });
  await waitFor(() => expect(button().disabled).toBe(true));
});
