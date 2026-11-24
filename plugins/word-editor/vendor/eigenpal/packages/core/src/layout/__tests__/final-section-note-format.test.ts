import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createDocumentLinkProjectors } from '../document-link-projector.ts';
import { createDocumentNotesInput } from '../document-notes-input.ts';
import { noteRefNumberingForPart } from '../field-noteref.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { storyBlocks } from '../story-roots.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// A title-page section in chicago (a star note) and a body whose own w:sectPr — the
// body-level one that closes the last section — states only the restart. The body holds
// one footnote, so the painted pages build their notes input too.
const bytes = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdS" Type="${R}/settings" Target="settings.xml"/>` +
      `<Relationship Id="rIdF" Type="${R}/footnotes" Target="footnotes.xml"/>` +
      '</Relationships>'
  ),
  'word/settings.xml': strToU8(
    `<w:settings xmlns:w="${W}"><w:footnotePr><w:numFmt w:val="chicago"/><w:numRestart w:val="eachSect"/></w:footnotePr></w:settings>`
  ),
  'word/footnotes.xml': strToU8(
    `<w:footnotes xmlns:w="${W}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>Note</w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      '<w:p><w:pPr><w:sectPr><w:footnotePr><w:numFmt w:val="chicago"/><w:numRestart w:val="eachSect"/></w:footnotePr></w:sectPr></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Body</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
      '<w:sectPr><w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr></w:sectPr>' +
      '</w:body></w:document>'
  ),
});

test('the last section reads its own body-level sectPr, not the document defaults', () => {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const input = noteRefNumberingForPart(loaded.package, part, storyBlocks(part));
  expect(input.footnotePropsBySection.map((p) => p.numFmt)).toEqual(['chicago', 'decimal']);
  expect(input.footnotePropsBySection[1]?.numRestart).toBe('eachSect');
});

test('the painted notes input reads the same per-section properties', () => {
  const opened = openHeadlessDocument(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const input = createDocumentNotesInput({
    view: opened.view,
    measurer: createFixedMeasurer(),
    producer: 'test',
    cache: undefined,
    linkProjectors: createDocumentLinkProjectors(opened.view),
  });
  expect(input).toBeDefined();
  expect(input?.footnotePropsBySection.map((p) => p.numFmt)).toEqual(['chicago', 'decimal']);
  expect(input?.footnotePropsBySection[1]?.numRestart).toBe('eachSect');
});
