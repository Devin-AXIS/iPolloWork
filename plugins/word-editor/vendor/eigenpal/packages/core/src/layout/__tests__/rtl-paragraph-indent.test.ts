import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../semantic-records.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

// In a bidi paragraph `w:left` (like `w:start`) is the LEADING indent, on the right margin,
// and a list level's `lvlJc` mirrors the same way `w:jc` does.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WIDTH = 400;
const TEXT = 'مرحبا '.repeat(20);

function read(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function numbering(jc: string, lvlText: string, start: number) {
  return buildNumberingIndex(
    read(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
        `<w:start w:val="${start}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="${lvlText}"/>` +
        `<w:lvlJc w:val="${jc}"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>` +
        `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
      '/word/numbering.xml'
    ).root
  );
}

function fragment(pPr: string, list?: { jc?: string; lvlText?: string; start?: number }) {
  return paragraphFragmentsOf(layoutOf(pPr, list).pages[0]!)[0]!;
}

function layoutOf(
  pPr: string,
  list?: { jc?: string; lvlText?: string; start?: number }
): SemanticLayout {
  const numPr = list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '';
  return layoutSemanticDocument(
    read(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${numPr}${pPr}</w:pPr>` +
        `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${TEXT}</w:t></w:r></w:p></w:body></w:document>`,
      '/word/document.xml'
    ),
    0,
    {
      measurer: createFixedMeasurer(6, 12),
      ...(list
        ? { numberingIndex: numbering(list.jc ?? 'left', list.lvlText ?? '%1.', list.start ?? 1) }
        : {}),
      geometry: { width: WIDTH, height: 600, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
  );
}

const lineRight = (frag: ReturnType<typeof fragment>, index: number) =>
  Math.max(...frag.lines[index]!.spans.map((span) => span.box.x + span.box.width));
const lineLeft = (frag: ReturnType<typeof fragment>, index: number) =>
  Math.min(...frag.lines[index]!.spans.map((span) => span.box.x));

describe('indents in a right-to-left paragraph', () => {
  test('`w:left` and `w:start` indent from the right margin', () => {
    for (const ind of ['w:left="1440"', 'w:start="1440"']) {
      const frag = fragment(`<w:bidi/><w:ind ${ind}/>`);
      expect(lineRight(frag, 0)).toBeCloseTo(WIDTH - 72, 5);
      expect(lineRight(frag, 1)).toBeCloseTo(WIDTH - 72, 5);
    }
  });

  test('`w:right` indents from the left margin', () => {
    const frag = fragment('<w:bidi/><w:ind w:right="1440"/>');
    expect(lineRight(frag, 0)).toBeCloseTo(WIDTH, 5);
    expect(lineLeft(frag, 1)).toBeGreaterThanOrEqual(72);
  });

  test('first-line and hanging offsets count from the leading indent', () => {
    const firstLine = fragment('<w:bidi/><w:ind w:left="1440" w:firstLine="720"/>');
    expect(lineRight(firstLine, 0)).toBeCloseTo(WIDTH - 108, 5);
    expect(lineRight(firstLine, 1)).toBeCloseTo(WIDTH - 72, 5);
    const hanging = fragment('<w:bidi/><w:ind w:left="1440" w:hanging="720"/>');
    expect(lineRight(hanging, 0)).toBeCloseTo(WIDTH - 36, 5);
    expect(lineRight(hanging, 1)).toBeCloseTo(WIDTH - 72, 5);
  });

  test('a list level indents from the right margin', () => {
    const frag = fragment('<w:bidi/>', {});
    expect(lineRight(frag, 1)).toBeCloseTo(WIDTH - 36, 5);
  });
});

describe('list markers in a right-to-left paragraph', () => {
  test('`lvlJc="left"` puts the leading (right) edge of the marker on its slot', () => {
    const marker = fragment('<w:bidi/>', { jc: 'left' }).marker!;
    expect(marker.box.x + marker.box.width).toBe(WIDTH - 18);
  });

  test('`lvlJc="right"` puts the trailing (left) edge of the marker on its slot', () => {
    const marker = fragment('<w:bidi/>', { jc: 'right' }).marker!;
    expect(marker.box.x).toBe(WIDTH - 18);
  });

  test('the marker text is published in visual order at the right-to-left base level', () => {
    const marker = fragment('<w:bidi/>', { start: 12 }).marker!;
    expect(marker.text).toBe('12.');
    expect(marker.pieces!.map((piece) => piece.text)).toEqual(['.', '12']);
    expect(marker.pieces!.map((piece) => piece.style.shaping?.level)).toEqual([1, 2]);
    const last = marker.pieces!.at(-1)!;
    expect(last.box.x + last.box.width).toBeCloseTo(marker.box.x + marker.box.width, 5);
    expect(marker.pieces![0]!.box.x + marker.pieces![0]!.box.width).toBeCloseTo(last.box.x, 5);
  });

  test('the painted marker orders its text right to left', () => {
    const host = document.createElement('div');
    paintSemanticLayout(host, layoutOf('<w:bidi/>', {}), { scale: 1 });
    const glyph = host.querySelector<HTMLElement>('.docx-list-marker > span')!;
    expect(glyph.dir).toBe('rtl');
    expect(glyph.textContent).toBe('1.');
  });

  test('a left-to-right paragraph publishes no pieces', () => {
    expect(fragment('', {}).marker!.pieces).toBeUndefined();
  });
});
