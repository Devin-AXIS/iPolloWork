// Walks over a long body run after every keystroke: the fonts the document names, the fonts its
// text renders in, and the tables of contents it holds. Each keeps its answer from the previous
// revision when the edit cannot have changed it, and must still see an edit that does.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { collectRenderedFontFamilies } from '../package/rendered-fonts.ts';
import { detectBodyTocs } from '../package/toc-detect.ts';
import { collectDocumentFonts } from '../../binding/document-catalog.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const THEME = {
  major: 'Major Face',
  minor: 'Minor Face',
  majorEastAsia: null,
  minorEastAsia: null,
  majorBidi: null,
  minorBidi: null,
};

const run = (text: string, font = 'Body Face') =>
  `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr><w:t>${text}</w:t></w:r>`;
const paragraph = (content: string) => `<w:p>${content}</w:p>`;
const field = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
const instruction = (text: string) =>
  `<w:r><w:instrText xml:space="preserve">${text}</w:instrText></w:r>`;

/** A body with a table of contents and enough plain paragraphs to compose from its children. */
function partOf(extra = ''): OoxmlPart {
  const plain: string[] = [];
  for (let index = 0; index < 40; index += 1) plain.push(paragraph(run(`Paragraph ${index}`)));
  const toc =
    paragraph(field('begin') + instruction(' TOC \\o "1-3" ') + field('separate') + run('Entry')) +
    paragraph(run('Entry two') + field('end'));
  const read = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${toc}${plain.join('')}${extra}</w:body></w:document>`
      ),
    })
  );
  if (!read.ok) throw new Error(read.reason);
  return read.package.parts.get('/word/document.xml')!;
}

function bodyOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  return body;
}

/** `part` with body child `index` replaced, as an edit rebuilds it: every other child kept. */
function edited(part: OoxmlPart, index: number, replacement: OoxmlNode): OoxmlPart {
  const body = bodyOf(part);
  const children = [...body.children];
  children[index] = replacement;
  const nextBody = { ...body, children } as OoxmlElement;
  const root = {
    ...part.root,
    children: part.root.children.map((n) => (n === body ? nextBody : n)),
  } as OoxmlElement;
  return { ...part, root };
}

/** Body child `index` of a freshly parsed body holding `content` there instead. */
function replacementFrom(content: string, index: number): OoxmlNode {
  return bodyOf(partOf(paragraph(content))).children.at(-1)!.kind === 'paragraph'
    ? {
        ...bodyOf(partOf(paragraph(content))).children.at(-1)!,
        id: bodyOf(partOf()).children[index]!.id,
      }
    : bodyOf(partOf()).children[index]!;
}

describe('body walks after an edit', () => {
  test('keep the fonts while the edit names none, and see one it adds', () => {
    const before = partOf();
    const plainEdit = edited(before, 10, replacementFrom(run('Changed text'), 10));
    const fontEdit = edited(before, 10, replacementFrom(run('Changed text', 'New Face'), 10));
    const named = (part: OoxmlPart) => collectDocumentFonts([part.root], THEME);
    const rendered = (part: OoxmlPart) => collectRenderedFontFamilies([part.root], null, THEME);

    const first = named(before);
    expect(first).toContain('Body Face');
    expect(named(plainEdit)).toBe(first);
    expect(named(fontEdit)).toContain('New Face');
    expect(rendered(before)).toEqual(rendered(plainEdit));
    expect(rendered(fontEdit)).toContain('New Face');
  });

  test('keep the tables of contents across plain text, and see a field the edit adds', () => {
    const before = partOf();
    const tocs = detectBodyTocs(before);
    expect(tocs).toHaveLength(1);
    expect(detectBodyTocs(edited(before, 10, replacementFrom(run('Changed text'), 10)))).toBe(tocs);
    // A paragraph that now ends the field early changes the answer.
    const broken = edited(before, 1, replacementFrom(field('end'), 1));
    expect(detectBodyTocs(broken)).not.toBe(tocs);
  });
});
