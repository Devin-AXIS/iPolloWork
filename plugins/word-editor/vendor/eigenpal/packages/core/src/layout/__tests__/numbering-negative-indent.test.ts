// Negative indents on a list level / list paragraph (CT_Ind, §17.3.1.12).
//
// `w:start`(`left`) and `w:end`(`right`) are ST_SignedTwipsMeasure: Word pulls the paragraph
// OUT into the margin when they are negative. Clamping them to zero silently moved every
// such list back to the text edge.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  buildNumberingIndex,
  resolveNumberingLevel,
  MAX_LEVEL_INDENT_PT,
} from '../numbering-index.ts';
import { listMarkerBox, mergeListIndent, resolveStoryListItems } from '../list-resolve.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

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

const NEGATIVE_LEVEL = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="-360" w:right="-720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
`;

describe('negative level indents', () => {
  test('a negative left / right indent survives the projection', () => {
    const level = resolveNumberingLevel(numbering(NEGATIVE_LEVEL), '1', 0)?.level;
    expect(level?.indent.left).toBe(-18);
    expect(level?.indent.right).toBe(-36);
    expect(level?.indent.hanging).toBe(18);
  });

  test('a hostile magnitude is still bounded both ways', () => {
    const level = resolveNumberingLevel(
      numbering(`
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
            <w:pPr><w:ind w:left="-999999999" w:right="999999999"/></w:pPr></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      `),
      '1',
      0
    )?.level;
    expect(level?.indent.left).toBe(-MAX_LEVEL_INDENT_PT);
    expect(level?.indent.right).toBe(MAX_LEVEL_INDENT_PT);
  });

  test('a negative w:hanging is refused — the slot cannot be right of its text', () => {
    const level = resolveNumberingLevel(
      numbering(`
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
            <w:pPr><w:ind w:left="720" w:hanging="-360"/></w:pPr></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      `),
      '1',
      0
    )?.level;
    expect(level?.indent.hanging).toBe(0);
  });

  test('a paragraph w:firstLine is read signed', () => {
    const merged = mergeListIndent({ left: 36, right: 0, hanging: 0, firstLine: 0 }, [
      { localName: 'ind', attributes: { left: '-720', firstLine: '-360' } },
    ]);
    expect(merged.left).toBe(-36);
    expect(merged.firstLine).toBe(-18);
  });
});

describe('a list pulled into the margin', () => {
  test('layout places the text left of the content origin, and its marker a hang further', () => {
    const part = document(
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t>Margin</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: numbering(NEGATIVE_LEVEL),
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.box.x).toBe(-18);
    expect(fragment.marker?.box.x).toBe(-36);
  });

  test('the marker never lands right of the text it numbers', () => {
    const part = document(
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t>Margin</w:t></w:r></w:p>`
    );
    const bodyElement = part.root!.children.find((child) => child.localName === 'body')!;
    const items = resolveStoryListItems(
      bodyElement.children.filter((child) => child.kind === 'paragraph'),
      numbering(NEGATIVE_LEVEL),
      undefined
    );
    const item = [...items.values()][0]!;
    const box = listMarkerBox(item, 6, 0, 14)!;
    expect(box.x).toBeLessThanOrEqual(item.indent.left);
  });
});
