// A bordered or shaded paragraph that opens with a page break. The lines holding only the
// break draw no rule and take no space before; the text after the break opens the box on the
// next sheet, with the space before it would take there. Shading fills each break line where
// it sits, even past the text area.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { SemanticLayoutOptions } from '../semantic-layout-options.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// 350pt by 210pt sheets with 20pt margins: a 170pt text area holds twelve 14pt lines.
const sect =
  '<w:sectPr><w:pgSz w:w="7000" w:h="4200"/>' +
  '<w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${sect}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, compatibilityMode?: number): SemanticLayout =>
  layoutSemanticDocument(part, 1, {
    measurer,
    ...(compatibilityMode ? { compatibilityMode } : {}),
  });

const spacing = (before = 0, line = 280) =>
  `<w:spacing w:before="${before}" w:after="0" w:line="${line}" w:lineRule="exact"/>`;
const rules = (...sides: string[]) =>
  '<w:pBdr>' +
  sides.map((side) => `<w:${side} w:val="single" w:sz="8" w:space="0"/>`).join('') +
  '</w:pBdr>';
const TOP = rules('top');
const BOTTOM = rules('bottom');
const BOX = rules('top', 'left', 'bottom', 'right');
const SHADING = '<w:shd w:val="clear" w:color="auto" w:fill="CCCCCC"/>';
const br = '<w:r><w:br w:type="page"/></w:r>';

const paragraph = (text: string, pPr = '', before = 0) =>
  `<w:p><w:pPr>${pPr}${spacing(before)}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const fill = (count: number) =>
  Array.from({ length: count }, (_, line) => paragraph(`line${line}`)).join('');
/** A paragraph that opens with `breaks` page breaks, then holds `text`. */
const leading = (
  text: string,
  pPr: string,
  { breaks = 1, before = 0, line = 280 }: { breaks?: number; before?: number; line?: number } = {}
) =>
  `<w:p><w:pPr>${pPr}${spacing(before, line)}</w:pPr>${br.repeat(breaks)}` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** Every placed fragment of the top-level paragraph at `position`, with its page. */
const fragmentsAt = (layout: SemanticLayout, position: number) =>
  layout.pages.flatMap((page, index) =>
    page.fragments
      .filter(
        (fragment): fragment is ParagraphFragmentRecord =>
          fragment.kind === 'paragraph' && fragment.paragraphId.endsWith(`#0.0.${position}`)
      )
      .map((fragment) => ({ fragment, page: index }))
  );
const sides = (fragment: ParagraphFragmentRecord): string[] =>
  (fragment.borders ?? []).map((stroke) => `${stroke.side}@${stroke.box.y}`);

describe('a bordered paragraph that opens with a page break', () => {
  const cases: [string, string, string[], number][] = [
    ['a top rule', TOP, ['top@0'], 1],
    ['a bottom rule', BOTTOM, ['bottom@14'], 0],
    ['a box', BOX, ['top@0', 'bottom@15', 'left@0', 'right@0'], 1],
  ];
  for (const [label, pPr, textRules, textTop] of cases) {
    for (const count of [8, 12]) {
      test(`with ${label} after ${count} lines keeps its rules with the text`, () => {
        const layout = lay(load(fill(count) + leading('after', pPr) + paragraph('tail')));
        expect(layout.pages).toHaveLength(2);
        const [breakLine, text] = fragmentsAt(layout, count);
        expect(breakLine!.page).toBe(0);
        expect(breakLine!.fragment.borders).toBeUndefined();
        expect(breakLine!.fragment.lines[0]!.box.y).toBe(count === 12 ? 156 : 112);
        expect(breakLine!.fragment.outOfFlow).toBe(count === 12 ? true : undefined);
        expect(text!.page).toBe(1);
        expect(sides(text!.fragment)).toEqual(textRules);
        expect(text!.fragment.lines[0]!.box.y).toBe(textTop);
      });
    }
  }

  test('moves its space before to the text in every mode', () => {
    for (const mode of [undefined, 11, 12, 14, 15]) {
      for (const count of [8, 12]) {
        const plain = lay(load(fill(count) + leading('after', '', { before: 240 })), mode);
        const [plainBreak, plainText] = fragmentsAt(plain, count);
        expect(plainBreak!.fragment.lines[0]!.box.y).toBe(count === 12 ? 156 : 112);
        expect(plainText!.fragment.spacing.before).toBe(12);
        expect(plainText!.fragment.lines[0]!.box.y).toBe(12);
        const ruled = lay(load(fill(count) + leading('after', TOP, { before: 240 })), mode);
        const [, text] = fragmentsAt(ruled, count);
        expect(sides(text!.fragment)).toEqual(['top@12']);
        expect(text!.fragment.lines[0]!.box.y).toBe(13);
      }
    }
  });

  // The space before collapses with the space after of the paragraph above, as it would
  // without the break, even though that space after ends the previous sheet.
  const spaced = (text: string, attributes: string) =>
    `<w:p><w:pPr><w:spacing ${attributes} w:line="280" w:lineRule="exact"/></w:pPr>` +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const spacedBreak = (attributes: string) =>
    `<w:p><w:pPr><w:spacing ${attributes} w:line="280" w:lineRule="exact"/></w:pPr>${br}` +
    '<w:r><w:t>after</w:t></w:r></w:p>';
  const textTop = (body: string, position: number) => {
    const [, text] = fragmentsAt(lay(load(body), 15), position);
    return text!.fragment.lines[0]!.box.y;
  };

  test('collapses the moved space before with the space after above', () => {
    const above = fill(10) + spaced('above', 'w:before="0" w:after="240"');
    expect(textTop(above + spacedBreak('w:before="240" w:after="0"'), 11)).toBe(0);
    expect(textTop(above + spacedBreak('w:before="360" w:after="0"'), 11)).toBe(6);
  });

  test('moves an automatic space before, collapsed the same way', () => {
    const auto = spacedBreak('w:before="100" w:beforeAutospacing="1" w:after="0"');
    expect(textTop(fill(12) + auto, 12)).toBe(14);
    const autoAbove = spaced('above', 'w:before="0" w:after="100" w:afterAutospacing="1"');
    expect(textTop(fill(10) + autoAbove + auto, 11)).toBe(0);
  });

  test('collapses the space after of the moved text with the next paragraph', () => {
    const layout = lay(
      load(
        fill(12) +
          spacedBreak('w:before="0" w:after="240"') +
          spaced('next', 'w:before="240" w:after="0"')
      )
    );
    const [next] = fragmentsAt(layout, 13);
    expect(next!.page).toBe(1);
    expect(next!.fragment.lines[0]!.box.y).toBe(26);
  });

  test('draws no rule on the empty sheet of repeated breaks', () => {
    const layout = lay(load(fill(12) + leading('after', TOP, { breaks: 2 })));
    expect(layout.pages).toHaveLength(3);
    const [first, second, text] = fragmentsAt(layout, 12);
    expect([first!.page, second!.page, text!.page]).toEqual([0, 1, 2]);
    expect(first!.fragment.borders).toBeUndefined();
    expect(second!.fragment.borders).toBeUndefined();
    expect(sides(text!.fragment)).toEqual(['top@0']);
  });

  test('leaves the border group of the paragraph above', () => {
    for (const count of [7, 11]) {
      const layout = lay(load(fill(count) + paragraph('group', BOX) + leading('after', BOX)));
      expect(layout.pages).toHaveLength(2);
      const [above] = fragmentsAt(layout, count);
      const top = count * 14;
      expect(sides(above!.fragment)).toEqual([
        `top@${top}`,
        `bottom@${top + 15}`,
        `left@${top}`,
        `right@${top}`,
      ]);
      expect(above!.fragment.bottomBorder).toBeDefined();
      const [breakLine, text] = fragmentsAt(layout, count + 1);
      expect(breakLine!.fragment.borders).toBeUndefined();
      expect(sides(text!.fragment)).toEqual(['top@0', 'bottom@15', 'left@0', 'right@0']);
    }
  });

  test('keeps the first of two breaks on a full page inside a border group', () => {
    const sidesOnly = rules('left', 'right');
    const breaksOnly = `<w:p><w:pPr>${sidesOnly}${spacing()}</w:pPr>${br}${br}</w:p>`;
    const layout = lay(
      load(fill(11) + paragraph('group', sidesOnly) + breaksOnly + paragraph('after'))
    );
    expect(layout.pages).toHaveLength(3);
    const [first, second] = fragmentsAt(layout, 12);
    expect(first!.page).toBe(0);
    expect(first!.fragment.outOfFlow).toBe(true);
    expect(second!.page).toBe(1);
    expect(fragmentsAt(layout, 13).map(({ page }) => page)).toEqual([2]);
  });

  test('keeps the ordinary group when the paragraph has text before its break', () => {
    const textFirst =
      `<w:p><w:pPr>${BOX}${spacing()}</w:pPr><w:r><w:t>lead</w:t></w:r>${br}` +
      '<w:r><w:t>after</w:t></w:r></w:p>';
    const layout = lay(load(fill(3) + paragraph('group', BOX) + textFirst));
    const [above] = fragmentsAt(layout, 3);
    expect(above!.fragment.bottomBorder).toBeUndefined();
    const [lead] = fragmentsAt(layout, 4);
    expect(sides(lead!.fragment)).toEqual(['left@57', 'right@57']);
  });
});

describe('a shaded paragraph that opens with a page break', () => {
  test('fills the break line where it sits after a full page', () => {
    const layout = lay(load(fill(12) + leading('after', SHADING)));
    expect(layout.pages).toHaveLength(2);
    const [breakLine, text] = fragmentsAt(layout, 12);
    expect(breakLine!.fragment.outOfFlow).toBe(true);
    expect(breakLine!.fragment.shadingBox).toEqual({ x: 0, y: 168, width: 310, height: 14 });
    expect(text!.fragment.shadingBox).toEqual({ x: 0, y: 0, width: 310, height: 14 });
  });

  test('fills the break line when it fits', () => {
    const layout = lay(load(fill(8) + leading('after', SHADING)));
    const [breakLine] = fragmentsAt(layout, 8);
    expect(breakLine!.fragment.shadingBox).toEqual({ x: 0, y: 112, width: 310, height: 14 });
  });

  test('stops the fill at the page edge', () => {
    // A 28pt line after twelve 14pt lines would reach 196pt; the sheet ends 190pt below the
    // top of the text area.
    const layout = lay(load(fill(12) + leading('after', SHADING, { line: 560 })));
    const [breakLine] = fragmentsAt(layout, 12);
    expect(breakLine!.fragment.shadingBox).toEqual({ x: 0, y: 168, width: 310, height: 22 });
  });

  test('ignores the space before and the top rule on the break line', () => {
    const layout = lay(load(fill(12) + leading('after', BOX + SHADING, { before: 240 })), 15);
    const [breakLine, text] = fragmentsAt(layout, 12);
    expect(breakLine!.fragment.shadingBox!.y).toBe(168);
    expect(text!.fragment.lines[0]!.box.y).toBe(13);
  });
});

describe('leading break layout reuse', () => {
  test('lays out the same through a retained session', () => {
    const part = load(
      fill(11) + paragraph('group', BOX) + leading('after', BOX + SHADING) + fill(3)
    );
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, { measurer, session });
    const again = layoutSemanticDocument(part, 1, { measurer, session });
    expect(again.pages).toEqual(first.pages);
    expect(first.pages).toEqual(lay(part).pages);
  });

  for (const [label, before, after] of [
    ['adding', paragraph('after', BOX), leading('after', BOX)],
    ['removing', leading('after', BOX), paragraph('after', BOX)],
  ] as const) {
    test(`${label} the break re-places the paragraph above`, () => {
      const options: SemanticLayoutOptions = {
        measurer,
        session: createLayoutSession(),
        cache: createParagraphLayoutCache(),
      };
      const head = fill(3) + paragraph('group', BOX);
      layoutSemanticDocument(load(head + before + paragraph('tail')), 1, options);
      const warm = layoutSemanticDocument(load(head + after + paragraph('tail')), 2, options);
      expect(warm.pages).toEqual(lay(load(head + after + paragraph('tail'))).pages);
    });
  }
});
