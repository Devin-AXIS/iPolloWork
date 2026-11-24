import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  createDocumentLinkProjectors,
  createFixedMeasurer,
  createParagraphLayoutCache,
} from '../../layout/index.ts';
import {
  readOoxmlPackage,
  relationshipTargetIn,
  type OoxmlPackage,
} from '../../store/package/index.ts';
import { createNotesLayoutInput } from '../surface-pages.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function load(body: string): OoxmlPackage {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="1"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:footnote>' +
        '</w:footnotes>'
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function notesInput(pkg: OoxmlPackage) {
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const session = {
    currentPackage: () => pkg,
    part: () => part,
    packageRevision: () => 0,
    documentProperties: () => ({}),
    relationshipTarget: (relationshipId: string) =>
      relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
  } as never;
  return createNotesLayoutInput({
    session,
    measurer: createFixedMeasurer(),
    producer: 'test',
    cache: createParagraphLayoutCache(),
    linkProjectors: createDocumentLinkProjectors(session),
  });
}

describe('notes layout input gate', () => {
  test('separator-only notes parts do not start note pagination', () => {
    const pkg = load('<w:p><w:r><w:t>Plain body</w:t></w:r></w:p>');
    expect(notesInput(pkg)).toBeUndefined();
  });

  test('a body citation still starts note pagination', () => {
    const pkg = load('<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>');
    expect(notesInput(pkg)).toBeDefined();
  });
});
