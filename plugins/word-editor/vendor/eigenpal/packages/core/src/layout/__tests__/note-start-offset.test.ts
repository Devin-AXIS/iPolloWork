// A note's number is its section's `w:numStart` plus its index in its numbering domain: the
// document for continuous numbering, the section for eachSect, the page for eachPage.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  type AuthoredNoteProperties,
} from '../../store/package/note-properties.ts';
import { noteRefMarkIndex, noteRefNumberingForPart } from '../field-noteref.ts';
import { deriveNoteDisplayMarksResolved, type NoteReferenceSite } from '../note-numbering.ts';
import { storyBlocks } from '../story-roots.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function marks(
  sites: readonly NoteReferenceSite[],
  sections: readonly AuthoredNoteProperties[],
  kind: 'footnote' | 'endnote' = 'footnote'
): (string | null)[] {
  const resolve = kind === 'footnote' ? resolveFootnoteProperties : resolveEndnoteProperties;
  return deriveNoteDisplayMarksResolved(kind, sites, (index) => resolve(sections[index])).map(
    (entry) => entry.mark
  );
}

const site = (noteId: number, sectionIndex: number, pageIndex?: number): NoteReferenceSite => ({
  noteId,
  sectionIndex,
  ...(pageIndex !== undefined ? { pageIndex } : {}),
});

describe('a note number is the section start plus the note index in its domain', () => {
  test('continuous: a later section start adds the count of every earlier note', () => {
    // Two notes, then a section starting at 10, then a section with no start of its own.
    const sections = [{ numStart: 3, numRestart: 'eachSect' }, { numStart: 10 }, {}];
    const sites = [site(1, 0), site(2, 0), site(3, 1), site(4, 1), site(5, 2), site(6, 2)];
    expect(marks(sites, sections)).toEqual(['3', '4', '12', '13', '5', '6']);
  });

  test('eachSect: the index counts the section only', () => {
    const sections = [{}, { numStart: 7, numRestart: 'eachSect' }];
    expect(marks([site(1, 0), site(2, 0), site(3, 1), site(4, 1)], sections)).toEqual([
      '1',
      '2',
      '7',
      '8',
    ]);
  });

  test('eachPage: the index counts the page only', () => {
    const sections = [{}, { numStart: 5, numRestart: 'eachPage' }];
    const sites = [site(1, 0, 0), site(2, 0, 0), site(3, 1, 1), site(4, 1, 1), site(5, 1, 2)];
    expect(marks(sites, sections)).toEqual(['1', '2', '5', '6', '5']);
  });

  test('endnotes follow the same rule with their own format per section', () => {
    const sections = [{}, { numFmt: 'decimal', numStart: 4 }];
    expect(marks([site(1, 0), site(2, 1), site(3, 1)], sections, 'endnote')).toEqual([
      'i',
      '5',
      '6',
    ]);
  });
});

test('the NOTEREF refresh numbers by the same rule', () => {
  const ref = (id: number) => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>A</w:t></w:r>${ref(1)}${ref(2)}</w:p>` +
        `<w:p><w:r><w:t>B</w:t></w:r>${ref(3)}${ref(4)}</w:p>` +
        '<w:sectPr><w:footnotePr><w:numStart w:val="10"/></w:footnotePr></w:sectPr>' +
        '</w:body></w:document>'
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const blocks = storyBlocks(part);
  const index = noteRefMarkIndex(blocks, noteRefNumberingForPart(loaded.package, part, blocks));
  expect([...index.values()]).toEqual(['1', '2', '12', '13']);
});
