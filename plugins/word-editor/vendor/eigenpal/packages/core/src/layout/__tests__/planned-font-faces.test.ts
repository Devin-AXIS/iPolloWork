import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { documentFontResolutionRequest } from '../document-font-substitution.ts';
import { plannedFontFaces } from '../planned-font-faces.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A document whose text is in `primary`, which the font table maps to `alternate`. */
function view(primary: string, alternate: string) {
  const opened = openHeadlessDocument(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="f" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="${primary}" w:hAnsi="${primary}"/><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:p></w:body></w:document>`
      ),
      'word/fontTable.xml': strToU8(
        `<w:fonts xmlns:w="${W}"><w:font w:name="${primary}"><w:altName w:val="${alternate}"/></w:font></w:fonts>`
      ),
    })
  );
  if (!opened.ok) throw new Error(opened.reason);
  return opened.view;
}

test('a face of a family goes to its font-table alternate too', () => {
  const { request } = documentFontResolutionRequest(view('Foo Sans', 'Arial'), {
    families: ['Foo Sans'],
    faces: [{ family: 'Foo Sans', weight: 700, style: 'normal' }],
  });
  expect(request.families).toContain('Arial');
  expect(request.faces).toContainEqual({ family: 'Arial', weight: 700, style: 'normal' });
  expect(request.faces).toContainEqual({ family: 'Foo Sans', weight: 700, style: 'normal' });
});

test('without faces, the request names no faces', () => {
  const { request } = documentFontResolutionRequest(view('Foo Sans', 'Arial'), {
    families: ['Foo Sans'],
  });
  expect('faces' in request).toBe(false);
});

test('a follow-up asks about its new faces, and the plan keeps every document family', () => {
  // A bold word in the default family: no new family, but Foo Sans keeps its alternate.
  const { plan, request } = documentFontResolutionRequest(view('Foo Sans', 'Arial'), {
    families: [],
    faces: [{ family: 'Calibri', weight: 700, style: 'normal' }],
    documentFamilies: ['Foo Sans'],
  });
  expect(request.families).toEqual([]);
  expect(request.faces).toEqual([{ family: 'Calibri', weight: 700, style: 'normal' }]);
  expect(plan.families).toEqual(['Foo Sans', 'Arial']);
  expect(plan.alternates.get('foo sans')).toBe('Arial');
});

test('a requested family that no text uses gets its regular face', () => {
  expect(
    plannedFontFaces({ families: ['Arial', 'Georgia'] }, 'Calibri', [
      { family: 'Arial', weight: 700, style: 'italic' },
    ])
  ).toEqual([
    { family: 'Arial', weight: 700, style: 'italic' },
    { family: 'Georgia', weight: 400, style: 'normal' },
  ]);
});

test('a face of a family the request does not name stays out', () => {
  const planned = plannedFontFaces(
    { families: ['Arial'], standIns: new Map([['arial', ['Dropped Alternate']]]) },
    'Calibri',
    [
      { family: 'Arial', weight: 400, style: 'normal' },
      { family: 'Calibri', weight: 400, style: 'italic' },
      { family: 'Past The Cap', weight: 400, style: 'normal' },
    ]
  );
  expect(planned).toEqual([
    { family: 'Arial', weight: 400, style: 'normal' },
    { family: 'Calibri', weight: 400, style: 'italic' },
  ]);
});
