import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../store/index.ts';
import { createDocxEditor } from '../index.ts';
import { linesOf } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string, styles?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...(styles
      ? {
          'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
          ),
        }
      : {}),
  });
}

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
    },
  };
}

test('changing display mode restores original formatting without changing document, selection, or history', async () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    modules: [reviewModule()],
    document: docx(
      '<w:p><w:pPr><w:jc w:val="right"/><w:pPrChange w:id="4" w:author="Ada"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:rPrChange w:id="1" w:author="Ada"><w:rPr><w:sz w:val="24"/></w:rPr>' +
        '</w:rPrChange></w:rPr><w:t>Base</w:t></w:r>' +
        '<w:ins w:id="2" w:author="Ada"><w:r><w:t>Added</w:t></w:r></w:ins>' +
        '<w:del w:id="3" w:author="Grace"><w:r><w:delText>Deleted</w:delText></w:r></w:del></w:p>'
    ),
  });
  try {
    const surface = editor.surface!;
    const before = new Uint8Array(await editor.save());
    const revision = editor.getDocumentHandle().revision;
    const position = { paragraphId: surface.session.paragraphIds()[0]!, offset: 2 };
    surface.setSelection({ anchor: position, head: position });
    const spans = () => linesOf(surface.layout()).flatMap((line) => line.spans);
    const text = () =>
      spans()
        .map((span) => span.text)
        .join('');
    expect(text()).toBe('BaseAddedDeleted');
    expect(spans()[0]!.style.bold).toBe(true);

    surface.setRevisionDisplayMode('original');
    expect(surface.revisionDisplayMode()).toBe('original');
    expect(text()).toBe('BaseDeleted');
    expect(spans()[0]!.style.bold).toBe(false);
    expect(editor.snapshot().formatting).toMatchObject({
      bold: false,
      fontSizePt: 12,
      alignment: 'left',
    });
    expect(surface.state().selection).toEqual({ anchor: position, head: position });
    surface.setRevisionDisplayMode('proposed');
    expect(text()).toBe('BaseAdded');
    expect(spans()[0]!.style.bold).toBe(true);
    expect(editor.snapshot().formatting).toMatchObject({
      bold: true,
      fontSizePt: 14,
      alignment: 'right',
    });
    surface.setRevisionDisplayMode('all-markup');
    expect(text()).toBe('BaseAddedDeleted');
    expect(surface.state().selection).toEqual({ anchor: position, head: position });
    expect(editor.getDocumentHandle().revision).toBe(revision);
    expect(editor.snapshot().canUndo).toBe(false);
    expect(new Uint8Array(await editor.save())).toEqual(before);

    surface.setRevisionAuthorVisible('Grace', false);
    editor.setTrackedChangesFilter((item) => item.author !== 'Ada', 'reject');
    surface.setRevisionDisplayMode('original');
    expect(text()).toBe('Base');
    expect(spans()[0]!.style.bold).toBe(false);
    surface.setRevisionDisplayMode('proposed');
    expect(text()).toBe('Base');
    expect(spans()[0]!.style.bold).toBe(false);
    expect([...surface.hiddenRevisionAuthors()]).toEqual(['Grace']);
    expect(new Uint8Array(await editor.save())).toEqual(before);
    editor.destroy();
    surface.setRevisionDisplayMode('original');
    expect(surface.revisionDisplayMode()).toBe('proposed');
  } finally {
    editor.destroy();
  }
});

for (const inCell of [false, true]) {
  test(`empty ${inCell ? 'cell' : 'body'} paragraphs report the displayed mark formatting`, () => {
    const paragraph =
      '<w:p><w:pPr><w:rPr><w:b/><w:sz w:val="28"/>' +
      '<w:rPrChange w:id="1" w:author="Ada"><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrChange>' +
      '</w:rPr></w:pPr></w:p>';
    const body = inCell
      ? '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>' +
        paragraph +
        '</w:tc></w:tr></w:tbl>'
      : paragraph;
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(body),
      modules: [reviewModule()],
    });
    try {
      const surface = editor.surface!;
      const position = { paragraphId: surface.session.paragraphIds()[0]!, offset: 0 };
      surface.setSelection({ anchor: position, head: position });
      expect(editor.snapshot().formatting).toMatchObject({ bold: true, fontSizePt: 14 });
      surface.setRevisionDisplayMode('original');
      expect(editor.snapshot().formatting).toMatchObject({ bold: false, fontSizePt: 12 });
      surface.setRevisionDisplayMode('proposed');
      expect(editor.snapshot().formatting).toMatchObject({ bold: true, fontSizePt: 14 });
    } finally {
      editor.destroy();
    }
  });
}

test('empty paragraphs follow their displayed paragraph style and report mixed selected sizes', () => {
  const styles =
    '<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/>' +
    '<w:rPr><w:i/><w:sz w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Large"><w:name w:val="Large"/>' +
    '<w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>';
  const body =
    '<w:p><w:pPr><w:pStyle w:val="Large"/><w:pPrChange w:id="1" w:author="Ada">' +
    '<w:pPr><w:pStyle w:val="Small"/></w:pPr></w:pPrChange></w:pPr></w:p>' +
    '<w:p><w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:pPr></w:p>';
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body, styles),
    modules: [reviewModule()],
  });
  try {
    const surface = editor.surface!;
    const ids = surface.session.paragraphIds();
    const position = { paragraphId: ids[0]!, offset: 0 };
    surface.setSelection({ anchor: position, head: position });
    expect(editor.snapshot().formatting).toMatchObject({
      bold: true,
      italic: false,
      fontSizePt: 20,
      styleId: 'Large',
    });
    surface.setRevisionDisplayMode('original');
    expect(editor.snapshot().formatting).toMatchObject({
      bold: false,
      italic: true,
      fontSizePt: 12,
      styleId: 'Small',
    });
    surface.setRevisionDisplayMode('proposed');
    expect(editor.snapshot().formatting).toMatchObject({
      bold: true,
      italic: false,
      fontSizePt: 20,
      styleId: 'Large',
    });
    surface.setSelection({ anchor: position, head: { paragraphId: ids[1]!, offset: 0 } });
    expect(surface.formatting().fontSizeHalfPoints).toBeNull();
  } finally {
    editor.destroy();
  }
});
