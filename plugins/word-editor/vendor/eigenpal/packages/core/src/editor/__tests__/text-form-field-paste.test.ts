import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { findNode, paragraphTextOf, textFormFieldsOf } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const field =
  '<w:bookmarkStart w:id="1" w:name="Input"/><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Input"/><w:textInput><w:default w:val="ABCDE"/><w:maxLength w:val="5"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>ABCDE</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="1"/>';

function setup(protectedForm = false, wrapped = false, adjacent = false, fieldXml = field) {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">${protectedForm ? '<w:documentProtection w:edit="forms" w:enforcement="1"/>' : ''}</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">Left </w:t></w:r>${wrapped ? `<w:smartTag>${fieldXml}</w:smartTag>` : fieldXml}${adjacent ? field.replaceAll('ABCDE', 'XYZ').replaceAll('w:val="Input"', 'w:val="Second"').replaceAll('w:name="Input"', 'w:name="Second"').replaceAll('w:id="1"', 'w:id="2"') : ''}<w:r><w:t xml:space="preserve"> right</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(result.reason);
  const surface = result.surface;
  const paragraphId = surface.session.paragraphIds()[0]!;
  return {
    surface,
    pages: container.querySelector<HTMLElement>('.docx-pages')!,
    paragraphId,
    caret(offset: number) {
      const point = { paragraphId, offset };
      surface.setSelection({ anchor: point, head: point });
    },
    text: () => paragraphTextOf(surface.session.part(), paragraphId),
    fields: () => {
      const p = findNode(surface.session.part(), paragraphId);
      if (p?.kind !== 'paragraph') throw new Error('paragraph');
      return textFormFieldsOf(p);
    },
    cleanup() {
      surface.destroy();
      container.remove();
    },
  };
}

for (const [label, input, start, end, expected] of [
  ['whole overflow', '123456789', 5, 10, '12345'],
  ['short', '123', 5, 10, '123'],
  ['partial overflow', '123456789', 6, 9, 'A123E'],
  ['unicode overflow', '😀😀😀😀😀😀', 5, 10, '😀😀😀😀😀'],
] as const) {
  test(`protected field paste ${label} preserves its definition and undo`, () => {
    const host = setup(true, true);
    try {
      const definition = host.fields()[0]!;
      host.surface.setSelection({
        anchor: { paragraphId: host.paragraphId, offset: start },
        head: { paragraphId: host.paragraphId, offset: end },
      });
      host.surface.pasteRich(input, null);
      expect(host.text()).toBe(`Left ${expected} right`);
      expect(host.fields()[0]).toMatchObject({
        fieldNodeId: definition.fieldNodeId,
        defaultText: 'ABCDE',
        maxLength: 5,
        enabled: true,
      });
      host.surface.undo();
      expect(host.text()).toBe('Left ABCDE right');
    } finally {
      host.cleanup();
    }
  });
}

test('paste at an adjacent field boundary uses the active second field capacity', () => {
  const host = setup(true, false, true);
  try {
    host.pages
      .querySelector('[data-field-atom="form"][data-start="10"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    host.pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    host.surface.pasteRich('7777', null);
    expect(host.text()).toBe('Left ABCDE77XYZ right');
    expect(host.fields().map((field) => field.defaultText)).toEqual(['ABCDE', 'XYZ']);
  } finally {
    host.cleanup();
  }
});

test('named date paste finds a valid prefix after an invalid shorter prefix', () => {
  const date = field
    .replaceAll('ABCDE', 'January 1, 2030')
    .replace('<w:textInput>', '<w:textInput><w:type w:val="date"/><w:format w:val="MMMM d, yyyy"/>')
    .replace('<w:maxLength w:val="5"/>', '<w:maxLength w:val="8"/>');
  const host = setup(true, false, false, date);
  try {
    host.surface.setSelection({
      anchor: { paragraphId: host.paragraphId, offset: 16 },
      head: { paragraphId: host.paragraphId, offset: 20 },
    });
    host.surface.pasteRich('2031xxxxxxxxxxxxxxxx', null);
    expect(host.text()).toBe('Left January 1, 2031 right');
    expect(host.fields()[0]!.defaultText).toBe('January 1, 2030');
    host.surface.undo();
    expect(host.text()).toBe('Left January 1, 2030 right');
  } finally {
    host.cleanup();
  }
});
