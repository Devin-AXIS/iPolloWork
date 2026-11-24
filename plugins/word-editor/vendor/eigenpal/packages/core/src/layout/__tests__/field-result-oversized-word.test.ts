import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { documentOrder } from '../document-order.ts';
import { selectionMarkRects, selectionRects } from '../selection-rects.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { lineSegments } from '../line-segments.ts';
import {
  caretAt,
  caretStops,
  caretStopsForBlocks,
  hitTestSemantic,
} from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const field = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run(result) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function layout(content: string, table = false) {
  const paragraph = `<w:p>${content}</w:p>`;
  const body = table
    ? '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>' +
      '<w:left w:w="0"/><w:right w:w="0"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${paragraph}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('next')}</w:p></w:tc>` +
      '</w:tr></w:tbl>'
    : paragraph;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    geometry: { width: 120, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

const lineTexts = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) => line.spans.map((span) => span.text).join(''));

test('an oversized HYPERLINK field result wraps at the measure', () => {
  const result = layout(field(`HYPERLINK "https://example.org/" \\h`, TOKEN));
  expect(lineTexts(result)).toEqual(['ABCDEFGHIJKLMNOPQRST', 'UVWXY']);
  for (const line of linesOf(result)) {
    for (const span of line.spans) {
      expect(span.projected).toBe(true);
      expect(span.box.x + span.box.width).toBeLessThanOrEqual(120 + 0.01);
    }
  }
});

test('an oversized field result wraps inside a fixed table cell', () => {
  const result = layout(field(`HYPERLINK "https://example.org/" \\h`, TOKEN), true);
  const cell = lineTexts(result).filter((text) => text !== 'next');
  expect(cell).toEqual(['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXY', '']);
});

test('every chopped field fragment publishes the whole field range', () => {
  const result = layout(run('ab ') + field('HYPERLINK "https://example.org/"', TOKEN + TOKEN));
  const spans = linesOf(result)
    .flatMap((line) => line.spans)
    .filter((span) => span.projected);
  expect(spans.length).toBeGreaterThan(1);
  for (const span of spans) expect(span.range).toEqual(spans[0]!.range);
  expect(spans.map((span) => span.text).join('')).toBe(TOKEN + TOKEN);
  expect(lineTexts(result)[0]).toBe('ab ');
});

test('the caret after a chopped field follows its last fragment', () => {
  const result = layout(run('ab ') + field('HYPERLINK "https://example.org/"', TOKEN + TOKEN));
  const fragments = linesOf(result).filter((line) => line.spans.some((span) => span.projected));
  const { paragraphId, end } = fragments[0]!.spans.find((span) => span.projected)!.range;
  const after = caretAt(result, { paragraphId, offset: end });
  const last = fragments.at(-1)!;
  const tail = last.spans.filter((span) => span.projected).at(-1)!;
  expect(after?.y).toBe(last.box.y);
  expect(after?.x).toBe(tail.box.x + tail.box.width);
});

test('a click on a later fragment resolves to the field', () => {
  const result = layout(run('ab ') + field('HYPERLINK "https://example.org/"', TOKEN + TOKEN));
  const fragments = linesOf(result).filter((line) => line.spans.some((span) => span.projected));
  const { start, end } = fragments[0]!.spans.find((span) => span.projected)!.range;
  const second = fragments[1]!;
  const hit = hitTestSemantic(result, { x: 30, y: second.box.y + 6 });
  expect([start, end]).toContain(hit!.position.offset);
});

test('a form control stays whole', () => {
  const dropdown =
    '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Dropdown1"/>' +
    `<w:ddList><w:listEntry w:val="${TOKEN}"/></w:ddList></w:ffData></w:fldChar></w:r>` +
    '<w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const spans = linesOf(layout(dropdown)).flatMap((line) => line.spans);
  expect(spans.filter((span) => span.fieldAtom?.formControl).map((span) => span.text)).toEqual([
    TOKEN,
  ]);
});

test('other cached field results chop the same way', () => {
  expect(lineTexts(layout(field('REF bookmark \\h', TOKEN)))).toEqual([
    'ABCDEFGHIJKLMNOPQRST',
    'UVWXY',
  ]);
});

test('a field result with spaces still wraps at its spaces', () => {
  expect(
    lineTexts(layout(field('HYPERLINK "https://example.org/"', 'ABCDEFGHIJ KLMNOPQRST')))
  ).toEqual(['ABCDEFGHIJ ', 'KLMNOPQRST']);
});

test('the caret after a field split at its spaces follows its last line', () => {
  const result = layout(
    run('ab ') + field('HYPERLINK "https://example.org/"', 'ABCDEFGHIJ KLMNOPQRST UVW')
  );
  const fragments = linesOf(result).filter((line) => line.spans.some((span) => span.projected));
  expect(fragments).toHaveLength(2);
  const { paragraphId, end } = fragments[0]!.spans.find((span) => span.projected)!.range;
  const tail = fragments[1]!.spans.filter((span) => span.projected).at(-1)!;
  const after = caretAt(result, { paragraphId, offset: end });
  expect(after?.y).toBe(fragments[1]!.box.y);
  expect(after?.x).toBe(tail.box.x + tail.box.width);
});

test('a field result in an East Asian paragraph chops at its own text', () => {
  const result = layout(run('中文') + field('HYPERLINK "https://example.org/"', TOKEN));
  const fragments = linesOf(result)
    .flatMap((line) => line.spans)
    .filter((span) => span.projected);
  expect(fragments.map((span) => span.text).join('')).toBe(TOKEN);
  expect(fragments.length).toBeGreaterThan(1);
  for (const span of fragments) expect(span.box.x + span.box.width).toBeLessThanOrEqual(120.01);
});

describe('a field cut across lines', () => {
  // The fixed cell cuts the field into three fragments, then 'next' follows in a new paragraph.
  const cut = () => {
    const result = layout(field('HYPERLINK "https://example.org/"', TOKEN), true);
    const lines = linesOf(result).filter((line) => line.spans.some((span) => span.projected));
    const { paragraphId, start, end } = lines[0]!.spans[0]!.range;
    return { result, lines, paragraphId, start, end };
  };

  test('covers the field range in the segment of every fragment line', () => {
    const { lines, start, end } = cut();
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(lineSegments(line)[0]).toMatchObject({ start, end });
  });

  test('a selection over the field highlights every fragment', () => {
    const { result, lines, paragraphId, start, end } = cut();
    const rects = selectionRects(
      result,
      { anchor: { paragraphId, offset: start }, head: { paragraphId, offset: end } },
      documentOrder(result)
    );
    expect(rects.map((rect) => rect.y)).toEqual(lines.map((line) => line.box.y));
  });

  test('a selected paragraph mark paints once, after the last fragment', () => {
    const { result, lines, paragraphId, start } = cut();
    const order = documentOrder(result);
    const next = order[order.indexOf(paragraphId) + 1]!;
    const marks = selectionMarkRects(
      result,
      { anchor: { paragraphId, offset: start }, head: { paragraphId: next, offset: 1 } },
      order
    );
    expect(marks.map((rect) => rect.y)).toEqual([lines.at(-1)!.box.y]);
  });

  test('caret stops put each field edge on the line caretAt draws it on', () => {
    const { result, lines, paragraphId, start, end } = cut();
    const stops = caretStops(result).filter((stop) => stop.position.paragraphId === paragraphId);
    expect(stops.map((stop) => stop.position.offset)).toEqual([start, end]);
    expect(stops.map((stop) => stop.lineId)).toEqual([lines[0]!.id, lines.at(-1)!.id]);
    for (const stop of stops) expect(caretAt(result, stop.position)?.lineId).toBe(stop.lineId);
  });
});

describe('a footer laid out on every page', () => {
  // The footer story is indexed once per page with the same line records.
  const twoPages = (footer: string) => {
    const part = (xml: string, name: string) => {
      const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
      if (!read.ok) throw new Error(read.reason);
      return read.part;
    };
    const styleCascade = elevenPointDefaults();
    const measurer = createFixedMeasurer(6, 12);
    const story = layoutHeaderFooterStory(
      part(`<w:ftr xmlns:w="${W}"><w:p>${footer}</w:p></w:ftr>`, '/word/footer1.xml'),
      60,
      measurer,
      'footer',
      undefined,
      styleCascade
    );
    const body = `<w:p>${run('one')}</w:p><w:p><w:r><w:br w:type="page"/></w:r>${run('two')}</w:p>`;
    const result = layoutSemanticDocument(
      part(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
        '/word/document.xml'
      ),
      1,
      {
        measurer,
        styleCascade,
        geometry: { width: 60, height: 200, margin: { top: 0, bottom: 40, left: 0, right: 0 } },
        furniture: {
          titlePage: false,
          evenAndOddHeaders: false,
          headers: new Map(),
          footers: new Map([['default', story]]),
        },
      }
    );
    expect(result.pages.length).toBe(2);
    const stops = caretStopsForBlocks(result, 0, story.fragments);
    const paragraphId = (story.fragments[0] as { paragraphId: string }).paragraphId;
    return { result, stops, paragraphId };
  };

  test('keeps the caret stop at the end of an ordinary paragraph', () => {
    const { result, stops, paragraphId } = twoPages(run('hello'));
    expect(stops.map((stop) => stop.position.offset)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(caretAt(result, { paragraphId, offset: 5 }, { preferredPageIndex: 0 })).not.toBeNull();
  });

  test('puts the end of a cut field on its last fragment line', () => {
    const { result, stops, paragraphId } = twoPages(
      field('HYPERLINK "https://example.org/"', TOKEN)
    );
    expect(stops.map((stop) => stop.position.offset)).toEqual([0, 1]);
    const lineIds = stops.map((stop) => stop.lineId);
    expect(new Set(lineIds).size).toBe(2);
    const after = caretAt(result, { paragraphId, offset: 1 }, { preferredPageIndex: 0 });
    expect(after?.lineId).toBe(lineIds[1]);
  });
});

test('a field carried to the next line with its word keeps its end there', () => {
  // `x ` fits after the first word; `yyyy` overflows and carries with `zz` to line 2.
  const result = layout(
    run('aaaaaaaaaaaa ') + field('HYPERLINK "https://e/"', 'x yyyy') + run('zz')
  );
  const lines = linesOf(result);
  const tail = lines.find((line) => line.spans.some((span) => span.text === 'yyyy'))!;
  const { paragraphId, start, end } = tail.spans.find((span) => span.projected)!.range;
  expect(caretAt(result, { paragraphId, offset: end })?.lineId).toBe(tail.id);
  const rects = selectionRects(
    result,
    { anchor: { paragraphId, offset: start }, head: { paragraphId, offset: end } },
    documentOrder(result)
  );
  expect(rects.some((rect) => rect.y === tail.box.y)).toBe(true);
});

test('the caret before a field cut across pages stays on its first page', () => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('ab ')}${field('HYPERLINK "https://e/"', TOKEN + TOKEN)}${run(' tail')}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    geometry: { width: 120, height: 30, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  expect(result.pages.length).toBeGreaterThan(1);
  const first = linesOf(result).find((line) => line.spans.some((span) => span.projected))!;
  const { paragraphId, start, end } = first.spans.find((span) => span.projected)!.range;
  const stops = caretStops(result).filter((stop) => stop.position.paragraphId === paragraphId);
  for (const offset of [start, end]) {
    const stop = stops.filter((candidate) => candidate.position.offset === offset);
    expect(stop).toHaveLength(1);
    for (const preferredPageIndex of [0, 1, 2])
      expect(caretAt(result, { paragraphId, offset }, { preferredPageIndex })?.lineId).toBe(
        stop[0]!.lineId
      );
  }
});

test('a space after a cut word hangs at the line end instead of opening the next line', () => {
  // 40 letters fill two 20-letter lines exactly; the space after them must not lead line 3.
  const word = 'ABCDEFGHIJKLMNOPQRST'.repeat(2);
  for (const content of [run(`${word} UV`), field('HYPERLINK "https://e/"', `${word} UV`)])
    expect(lineTexts(layout(content))).toEqual([
      'ABCDEFGHIJKLMNOPQRST',
      'ABCDEFGHIJKLMNOPQRST ',
      'UV',
    ]);
  const fieldLines = lineTexts(layout(field('HYPERLINK "https://e/"', 'ABCDEFGHIJKLMNOPQRST UV')));
  expect(fieldLines).toEqual(['ABCDEFGHIJKLMNOPQRST ', 'UV']);
});

test('a repeated header row resolves the field end on its own last fragment', () => {
  const header =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>' +
    `<w:p>${field('HYPERLINK "https://e/"', TOKEN)}</w:p></w:tc></w:tr>`;
  const row = `<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p>${run('row')}</w:p></w:tc></w:tr>`;
  const table =
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0"/><w:right w:w="0"/>' +
    '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
    header +
    row.repeat(12) +
    '</w:tbl>';
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${table}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    geometry: { width: 120, height: 100, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  expect(result.pages.length).toBeGreaterThan(1);
  const first = linesOf(result).find((line) => line.spans.some((span) => span.projected))!;
  const { paragraphId, start, end } = first.spans.find((span) => span.projected)!.range;
  for (const preferredPageIndex of [0, 1]) {
    const after = caretAt(result, { paragraphId, offset: end }, { preferredPageIndex })!;
    const before = caretAt(result, { paragraphId, offset: start }, { preferredPageIndex })!;
    expect(after.pageIndex).toBe(preferredPageIndex);
    expect(after.x).toBe(30);
    expect(after.y).toBeGreaterThan(before.y);
    expect(before.x).toBe(0);
  }
});
