import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '../docx-editor.ts';

function dateDocx(): Uint8Array {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml':
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/settings" Target="settings.xml"/></Relationships>`,
        'word/settings.xml': `<w:settings xmlns:w="${w}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
        'word/document.xml': `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Date"/><w:textInput><w:type w:val="date"/><w:default w:val="01/02/2030"/><w:format w:val="MM/dd/yyyy"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>01/02/2030</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p></w:body></w:document>`,
      }).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
}

function setup(locale: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, locale, document: dateDocx() });
  expect(editor.snapshot().parseError).toBeNull();
  return {
    editor,
    select(start: number, end = start) {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: start },
        head: { paragraphId, offset: end },
      });
    },
    text: () =>
      paragraphTextOf(editor.surface!.session.part(), editor.surface!.session.paragraphIds()[0]!),
    cleanup() {
      editor.destroy();
      container.remove();
    },
  };
}

test('locale changes flush buffered input under its original region, with undo and reload preservation', () => {
  const host = setup('en-GB');
  try {
    host.select(0, 10);
    host.editor.surface!.pasteRich('1/2/203', null);
    host.editor.surface!.enqueueType('0');
    host.editor.setLocale('en-US');
    host.select(13);
    expect(host.text()).toBe('02/01/2030 tail');
    host.editor.surface!.undo();
    expect(host.text()).toBe('1/2/2030 tail');
    host.editor.surface!.redo();
    expect(host.text()).toBe('02/01/2030 tail');
    const bytes = host.editor.surface!.session.save();
    host.editor.setLocale('pl-PL');
    host.editor.load(bytes);
    host.select(0);
    host.select(13);
    expect(host.text()).toBe('02/01/2030 tail');
    host.select(0, 10);
    host.editor.surface!.pasteRich('02.03.2030', null);
    host.select(13);
    expect(host.text()).toBe('03/02/2030 tail');
  } finally {
    host.cleanup();
  }
});

test('explicitly replacing a date with identical characters still parses new regional input', () => {
  const host = setup('en-GB');
  try {
    host.select(0, 10);
    host.editor.surface!.pasteRich('01/02/2030', null);
    host.select(13);
    expect(host.text()).toBe('02/01/2030 tail');
  } finally {
    host.cleanup();
  }
});

test('undo restores a stored date without reinterpreting it on exit', () => {
  const host = setup('en-GB');
  try {
    host.select(0, 10);
    host.editor.surface!.pasteRich('03/04/2030', null);
    host.editor.surface!.undo();
    host.select(13);
    expect(host.text()).toBe('01/02/2030 tail');
  } finally {
    host.cleanup();
  }
});

test('redo restores unfinished date input with the locale it was entered under', () => {
  const host = setup('en-GB');
  try {
    host.select(0, 10);
    host.editor.surface!.pasteRich('03/04/2030', null);
    host.editor.surface!.undo();
    host.editor.setLocale('en-US');
    host.editor.surface!.redo();
    host.select(13);
    expect(host.text()).toBe('04/03/2030 tail');
  } finally {
    host.cleanup();
  }
});

test('undoing date formatting restores the input locale for a later commit', () => {
  const host = setup('en-GB');
  try {
    host.select(0, 10);
    host.editor.surface!.pasteRich('03/04/2030', null);
    host.select(13);
    expect(host.text()).toBe('04/03/2030 tail');
    host.editor.setLocale('en-US');
    host.editor.surface!.undo();
    expect(host.text()).toBe('03/04/2030 tail');
    host.select(0);
    host.select(13);
    expect(host.text()).toBe('04/03/2030 tail');
  } finally {
    host.cleanup();
  }
});
