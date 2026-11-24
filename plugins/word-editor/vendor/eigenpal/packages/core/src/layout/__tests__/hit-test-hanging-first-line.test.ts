// A press on first-line text that is painted OUTSIDE its paragraph box.
//
// A paragraph box starts at the left indent. A hanging first line — a hanging indent, or a
// numbered paragraph whose suffix tab stops before the indent — paints its text left of that
// box (right of it in a right-to-left paragraph). A press on that text must resolve to the
// text, not to whichever neighbouring box is nearer.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { blockDistance } from '../hit-test-blocks.ts';
import {
  paragraphFragmentsOf,
  type ParagraphFragmentRecord,
  type SemanticLayout,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// Marker slot at 42pt (left 150pt, hanging 108pt); the paragraph box starts at 150pt. A
// right-to-left paragraph reads the same level from its leading (right) side.
function numbering() {
  return buildNumberingIndex(
    read(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
        `<w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/>` +
        `<w:lvlJc w:val="left"/><w:pPr>` +
        `<w:ind w:left="3000" w:hanging="2160"/></w:pPr>` +
        `<w:rPr><w:sz w:val="22"/></w:rPr></w:lvl></w:abstractNum>` +
        `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
      '/word/numbering.xml'
    ).root
  );
}

const run = (text: string) => `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r>`;
const plain = (text: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr>${run(text)}</w:p>`;
const TEXT = 'first words of the item';
// 1418tw = 70.9pt: the suffix tab stops there, 79.65pt left of the 150.55pt box edge.
const numbered = (pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` +
  `<w:tabs><w:tab w:val="num" w:pos="1418"/></w:tabs></w:pPr>${run(TEXT)}</w:p>`;

function layout(body: string): SemanticLayout {
  const part = read(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  return layoutSemanticDocument(part, 1, {
    measurer,
    numberingIndex: numbering(),
    geometry: { width: 400, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
}

/** The paragraph that carries `TEXT`, and the x of its first glyph. */
function target(result: SemanticLayout): ParagraphFragmentRecord {
  const found = paragraphFragmentsOf(result.pages[0]!).find((fragment) =>
    fragment.lines.some((line) => line.spans.some((span) => span.text.includes('first')))
  );
  if (!found) throw new Error('no target paragraph');
  return found;
}

function press(result: SemanticLayout, x: number, y: number) {
  const hit = hitTestPage(result, 0, { x, y }, { measurer });
  if (!hit) throw new Error('no hit');
  return hit;
}

describe('a press on first-line text left of the paragraph box', () => {
  const body = plain('previous paragraph words') + numbered();

  test('resolves to the numbered paragraph, on the glyph under the pointer', () => {
    const result = layout(body);
    const paragraph = target(result);
    const line = paragraph.lines[0]!;
    const first = line.spans[0]!;
    expect(first.box.x).toBeCloseTo(70.9, 5);
    expect(paragraph.box.x).toBeCloseTo(150, 0);
    // Two glyphs into the first word, level with the first line.
    const hit = press(result, first.box.x + 13, line.box.y + 2);
    expect(hit.position.paragraphId).toBe(paragraph.paragraphId);
    expect(hit.position.offset).toBe(2);
    expect(hit.onGlyphs).toBe(true);
    expect(hit.caret.x).toBeCloseTo(first.box.x + 12, 5);
  });

  test('a press on the previous paragraph still resolves there', () => {
    const result = layout(body);
    const previous = paragraphFragmentsOf(result.pages[0]!)[0]!;
    const line = previous.lines[0]!;
    const hit = press(result, 20, line.box.y + line.box.height - 1);
    expect(hit.position.paragraphId).toBe(previous.paragraphId);
    expect(hit.position.offset).toBeGreaterThan(2);
  });

  test('continuation lines keep the indent box', () => {
    const long = plain('previous paragraph words') + numbered().replace(TEXT, `${TEXT} `.repeat(6));
    const result = layout(long);
    const paragraph = target(result);
    expect(paragraph.lines.length).toBeGreaterThan(1);
    const second = paragraph.lines[1]!;
    const hit = press(result, second.spans[0]!.box.x + 1, second.box.y + 2);
    expect(hit.position.paragraphId).toBe(paragraph.paragraphId);
    expect(hit.position.offset).toBe(second.range.start);
  });

  test('a hanging indent without numbering behaves the same', () => {
    const hanging =
      plain('previous paragraph words') + plain(TEXT, '<w:ind w:left="3000" w:hanging="2600"/>');
    const result = layout(hanging);
    const paragraph = target(result);
    const first = paragraph.lines[0]!.spans[0]!;
    expect(first.box.x).toBe(20);
    const hit = press(result, first.box.x + 7, paragraph.lines[0]!.box.y + 2);
    expect(hit.position.paragraphId).toBe(paragraph.paragraphId);
    expect(hit.position.offset).toBe(1);
    expect(hit.onGlyphs).toBe(true);
  });

  test('a table cell resolves the same way', () => {
    const cell = (content: string) =>
      `<w:tbl><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc>${content}</w:tc>` +
      `</w:tr></w:tbl>`;
    const result = layout(cell(plain('previous paragraph words') + numbered()));
    const paragraph = target(result);
    const line = paragraph.lines[0]!;
    const first = line.spans[0]!;
    expect(first.box.x).toBeLessThan(paragraph.box.x - 40);
    const hit = press(result, first.box.x + 13, line.box.y + 2);
    expect(hit.position.paragraphId).toBe(paragraph.paragraphId);
    expect(hit.position.offset).toBe(2);
    expect(hit.onGlyphs).toBe(true);
  });
});

describe('a right-to-left first line right of the paragraph box', () => {
  test('resolves to that paragraph', () => {
    const body = plain('previous paragraph words', '<w:bidi/>') + numbered('<w:bidi/>');
    const result = layout(body);
    const paragraph = target(result);
    const line = paragraph.lines[0]!;
    const right = Math.max(...line.spans.map((span) => span.box.x + span.box.width));
    expect(right).toBeGreaterThan(paragraph.box.x + paragraph.box.width + 40);
    const hit = press(result, right - 3, line.box.y + 2);
    expect(hit.position.paragraphId).toBe(paragraph.paragraphId);
    expect(hit.onGlyphs).toBe(true);
  });
});

describe('the paragraph distance the ranking uses', () => {
  const record = (lines: unknown[], clipToBox?: true) =>
    ({
      kind: 'paragraph',
      box: { x: 100, y: 0, width: 100, height: 20 },
      lines,
      ...(clipToBox ? { clipToBox } : {}),
    }) as unknown as ParagraphFragmentRecord;
  const line = (spanX: number) => ({
    box: { x: 100, y: 0, width: 100, height: 10 },
    spans: [{ box: { x: spanX, y: 0, width: 20, height: 10 } }],
  });

  test('is the box distance when the text stays inside the box', () => {
    expect(blockDistance(record([line(110)]), { x: 50, y: 5 }, 8)).toBe(50);
  });

  test('is zero on first-line text outside the box', () => {
    expect(blockDistance(record([line(40)]), { x: 50, y: 5 }, 8)).toBe(0);
  });

  test('ignores text a clipped box hides', () => {
    expect(blockDistance(record([line(40)], true), { x: 50, y: 5 }, 8)).toBe(50);
  });

  test('counts an inline drawing painted outside the box', () => {
    const withDrawing = record([
      { ...line(110), drawings: [{ x: 30, y: 0, width: 20, height: 10 }] },
    ]);
    expect(blockDistance(withDrawing, { x: 35, y: 5 }, 8)).toBe(0);
  });

  test('still measures vertical distance above the paragraph', () => {
    expect(blockDistance(record([line(40)]), { x: 50, y: -2 }, 8)).toBe(16);
  });
});
