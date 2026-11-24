// The snapshot's `table` sub-object stays the same reference while the caret's table context
// holds the same values, as `formatting` and `page` do. Typing in a cell must not hand every
// table control a new object on every keystroke.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

function tableDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `<w:tr>${cell('a1')}${cell('b1')}</w:tr><w:tr>${cell('a2')}${cell('b2')}</w:tr></w:tbl>` +
        '<w:p><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>'
    ),
  });
}

test('typing in a table cell keeps the snapshot table context reference', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: tableDocx() });
  try {
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset: 1 }, head: { paragraphId, offset: 1 } });
    const before = editor.snapshot().table;
    expect(before).toMatchObject({ rows: 2, columns: 2, rowIndex: 0, columnIndex: 0 });
    surface.type('x');
    surface.layout();
    expect(editor.snapshot().table).toBe(before);
    // A move to another cell is a new context.
    const next = surface.session.paragraphIds()[1]!;
    surface.setSelection({
      anchor: { paragraphId: next, offset: 0 },
      head: { paragraphId: next, offset: 0 },
    });
    expect(editor.snapshot().table).toMatchObject({ rowIndex: 0, columnIndex: 1 });
    expect(editor.snapshot().table).not.toBe(before);
  } finally {
    editor.destroy();
    container.remove();
  }
});
