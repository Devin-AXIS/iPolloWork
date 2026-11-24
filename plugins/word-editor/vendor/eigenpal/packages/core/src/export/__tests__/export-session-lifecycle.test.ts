import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { openDocumentForExport } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

test('a resolved export snapshot remains traversable after its session is disposed', async () => {
  const opened = openDocumentForExport(
    docx('<w:p><w:r><w:t>Detached core snapshot</w:t></w:r></w:p>')
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;

  const layout = await opened.session.layout();
  opened.session.dispose();
  const text: string[] = [];
  forEachSemanticSpan(layout, ({ span }) => text.push(span.text));

  expect(Object.isFrozen(layout)).toBe(true);
  expect(text.join('')).toBe('Detached core snapshot');
  await expect(opened.session.layout()).rejects.toMatchObject({ code: 'disposed' });
});
