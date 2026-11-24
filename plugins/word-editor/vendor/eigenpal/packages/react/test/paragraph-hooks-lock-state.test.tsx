// The ruler and paragraph dialog hooks follow the caret into and out of protected content.
import './dom-setup.ts';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useParagraphIndent } from '../src/editor/useParagraphIndent.ts';
import { useParagraphFormat } from '../src/editor/useParagraphFormat.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const doc = (body: string) =>
  zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
const LOCKED =
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
  '<w:p><w:r><w:t>Locked title</w:t></w:r></w:p></w:sdtContent></w:sdt>';
const BOUND =
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:dataBinding w:storeItemID="{1}" w:xpath="/a"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>Bound title</w:t></w:r></w:p></w:sdtContent></w:sdt>';
const BOUND_LOCKED =
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="contentLocked"/>' +
  '<w:dataBinding w:storeItemID="{1}" w:xpath="/a"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>Bound title</w:t></w:r></w:p></w:sdtContent></w:sdt>';
const FREE = '<w:p><w:r><w:t>Free text</w:t></w:r></w:p>';

afterEach(cleanup);

let seen: { indent: boolean; format: boolean }[] = [];
function Probe() {
  const indent = useParagraphIndent();
  const format = useParagraphFormat();
  seen.push({ indent: indent.isEnabled, format: format.isEnabled });
  return null;
}

// Indents and alignment pass a content lock, and a data binding mirrors only the text, so the
// ruler and the dialog stay available in both, as in a binding that also locks its content.
for (const [name, first] of [
  ['a content lock', LOCKED],
  ['a data binding', BOUND],
  ['a data binding with a content lock', BOUND_LOCKED],
] as const) {
  test(`ruler and dialog state follow the caret out of and back into ${name}`, async () => {
    seen = [];
    let editor: DocxEditorInstance | null = null;
    render(
      <DocxEditorRoot
        document={doc(first + FREE)}
        onReady={(ready) => (editor = ready as DocxEditorInstance)}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <Probe />
      </DocxEditorRoot>
    );
    for (let attempt = 0; attempt < 50 && !editor; attempt += 1) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    const mounted = editor! as DocxEditorInstance;
    const ids = mounted.surface!.session.paragraphIds();
    const put = async (index: number) => {
      await act(async () => {
        const at = { paragraphId: ids[index]!, offset: 1 };
        mounted.surface!.setSelection({ anchor: at, head: at });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      return seen.at(-1)!;
    };
    expect(await put(0)).toEqual({ indent: true, format: true });
    expect(await put(1)).toEqual({ indent: true, format: true });
    expect(await put(0)).toEqual({ indent: true, format: true });
    // A real refusal: the document open for viewing takes both away, in and out of the control.
    await act(async () => {
      expect(mounted.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(await put(0)).toEqual({ indent: false, format: false });
    expect(await put(1)).toEqual({ indent: false, format: false });
  });
}
