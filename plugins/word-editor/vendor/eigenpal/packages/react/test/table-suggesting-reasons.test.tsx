// In suggesting mode, the context menu's Delete table row is disabled with the engine's
// reason in the reader's language, not the engine's English sentence.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { en } from '@docx-editor.dev/i18n';
import { reviewModule } from '../../pro/src/index';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const TABLE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>' +
      '</w:body></w:document>'
  ),
});

afterEach(cleanup);

test('Delete table in suggesting mode is disabled with the localized reason', () => {
  let editor: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={TABLE}
      modules={[reviewModule()]}
      author="Reviewer"
      onReady={(ready) => {
        editor = ready as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <ContextMenu t={(key: string) => key} />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  act(() => {
    editor!.setEditingMode('suggesting');
    const paragraphId = editor!.surface!.session.paragraphIds()[0]!;
    editor!.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
  });
  act(() => {
    const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface')!;
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  const row = view.container.querySelector<HTMLElement>(
    '.docx-contextmenu [data-slot="table.deleteTable"]'
  )!;
  expect(row.getAttribute('aria-disabled')).toBe('true');
  expect(row.getAttribute('title')).toBe(en.disabledReason.tableDeleteSuggesting);
});
