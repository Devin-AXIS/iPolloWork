// Which card a RANGE selection opens.
//
// A caret counts both ends of a tracked change, so a caret at either boundary opens the card.
// A range selection is not a caret. Selecting a word that ends where an insertion starts put
// the selection head at the insertion's first offset, and the insertion lit up as active
// although none of its characters were selected.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../index.ts';
import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../store/index.ts';

function engineReviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
    },
  };
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(body: string): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    author: 'Grace Hopper',
    modules: [engineReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

// Offsets: "alpha " 0..6, deleted "gone" 6..10, "beta" 10..14, inserted " added" 14..20,
// " gamma" 20..26.
const BODY = `<w:p>
<w:r><w:t xml:space="preserve">alpha </w:t></w:r>
<w:del w:author="A" w:date="2026-07-08T11:32:00Z" w:id="1"><w:r><w:delText>gone</w:delText></w:r></w:del>
<w:r><w:t>beta</w:t></w:r>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="2"><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins>
<w:r><w:t xml:space="preserve"> gamma</w:t></w:r>
</w:p>`;

function paragraphOf(editor: DocxEditorInstance): string {
  const item = editor.getReviewItems()[0]!.item as {
    ranges: readonly { start: { paragraphId: string } }[];
  };
  return item.ranges[0]!.start.paragraphId;
}

function activeAfter(editor: DocxEditorInstance, anchor: number, head: number): string | null {
  const paragraphId = paragraphOf(editor);
  editor.exec({
    type: 'setSelection',
    range: { anchor: { paragraphId, offset: anchor }, head: { paragraphId, offset: head } },
  });
  const open = editor.getReviewItems().find((entry) => entry.isActive);
  return open ? ((open as { revisionKind?: string }).revisionKind ?? open.kind) : null;
}

describe('range selection beside a tracked change', () => {
  test('a selection that ends where an insertion starts opens nothing', () => {
    const editor = mount(BODY);
    expect(activeAfter(editor, 10, 14)).toBeNull();
    expect(activeAfter(editor, 14, 10)).toBeNull();
    editor.destroy();
  });

  test('a selection that starts where a deletion ends opens nothing', () => {
    const editor = mount(BODY);
    expect(activeAfter(editor, 10, 14)).toBeNull();
    expect(activeAfter(editor, 14, 10)).toBeNull();
    expect(activeAfter(editor, 0, 6)).toBeNull();
    expect(activeAfter(editor, 6, 0)).toBeNull();
    editor.destroy();
  });

  test('a selection after an insertion opens nothing', () => {
    const editor = mount(BODY);
    expect(activeAfter(editor, 20, 26)).toBeNull();
    expect(activeAfter(editor, 26, 20)).toBeNull();
    editor.destroy();
  });

  test('a selection that shares characters with a change opens it', () => {
    const editor = mount(BODY);
    expect(activeAfter(editor, 10, 15)).toBe('insert');
    expect(activeAfter(editor, 16, 15)).toBe('insert');
    expect(activeAfter(editor, 14, 20)).toBe('insert');
    expect(activeAfter(editor, 20, 14)).toBe('insert');
    expect(activeAfter(editor, 26, 19)).toBe('insert');
    expect(activeAfter(editor, 12, 9)).toBe('delete');
    editor.destroy();
  });

  test('the head still decides, so a selection reaching past a change opens nothing', () => {
    // A select-all must not open whichever card it happens to cross.
    const editor = mount(BODY);
    expect(activeAfter(editor, 15, 10)).toBeNull();
    expect(activeAfter(editor, 0, 26)).toBeNull();
    editor.destroy();
  });

  test('a caret at either boundary still opens the change', () => {
    const editor = mount(BODY);
    expect(activeAfter(editor, 14, 14)).toBe('insert');
    expect(activeAfter(editor, 20, 20)).toBe('insert');
    editor.destroy();
  });
});
