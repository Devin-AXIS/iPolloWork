// An `atLeast` line grows its box upward: the glyphs sit on the floor of the box, so no
// spacing lies below them. The whole box must fit above the bottom text margin. Only `auto`
// spacing below the glyph band may cross that margin.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// Natural lines are 14pt tall at 11pt.
const measurer = createFixedMeasurer(6, 14);
const size = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const run = (text: string) => `<w:r>${size}<w:t>${text}</w:t></w:r>`;
const lay = (part: OoxmlPart) => layoutSemanticDocument(part, 1, { measurer });

// 200pt wide, 316pt tall sheets with 10pt margins: a 296pt content box. Fourteen 20pt lines
// use 280pt; a fifteenth ends at 300pt, 4pt past the bottom.
const sect =
  '<w:sectPr><w:pgSz w:w="4000" w:h="6320"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const atLeast = '<w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="atLeast"/>';
const exact = '<w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/>';
// 28pt lines with 14pt of spacing below the glyphs: an eleventh line ends 12pt past the bottom.
const double = '<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/>';
const noWidows = '<w:widowControl w:val="0"/>';

const paragraph = (text: string, pPr: string) =>
  `<w:p><w:pPr>${pPr}${size}</w:pPr>${run(text)}</w:p>`;
const fill = (count: number, pPr: string, prefix = 'line') =>
  Array.from({ length: count }, (_, line) => paragraph(`${prefix}${line}`, pPr)).join('');
/** One paragraph of `count` lines separated by manual line breaks. */
const lines = (count: number, pPr: string) =>
  `<w:p><w:pPr>${pPr}${size}</w:pPr>` +
  Array.from(
    { length: count },
    (_, line) => `${line > 0 ? `<w:r>${size}<w:br/></w:r>` : ''}${run(`part${line}`)}`
  ).join('') +
  '</w:p>';

const paragraphsOn = (layout: SemanticLayout, page: number): ParagraphFragmentRecord[] =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
const linesPerPage = (layout: SemanticLayout): number[] =>
  layout.pages.map((_, page) =>
    paragraphsOn(layout, page).reduce((sum, fragment) => sum + fragment.lines.length, 0)
  );

describe('an atLeast line at the bottom of the page', () => {
  test('moves to the next page when its box crosses the bottom margin', () => {
    const layout = lay(load(fill(15, noWidows + atLeast) + sect));
    expect(linesPerPage(layout)).toEqual([14, 1]);
  });

  test('publishes its extra space above the glyphs and none below them', () => {
    const layout = lay(load(fill(1, atLeast) + sect));
    const line = paragraphsOn(layout, 0)[0]!.lines[0]!;
    expect(line.box.height).toBe(20);
    expect(line.leading).toBeCloseTo(6, 6);
    expect(line.trailingSpacing).toBe(0);
  });

  test('gives an empty paragraph a caret as tall as its glyph band', () => {
    const layout = lay(load(`<w:p><w:pPr>${atLeast}${size}</w:pPr></w:p>` + sect));
    const paragraphId = paragraphsOn(layout, 0)[0]!.paragraphId;
    const caret = caretAt(layout, { paragraphId, offset: 0 }, measurer);
    expect(caret?.height).toBeCloseTo(14, 6);
    expect(caret?.y).toBeCloseTo(6, 6);
  });

  test('moves a paragraph whole when only its first line fits and widow control is on', () => {
    // Thirteen lines use 260pt. The first line of the four-line paragraph ends at 280pt and
    // the second at 300pt: one line alone would be an orphan.
    const layout = lay(load(fill(13, atLeast) + lines(4, atLeast) + sect));
    expect(linesPerPage(layout)).toEqual([13, 4]);
    const moved = paragraphsOn(layout, 1)[0]!;
    expect(
      moved.lines[0]!.spans.map((span) => span.text)
        .join('')
        .trim()
    ).toBe('part0');
  });

  test('keeps the same pages through a retained session and after an edit', () => {
    const session = createLayoutSession();
    const before = load(fill(15, noWidows + atLeast) + sect);
    layoutSemanticDocument(before, 1, { measurer, session });
    const again = layoutSemanticDocument(before, 1, { measurer, session });
    expect(again.pages).toEqual(lay(before).pages);
    const edited = load(fill(15, noWidows + atLeast, 'edit') + sect);
    const warm = layoutSemanticDocument(edited, 1, { measurer, session });
    expect(linesPerPage(warm)).toEqual([14, 1]);
    expect(warm.pages).toEqual(lay(edited).pages);
  });
});

describe('controls', () => {
  test('an auto line may carry its spacing below the glyphs past the bottom margin', () => {
    const layout = lay(load(fill(11, noWidows + double) + sect));
    expect(linesPerPage(layout)).toEqual([11]);
    const last = paragraphsOn(layout, 0).at(-1)!.lines[0]!;
    expect(last.trailingSpacing).toBe(14);
    expect(last.box.y + last.box.height).toBe(308);
  });

  test('an exact line moves when its box crosses the bottom margin', () => {
    const layout = lay(load(fill(15, noWidows + exact) + sect));
    expect(linesPerPage(layout)).toEqual([14, 1]);
  });

  test('an atLeast value below the natural height fits by the natural box', () => {
    // 10pt is below the 14pt natural line, so each line is 14pt: 21 lines use 294pt.
    const small = '<w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="atLeast"/>';
    const layout = lay(load(fill(22, noWidows + small) + sect));
    expect(linesPerPage(layout)).toEqual([21, 1]);
  });
});
