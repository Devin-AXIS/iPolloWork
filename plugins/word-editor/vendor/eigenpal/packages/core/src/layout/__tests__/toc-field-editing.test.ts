// Refreshing a TOC in a live editor, which is the gesture the fold exists for.
//
// The sibling file drives `layoutSemanticDocument` with two parsed trees. That proves the
// fold, but it reloads XML each time, so it never puts a SECTION PREPASS MEMO under pressure —
// and the memo is the other half of the answer, because it can hand back cached flow keys
// built from the verdicts of a revision that is gone.
//
// `refreshToc` is the real trigger. It rewrites the result paragraphs and leaves the begin
// paragraph byte-identical, so a document with no headings loses every result row and the
// begin paragraph has to start emitting the one placeholder line that stands in for an empty
// TOC. The oracle is the same bytes reopened.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/>' +
  '<w:basedOn w:val="Normal"/></w:style>' +
  '</w:styles>';

const BEGIN =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/>' +
  '<w:instrText> TOC \\o "1-3" \\h </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r></w:p>';
const END = '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const tocEntry = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const body = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const sdt = (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

function docx(bodyXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`
    ),
  });
}

const open: DocxEditorInstance[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** Which rows the flow actually emits, and where. */
const shapeOf = (editor: DocxEditorInstance): unknown =>
  editor.surface!.layout().pages.map((page) =>
    page.fragments.map((fragment) => ({
      y: Math.round(fragment.box.y * 100) / 100,
      height: Math.round(fragment.box.height * 100) / 100,
      text:
        fragment.kind === 'paragraph'
          ? fragment.lines
              .flatMap((line) => line.spans.map((span) => span.text))
              .join('')
              .trim()
          : '',
    }))
  );

async function reopened(editor: DocxEditorInstance): Promise<DocxEditorInstance> {
  return mount(new Uint8Array(await editor.save()));
}

describe('refreshToc through a live editor', () => {
  test('a refresh that finds no headings gives the begin paragraph its placeholder', async () => {
    // The document has cached rows but nothing for them to point at, so the refresh empties
    // the TOC. Every result paragraph is rewritten; the begin paragraph is not touched.
    const editor = mount(
      docx(sdt(BEGIN + tocEntry('Introduction') + tocEntry('Method') + END) + body('after'))
    );
    expect(editor.surface!.refreshToc(undefined, 'entire')).toBe(true);

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });

  test('a refresh that finds headings takes the placeholder back off', async () => {
    const editor = mount(
      docx(sdt(BEGIN + END) + heading('Introduction') + heading('Method') + body('after'))
    );
    expect(editor.surface!.refreshToc(undefined, 'entire')).toBe(true);

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });

  test('typing after a refresh keeps the flow agreeing with the reopened bytes', async () => {
    // The prepass memo is what this reaches: the refresh moves the TOC id sets, and the
    // keystrokes after it run passes that must not serve flow keys built from the shape the
    // document had before.
    const editor = mount(docx(sdt(BEGIN + tocEntry('Introduction') + END) + body('after')));
    const surface = editor.surface!;
    expect(surface.refreshToc(undefined, 'entire')).toBe(true);

    const ids = surface.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    surface.setSelection({
      anchor: { paragraphId: last, offset: 0 },
      head: { paragraphId: last, offset: 0 },
    });
    surface.type('more ');

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });
});
