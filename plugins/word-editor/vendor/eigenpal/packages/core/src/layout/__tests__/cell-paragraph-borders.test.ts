// `w:pBdr` on a paragraph INSIDE a table cell (ECMA-376 §17.3.1.24).
//
// Body flow publishes all six edges; cell flow read only `w:bottom`, so the boxed callout
// every template puts in a cell — four rules around a note — rendered as a lone underline.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  type PageGeometry,
  type ParagraphBorderSide,
  type ParagraphFragmentRecord,
  type SemanticLayout,
} from '../semantic-records.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { cellBorderGroupKey } from '../cell-border-groups.ts';
import {
  buildStyleCascadeTable,
  cascadeTableFormatting,
  tableCellStyleFormatting,
} from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

/** Tiny page: 100pt tall, 10pt margins → 80pt content box, so a cell row paginates. */
const TINY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const lay = (body: string, geometry?: PageGeometry): SemanticLayout =>
  layoutSemanticDocument(load(body), 1, { measurer, ...(geometry ? { geometry } : {}) });

/** Same, with a numbering part, so a `w:numPr` paragraph resolves a level indent. */
const layWithNumbering = (body: string, numberingBody: string): SemanticLayout => {
  const parsed = readOoxmlPart(`<w:numbering xmlns:w="${W}">${numberingBody}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return layoutSemanticDocument(load(body), 1, {
    measurer,
    numberingIndex: buildNumberingIndex(parsed.part.root),
  });
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

const oneCellTable = (content: string, tcPr = '') =>
  `<w:tbl><w:tr><w:tc>${tcPr}${content}</w:tc></w:tr></w:tbl>`;

/** A four-edge box: 1pt rules, 4pt from the text — Word's own Box defaults. */
const BOX =
  '<w:pBdr>' +
  '<w:top w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:left w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:bottom w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:right w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '</w:pBdr>';

/** Every cell paragraph fragment of a layout, in reading order across pages. */
function cellParagraphs(layout: SemanticLayout): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      for (const row of fragment.rows) {
        for (const cell of row.cells) {
          for (const block of cell.blocks) {
            if (block.kind === 'paragraph') found.push(block);
          }
        }
      }
    }
  }
  return found;
}

function sides(fragment: ParagraphFragmentRecord): ParagraphBorderSide[] {
  return (fragment.borders ?? []).map((entry) => entry.side);
}

function stroke(fragment: ParagraphFragmentRecord, side: ParagraphBorderSide) {
  const found = (fragment.borders ?? []).find((entry) => entry.side === side);
  if (!found) throw new Error(`no ${side} stroke on ${fragment.id}`);
  return found;
}

describe('a boxed cell paragraph publishes the whole frame, not just the underline', () => {
  test('all four edges are placed around the cell text', () => {
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('note', BOX))))[0]!;
    expect(sides(fragment).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  test('the rules sit at the same offsets body flow uses', () => {
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('note', BOX))))[0]!;
    const line = fragment.lines[0]!;
    const top = stroke(fragment, 'top');
    const bottom = stroke(fragment, 'bottom');
    const left = stroke(fragment, 'left');
    const right = stroke(fragment, 'right');

    // Horizontal rules sit `space` away from the lines vertically.
    expect(top.box.y + top.box.height).toBe(line.box.y - 4);
    expect(bottom.box.y).toBe(line.box.y + line.box.height + 4);

    // Word draws the side rules OUTSIDE the text column and never re-breaks the lines,
    // so inside a cell they hang into the cell margin exactly as they hang into the
    // page margin in the body.
    expect(left.box.x + left.box.width).toBe(line.box.x - 4);
    expect(right.box.x).toBe(line.box.x + line.box.width + 4);

    // And the frame CLOSES, exactly as it does in body flow — one document must not paint
    // the same callout two ways depending on whether it sits in a cell.
    expect(top.box.x).toBe(left.box.x);
    expect(top.box.x + top.box.width).toBe(right.box.x + right.box.width);
    expect(bottom.box.x).toBe(top.box.x);
    expect(bottom.box.width).toBe(top.box.width);
    expect(left.box.y).toBe(top.box.y);
    expect(left.box.y + left.box.height).toBe(bottom.box.y + bottom.box.height);
    expect(right.box.height).toBe(left.box.height);
  });

  test('bottomBorder still names the bottom rule alone', () => {
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('note', BOX))))[0]!;
    expect(fragment.bottomBorder?.box).toEqual(stroke(fragment, 'bottom').box);
  });

  test('the top rule is flow height: it pushes the text down and grows the row', () => {
    const bareLayout = lay(oneCellTable(paragraph('note')));
    const boxedLayout = lay(oneCellTable(paragraph('note', BOX)));
    const bare = cellParagraphs(bareLayout)[0]!;
    const boxed = cellParagraphs(boxedLayout)[0]!;
    // top space (4) + top rule (1) above the line; bottom space (4) + rule (1) below it.
    expect(boxed.lines[0]!.box.y - bare.lines[0]!.box.y).toBe(5);
    expect(boxed.box.height - bare.box.height).toBe(10);
    expect(boxed.box.y).toBe(bare.box.y);
    // The cell has to grow with it, or the frame paints over the cell's own bottom rule.
    const rowOf = (layout: SemanticLayout) =>
      layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!;
    expect(rowOf(boxedLayout).box.height - rowOf(bareLayout).box.height).toBe(10);
  });

  test('a box does not reflow cell text — same breaks as an unbordered twin', () => {
    const words = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');
    const bare = cellParagraphs(lay(oneCellTable(paragraph(words))))[0]!;
    const boxed = cellParagraphs(lay(oneCellTable(paragraph(words, BOX))))[0]!;
    expect(boxed.lines.map((line) => line.range.end)).toEqual(
      bare.lines.map((line) => line.range.end)
    );
    expect(boxed.box.width).toBe(bare.box.width);
  });

  test('w:bar draws beside the cell paragraph and costs no height', () => {
    const BAR = '<w:pBdr><w:bar w:val="single" w:sz="8" w:space="2"/></w:pBdr>';
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('changed', BAR))))[0]!;
    expect(sides(fragment)).toEqual(['bar']);
    const bar = stroke(fragment, 'bar');
    const line = fragment.lines[0]!;
    expect(bar.box.x + bar.box.width).toBe(line.box.x - 2);
    expect(bar.box.height).toBe(line.box.height);
    expect(fragment.box.height).toBe(
      cellParagraphs(lay(oneCellTable(paragraph('changed'))))[0]!.box.height
    );
  });

  test('an unbordered cell paragraph publishes no strokes at all', () => {
    expect(cellParagraphs(lay(oneCellTable(paragraph('plain'))))[0]!.borders).toBeUndefined();
  });
});

describe('consecutive cell paragraphs with identical borders are ONE bordered block', () => {
  /** Word's `HorizontalLine`: a bottom rule and nothing else. */
  const RULE = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>';

  test('two identically ruled paragraphs draw one rule, not two', () => {
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', RULE) + paragraph('second', RULE)))
    );
    expect(fragments).toHaveLength(2);
    // The run has no `w:between`, so the interior boundary carries nothing at all.
    expect(fragments[0]!.borders ?? []).toHaveLength(0);
    expect(sides(fragments[1]!)).toEqual(['bottom']);
    expect(fragments[0]!.bottomBorder).toBeUndefined();
  });

  test('a boxed run opens above the first paragraph and closes below the last', () => {
    // A REAL gap between the two paragraphs, or the claim below tests nothing: with no
    // `w:spacing` the last line of the first sits flush against the first line of the second,
    // and the side rules meet whether or not they were asked to span anything.
    const GAP = '<w:spacing w:after="240"/>';
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', GAP + BOX) + paragraph('second', GAP + BOX)))
    );
    expect(sides(fragments[0]!).sort()).toEqual(['left', 'right', 'top']);
    expect(sides(fragments[1]!).sort()).toEqual(['bottom', 'left', 'right']);
    const upper = stroke(fragments[0]!, 'left');
    const lower = stroke(fragments[1]!, 'left');
    // 12pt of `w:after` plus the box's own 4pt spaces: the gap the rules have to cross is
    // real, and nothing else in the fragment reaches across it.
    const contentGap = lower.box.y - (upper.box.y + upper.box.height);
    expect(fragments[1]!.lines[0]!.box.y - fragments[0]!.lines[0]!.box.y).toBeGreaterThan(12);
    // One outline: the side rules meet ACROSS that gap rather than stopping at the text.
    expect(contentGap).toBeCloseTo(0, 6);
    // And they really do span it: the upper rule runs a full 12pt of `w:after` past its own
    // last line, which is the whole of the gap and not one point of it.
    const upperLastLine = fragments[0]!.lines[fragments[0]!.lines.length - 1]!;
    expect(upper.box.y + upper.box.height).toBeCloseTo(
      upperLastLine.box.y + upperLastLine.box.height + 12,
      6
    );
  });

  test('the LOWER paragraph of a group opens its side rules at the fragment top', () => {
    // The other half of the run-through, and it needs its OWN fixture. `w:after` on both
    // paragraphs collapses the second's applied before-spacing to zero
    // (`collapsedSpaceBefore(before, prevAfter)` is `max(before, prevAfter) - prevAfter`), so
    // the second fragment's `top` and its first line coincide and the two candidate origins
    // for its side rules are indistinguishable. `w:before` with no `w:after` above it is what
    // pulls them apart: the rule has to start at the FRAGMENT top, 12pt above the text, or
    // the outline breaks open at every interior boundary.
    const LEAD = '<w:spacing w:before="240" w:after="0"/>';
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', LEAD + BOX) + paragraph('second', LEAD + BOX)))
    );
    expect(fragments).toHaveLength(2);
    const lower = stroke(fragments[1]!, 'left');
    const lowerFirstLine = fragments[1]!.lines[0]!;
    // The before-spacing is real and belongs to the second paragraph.
    expect(lowerFirstLine.box.y - lower.box.y).toBeCloseTo(12, 6);
    // And it is the fragment top the rule opens at, not some other point above the text.
    expect(lower.box.y).toBeCloseTo(fragments[1]!.box.y, 6);
    // Still one outline: the upper rule closes exactly where the lower one opens.
    const upper = stroke(fragments[0]!, 'left');
    expect(upper.box.y + upper.box.height).toBeCloseTo(lower.box.y, 6);
    // The FIRST paragraph of a group is not affected: it opens at its own top rule, which is
    // above its text by the box's `w:space` and stroke, not by the before-spacing.
    const upperTop = stroke(fragments[0]!, 'top');
    expect(upper.box.y).toBeCloseTo(upperTop.box.y, 6);
  });

  test('an interior boundary carries w:between when the run declares one', () => {
    const withBetween =
      '<w:pBdr>' +
      '<w:top w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
      '<w:between w:val="single" w:sz="4" w:space="2" w:color="00B050"/>' +
      '<w:bottom w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
      '</w:pBdr>';
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', withBetween) + paragraph('second', withBetween)))
    );
    expect(sides(fragments[0]!).sort()).toEqual(['between', 'top']);
    expect(sides(fragments[1]!)).toEqual(['bottom']);
    // `bottomBorder` names the block's bottom rule alone; a `between` is a different edge.
    expect(fragments[0]!.bottomBorder).toBeUndefined();
    expect(stroke(fragments[0]!, 'between').edge.color).toBe('00B050');
  });

  test('paragraphs whose borders differ each keep their own frame', () => {
    const other = BOX.replace(/C00000/g, '0070C0');
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', BOX) + paragraph('second', other)))
    );
    expect(sides(fragments[0]!).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(sides(fragments[1]!).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  test('a different indent splits the group, exactly as it does in body flow', () => {
    const indented = `<w:ind w:left="720"/>${BOX}`;
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', BOX) + paragraph('second', indented)))
    );
    expect(sides(fragments[0]!)).toContain('bottom');
    expect(sides(fragments[1]!)).toContain('top');
  });

  test('a numbering level indent splits the group the way a direct w:ind does', () => {
    // The group key folds in the paragraph's own box insets, and a LIST paragraph takes them
    // from its numbering level rather than from `w:ind` — so the memo has to invalidate on
    // the resolved list item as well as on the style table. Both paragraphs are boxed and
    // both name the same style; only the numbering level moves the second one's box.
    const numbering =
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      `<w:abstractNum w:abstractNumId="0">` +
      `<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/>` +
      `<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>` +
      `</w:abstractNum>`;
    const numbered = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${BOX}`;
    const fragments = cellParagraphs(
      layWithNumbering(
        oneCellTable(paragraph('plain', BOX) + paragraph('item', numbered)),
        numbering
      )
    );
    expect(fragments).toHaveLength(2);
    // Different boxes, so no group: each closes and opens on its own.
    expect(sides(fragments[0]!)).toContain('bottom');
    expect(sides(fragments[1]!)).toContain('top');
    // And the level really did move the second box, or the split proves nothing.
    expect(fragments[1]!.lines[0]!.box.x).toBeGreaterThan(fragments[0]!.lines[0]!.box.x);
  });

  test('the neighbour-key memo invalidates when the resolved list item moves', () => {
    // The memo lives on the paragraph NODE, so the node cannot be what tells it the answer
    // went stale. A list paragraph takes its box insets from its numbering level, and the
    // level can change under a node that did not — so the resolved list item is one of the
    // three things the entry is checked against. Asked directly, because inside one layout
    // pass both the seed and the lookup see the same item and cannot tell the arms apart.
    const numberingAt = (left: number) => {
      const parsed = readOoxmlPart(
        `<w:numbering xmlns:w="${W}">` +
          `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
          `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
          `<w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/>` +
          `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>` +
          `</w:lvl></w:abstractNum></w:numbering>`,
        { name: '/word/numbering.xml', contentType: 'app/xml' }
      );
      if (!parsed.ok) throw new Error(parsed.reason);
      return buildNumberingIndex(parsed.part.root);
    };
    const numbered = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${BOX}`;
    const block = load(paragraph('item', numbered)).root.children[0]!.children[0]! as OoxmlElement;
    const contextFor = (left: number) => ({
      styleCascade: undefined,
      tableCellStyle: undefined,
      listItems: resolveStoryListItems([block], numberingAt(left), undefined),
    });
    const wide = cellBorderGroupKey(block, contextFor(1440));
    const narrow = cellBorderGroupKey(block, contextFor(720));
    // Same node, same styles, different level indent — so a different group.
    expect(wide).not.toBe(narrow);
    // Both are real keys, not two spellings of "no borders".
    expect(wide).not.toBe('');
    // And asking again with the first level gives the first answer back.
    expect(cellBorderGroupKey(block, contextFor(1440))).toBe(wide);
  });

  test('the neighbour-key memo invalidates when the style table or the cell style moves', () => {
    // The other two arms of the same entry, asked the same way and for the same reason: a
    // restyle replaces the cascade table and a re-banded row replaces the cell style, and
    // either can move a paragraph's borders or indent under a node that did not change.
    const styled = (pBdr: string) => {
      const parsed = readOoxmlPart(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Boxed">` +
          `<w:pPr>${pBdr}</w:pPr></w:style>` +
          `<w:style w:type="table" w:styleId="Tbl"><w:pPr>${pBdr}</w:pPr></w:style></w:styles>`,
        { name: '/word/styles.xml', contentType: 'app/xml' }
      );
      if (!parsed.ok) throw new Error(parsed.reason);
      return buildStyleCascadeTable(parsed.part.root);
    };
    const RULE =
      '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="C00000"/></w:pBdr>';
    const block = load(paragraph('x', '<w:pStyle w:val="Boxed"/>')).root.children[0]!
      .children[0]! as OoxmlElement;

    // Arm 1: the style table. Same node, a style that gains a `w:pBdr`.
    const bare = cellBorderGroupKey(block, {
      styleCascade: styled(''),
      tableCellStyle: undefined,
      listItems: undefined,
    });
    const boxedTable = styled(RULE);
    const boxed = cellBorderGroupKey(block, {
      styleCascade: boxedTable,
      tableCellStyle: undefined,
      listItems: undefined,
    });
    expect(bare).toBe('');
    expect(boxed).not.toBe('');

    // Arm 2: the cell style, with the style table held fixed.
    const plainTable = styled('');
    const withCellStyle = cellBorderGroupKey(block, {
      styleCascade: plainTable,
      tableCellStyle: tableCellStyleFormatting(cascadeTableFormatting(plainTable, 'Tbl'), []),
      listItems: undefined,
    });
    expect(withCellStyle).toBe('');
    const boxedCellStyle = cellBorderGroupKey(block, {
      styleCascade: plainTable,
      tableCellStyle: tableCellStyleFormatting(cascadeTableFormatting(styled(RULE), 'Tbl'), []),
      listItems: undefined,
    });
    expect(boxedCellStyle).not.toBe('');
  });

  test('a group split across a page still opens once and closes once', () => {
    // `borderNeighbours` reads the block list rather than a running key, so a paragraph whose
    // neighbour was placed on the PREVIOUS page still knows it is mid-group. Seven boxed
    // paragraphs on an 80pt content box cross at least one page boundary.
    const boxed = Array.from({ length: 7 }, (_, index) => paragraph(`line${index}`, BOX)).join('');
    const layout = lay(oneCellTable(boxed), TINY);
    const fragments = cellParagraphs(layout);
    expect(fragments).toHaveLength(7);
    expect(layout.pages.length).toBeGreaterThan(1);
    // Exactly one opening rule and one closing rule across the whole run, on the first and
    // last paragraph — and every paragraph between them carries neither.
    expect(fragments.filter((fragment) => sides(fragment).includes('top'))).toHaveLength(1);
    expect(fragments.filter((fragment) => sides(fragment).includes('bottom'))).toHaveLength(1);
    expect(sides(fragments[0]!)).toContain('top');
    expect(sides(fragments[6]!)).toContain('bottom');
    // The side rules follow the group onto every page it reaches, including the paragraph
    // that lands first on the new sheet.
    for (const fragment of fragments) expect(sides(fragment)).toContain('left');
  });
});

describe('a boxed cell paragraph that spans pages opens once and closes once', () => {
  const long = 'word '.repeat(40).trim();

  test('the top rule rides the first fragment and the bottom the last', () => {
    const fragments = cellParagraphs(lay(oneCellTable(paragraph(long, BOX)), TINY));
    expect(fragments.length).toBeGreaterThan(1);
    expect(sides(fragments[0]!)).toContain('top');
    expect(sides(fragments[0]!)).not.toContain('bottom');
    const last = fragments[fragments.length - 1]!;
    expect(sides(last)).toContain('bottom');
    expect(sides(last)).not.toContain('top');
    // Exactly one closing rule across the whole paragraph.
    expect(fragments.filter((fragment) => sides(fragment).includes('bottom'))).toHaveLength(1);
    // The side rules follow the text onto every page it reaches.
    for (const fragment of fragments) expect(sides(fragment)).toContain('left');
  });

  test('no fragment paints its frame past the page content box', () => {
    const layout = lay(oneCellTable(paragraph(long, BOX)), TINY);
    for (const page of layout.pages) {
      const limit = page.contentBox.height;
      for (const fragment of cellParagraphs({ ...layout, pages: [page] })) {
        for (const entry of fragment.borders ?? []) {
          expect(entry.box.y + entry.box.height).toBeLessThanOrEqual(limit + 0.001);
        }
      }
    }
  });
});

describe('vAlign moves the frame with the text it encloses', () => {
  test('a centred cell shifts strokes and lines by the same amount', () => {
    // Two cells in one row: a tall one sets the row height, the bordered one centres in it.
    const body =
      '<w:tbl><w:tr>' +
      `<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>${paragraph('note', BOX)}</w:tc>` +
      `<w:tc>${Array.from({ length: 6 }, (_, index) => paragraph(`tall${index}`)).join('')}</w:tc>` +
      '</w:tr></w:tbl>';
    const centred = cellParagraphs(lay(body))[0]!;
    const flush = cellParagraphs(lay(body.replace('<w:vAlign w:val="center"/>', '')))[0]!;
    const dy = centred.lines[0]!.box.y - flush.lines[0]!.box.y;
    expect(dy).toBeGreaterThan(0);
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      expect(stroke(centred, side).box.y - stroke(flush, side).box.y).toBeCloseTo(dy, 6);
    }
  });
});

describe('paint draws the cell frame from the published boxes', () => {
  test('four rules reach the DOM at the layout-owned geometry', () => {
    const layout = lay(oneCellTable(paragraph('note', BOX)));
    const fragment = cellParagraphs(layout)[0]!;
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    expect(container.querySelectorAll('.docx-paragraph-border')).toHaveLength(4);
    for (const side of ['top', 'left', 'bottom', 'right'] as const) {
      const rule = container.querySelector<HTMLElement>(`.docx-paragraph-border-${side}`)!;
      const published = stroke(fragment, side);
      expect(Number.parseFloat(rule.style.left)).toBeCloseTo(published.box.x - fragment.box.x, 6);
      expect(Number.parseFloat(rule.style.top)).toBeCloseTo(published.box.y - fragment.box.y, 6);
      expect(rule.style.backgroundColor.toLowerCase()).toBe('#c00000');
    }
  });
});

describe('a shaded box in a cell is filled across the frame', () => {
  test('shading covers the bordered rectangle, exactly as it does in body flow', () => {
    // The border/shading rule landed in the body flow first; a cell paragraph kept painting
    // the old geometry, so one document rendered the identical callout two ways.
    const fragment = cellParagraphs(
      lay(oneCellTable(paragraph('note', `${BOX}<w:shd w:val="clear" w:fill="E8F0FE"/>`)))
    )[0]!;
    const top = stroke(fragment, 'top');
    const bottom = stroke(fragment, 'bottom');
    const left = stroke(fragment, 'left');
    const right = stroke(fragment, 'right');
    const box = fragment.shadingBox!;
    expect(fragment.shading).toBe('E8F0FE');
    expect(box.x).toBe(left.box.x);
    expect(box.x + box.width).toBe(right.box.x + right.box.width);
    expect(box.y).toBe(top.box.y);
    expect(box.y + box.height).toBe(bottom.box.y + bottom.box.height);
  });
});
