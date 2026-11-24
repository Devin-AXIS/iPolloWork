// A text control the user empties shows the placeholder its `w:placeholder/w:docPart` names,
// and not the type's default prompt.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const GLOSSARY_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml';

function docPart(name: string, text: string): string {
  return (
    `<w:docPart><w:docPartPr><w:name w:val="${name}"/><w:category><w:name w:val="General"/>` +
    '<w:gallery w:val="placeholder"/></w:category></w:docPartPr><w:docPartBody>' +
    `<w:p><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${text}</w:t></w:r></w:p>` +
    '</w:docPartBody></w:docPart>'
  );
}

function docx(body: string, glossary: string | null): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (glossary
          ? `<Override PartName="/word/glossary/document.xml" ContentType="${GLOSSARY_CONTENT_TYPE}"/>`
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  };
  if (glossary) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${R}/glossaryDocument" Target="glossary/document.xml"/></Relationships>`
    );
    files['word/glossary/document.xml'] = strToU8(
      `<w:glossaryDocument xmlns:w="${W}"><w:docParts>${glossary}</w:docParts></w:glossaryDocument>`
    );
  }
  return zipSync(files);
}

const control = (docPartName: string, value: string) =>
  '<w:sdt><w:sdtPr><w:tag w:val="value"/>' +
  `<w:placeholder><w:docPart w:val="${docPartName}"/></w:placeholder><w:text/></w:sdtPr>` +
  `<w:sdtContent><w:r><w:t>${value}</w:t></w:r></w:sdtContent></w:sdt>`;
const paragraph = (inner: string) =>
  `<w:p><w:r><w:t xml:space="preserve">A </w:t></w:r>${inner}<w:r><w:t xml:space="preserve"> B</w:t></w:r></w:p>`;

const mounted: (() => void)[] = [];
afterEach(() => mounted.splice(0).forEach((cleanup) => cleanup()));

function mount(bytes: Uint8Array) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  mounted.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

/** Select the control's whole value and delete it, as a user does. */
function emptyTheControl(editor: ReturnType<typeof createDocxEditor>): void {
  const surface = editor.surface!;
  const range = surface.layout().contentControls![0]!.range!;
  surface.setSelection({
    anchor: { paragraphId: range.paragraphId, offset: range.start },
    head: { paragraphId: range.paragraphId, offset: range.end },
  });
  surface.deleteBackward();
}

async function savedBody(editor: ReturnType<typeof createDocxEditor>): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

test('an emptied text control shows the prompt its glossary placeholder names', async () => {
  const editor = mount(
    docx(paragraph(control('Empty', 'value')), docPart('Empty', 'Enter a value'))
  );
  emptyTheControl(editor);
  expect(editor.surface!.session.bodyText()).toBe('A Enter a value B');
  const body = await savedBody(editor);
  expect(body).toContain('<w:showingPlcHdr/>');
  expect(body).toContain('<w:docPart w:val="Empty"/>');
});

test('an emptied control whose glossary block is missing takes the type default prompt', () => {
  const editor = mount(docx(paragraph(control('Missing', 'value')), docPart('Empty', 'x')));
  emptyTheControl(editor);
  expect(editor.surface!.session.bodyText()).toBe('A Click here to enter text. B');
});

test('the first keystroke after the restored prompt replaces it whole', () => {
  const editor = mount(
    docx(paragraph(control('Empty', 'value')), docPart('Empty', 'Enter a value'))
  );
  emptyTheControl(editor);
  editor.surface!.type('Z');
  expect(editor.surface!.session.bodyText()).toBe('A Z B');
});

test('an emptied control takes the first block of its name and its first paragraph', () => {
  // Two blocks share the name; the open path reads only the first one.
  const twoBlocks = docPart('Empty', 'First prompt') + docPart('Empty', 'Second prompt');
  const first = mount(docx(paragraph(control('Empty', 'value')), twoBlocks));
  emptyTheControl(first);
  expect(first.surface!.session.bodyText()).toBe('A First prompt B');
  // A first paragraph without text shows the type default, as on open.
  const emptyFirstParagraph = docPart('Empty', 'Later text').replace(
    '<w:docPartBody>',
    '<w:docPartBody><w:p/>'
  );
  const second = mount(docx(paragraph(control('Empty', 'value')), emptyFirstParagraph));
  emptyTheControl(second);
  expect(second.surface!.session.bodyText()).toBe('A Click here to enter text. B');
});
