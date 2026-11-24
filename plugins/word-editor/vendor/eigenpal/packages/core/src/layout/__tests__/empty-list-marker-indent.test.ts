import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Every character, the space included, is 6pt wide.
const measurer = createFixedMeasurer(6, 14);

function fixture(
  indent: string,
  levelText = '',
  format = 'none',
  {
    levelIndent = 'w:left="0" w:hanging="0"',
    text = 'Heading text',
    bidi = false,
    numbered = true,
    suffix = 'nothing',
    levelTabs = '',
  } = {}
) {
  const doc = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>
      ${numbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}
      ${bidi ? '<w:bidi/>' : ''}
      <w:ind ${indent}/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr>
      ${text ? `<w:t>${text}</w:t>` : ''}</w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  const num = readOoxmlPart(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/>
      <w:lvlText w:val="${levelText}"/><w:suff w:val="${suffix}"/>
      <w:pPr>${levelTabs}<w:ind ${levelIndent}/></w:pPr>
      <w:rPr><w:sz w:val="22"/></w:rPr></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    { name: '/word/numbering.xml', contentType: 'app/xml' }
  );
  if (!doc.ok || !num.ok) throw new Error('Invalid synthetic fixture');
  const layout = layoutSemanticDocument(doc.part, 1, {
    measurer,
    numberingIndex: buildNumberingIndex(num.part.root),
    geometry: { width: 140, height: 400, margin: { top: 20, right: 20, bottom: 20, left: 20 } },
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!;
}

describe('paragraph indents without a painted list marker', () => {
  test('keeps a positive first-line indent on a none level', () => {
    const paragraph = fixture('w:firstLine="720"');
    expect(paragraph.indent.firstLine).toBe(36);
    expect(paragraph.marker).toBeUndefined();
    expect(paragraph.lines[0]!.spans[0]!.box.x).toBe(36);
  });

  test('keeps a hanging first line when the marker is empty', () => {
    const paragraph = fixture('w:left="720" w:hanging="360"');
    expect(paragraph.indent.hanging).toBe(18);
    expect(paragraph.marker).toBeUndefined();
    expect(paragraph.lines[0]!.spans[0]!.box.x).toBe(18);
  });

  test('inherits a hanging indent from an empty numbering level', () => {
    const paragraph = fixture('', '', 'none', { levelIndent: 'w:left="720" w:hanging="360"' });
    expect(paragraph.indent).toMatchObject({ left: 36, hanging: 18 });
    expect(paragraph.lines[0]!.spans[0]!.box.x).toBe(18);
  });

  test('keeps the continuation line at the content indent', () => {
    const paragraph = fixture('w:firstLine="720"', '', 'none', { text: 'Alpha beta gamma delta' });
    expect(paragraph.lines.length).toBeGreaterThan(1);
    expect(paragraph.lines[0]!.contentX).toBe(36);
    expect(paragraph.lines[1]!.contentX).toBe(0);
  });

  test('places a right-to-left empty marker like an ordinary paragraph', () => {
    const indent = 'w:left="720" w:firstLine="360"';
    const list = fixture(indent, '', 'none', { bidi: true });
    const plain = fixture(indent, '', 'none', { bidi: true, numbered: false });
    expect(list.marker).toBeUndefined();
    expect(list.lines[0]!.contentX).toBe(plain.lines[0]!.contentX);
    expect(list.lines[0]!.spans[0]!.box).toEqual(plain.lines[0]!.spans[0]!.box);
  });

  test('still places text after a visible marker', () => {
    const paragraph = fixture('w:firstLine="720"', '%1.', 'decimal');
    expect(paragraph.marker?.text).toBe('1.');
    expect(paragraph.lines[0]!.spans[0]!.box.x).toBe(48);
  });
});

describe('the suffix after an empty list marker', () => {
  const firstX = (indent: string, suffix: string, extra: { levelTabs?: string } = {}) =>
    fixture(indent, '', 'none', { suffix, ...extra }).lines[0]!.contentX;

  test('a tab after an empty hanging marker reaches the indent', () => {
    expect(firstX('w:left="720" w:hanging="360"', 'tab')).toBe(36);
    expect(firstX('w:left="1440" w:hanging="1440"', 'tab')).toBe(72);
  });

  test('a tab after an empty first-line marker reaches the next tab stop', () => {
    expect(firstX('w:left="0" w:firstLine="720"', 'tab')).toBe(72);
  });

  test('a tab after an empty marker stops at a nearer authored stop', () => {
    const levelTabs = '<w:tabs><w:tab w:val="left" w:pos="540"/></w:tabs>';
    expect(firstX('w:left="720" w:hanging="360"', 'tab', { levelTabs })).toBe(27);
  });

  test('a tab after an empty marker at the indent does not move the first line', () => {
    expect(firstX('w:left="0"', 'tab')).toBe(0);
    expect(firstX('w:left="0" w:firstLine="0"', 'tab')).toBe(0);
    expect(firstX('w:left="720"', 'tab')).toBe(36);
    const levelTabs = '<w:tabs><w:tab w:val="left" w:pos="540"/></w:tabs>';
    expect(firstX('w:left="0"', 'tab', { levelTabs })).toBe(0);
  });

  test('a space after an empty marker starts the text one space past the slot', () => {
    // The space suffix is 569/2048 em of the 11pt marker size.
    const space = (569 / 2048) * 11;
    expect(firstX('w:left="720" w:hanging="360"', 'space')).toBeCloseTo(18 + space, 6);
    expect(firstX('w:left="0" w:firstLine="720"', 'space')).toBeCloseTo(36 + space, 6);
  });

  test('a tab after an empty right-to-left marker mirrors the left-to-right placement', () => {
    const rtl = fixture('w:left="720" w:hanging="360"', '', 'none', { suffix: 'tab', bidi: true });
    const ltr = fixture('w:left="720" w:hanging="360"', '', 'none', { suffix: 'tab' });
    const width = 100;
    const rtlStart = rtl.lines[0]!.spans[0]!.box;
    expect(width - (rtlStart.x + rtlStart.width)).toBe(ltr.lines[0]!.contentX);
  });

  test('an empty list item places its caret line at the suffix destination', () => {
    const empty = (indent: string, suffix: string) =>
      fixture(indent, '', 'none', { suffix, text: '' }).lines[0]!.contentX;
    expect(empty('w:left="720" w:hanging="360"', 'tab')).toBe(36);
    expect(empty('w:left="0" w:firstLine="720"', 'tab')).toBe(72);
    expect(empty('w:left="720" w:hanging="360"', 'nothing')).toBe(18);
  });
});
