// `w:compat/w:doNotExpandShiftReturn`: a justified line that ends in a manual line break keeps
// its natural spacing, as a last line does.

import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { linesOf, type LineRecord, type TextMeasurer } from '../semantic-records.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer } from '../index.ts';
import { compatibilityProfileFromSettings } from '../compatibility/compatibility-profile.ts';
import type { PendingLine } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WIDTH = 120;
const measurer: TextMeasurer = createFixedMeasurer(6, 14);

function settings(compat: string) {
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:compat>${compat}</w:compat></w:settings>`,
    {
      name: '/word/settings.xml',
      contentType: 'application/xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const cascadeOf = (compat: string) =>
  buildStyleCascadeTable(null, undefined, settings(compat).root);
const ON = cascadeOf('<w:doNotExpandShiftReturn/>');
const OFF = cascadeOf('');

/** One paragraph: `text`, a break, then `after`; optionally inside a one-cell table. */
function body(
  text: string,
  options: { rtl?: boolean; table?: boolean; jc?: string; brk?: string } = {}
) {
  const { rtl = false, table = false, jc = 'both', brk = '<w:br/>' } = options;
  // Pin the size so this spacing test does not depend on document font defaults.
  const run = (content: string) =>
    `<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/>` +
    `${rtl ? '<w:rtl/>' : ''}</w:rPr>${content}</w:r>`;
  const paragraph =
    `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}<w:jc w:val="${jc}"/></w:pPr>` +
    `${run(`<w:t xml:space="preserve">${text}</w:t>`)}${run(brk)}${run('<w:t>tail</w:t>')}</w:p>`;
  const cell =
    `<w:tbl><w:tblPr><w:tblW w:w="${WIDTH * 20}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${WIDTH * 20}"/></w:tblGrid><w:tr><w:tc>` +
    `<w:tcPr><w:tcW w:w="${WIDTH * 20}" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`;
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${table ? cell : paragraph}` +
      `<w:sectPr><w:pgSz w:w="${(WIDTH + 30) * 20}" w:h="12000"/>` +
      '<w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

/** The ink extent of a line's words, in content-box coordinates. */
function edges(line: LineRecord): readonly [number, number] {
  const boxes = line.spans
    .filter((span) => span.text.trim())
    .map((span) => {
      const visible = measurer.measure(span.text.trim(), span.style);
      return (span.style.shaping?.level ?? 0) % 2
        ? [span.box.x + span.box.width - visible, span.box.x + span.box.width]
        : [span.box.x, span.box.x + visible];
    });
  return [Math.min(...boxes.map((box) => box[0]!)), Math.max(...boxes.map((box) => box[1]!))];
}

const lines = (part: ReturnType<typeof body>, styleCascade = ON) =>
  linesOf(layoutSemanticDocument(part, 0, { measurer, compatibilityMode: 15, styleCascade }));
const naturalWidth = (text: string) => measurer.measure(text, lines(body('x'))[0]!.spans[0]!.style);

test.each([
  ['without', 'aaa bbb ccc'],
  ['with', 'aaa bbb ccc '],
])('a justified line %s a trailing space before a line break keeps its spacing', (_, text) => {
  const [left, right] = edges(lines(body(text))[0]!);
  expect(left).toBeCloseTo(0, 3);
  expect(right).toBeCloseTo(naturalWidth('aaa bbb ccc'), 3);
  // Without the setting the same line fills the measure.
  expect(edges(lines(body(text), OFF)[0]!)[1]).toBeCloseTo(WIDTH, 3);
});

test('a right-to-left line before a line break sets at its start margin and hangs its space', () => {
  const plain = edges(lines(body('אבג דהו זחט', { rtl: true }))[0]!);
  expect(plain[1]).toBeCloseTo(WIDTH, 3);
  expect(plain[1] - plain[0]).toBeCloseTo(naturalWidth('אבג דהו זחט'), 3);
  // The trailing space does not move the text.
  const spaced = edges(lines(body('אבג דהו זחט ', { rtl: true }))[0]!);
  expect(spaced[0]).toBeCloseTo(plain[0], 3);
  expect(spaced[1]).toBeCloseTo(plain[1], 3);
  expect(edges(lines(body('אבג דהו זחט', { rtl: true }), OFF)[0]!)[0]).toBeCloseTo(0, 3);
});

test('a line before a line break in a table cell keeps its spacing', () => {
  const cell = (styleCascade: typeof ON) =>
    linesOf(
      layoutSemanticDocument(body('aaa bbb ccc', { table: true }), 0, {
        measurer,
        compatibilityMode: 15,
        styleCascade,
      })
    ).find((line) => line.spans.some((span) => span.text.includes('aaa')))!;
  expect(edges(cell(ON))[1]).toBeCloseTo(naturalWidth('aaa bbb ccc'), 3);
  expect(edges(cell(OFF))[1]).toBeCloseTo(WIDTH, 3);
});

test('a distributed line before a line break still fills the measure', () => {
  expect(edges(lines(body('aaa bbb ccc', { jc: 'distribute' }))[0]!)[1]).toBeCloseTo(WIDTH, 3);
});

test('only the line the break closes keeps its spacing', () => {
  const long = 'aaa bbb ccc ddd eee fff ggg hhh iii';
  const [wrapped, closed] = lines(body(long));
  expect(edges(wrapped!)[1]).toBeCloseTo(WIDTH, 3);
  const closedText = closed!.spans
    .map((span) => span.text)
    .join('')
    .trim();
  expect(closedText).toBe('ggg hhh iii');
  expect(edges(closed!)[1]).toBeCloseTo(naturalWidth(closedText), 3);
});

test('the setting reads as an on/off value and survives a save', () => {
  for (const [markup, on] of [
    ['<w:doNotExpandShiftReturn/>', true],
    ['<w:doNotExpandShiftReturn w:val="1"/>', true],
    ['<w:doNotExpandShiftReturn w:val="0"/>', false],
    ['<w:doNotExpandShiftReturn w:val="off"/>', false],
  ] as const) {
    expect(cascadeOf(markup).unstretchedManualBreakLines === true).toBe(on);
  }
  const saved = readOoxmlPart(serializeOoxmlPart(settings('<w:doNotExpandShiftReturn/>')), {
    name: '/word/settings.xml',
    contentType: 'application/xml',
  });
  if (!saved.ok) throw new Error(saved.reason);
  expect(compatibilityProfileFromSettings(saved.part.root).has('unstretchedManualBreakLines')).toBe(
    true
  );
});

test('changing the setting invalidates retained layout', () => {
  expect(ON.cacheToken).not.toBe(OFF.cacheToken);
  const source = body('aaa bbb ccc');
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (const styleCascade of [OFF, ON, OFF]) {
    const options = { measurer, compatibilityMode: 15, styleCascade };
    const warm = layoutSemanticDocument(source, 0, { ...options, session, cache });
    const fresh = layoutSemanticDocument(source, 0, options);
    expect(warm.pages).toEqual(fresh.pages);
    expect(edges(linesOf(warm)[0]!)[1]).toBeCloseTo(
      styleCascade === ON ? naturalWidth('aaa bbb ccc') : WIDTH,
      3
    );
  }
});
