// One offset can end a wrapped line and start the next. These cases pin which line the caret
// shows on, for every way the caret reaches that offset:
//
// - placed at the offset: the next line's start, where typed text lands;
// - End on the upper line: the same offset, shown at the end of the upper line;
// - Home on the lower line: the same offset, at the lower line's start;
// - a click past the upper line's end, or before the lower line's start: that line.
//
// A hard break owns no shared offset: End stops before the break, on its own line.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { caretAt, moveCaret, type SemanticPosition } from '../semantic-interaction.ts';
import type { LineRecord, SemanticLayout } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const measurer = createFixedMeasurer(6, 14);
const WIDTH = 120;
const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod';
const HEBREW = 'אבגד הוזח טיכל מנסע פצקר שתאב גדהו זחטי כלמנ סעפצ';
const ARABIC = 'كتاب مدرسة قلم بيت شمس قمر نجمة بحر جبل وادي شجرة';

const run = (text: string, rtl = false) =>
  `<w:r>${rtl ? '<w:rPr><w:rtl/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

function picture(cx: number): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="254000"/><wp:docPr id="1" name="p1"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="254000"/></a:xfrm><a:prstGeom prst="rect"/>` +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

interface Case {
  readonly label: string;
  readonly paragraph: string;
  readonly rtl?: boolean;
  readonly cell?: boolean;
}

const SOFT: readonly Case[] = [
  ...(['left', 'both', 'center', 'right'] as const).map((jc) => ({
    label: `left-to-right, ${jc}`,
    paragraph: `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>${run(WORDS)}</w:p>`,
  })),
  {
    label: 'one long word',
    paragraph: `<w:p>${run('abcdefghijklmnopqrstuvwxyz'.repeat(2))}</w:p>`,
  },
  {
    label: 'two runs',
    paragraph: `<w:p>${run(WORDS.slice(0, 30))}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${WORDS.slice(30)}</w:t></w:r></w:p>`,
  },
  {
    label: 'Hebrew',
    paragraph: `<w:p><w:pPr><w:bidi/></w:pPr>${run(HEBREW, true)}</w:p>`,
    rtl: true,
  },
  {
    label: 'Arabic, justified',
    paragraph: `<w:p><w:pPr><w:bidi/><w:jc w:val="both"/></w:pPr>${run(ARABIC, true)}</w:p>`,
    rtl: true,
  },
  {
    label: 'mixed directions',
    paragraph: `<w:p><w:pPr><w:bidi/></w:pPr>${run(HEBREW.slice(0, 20), true)}${run('ABCD EFGH ')}${run(HEBREW.slice(20), true)}</w:p>`,
    rtl: true,
  },
  {
    label: 'text before a wrapped picture',
    paragraph: `<w:p>${run('aaaa bbbb cccc ')}${picture(508000)}${run(' dddd')}</w:p>`,
  },
  {
    label: 'table cell',
    paragraph: `<w:p>${run(WORDS)}</w:p>`,
    cell: true,
  },
];

function layoutOf(item: Case): SemanticLayout {
  const body = item.cell
    ? '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' +
      item.paragraph +
      '</w:tc></w:tr></w:tbl><w:p/>'
    : item.paragraph;
  const part = load(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`);
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    geometry: { width: WIDTH, height: 600, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

function paragraphLines(layout: SemanticLayout): LineRecord[] {
  const lines = linesOf(layout);
  const id = lines[0]!.range.paragraphId;
  return lines.filter((line) => line.range.paragraphId === id);
}

/** The line a position shows on, honoring a preferred line. */
function shownLine(layout: SemanticLayout, position: SemanticPosition, lineId?: string) {
  return caretAt(layout, position, {
    measurer,
    ...(lineId !== undefined ? { preferredLineId: lineId } : {}),
  })?.lineId;
}

describe('a soft wrap', () => {
  for (const item of SOFT) {
    test(item.label, () => {
      const layout = layoutOf(item);
      const lines = paragraphLines(layout);
      expect(lines.length).toBeGreaterThan(1);
      const paragraphId = lines[0]!.range.paragraphId;
      for (let index = 0; index + 1 < lines.length; index += 1) {
        const upper = lines[index]!;
        const lower = lines[index + 1]!;
        const b = lower.range.start;
        expect(upper.range.end).toBe(b);
        const at = (offset: number) => ({ paragraphId, offset });

        // Placed at the offset: the lower line's start.
        expect(shownLine(layout, at(b))).toBe(lower.id);

        // End on the upper line: after its trailing space, shown on the upper line.
        const end = moveCaret(layout, at(upper.range.start + 1), 'lineEnd', null, { measurer })!;
        expect(end.position).toEqual(at(b));
        expect(end.lineId).toBe(upper.id);
        expect(shownLine(layout, end.position, end.lineId)).toBe(upper.id);

        // Home on the lower line: the same offset, on the lower line.
        const home = moveCaret(layout, at(b + 1), 'lineStart', null, { measurer })!;
        expect(home.position).toEqual(at(b));
        expect(shownLine(layout, home.position, home.lineId)).toBe(lower.id);

        // Home from the END of the upper line stays on the upper line.
        const back = moveCaret(layout, at(b), 'lineStart', null, { measurer, lineId: upper.id })!;
        expect(back.position).toEqual(at(upper.range.start));

        // Down from the end of the upper line reaches the lower line, not the one after it.
        const down = moveCaret(layout, at(b), 'down', null, { measurer, lineId: upper.id })!;
        expect(shownLine(layout, down.position, down.lineId)).toBe(lower.id);
        const up = moveCaret(layout, down.position, 'up', down.desiredX, {
          measurer,
          ...(down.lineId !== undefined ? { lineId: down.lineId } : {}),
        })!;
        expect(shownLine(layout, up.position, up.lineId)).toBe(upper.id);

        // Clicks beside the line edges keep the clicked line.
        const pastEnd = hitTestPage(
          layout,
          0,
          { x: item.rtl ? -5 : WIDTH + 5, y: upper.box.y + upper.box.height / 2 },
          { measurer }
        )!;
        expect(pastEnd.position).toEqual(at(b));
        expect(pastEnd.caret.lineId).toBe(upper.id);
      }
    });
  }
});

describe('a hard break', () => {
  for (const rtl of [false, true]) {
    test(rtl ? 'right-to-left' : 'left-to-right', () => {
      const layout = layoutOf({
        label: 'hard break',
        paragraph:
          `<w:p>${rtl ? '<w:pPr><w:bidi/></w:pPr>' : ''}<w:r>${rtl ? '<w:rPr><w:rtl/></w:rPr>' : ''}` +
          `<w:t>${rtl ? 'אבגד' : 'aaaa'}</w:t><w:br/><w:t>${rtl ? 'הוזח' : 'bbbb'}</w:t></w:r></w:p>`,
      });
      const [upper, lower] = paragraphLines(layout);
      const paragraphId = upper!.range.paragraphId;
      const at = (offset: number) => ({ paragraphId, offset });
      const b = lower!.range.start;
      expect(shownLine(layout, at(b))).toBe(lower!.id);
      const end = moveCaret(layout, at(1), 'lineEnd', null, { measurer })!;
      expect(end.position).toEqual(at(b - 1));
      expect(shownLine(layout, end.position, end.lineId)).toBe(upper!.id);
      const home = moveCaret(layout, at(b + 2), 'lineStart', null, { measurer })!;
      expect(home.position).toEqual(at(b));
      expect(shownLine(layout, home.position, home.lineId)).toBe(lower!.id);
    });
  }
});

describe('a field result cut across lines stays one unit', () => {
  test('Home and End keep the visual rule inside it', () => {
    const layout = layoutOf({
      label: 'field',
      paragraph:
        `<w:p>${run('x ')}<w:fldSimple w:instr=" QUOTE x "><w:r><w:t>aaaa</w:t><w:br/>` +
        `<w:t>bbbb</w:t><w:br/><w:t>cccc</w:t></w:r></w:fldSimple>${run(' y')}</w:p>`,
    });
    const lines = paragraphLines(layout);
    const paragraphId = lines[0]!.range.paragraphId;
    const at = (offset: number) => ({ paragraphId, offset });
    // The offset after the field shows on its last line, where typed text lands.
    expect(shownLine(layout, at(3))).toBe(lines.at(-1)!.id);
    // End on its first line stops before the field, where typed text lands too.
    const end = moveCaret(layout, at(1), 'lineEnd', null, { measurer })!;
    expect(end.position).toEqual(at(2));
    expect(shownLine(layout, end.position, end.lineId)).toBe(lines[0]!.id);
  });
});
