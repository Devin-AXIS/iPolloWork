// Word writes Symbol/Wingdings bullets as font-byte + 0xF000 (U+F0B7, U+F0A7). Those are
// private-use codepoints: any font that is not the symbol-encoded original draws a tofu box.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { hasSymbolPua, isSymbolEncodedFamily, mapSymbolPuaText } from '../symbol-encoding.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

/** What Word actually writes for its default level 0 / level 2 bullets. */
const SYMBOL_BULLET = '';
const WINGDINGS_SQUARE = '';

const NUMBERING = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>
      <w:lvlText w:val="${SYMBOL_BULLET}"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/><w:sz w:val="22"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/>
      <w:lvlText w:val="${WINGDINGS_SQUARE}"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings" w:hint="default"/><w:sz w:val="22"/></w:rPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
`;

function numbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

function document(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const listParagraph = (text: string, ilvl: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

function items(isFontAvailable?: (family: string) => boolean) {
  const part = document(listParagraph('Level zero', '0') + listParagraph('Level two', '2'));
  const bodyElement = part.root!.children.find((child) => child.localName === 'body')!;
  return [
    ...resolveStoryListItems(
      bodyElement.children.filter((child) => child.kind === 'paragraph'),
      numbering(NUMBERING),
      undefined,
      isFontAvailable
    ).values(),
  ];
}

describe('symbol-font private-use mapping', () => {
  test('recognises the legacy symbol families, case-insensitively', () => {
    expect(isSymbolEncodedFamily('Symbol')).toBe(true);
    expect(isSymbolEncodedFamily('wingdings')).toBe(true);
    expect(isSymbolEncodedFamily('Wingdings 2')).toBe(true);
    expect(isSymbolEncodedFamily('Calibri')).toBe(false);
    expect(isSymbolEncodedFamily(null)).toBe(false);
  });

  test('maps the bullets Word writes', () => {
    expect(hasSymbolPua(SYMBOL_BULLET)).toBe(true);
    expect(mapSymbolPuaText(SYMBOL_BULLET, 'Symbol')).toBe('•');
    expect(mapSymbolPuaText(WINGDINGS_SQUARE, 'Wingdings')).toBe('▪');
    expect(mapSymbolPuaText('', 'Wingdings')).toBe('■');
    expect(mapSymbolPuaText('', 'Wingdings')).toBe('✔');
    expect(mapSymbolPuaText('', 'Symbol')).toBe('→');
  });

  test('leaves everything it cannot map exactly', () => {
    // Not a symbol family: the codepoint means whatever that font says it means.
    expect(mapSymbolPuaText(SYMBOL_BULLET, 'Calibri')).toBe(SYMBOL_BULLET);
    // In range but unmapped — a wrong glyph is not better than an unknown one.
    expect(mapSymbolPuaText('', 'Symbol')).toBe('');
    // Ordinary text is returned by identity.
    const plain = '1.';
    expect(mapSymbolPuaText(plain, 'Symbol')).toBe(plain);
  });

  test('a host that knows the font is present keeps the authored codepoint', () => {
    expect(mapSymbolPuaText(SYMBOL_BULLET, 'Symbol', () => true)).toBe(SYMBOL_BULLET);
    expect(mapSymbolPuaText(SYMBOL_BULLET, 'Symbol', () => false)).toBe('•');
  });

  test('resolved list markers carry the mapped glyph', () => {
    expect(items().map((item) => item.markerText)).toEqual(['•', '▪']);
    expect(items().map((item) => item.markerStyle.fontFamily)).toEqual(['Symbol', 'Wingdings']);
    expect(items(() => true).map((item) => item.markerText)).toEqual([
      SYMBOL_BULLET,
      WINGDINGS_SQUARE,
    ]);
    expect(items(() => true).map((item) => item.markerStyle.fontFamily)).toEqual([
      'Symbol',
      'Wingdings',
    ]);
  });

  test('partial translations preserve the font needed by unknown private-use glyphs', () => {
    const part = document(listParagraph('Unknown symbol', '0'));
    const body = part.root!.children.find((child) => child.localName === 'body')!;
    const index = numbering(NUMBERING.replace(SYMBOL_BULLET, `${SYMBOL_BULLET}`));
    const [item] = resolveStoryListItems(body.children, index, undefined).values();
    expect(item!.markerText).toBe('•');
    expect(item!.markerStyle.fontFamily).toBe('Symbol');
  });

  test('layout paints the mapped glyph, and measures the same string', () => {
    const part = document(listParagraph('Level zero', '0'));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: numbering(NUMBERING),
    });
    const marker = paragraphFragmentsOf(layout.pages[0]!)[0]!.marker!;
    expect(marker.text).toBe('•');
    expect(marker.style.fontFamily).toBe('Symbol');
    expect(marker.box.width).toBe(6);
  });
});
