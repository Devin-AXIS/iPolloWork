import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { spanOffsetX } from '../semantic-hit-test.ts';
import { anchorLineStartsByModelOffset } from '../anchor-line-probe.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const run = (text: string, bold = false) =>
  `<w:r><w:rPr><w:sz w:val="22"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
/** An inline picture `widthPt` wide, so a line can start with a drawing and no text. */
const picture = (widthPt: number) => {
  const cx = widthPt * 12700;
  const cy = 10 * 12700;
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="picture"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
};
const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 40,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});
const measurer = createFixedMeasurer(10, 12);
function layout(body: string, width = 25, paragraphProperties = '') {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body><w:p>${paragraphProperties}${body}</w:p></w:body></w:document>`,
    { name: OWNER, contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const original = serializeOoxmlPart(parsed.part);
  const atoms = indexInlineDrawingProjectionsInPart(parsed.part);
  const inlineDrawingLayout: InlineDrawingLayoutContext = {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
  const result = layoutSemanticDocument(parsed.part, 1, {
    measurer,
    inlineDrawingLayout,
    geometry: { width, height: 300, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  expect(serializeOoxmlPart(parsed.part)).toBe(original);
  return linesOf(result);
}
const texts = (lines: ReturnType<typeof layout>) =>
  lines.map((line) => line.spans.map((span) => span.text).join(''));

describe('separate whitespace runs at a soft-wrap margin', () => {
  test('retains the separator on its old line without indenting the next word', () => {
    const lines = layout(run('AB') + run(' ', true) + run('CD'));
    expect(texts(lines)).toEqual(['AB ', 'CD']);
    const space = lines[0]!.spans.at(-1)!;
    expect(space.range).toMatchObject({ start: 2, end: 3 });
    expect(space.box.width).toBe(5);
    expect(spanOffsetX(space, 3, measurer)).toBe(25);
    expect(lines[1]!.spans[0]!.box.x).toBe(0);
  });
  test('keeps long and producer-split space runs in the same line', () => {
    const spaces = run('  ', true) + run('  ');
    expect(texts(layout(run('AB') + spaces + run('CD', true)))).toEqual(['AB    ', 'CD']);
  });
  test('ordinary spaces that fit retain their measured advance', () => {
    const lines = layout(run('A') + run(' ', true) + run('B'), 40);
    expect(texts(lines)).toEqual(['A B']);
    expect(lines[0]!.spans[1]!.box.width).toBe(10);
  });
  test('does not drop an authored paragraph indent made from spaces', () => {
    const lines = layout(run(' ', true) + run('A'));
    expect(texts(lines)).toEqual([' A']);
    expect(lines[0]!.spans.at(-1)!.box.x).toBe(10);
  });
  test('does not collapse leading spaces after a hard break', () => {
    const lines = layout(run('AB') + '<w:r><w:br/></w:r>' + run(' ', true) + run('C'));
    expect(texts(lines)).toEqual(['AB\n', ' C']);
    expect(lines[1]!.spans.at(-1)!.box.x).toBe(10);
  });
  test('keeps nonbreaking spaces non-collapsible', () => {
    const lines = layout(run('AB') + run('\u00a0', true) + run('C'));
    expect(
      lines.flatMap((line) => line.spans).find((span) => span.text === '\u00a0')!.box.width
    ).toBe(10);
  });
  test('hangs an overflowing space run after an inline drawing that starts the line', () => {
    // The drawing is the only content so far; the space still hangs instead of wrapping.
    const lines = layout(picture(30) + run(' ', true) + run('CD'), 35);
    expect(texts(lines)).toEqual([' ', 'CD']);
    expect(lines[0]!.drawings).toHaveLength(1);
    const space = lines[0]!.spans[0]!;
    expect(space.lineEndWhitespace).toBe(true);
    expect(space.box.x + space.box.width).toBeLessThanOrEqual(35);
    expect(lines[1]!.spans[0]!.box.x).toBe(0);
  });
});

describe('justified lines ending in clipped space runs', () => {
  const justified = '<w:pPr><w:jc w:val="both"/></w:pPr>';
  const endOfB = (lines: ReturnType<typeof layout>) => {
    const b = lines[0]!.spans.find((span) => span.text === 'B')!;
    return spanOffsetX(b, b.range.end, measurer);
  };
  test('stretches the line the same way with one or two hanging space runs', () => {
    const one = layout(run('A B') + run(' ', true) + run('CD'), 35, justified);
    const two = layout(run('A B') + run(' ', true) + run(' ') + run('CD'), 35, justified);
    expect(texts(one)).toEqual(['A B ', 'CD']);
    expect(texts(two)).toEqual(['A B  ', 'CD']);
    // `B` is flush with the measure on the first line either way.
    expect(endOfB(one)).toBe(35);
    expect(endOfB(two)).toBe(35);
    // The last line stays flush left.
    expect(one[1]!.spans[0]!.box.x).toBe(0);
    expect(two[1]!.spans[0]!.box.x).toBe(0);
  });
});

describe('same-run trailing spaces at a soft-wrap margin', () => {
  test('keeps the word when only its same-run separator overflows', () => {
    const lines = layout(run('XY AB CD'), 55);
    expect(texts(lines)).toEqual(['XY AB ', 'CD']);
    const fill = lines[0]!.spans.at(-1)!;
    expect(fill.text).toBe(' ');
    expect(fill.lineEndWhitespace).toBe(true);
    expect(fill.box).toMatchObject({ x: 50, width: 5 });
    expect(fill.range).toMatchObject({ start: 5, end: 6 });
    expect(spanOffsetX(fill, 6, measurer)).toBe(55);
  });
  test('aligns the visible word and preserves a margin caret for the clipped fill', () => {
    for (const [alignment, end] of [
      ['center', 52.5],
      ['right', 55],
      ['both', 55],
    ] as const) {
      const lines = layout(run('XY AB CD'), 55, `<w:pPr><w:jc w:val="${alignment}"/></w:pPr>`);
      expect(texts(lines)).toEqual(['XY AB ', 'CD']);
      const word = lines[0]!.spans.find((span) => span.text === 'AB')!;
      expect(word.box.x + word.box.width).toBe(end);
      expect(word.lineEndWhitespace).toBeUndefined();
      expect(spanOffsetX(word, word.range.end, measurer)).toBe(end);
    }
  });

  test('keeps exact-fit words, repeated separators and drawing-led words on their line', () => {
    expect(texts(layout(run('XY AB CD'), 50))).toEqual(['XY AB ', 'CD']);
    expect(texts(layout(run('XY AB   CD'), 55))).toEqual(['XY AB   ', 'CD']);
    expect(texts(layout(picture(30) + run('AB CD'), 55))).toEqual(['AB ', 'CD']);
    expect(texts(layout(run('AB CD'), 25))).toEqual(['AB ', 'CD']);
    expect(texts(layout(run('XY AB CD'), 60))).toEqual(['XY AB ', 'CD']);
    expect(texts(layout(run('XY AB CD'), 45))).toEqual(['XY ', 'AB ', 'CD']);
  });
  test('predicts the same anchor line after a clipped same-run separator', () => {
    const text = 'XY AB CD';
    const starts = anchorLineStartsByModelOffset({
      pieces: [{ text, start: 0, end: text.length, props: [], style: DEFAULT_RUN_STYLE }],
      measurer,
      available: 55,
      firstLineOffset: 0,
      anchorStarts: [3, 6],
      equationLayoutOf: () => null,
    });
    const lines = layout(run(text), 55);
    expect(starts.get(3)).toBe(lines[0]!.range.start);
    expect(starts.get(6)).toBe(lines[1]!.range.start);
    expect(starts.get(6)).toBe(6);
  });
});
