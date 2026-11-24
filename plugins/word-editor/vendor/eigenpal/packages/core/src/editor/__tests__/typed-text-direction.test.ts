import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { typedTextDirection } from '../surface-typed-direction.ts';

// Letters typed in a right-to-left script start a `w:rtl` run, as a right-to-left keyboard
// marks them. Other text keeps the direction of the run it joins.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
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
}

function withEditor(body: string, run: (editor: DocxEditorInstance) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  try {
    run(editor);
  } finally {
    editor.destroy();
    container.remove();
  }
}

/** The first paragraph's runs as `text|rtl` or `text|ltr`. */
function runs(editor: DocxEditorInstance): string[] {
  const paragraph = editor
    .surface!.session.part()
    .root.children[0]!.children.find((node) => node.kind === 'paragraph') as Extract<
    OoxmlNode,
    { kind: 'paragraph' }
  >;
  return paragraph.children.flatMap((child) => {
    if (child.kind !== 'run') return [];
    const rPr = child.children.find((node) => node.kind === 'runProperties');
    const rtl =
      rPr !== undefined &&
      rPr.kind !== 'textValue' &&
      rPr.children.some((node) => node.kind !== 'textValue' && node.localName === 'rtl');
    const text = child.children
      .flatMap((node) => (node.kind === 'text' ? node.children : []))
      .map((node) => (node.kind === 'textValue' ? node.value : ''))
      .join('');
    return [`${text}|${rtl ? 'rtl' : 'ltr'}`];
  });
}

/** The first paragraph's runs as `text|propertyName,propertyName`. */
function runProperties(editor: DocxEditorInstance): string[] {
  const paragraph = editor
    .surface!.session.part()
    .root.children[0]!.children.find((node) => node.kind === 'paragraph') as Extract<
    OoxmlNode,
    { kind: 'paragraph' }
  >;
  return paragraph.children.flatMap((child) => {
    if (child.kind !== 'run') return [];
    const rPr = child.children.find((node) => node.kind === 'runProperties');
    const names =
      rPr && rPr.kind !== 'textValue'
        ? rPr.children.flatMap((node) => (node.kind !== 'textValue' ? [node.localName] : []))
        : [];
    const text = child.children
      .flatMap((node) => (node.kind === 'text' ? node.children : []))
      .map((node) => (node.kind === 'textValue' ? node.value : ''))
      .join('');
    return [`${text}|${[...names].sort().join(',')}`];
  });
}

function caretAt(editor: DocxEditorInstance, offset: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

const run = (text: string, rtl = false) =>
  `<w:r>${rtl ? '<w:rPr><w:rtl/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('typedTextDirection', () => {
  test('the first letter decides', () => {
    expect(typedTextDirection('مرحبا')).toBe('rtl');
    expect(typedTextDirection('שלום')).toBe('rtl');
    expect(typedTextDirection(' 12 مرحبا')).toBe('rtl');
    expect(typedTextDirection('abc مرحبا')).toBe('ltr');
    expect(typedTextDirection('漢字')).toBe('ltr');
  });

  test('digits, spaces, and punctuation decide nothing', () => {
    expect(typedTextDirection('12 ')).toBeNull();
    expect(typedTextDirection('٣٤')).toBeNull();
    expect(typedTextDirection('.,؟')).toBeNull();
  });
});

describe('typing', () => {
  test('Arabic letters typed into a left-to-right run start a right-to-left run', () => {
    withEditor(`<w:p><w:pPr><w:bidi/></w:pPr>${run('Hello ')}</w:p>`, (editor) => {
      caretAt(editor, 6);
      editor.surface!.type('مرحبا');
      expect(runs(editor)).toEqual(['Hello |ltr', 'مرحبا|rtl']);
    });
  });

  test('Hebrew letters typed in the middle of a run split it', () => {
    withEditor(`<w:p>${run('abcd')}</w:p>`, (editor) => {
      caretAt(editor, 2);
      editor.surface!.type('שלום');
      expect(runs(editor)).toEqual(['ab|ltr', 'שלום|rtl', 'cd|ltr']);
    });
  });

  test('right-to-left letters typed into a right-to-left run add nothing', () => {
    withEditor(`<w:p><w:pPr><w:bidi/></w:pPr>${run('مرحبا ', true)}</w:p>`, (editor) => {
      caretAt(editor, 6);
      editor.surface!.type('بالعالم');
      expect(runs(editor)).toEqual(['مرحبا بالعالم|rtl']);
    });
  });

  test('Latin letters and digits keep the direction of the run they join', () => {
    withEditor(`<w:p>${run('مرحبا ', true)}${run('Hello ')}</w:p>`, (editor) => {
      caretAt(editor, 6);
      editor.surface!.type('test 12');
      caretAt(editor, 19);
      editor.surface!.type('34');
      expect(runs(editor)).toEqual(['مرحبا test 12|rtl', 'Hello 34|ltr']);
    });
  });

  test('one undo removes the typed text and its direction', () => {
    withEditor(`<w:p>${run('Hello ')}</w:p>`, (editor) => {
      caretAt(editor, 6);
      editor.surface!.type('مرحبا');
      editor.surface!.undo();
      expect(runs(editor)).toEqual(['Hello |ltr']);
    });
  });

  test('typed right-to-left letters keep the formatting of the run they join', () => {
    const bold =
      '<w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t xml:space="preserve">Hello </w:t></w:r>';
    withEditor(`<w:p>${bold}</w:p>`, (editor) => {
      caretAt(editor, 6);
      editor.surface!.type('مرحبا');
      expect(runProperties(editor)).toEqual(['Hello |b,sz', 'مرحبا|b,rtl,sz']);
    });
  });

  test('typed right-to-left letters keep a caret format armed before them', () => {
    withEditor(`<w:p>${run('Hello ')}</w:p>`, (editor) => {
      caretAt(editor, 6);
      editor.surface!.toggleRunProperty('b');
      editor.surface!.type('مرحبا');
      expect(runProperties(editor).at(-1)).toBe('مرحبا|b,rtl');
    });
  });

  test('right-to-left letters typed over a selection start a right-to-left run', () => {
    withEditor(`<w:p>${run('Hello world')}</w:p>`, (editor) => {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 6 },
        head: { paragraphId, offset: 11 },
      });
      editor.surface!.type('مرحبا');
      expect(runs(editor)).toEqual(['Hello |ltr', 'مرحبا|rtl']);
    });
  });
});
