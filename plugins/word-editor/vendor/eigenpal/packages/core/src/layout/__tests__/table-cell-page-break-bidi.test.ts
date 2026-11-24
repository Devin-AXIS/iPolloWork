import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { serializeOoxmlPart } from '../../store/package/ooxml-serialize.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import { bidiPieces } from '../rtl-paragraph.ts';
import { caretAt, hitTestSemantic } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout, TextMeasurer } from '../semantic-records.ts';

// A page break inside a table cell has no geometry. Bidi resolution, itemization and Arabic
// joining must read the cell's text as the same text without the break, while every span
// keeps its source offsets.

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const text = (value: string) => (value ? `<w:t xml:space="preserve">${value}</w:t>` : '');
const pageBreak = '<w:br w:type="page"/>';
const tab = '<w:tab/>';
const rtl = '<w:rtl/>';
const run = (content: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${content}</w:r>`;
const table = (content: string, width = 6000) =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>` +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${content}</w:tc></w:tr></w:tbl><w:p/>`;
const tabs = (bidi: boolean, alignment = 'decimal') =>
  `<w:pPr>${bidi ? '<w:bidi/>' : ''}<w:tabs><w:tab w:val="${alignment}" w:pos="3000"/></w:tabs></w:pPr>`;
const cell = (pPr: string, runs: string, width?: number) =>
  table(`<w:p>${pPr}${runs}</w:p>`, width);
const fixed = createFixedMeasurer(6, 12);

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
const snapshot = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2000000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
});
const font = snapshot.resolve(request);
if (font instanceof FontResolutionError) throw font;
const shaped = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: () => font,
  fallback: fixed,
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});

function part(body: string) {
  const result = readOoxmlPart(`<w:document ${NS}><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function layout(body: string, measurer: TextMeasurer = fixed) {
  return layoutSemanticDocument(part(body), 0, { measurer });
}
function cellParagraph(result: SemanticLayout) {
  const block = result.pages[0]!.fragments[0]!;
  if (block.kind !== 'table') throw new Error('Expected table');
  const p = block.rows[0]!.cells[0]!.blocks[0]!;
  if (p.kind !== 'paragraph') throw new Error('Expected paragraph');
  return p;
}
const round = (value: number) => Math.round(value * 1e6) / 1e6;
function tabBox(result: SemanticLayout) {
  const span = cellParagraph(result).lines[0]!.spans.find((s) => s.text === '\t');
  return span && [round(span.box.x), round(span.box.width)];
}
/** Each visible character's box, left to right, laid out in its span's direction. */
function glyphs(result: SemanticLayout) {
  return cellParagraph(result)
    .lines.flatMap((line) => line.spans)
    .filter((span) => span.text !== '\f' && span.text !== '\t')
    .flatMap((span) => {
      const chars = Array.from(span.text);
      const width = span.box.width / chars.length;
      const reversed = span.style.shaping?.direction === 'rtl';
      return chars.map((char, index) => ({
        char,
        x: span.box.x + width * (reversed ? chars.length - 1 - index : index),
        width,
      }));
    })
    .sort((a, b) => a.x - b.x);
}
const visualText = (result: SemanticLayout) =>
  glyphs(result)
    .map(({ char }) => char)
    .join('');
/** The offset in the text without breaks: both sides of a break map to one offset. */
function withoutBreaks(result: SemanticLayout) {
  const breaks = cellParagraph(result)
    .lines.flatMap((line) => line.spans)
    .filter((span) => span.text === '\f')
    .map((span) => span.range.start);
  return (offset: number) => offset - breaks.filter((at) => at < offset).length;
}
/** The paragraph's last source offset. */
const endOf = (result: SemanticLayout) =>
  Math.max(...cellParagraph(result).lines.flatMap((line) => line.spans.map((s) => s.range.end)));
/**
 * Everything the reader sees: lines, tab, line widths, glyph order, the caret at each offset
 * (keyed by the offset without breaks), and where clicks inside the control's glyphs land.
 * With a `measurer`, carets inside a span use its measured advances.
 */
function geometry(result: SemanticLayout, control: SemanticLayout, measurer?: TextMeasurer) {
  const map = withoutBreaks(result);
  const carets = new Set<string>();
  for (let offset = 0; offset <= endOf(result); offset++) {
    const position = { paragraphId: cellParagraph(result).paragraphId, offset };
    const caret = caretAt(result, position, measurer)!;
    carets.add(`${map(offset)}@${round(caret.x)}`);
  }
  // A click inside each control glyph, clear of the ties at span edges.
  const y = caretAt(control, { paragraphId: cellParagraph(control).paragraphId, offset: 0 })!.y;
  const hits = glyphs(control).flatMap(({ x, width }) =>
    [0.25, 0.75].map((part) => {
      const hit = hitTestSemantic(result, { x: x + width * part, y: y + 1, pageIndex: 0 });
      return hit ? map(hit.position.offset) : undefined;
    })
  );
  return {
    lines: cellParagraph(result).lines.length,
    widths: cellParagraph(result).lines.map((line) => round(line.box.width)),
    tab: tabBox(result),
    visual: visualText(result),
    carets: [...carets],
    hits,
  };
}

describe('bidi text around an ignored cell page break', () => {
  test.each([
    ['an unmarked run', '', '12אב', '.3'],
    ['a w:rtl run', rtl, 'אבג', '.'],
    ['a w:rtl Arabic run', rtl, 'ببب', '.٣'],
  ])(
    'a decimal stop reads the letter before a break before the point, in %s',
    (_, rPr, before, after) => {
      const control = layout(cell(tabs(true), run(tab + text(before + after), rPr)));
      const sameRun = layout(
        cell(tabs(true), run(tab + text(before) + pageBreak + text(after), rPr))
      );
      const ownRun = layout(
        cell(tabs(true), run(tab + text(before), rPr) + run(pageBreak, rPr) + run(text(after), rPr))
      );
      expect(tabBox(sameRun)).toEqual(tabBox(control));
      expect(tabBox(ownRun)).toEqual(tabBox(control));
    }
  );

  test('a formatting change before the point still ends the decimal lookback', () => {
    const bold = run(text('.3'), '<w:b/>');
    const control = layout(cell(tabs(true), run(tab + text('12אב')) + bold));
    const result = layout(cell(tabs(true), run(tab + text('12אב') + pageBreak) + bold));
    const unformatted = layout(cell(tabs(true), run(tab + text('12אב.3'))));
    expect(tabBox(result)).toEqual(tabBox(control));
    expect(tabBox(result)).not.toEqual(tabBox(unformatted));
  });

  const texts = ['1234.5', '12אב.3', 'אבג.12', 'אבג.', 'ببب.٣', '١٢٣.٤٥', 'אב 12.5'];
  const cases = texts.flatMap((value) =>
    [true, false].flatMap((bidi) =>
      ['', rtl].flatMap((rPr) =>
        Array.from({ length: value.length + 1 }, (_, at) => [value, bidi, rPr, at] as const)
      )
    )
  );
  test.each(['decimal', 'left'])(
    'every break position lays out as the text without it, %s tab',
    (alignment) => {
      for (const [value, bidi, rPr, at] of cases) {
        const pPr = tabs(bidi, alignment);
        const [before, after] = [value.slice(0, at), value.slice(at)];
        const label = `${bidi ? 'bidi' : 'ltr'} ${rPr ? 'w:rtl' : 'plain'} ${before}|${after}`;
        const control = layout(cell(pPr, run(tab + text(value), rPr)));
        const expected = geometry(control, control);
        const shapes = {
          'same run': run(tab + text(before) + pageBreak + text(after), rPr),
          'own run': run(tab + text(before), rPr) + run(pageBreak, rPr) + run(text(after), rPr),
          repeated: run(tab + text(before) + pageBreak + pageBreak + text(after), rPr),
        };
        for (const [shape, runs] of Object.entries(shapes)) {
          const actual = geometry(layout(cell(pPr, runs)), control);
          expect({ label, shape, ...actual }).toEqual({ label, shape, ...expected });
        }
      }
    }
  );

  test('a w:rtl number split by a break keeps one digit group, without a tab', () => {
    const pPr = '<w:pPr><w:bidi/></w:pPr>';
    const control = layout(cell(pPr, run(text('1234'), rtl)));
    const result = layout(cell(pPr, run(text('12') + pageBreak + text('34'), rtl)));
    expect(visualText(result)).toBe('1234');
    expect(geometry(result, control)).toEqual(geometry(control, control));
  });

  test('pieces keep their source offsets and the break takes the following level', () => {
    const piece = (value: string, start: number, props = [] as FieldAwarePiece['props']) => ({
      text: value,
      start,
      end: start + value.length,
      props,
      style: DEFAULT_RUN_STYLE,
    });
    const rtlProps = [{ localName: 'rtl' }] as unknown as FieldAwarePiece['props'];
    const pieces = [
      piece('אב', 0, rtlProps),
      { ...piece('\f', 2, rtlProps), breakKind: 'page' as const },
      piece('12', 3, rtlProps),
    ];
    const ignored = bidiPieces(pieces, true, undefined, true);
    expect(ignored.map((p) => [p.text, p.start, p.end, p.style.shaping?.level])).toEqual([
      ['אב', 0, 2, 1],
      ['\f', 2, 3, 2],
      ['12', 3, 5, 2],
    ]);
    // A body page break ends the line: it still resolves as whitespace.
    const body = bidiPieces(pieces, true);
    expect(body.map((p) => [p.text, p.start, p.end, p.style.shaping?.level])).toEqual([
      ['אב', 0, 2, 1],
      ['\f', 2, 3, 1],
      ['12', 3, 5, 2],
    ]);
  });

  test('save and reopen keep the break and the layout', () => {
    const source = part(cell(tabs(true), run(tab + text('12') + pageBreak + text('34.5'), rtl)));
    const reopened = readOoxmlPart(serializeOoxmlPart(source), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    const before = layoutSemanticDocument(source, 0, { measurer: fixed });
    const after = layoutSemanticDocument(reopened.part, 0, { measurer: fixed });
    const spans = (result: SemanticLayout) =>
      cellParagraph(result).lines[0]!.spans.map((s) => [s.text, s.range.start, s.range.end, s.box]);
    expect(spans(after)).toEqual(spans(before));
    expect(spans(after).map(([value]) => value)).toEqual(['\t', '12', '\f', '34.5']);
  });

  test('a manual line break and a body page break still split right-to-left text', () => {
    const pPr = '<w:pPr><w:bidi/></w:pPr>';
    const lineBreak = layout(cell(pPr, run(text('12') + '<w:br/>' + text('34'), rtl)));
    expect(cellParagraph(lineBreak).lines).toHaveLength(2);
    const body = layout(`<w:p>${pPr}${run(text('12') + pageBreak + text('34'), rtl)}</w:p>`);
    expect(body.pages).toHaveLength(2);
  });
});

describe('an ignored cell page break beside line-end spaces', () => {
  const face = '<w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/>';
  const bidi = '<w:pPr><w:bidi/></w:pPr>';
  const centered = '<w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr>';
  const long = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzab';
  // [label, pPr, cell width, text before the break, text after it]
  const cases = [
    ['a wrapped line ends in a space', bidi, 1500, tab + text('abc'), text(' def אבג דהו 123')],
    ['the paragraph ends in a space', bidi, 6000, text('abc'), text(' ')],
    ['a centered paragraph ends in a space', centered, 6000, text('abc'), text(' ')],
    ['two spaces end the paragraph', bidi, 6000, text('abc'), text('  ')],
    ['the space overflows the margin', bidi, 6000, text(long), text(' ')],
    ['left-to-right text continues after it', '', 6000, text('$12'), text('.50')],
  ] as const;
  const measurers = [
    ['fixed', fixed, ''],
    ['HarfBuzz', shaped, face],
  ] as const;

  test.each(cases)('%s: text, carets and hits match the text without it', (...testCase) => {
    const [, pPr, width, before, after] = testCase;
    for (const [name, measurer, rPr] of measurers) {
      // Shaped, the control's `abc ` is one span and the break splits it in two. A click
      // inside a shaped span that ends in a space snaps differently from one inside the
      // split halves, with or without a break, so shaped hits are not compared.
      const compared = (result: SemanticLayout) => {
        const { hits, ...rest } = geometry(result, control, measurer);
        return name === 'fixed' ? { hits, ...rest } : rest;
      };
      const control = layout(cell(pPr, run(before + after, rPr), width), measurer);
      for (const runs of [
        run(before + pageBreak + after, rPr),
        run(before, rPr) + run(pageBreak, rPr) + run(after, rPr),
      ]) {
        const actual = compared(layout(cell(pPr, runs, width), measurer));
        expect({ name, ...actual }).toEqual({ name, ...compared(control) });
      }
    }
  });

  test('a genuine run boundary before the space still hangs it', () => {
    // Right-to-left runs, so the paragraph-end space has the paragraph's direction and hangs.
    // A left-to-right run's space takes room there instead.
    const bold = run(text('abc'), '<w:b/><w:rtl/>');
    const control = layout(cell(bidi, bold + run(text(' '), '<w:rtl/>')));
    const result = layout(cell(bidi, bold + run(pageBreak + text(' '), '<w:rtl/>')));
    expect(geometry(result, control, fixed)).toEqual(geometry(control, control, fixed));
    expect(cellParagraph(result).lines[0]!.spans.at(-1)!.lineEndWhitespace).toBe(true);
  });
});

describe('merged paragraph boundaries with ignored cell page breaks', () => {
  const piece = (value: string, start: number) => ({
    text: value,
    start,
    end: start + value.length,
    props: [],
    style: DEFAULT_RUN_STYLE,
    ...(value === '\f' ? { breakKind: 'page' as const } : {}),
  });

  test('each boundary maps past the breaks before it', () => {
    const pieces = ['א', '\f', 'ב', 'ג', '\f', '\f', 'ד', 'ה'].map((value, at) => piece(value, at));
    const result = bidiPieces(pieces, true, new Set([2, 3, 6, 7]), true);
    expect(result.map((p) => [p.text, p.start, p.end])).toEqual([
      ['א', 0, 1],
      ['\f', 1, 2],
      ['ב', 2, 3],
      ['ג', 3, 4],
      ['\f', 4, 5],
      ['\f', 5, 6],
      ['ד', 6, 7],
      ['ה', 7, 8],
    ]);
  });

  test('many members that each end with a break resolve in linear time', () => {
    const count = 40000;
    const pieces = Array.from({ length: count * 2 }, (_, at) => piece(at % 2 ? '\f' : 'א', at));
    const boundaries = new Set(Array.from({ length: count }, (_, member) => member * 2));
    const started = performance.now();
    const result = bidiPieces(pieces, true, boundaries, true);
    const elapsed = performance.now() - started;
    expect(result).toHaveLength(count * 2);
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('Arabic joining across an ignored cell page break', () => {
  const face = '<w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/>';

  test.each([
    [true, 'right'],
    [false, 'right'],
    [true, 'decimal'],
  ])('the halves join as one word, bidi %p, %s tab', (bidi, alignment) => {
    const pPr = tabs(bidi, alignment);
    const control = layout(cell(pPr, run(tab + text('بببب'), face)), shaped);
    const result = layout(cell(pPr, run(tab + text('بب') + pageBreak + text('بب'), face)), shaped);
    const width = (r: SemanticLayout) =>
      cellParagraph(r)
        .lines[0]!.spans.filter((s) => s.text !== '\t')
        .reduce((sum, s) => sum + s.box.width, 0);
    expect(width(result)).toBeCloseTo(width(control), 6);
    const [controlTab, resultTab] = [tabBox(control)!, tabBox(result)!];
    expect(resultTab[0]).toBeCloseTo(controlTab[0]!, 6);
    expect(resultTab[1]).toBeCloseTo(controlTab[1]!, 6);
    // The word's edges match. Inside it, each half spreads its carets over its own glyphs,
    // and the unbroken word spreads them over the whole word.
    const carets = (r: SemanticLayout) => geometry(r, control).carets.map((c) => c.split('@'));
    const [expected, actual] = [carets(control), carets(result)];
    expect(actual.map(([offset]) => offset)).toEqual(expected.map(([offset]) => offset));
    expect([actual[1], actual.at(-1)]).toEqual([expected[1], expected.at(-1)]);
    const xs = actual.slice(1).map(([, x]) => Number(x));
    // The word runs right to left in either paragraph direction.
    expect(xs).toEqual([...xs].sort((a, b) => b - a));
    const contexts = cellParagraph(result)
      .lines[0]!.spans.filter((s) => s.text === 'بب')
      .map((s) => s.style.shaping?.context);
    expect(contexts).toEqual([
      { before: '', after: 'بب' },
      { before: 'بب', after: '' },
    ]);
  });
});
