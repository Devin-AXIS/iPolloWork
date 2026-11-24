// A wrapping object that its paragraph or line positions, near the bottom of the page.
//
// Modern modes (`wrappedAnchorsEndAtBottomMargin`): the object moves up to end at the bottom
// margin when it can stay at or below the top of its line. Otherwise its line moves to the next
// page with it, and an object that still crosses the margin there ends the page. Legacy modes
// (`wrappedAnchorsEndOnSheet`) move it up to end at the sheet bottom and never move the line.
// An object that does not wrap text keeps its offset in every mode.
//
// Letter page, 1in margins: a 648pt content box, 72pt from the sheet top and bottom. A filler
// line of exact height puts the anchor paragraph where a test needs it: at 560 by default, with
// 88pt left above the bottom margin. Multi-line paragraphs use exact 14pt lines.

import { describe, expect, test } from 'bun:test';
import { createLayoutSession } from '../layout-session.ts';
import {
  after,
  anchor,
  drawings,
  exactLine,
  filler,
  lineAt,
  linesParagraph,
  render,
  section,
  text,
} from './anchor-page-fit-fixtures.ts';

describe('modern modes: a wrapping object that cannot end at the bottom margin', () => {
  test('moves an anchor-only paragraph to the next page with its object', () => {
    const layout = render(filler() + `<w:p>${anchor({ y: 8, height: 300 })}</w:p>` + after);
    expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
    expect(lineAt(layout, 'After')!.page).toBe(1);
  });

  test('moves the same paragraph when the object sits at the right of the column', () => {
    const tall = anchor({ y: 8, height: 300, x: 368 });
    expect(drawings(render(filler() + `<w:p>${tall}</w:p>`))).toEqual([{ page: 1, y: 8 }]);
  });

  test('moves a paragraph with text, before or after the object', () => {
    for (const body of [
      `<w:p>${anchor({ y: 8, height: 300 })}<w:r><w:t>Text</w:t></w:r></w:p>`,
      `<w:p><w:r><w:t>Text</w:t></w:r>${anchor({ y: 8, height: 300 })}</w:p>`,
    ]) {
      const layout = render(filler() + body);
      expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
      expect(lineAt(layout, 'Text')).toEqual({ page: 1, y: 0 });
    }
  });

  test('moves the paragraph for a tall object after a short one', () => {
    const both = anchor({ y: 8, height: 20 }) + anchor({ y: 8, height: 300, x: 200 });
    expect(drawings(render(filler() + `<w:p>${both}</w:p>`))).toEqual([
      { page: 1, y: 8 },
      { page: 1, y: 8 },
    ]);
  });

  test('moves the paragraph for a line-relative object', () => {
    const tall = anchor({ y: 8, height: 300, frame: 'line' });
    expect(drawings(render(filler() + `<w:p>${tall}</w:p>`))).toEqual([{ page: 1, y: 8 }]);
  });

  test('stops a negative offset at the next page top margin', () => {
    const tall = anchor({ y: -200, height: 300 });
    expect(drawings(render(filler() + `<w:p>${tall}</w:p>`))).toEqual([{ page: 1, y: 0 }]);
  });

  test('splits a paragraph before the line that holds the object', () => {
    // The paragraph starts at 518, so line 5 starts at 574.
    for (const frame of ['paragraph', 'line'] as const) {
      const box = anchor({ y: 8, height: 300, x: 368, frame });
      const layout = render(filler(518) + linesParagraph(box, 5, 8) + after);
      expect(lineAt(layout, 'Line 4')).toEqual({ page: 0, y: 560 });
      expect(lineAt(layout, 'Line 5')).toEqual({ page: 1, y: 0 });
      expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
    }
  });

  test('moves the line when the lifted object would rise above that line', () => {
    // Lifted to end at 648, a 110pt object starts at 538: below the paragraph top (518) but
    // above its own line (574).
    const box = anchor({ y: 100, height: 110, x: 368 });
    const layout = render(filler(518) + linesParagraph(box, 5, 8));
    expect(lineAt(layout, 'Line 5')).toEqual({ page: 1, y: 0 });
    expect(drawings(layout)).toEqual([{ page: 1, y: 100 }]);
  });

  test('ends the page after an object taller than the page', () => {
    const layout = render(
      filler() + linesParagraph(anchor({ y: 8, height: 700, x: 368 }), 1, 3) + after
    );
    expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
    expect(lineAt(layout, 'Line 1')).toEqual({ page: 1, y: 0 });
    expect(lineAt(layout, 'Line 2')).toEqual({ page: 2, y: 0 });
    expect(lineAt(layout, 'After')!.page).toBe(2);
  });

  test('agrees with a fresh layout after an edit above the paragraph', () => {
    const body = (title: string) =>
      text(title) + filler(532) + linesParagraph(anchor({ y: 8, height: 300, x: 368 }), 3, 5);
    const session = createLayoutSession();
    render(body('Heading'), 15, session);
    const edited = render(body('Changed heading'), 15, session, 2);
    const fresh = render(body('Changed heading'));
    expect(drawings(edited)).toEqual(drawings(fresh));
    expect(lineAt(edited, 'Line 3')).toEqual(lineAt(fresh, 'Line 3'));
    expect(lineAt(fresh, 'Line 3')).toEqual({ page: 1, y: 0 });
    expect(lineAt(fresh, 'Line 2')!.page).toBe(0);
  });
});

describe('modern modes: a wrapping object that can end at the bottom margin', () => {
  test('moves up to end at the margin and keeps its paragraph', () => {
    // Below the margin (offset 120), and across it (offsets 68 and 60).
    for (const [y, height] of [
      [120, 40],
      [68, 40],
      [60, 60],
    ] as const) {
      const layout = render(filler() + `<w:p>${anchor({ y, height })}</w:p>` + after);
      expect(drawings(layout)).toEqual([{ page: 0, y: 648 - height }]);
      expect(lineAt(layout, 'After')!.page).toBe(0);
    }
  });

  test('keeps a paragraph with text and lifts a line-relative object too', () => {
    const withText = `<w:p>${anchor({ y: 120, height: 40 })}<w:r><w:t>Text</w:t></w:r></w:p>`;
    expect(drawings(render(filler() + withText))).toEqual([{ page: 0, y: 608 }]);
    const line = `<w:p>${anchor({ y: 120, height: 40, frame: 'line' })}</w:p>`;
    expect(drawings(render(filler() + line))).toEqual([{ page: 0, y: 608 }]);
  });

  test('keeps a later line when the lifted object stays below it', () => {
    const box = anchor({ y: 100, height: 60, x: 368 });
    const layout = render(filler(518) + linesParagraph(box, 5, 8));
    expect(lineAt(layout, 'Line 8')!.page).toBe(0);
    expect(drawings(layout)).toEqual([{ page: 0, y: 588 }]);
  });

  test('leaves an object that fits where it is', () => {
    expect(drawings(render(filler() + `<w:p>${anchor({ y: 8, height: 60 })}</w:p>`))).toEqual([
      { page: 0, y: 568 },
    ]);
  });
});

describe('objects that do not wrap text', () => {
  for (const mode of [15, 14]) {
    test(`keep their offset and their paragraph in mode ${mode}`, () => {
      for (const wrap of ['none', 'behind'] as const)
        for (const [y, height] of [
          [8, 300],
          [120, 40],
          [60, 60],
        ] as const) {
          const layout = render(
            filler() + `<w:p>${anchor({ y, height, wrap })}</w:p>` + after,
            mode
          );
          expect(drawings(layout)).toEqual([{ page: 0, y: 560 + y }]);
          expect(lineAt(layout, 'After')!.page).toBe(0);
        }
    });
  }
});

describe('legacy modes: a wrapping object near the bottom of the page', () => {
  for (const mode of [14, 12, null]) {
    test(`moves up to end at the sheet bottom and keeps its line in mode ${mode}`, () => {
      // The sheet bottom is 72pt below the content box: 720 in content coordinates.
      const layout = render(filler() + `<w:p>${anchor({ y: 8, height: 300 })}</w:p>` + after, mode);
      expect(drawings(layout)).toEqual([{ page: 0, y: 420 }]);
      expect(lineAt(layout, 'After')!.page).toBe(0);
    });
  }

  test('never moves above the sheet top', () => {
    const layout = render(filler() + `<w:p>${anchor({ y: 8, height: 800 })}</w:p>` + after, 14);
    expect(drawings(layout)).toEqual([{ page: 0, y: -72 }]);
    expect(lineAt(layout, 'After')!.page).toBe(0);
  });

  test('leaves an object that ends above the sheet bottom where it is', () => {
    const layout = render(filler() + `<w:p>${anchor({ y: 120, height: 40 })}</w:p>`, 14);
    expect(drawings(layout)).toEqual([{ page: 0, y: 680 }]);
  });

  test('keeps a later line and lifts its object', () => {
    const box = anchor({ y: 8, height: 300, x: 368 });
    const layout = render(filler(518) + linesParagraph(box, 5, 8), 14);
    expect(lineAt(layout, 'Line 8')!.page).toBe(0);
    expect(drawings(layout)).toEqual([{ page: 0, y: 420 }]);
  });
});

describe('the page-fit rule follows what publishes', () => {
  test('counts an object that ends on the margin after rounding as fitting', () => {
    // A4 with 1in margins leaves 697.9pt; this object lifts to end exactly there.
    const layout = render(
      filler(600) +
        `<w:p>${anchor({ y: 80, height: 508_057 / 12_700 })}</w:p>` +
        after +
        section(595.3, 841.9)
    );
    expect(drawings(layout)).toEqual([{ page: 0, y: 657.9 }]);
    expect(lineAt(layout, 'After')!.page).toBe(0);
  });

  test('ignores a hidden object', () => {
    const hidden = anchor({ y: 8, height: 300, hidden: true });
    const layout = render(filler() + `<w:p>${hidden}<w:r><w:t>Text</w:t></w:r></w:p>`);
    expect(lineAt(layout, 'Text')!.page).toBe(0);
  });

  test('publishes an object on a later page from the top of the part on that page', () => {
    // 100 lines split by the page bottom; the object on line 85 measures from page 2's top.
    const layout = render(linesParagraph(anchor({ y: 20, height: 50, x: 368 }), 85, 100) + after);
    expect(lineAt(layout, 'Line 85')!.page).toBe(1);
    expect(drawings(layout)).toEqual([{ page: 1, y: 20 }]);
  });

  test('keeps the object with its line when widow control moves the cut earlier', () => {
    const box = anchor({ y: 100, height: 110, x: 368 });
    const kept = linesParagraph(box, 8, 8).replace('<w:pPr>', '<w:pPr><w:widowControl/>');
    const layout = render(filler(518) + kept);
    expect(lineAt(layout, 'Line 6')!.page).toBe(0);
    expect(lineAt(layout, 'Line 7')).toEqual({ page: 1, y: 0 });
    expect(drawings(layout)[0]!.page).toBe(1);
  });

  test('moves a keep-with-next heading with the paragraph its object moves', () => {
    const heading =
      '<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/></w:pPr>' +
      '<w:r><w:t>Heading</w:t></w:r></w:p>';
    const body = `<w:p>${anchor({ y: 8, height: 300 })}<w:r><w:t>Body</w:t></w:r></w:p>`;
    const layout = render(filler(546) + heading + body);
    expect(lineAt(layout, 'Heading')).toEqual({ page: 1, y: 0 });
    expect(lineAt(layout, 'Body')!.page).toBe(1);
  });

  test('publishes an object that fits with its own line and moves a later one with its line', () => {
    // The paragraph starts at 518: line 3 at 546 holds an object that ends at 596; line 5 at
    // 574 holds one that cannot end at the margin.
    const fits = anchor({ y: 0, height: 50, x: 368, frame: 'line' });
    const tall = anchor({ y: 8, height: 300, x: 368, frame: 'line' });
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (line) => (line === 3 ? fits : line === 5 ? tall : '') + `<w:r><w:t>Line ${line}</w:t></w:r>`
    );
    const body = `<w:p>${exactLine(14)}${runs.join('<w:r><w:br/></w:r>')}</w:p>`;
    const layout = render(filler(518) + body);
    expect(lineAt(layout, 'Line 4')!.page).toBe(0);
    expect(lineAt(layout, 'Line 5')).toEqual({ page: 1, y: 0 });
    expect(drawings(layout)).toEqual([
      { page: 0, y: 546 },
      { page: 1, y: 8 },
    ]);
  });

  test('frames a moved object on its new page when a later page holds another object', () => {
    // 70 lines from 560. The object on line `at` cannot end at the margin: its line moves (a
    // split, or the whole paragraph), and a 700pt one also ends the page after it. It publishes
    // from the top of its fragment on page 2; a small object on line 60 publishes with its line.
    for (const { at, height } of [
      { at: 1, height: 300 },
      { at: 2, height: 300 },
      { at: 5, height: 300 },
      { at: 1, height: 700 },
      { at: 3, height: 700 },
    ]) {
      const runs = Array.from({ length: 70 }, (_, index) => {
        const line = index + 1;
        const own =
          line === at
            ? anchor({ y: 20, height, x: 368 })
            : line === 60
              ? anchor({ y: 0, height: 10, x: 368, frame: 'line' })
              : '';
        return `${own}<w:r><w:t>Line ${line}</w:t></w:r>`;
      });
      const body = `<w:p>${exactLine(14)}${runs.join('<w:r><w:br/></w:r>')}</w:p>`;
      const layout = render(filler() + body);
      expect(lineAt(layout, `Line ${at}`)!.page).toBe(1);
      expect(drawings(layout)[0]).toEqual({ page: 1, y: 20 });
      const line60 = lineAt(layout, 'Line 60')!;
      expect(drawings(layout)[1]).toEqual(line60);
    }
  });

  test('prices a keep-with-next chain from the top of the space before', () => {
    // From 566, the heading and 18pt of space leave the 60pt object (offset 0, so it starts
    // above its line) room to end at 640.
    const heading =
      '<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/></w:pPr>' +
      '<w:r><w:t>Heading</w:t></w:r></w:p>';
    const body =
      '<w:p><w:pPr><w:spacing w:before="360" w:after="0"/></w:pPr>' +
      `${anchor({ y: 0, height: 60 })}<w:r><w:t>Body</w:t></w:r></w:p>`;
    const layout = render(filler(566) + heading + body);
    expect(lineAt(layout, 'Heading')!.page).toBe(0);
    expect(drawings(layout)).toEqual([{ page: 0, y: 578.73 }]);
  });

  test('keeps the top border when an earlier band pushes the first line past the head check', () => {
    // The first object's band (420 to 520) pushes the next paragraph's first line to 520,
    // where its own object (520 to 720) cannot end at the margin.
    const band = anchor({ y: 20, height: 100, x: 368, wrap: 'topAndBottom' });
    const bordered =
      '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="24" w:space="0" w:color="000000"/>' +
      '</w:pBdr><w:spacing w:before="0" w:after="0"/></w:pPr>' +
      `${anchor({ y: 0, height: 200, x: 368, frame: 'line' })}<w:r><w:t>Text</w:t></w:r></w:p>`;
    const prev = `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${band}<w:r><w:t>Prev</w:t></w:r></w:p>`;
    const layout = render(filler(400) + prev + bordered);
    expect(lineAt(layout, 'Text')).toEqual({ page: 1, y: 3 });
  });

  test('moves the line to the next column before the next page', () => {
    const tall = linesParagraph(anchor({ y: 8, height: 300 }), 1, 3);
    const layout = render(filler() + tall + section(612, 792, 2));
    const line = lineAt(layout, 'Line 1')!;
    expect(line).toEqual({ page: 0, y: 0 });
    expect(drawings(layout)).toEqual([{ page: 0, y: 8 }]);
  });
});
