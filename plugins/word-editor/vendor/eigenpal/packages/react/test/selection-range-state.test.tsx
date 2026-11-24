// `useEditorState((s) => s.selectionRange)`: the caret as a paragraph id and offset, live.
//
// The slice is reference-stable while the selection does not move, so a consumer re-renders
// for a caret move inside one paragraph and not for an unrelated change such as zoom.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useDocxEditor } from '../src/editor/context.ts';
import { useEditorState } from '../src/editor/useEditorState.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>`
  ),
});

afterEach(cleanup);

const selectRange = (snapshot: EditorSnapshot) => snapshot.selectionRange;

/** Run an editor call, then let the deferred state notifications land inside `act`. */
async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test('a selectionRange consumer re-renders for caret moves only', async () => {
  let editor: DocxEditorInstance | null = null;
  const offsets: (number | null)[] = [];
  function CaretProbe() {
    editor = useDocxEditor();
    const range = useEditorState(selectRange);
    offsets.push(range ? range.head.offset : null);
    return null;
  }
  render(
    <DocxEditorRoot document={SOURCE}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <CaretProbe />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await settle(() => {});
  const paragraphId = editor!.surface!.session.paragraphIds()[0]!;
  const caret = (offset: number) => {
    const at = { blockId: paragraphId, offset };
    expect(editor!.exec({ type: 'setSelection', range: { anchor: at, head: at } }).ok).toBe(true);
  };
  await settle(() => caret(3));
  expect(offsets.at(-1)).toBe(3);
  await settle(() => caret(7));
  expect(offsets.at(-1)).toBe(7);
  expect(editor!.snapshot().selectionRange?.head).toEqual({ blockId: paragraphId, offset: 7 });
  const renders = offsets.length;
  await settle(() => expect(editor!.setZoom(1.5).ok).toBe(true));
  expect(editor!.snapshot().zoom).toBe(1.5);
  expect(offsets.length).toBe(renders);
});
