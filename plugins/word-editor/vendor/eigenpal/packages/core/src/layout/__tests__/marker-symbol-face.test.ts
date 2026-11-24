import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// A Wingdings square bullet, written as its font byte + 0xF000.
const numbering = buildNumberingIndex(
  part(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
      `<w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>` +
      `<w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings" w:hint="default"/></w:rPr>` +
      `</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    '/word/numbering.xml'
  ).root
);

function markerOf(markRunProperties: string) {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/>` +
      `<w:numId w:val="1"/></w:numPr><w:bidi/><w:rPr><w:rFonts w:cs="Arial"/>` +
      `${markRunProperties}</w:rPr></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>نعم</w:t></w:r>` +
      `</w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const body = document.root!.children.find((child) => child.localName === 'body')!;
  const items = resolveStoryListItems(
    body.children.filter((child) => child.kind === 'paragraph'),
    numbering,
    undefined
  );
  return [...items.values()][0]!;
}

describe('a symbol bullet under a right-to-left paragraph mark', () => {
  test('keeps the level symbol face instead of the complex-script face', () => {
    const item = markerOf('<w:rtl/>');
    expect(item.markerStyle.fontFamily).toBe('Wingdings');
  });

  test('matches the marker of a mark without right-to-left formatting', () => {
    expect(markerOf('<w:rtl/>').markerText).toBe(markerOf('').markerText);
    expect(markerOf('').markerStyle.fontFamily).toBe('Wingdings');
  });
});
