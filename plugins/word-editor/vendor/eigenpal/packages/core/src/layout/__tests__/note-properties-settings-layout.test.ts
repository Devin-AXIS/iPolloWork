// The painted notes pass and the NOTEREF save refresh both number notes from each section's own
// `w:sectPr`. settings.xml note properties take no part, except the endnote position.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createDocumentLinkProjectors } from '../document-link-projector.ts';
import { createDocumentNotesInput } from '../document-notes-input.ts';
import { noteRefNumberingForPart } from '../field-noteref.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { storyBlocks } from '../story-roots.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const SETTINGS =
  '<w:footnotePr><w:pos w:val="beneathText"/><w:numFmt w:val="lowerRoman"/>' +
  '<w:numStart w:val="5"/><w:numRestart w:val="eachSect"/></w:footnotePr>' +
  '<w:endnotePr><w:pos w:val="sectEnd"/><w:numFmt w:val="upperLetter"/>' +
  '<w:numStart w:val="4"/></w:endnotePr>';

/**
 * Three sections: none of its own, a paragraph `w:sectPr` stating only `numStart`, and the
 * body-level `w:sectPr` with no note properties. One footnote and one endnote reference.
 */
function bytes(): Uint8Array {
  const note = (tag: string) =>
    `<w:${tag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${tag}>` +
    `<w:${tag} w:id="1"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:${tag}>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdS" Type="${R}/settings" Target="settings.xml"/>` +
        `<Relationship Id="rIdF" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdE" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${SETTINGS}</w:settings>`),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${note('footnote')}</w:footnotes>`),
    'word/endnotes.xml': strToU8(`<w:endnotes xmlns:w="${W}">${note('endnote')}</w:endnotes>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>One</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:sectPr><w:footnotePr><w:numStart w:val="3"/></w:footnotePr>' +
        '</w:sectPr></w:pPr><w:r><w:t>Two</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Three</w:t><w:footnoteReference w:id="1"/>' +
        '<w:endnoteReference w:id="1"/></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
  });
}

const FOOTNOTES = [
  { pos: 'pageBottom', numFmt: 'decimal', numStart: 1, numRestart: 'continuous' },
  { pos: 'pageBottom', numFmt: 'decimal', numStart: 3, numRestart: 'continuous' },
  { pos: 'pageBottom', numFmt: 'decimal', numStart: 1, numRestart: 'continuous' },
];
const ENDNOTE = { pos: 'sectEnd', numFmt: 'lowerRoman', numStart: 1, numRestart: 'continuous' };

describe('note numbering ignores settings.xml', () => {
  test('in the painted notes input', () => {
    const opened = openHeadlessDocument(bytes());
    if (!opened.ok) throw new Error(opened.reason);
    const input = createDocumentNotesInput({
      view: opened.view,
      measurer: createFixedMeasurer(),
      producer: 'test',
      cache: createParagraphLayoutCache(),
      linkProjectors: createDocumentLinkProjectors(opened.view),
    });
    if (!input) throw new Error('no notes input');
    expect(input.footnotePropsBySection).toEqual(FOOTNOTES);
    expect(input.endnotePropsBySection).toEqual([ENDNOTE, ENDNOTE, ENDNOTE]);
    // A section with none of its own resolves like the document fallback.
    expect(input.documentFootnoteProps).toEqual(FOOTNOTES[0]!);
    expect(input.documentEndnoteProps).toEqual(ENDNOTE);
  });

  test('in the NOTEREF save refresh', () => {
    const loaded = readOoxmlPackage(bytes());
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const input = noteRefNumberingForPart(loaded.package, part, storyBlocks(part));
    expect(input.footnotePropsBySection).toEqual(FOOTNOTES);
    expect(input.endnotePropsBySection).toEqual([ENDNOTE, ENDNOTE, ENDNOTE]);
  });
});
