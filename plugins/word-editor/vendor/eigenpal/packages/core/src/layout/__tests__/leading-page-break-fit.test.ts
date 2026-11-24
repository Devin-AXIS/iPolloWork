// A paragraph that opens with a page break, with text after it, advances one sheet even when
// the empty line in front of the break does not fit the page.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { caretAt, hitTestSemantic } from '../semantic-interaction.ts';
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

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart) => layoutSemanticDocument(part, 1, { measurer });

// 200pt wide, 310pt tall sheets with 10pt margins: a 290pt content box holds fourteen 20pt
// lines and leaves 10pt, less than one more line.
const sect =
  '<w:sectPr><w:pgSz w:w="4000" w:h="6200"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const exact = '<w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/>';

const paragraph = (text: string, pPr = exact) =>
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const fill = (count: number) =>
  Array.from({ length: count }, (_, line) => paragraph(`line${line}`)).join('');
const br = '<w:r><w:br w:type="page"/></w:r>';
const breaksOnly = (count: number) => `<w:p><w:pPr>${exact}</w:pPr>${br.repeat(count)}</w:p>`;
const leading = (text: string, pPr = exact) =>
  `<w:p><w:pPr>${pPr}</w:pPr>${br}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const paragraphsOn = (layout: SemanticLayout, page: number): ParagraphFragmentRecord[] =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
const textOf = (fragment: ParagraphFragmentRecord): string =>
  fragment.lines
    .flatMap((line) => line.spans.map((span) => span.text))
    .join('')
    .replace(/[^\w ]/g, '');
const pageTexts = (layout: SemanticLayout): string[] =>
  layout.pages.map((_, page) =>
    paragraphsOn(layout, page)
      .map(textOf)
      .filter((text) => text !== '')
      .join(' ')
  );
const lastFill = (count: number) =>
  Array.from({ length: count }, (_, line) => `line${line}`).join(' ');
/** Every placed fragment of the paragraph at a top-level body position (`#0.0.N`). */
const fragmentsAt = (layout: SemanticLayout, position: number) =>
  layout.pages.flatMap((_, page) =>
    paragraphsOn(layout, page)
      .filter((fragment) => fragment.paragraphId.endsWith(`#0.0.${position}`))
      .map((fragment) => ({ fragment, page }))
  );

describe('a paragraph that opens with a page break', () => {
  test('keeps the break line on a full page and starts its text on the next sheet', () => {
    const layout = lay(load(fill(14) + leading('after') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), 'after']);
    const [before, after] = fragmentsAt(layout, 14);
    expect(before!.page).toBe(0);
    expect(before!.fragment.lines).toHaveLength(1);
    // Out of flow and inside the 290pt band: it overlaps the last line's lower half.
    expect(before!.fragment.outOfFlow).toBe(true);
    expect(before!.fragment.lines[0]!.box.y).toBe(270);
    expect(after!.page).toBe(1);
    expect(after!.fragment.outOfFlow).toBeUndefined();
    expect(after!.fragment.lines[0]!.box.y).toBe(0);
  });

  test('places the same way when the break line fits', () => {
    const layout = lay(load(fill(13) + leading('after') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(13), 'after']);
    expect(fragmentsAt(layout, 13).map(({ page }) => page)).toEqual([0, 1]);
    expect(fragmentsAt(layout, 13)[0]!.fragment.outOfFlow).toBeUndefined();
    expect(fragmentsAt(layout, 13)[0]!.fragment.lines[0]!.box.y).toBe(260);
  });

  test('keeps the break line when space before pushes it past the bottom', () => {
    const spaced = '<w:spacing w:before="240" w:after="0" w:line="400" w:lineRule="exact"/>';
    const layout = lay(load(fill(14) + leading('after', spaced) + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), 'after']);
  });

  test('places the caret before the break on the first sheet and after it on the next', () => {
    const layout = lay(load(fill(14) + leading('after') + sect));
    const paragraphId = fragmentsAt(layout, 14)[0]!.fragment.paragraphId;
    expect(caretAt(layout, { paragraphId, offset: 0 })?.pageIndex).toBe(0);
    expect(caretAt(layout, { paragraphId, offset: 1 })?.pageIndex).toBe(1);
    // A press on the last text line still lands in that line, not before the break.
    const pressed = hitTestSemantic(layout, { x: 30, y: 275, pageIndex: 0 });
    expect(pressed?.position.paragraphId).toBe(fragmentsAt(layout, 13)[0]!.fragment.paragraphId);
  });

  test('keeps a keep-with-next heading with the text after it', () => {
    const heading =
      '<w:keepNext/><w:keepLines/>' +
      '<w:spacing w:before="120" w:after="0" w:line="400" w:lineRule="exact"/>';
    const layout = lay(
      load(fill(14) + leading('heading', heading) + paragraph('body') + paragraph('more') + sect)
    );
    expect(pageTexts(layout)).toEqual([lastFill(14), 'heading body more']);
  });

  test('moves the text after the break under keepLines when it cannot finish the sheet', () => {
    // The break opens the second sheet; twelve lines there leave room for one, and the
    // keepLines paragraph that follows needs two.
    const layout = lay(
      load(
        fill(14) +
          leading('after') +
          fill(12) +
          `<w:p><w:pPr><w:keepLines/>${exact}</w:pPr><w:r><w:t>kept</w:t></w:r>` +
          `<w:r><w:br/></w:r><w:r><w:t>whole</w:t></w:r></w:p>` +
          sect
      )
    );
    expect(pageTexts(layout)).toEqual([lastFill(14), `after ${lastFill(12)}`, 'keptwhole']);
  });

  test('keeps authored repeated breaks as an empty sheet', () => {
    const repeated = `<w:p><w:pPr>${exact}</w:pPr>${br}${br}<w:r><w:t>after</w:t></w:r></w:p>`;
    const layout = lay(load(fill(14) + repeated + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), '', 'after']);
  });

  test('keeps the first of two breaks on a full page when no text follows them', () => {
    const layout = lay(load(fill(14) + breaksOnly(2) + paragraph('after') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), '', 'after']);
    const [first, second] = fragmentsAt(layout, 14);
    expect(first!.page).toBe(0);
    expect(first!.fragment.outOfFlow).toBe(true);
    expect(second!.page).toBe(1);
  });

  test('gives each later break of a run of three its own sheet', () => {
    const layout = lay(load(fill(14) + breaksOnly(3) + paragraph('after') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), '', '', 'after']);
  });

  test('keeps a page break followed by a column break on a full page', () => {
    const columnBreak = '<w:r><w:br w:type="column"/></w:r>';
    const breaks = `<w:p><w:pPr>${exact}</w:pPr>${br}${columnBreak}</w:p>`;
    const layout = lay(load(fill(14) + breaks + paragraph('after') + sect));
    expect(layout.pages).toHaveLength(3);
    const [first] = fragmentsAt(layout, 14);
    expect(first!.page).toBe(0);
    expect(first!.fragment.outOfFlow).toBe(true);
    expect(fragmentsAt(layout, 15).map(({ page }) => page)).toEqual([2]);
  });

  test('keeps the first of two breaks after a table that fills the page', () => {
    const fullTable =
      '<w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/><w:tblCellMar>' +
      '<w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr>' +
      '<w:trHeight w:val="5800" w:hRule="exact"/></w:trPr><w:tc>' +
      paragraph('cell') +
      '</w:tc></w:tr></w:tbl>';
    const twice = lay(load(fullTable + breaksOnly(2) + paragraph('after') + sect));
    expect(twice.pages).toHaveLength(3);
    expect(fragmentsAt(twice, 1).map(({ page }) => page)).toEqual([0, 1]);
    expect(fragmentsAt(twice, 2).map(({ page }) => page)).toEqual([2]);
    // One break alone keeps the ordinary fit: its line takes the next sheet.
    const once = lay(load(fullTable + breaksOnly(1) + paragraph('after') + sect));
    expect(once.pages).toHaveLength(3);
    expect(fragmentsAt(once, 1).map(({ page }) => page)).toEqual([1]);
    expect(fragmentsAt(once, 2).map(({ page }) => page)).toEqual([2]);
  });

  test('matches a cold layout after a second break joins a lone break', () => {
    const session = createLayoutSession();
    for (const [revision, count] of [1, 2, 1].entries()) {
      const part = load(fill(14) + breaksOnly(count) + paragraph('after') + sect);
      const warm = layoutSemanticDocument(part, revision, { measurer, session });
      expect(warm.pages).toEqual(layoutSemanticDocument(part, revision, { measurer }).pages);
      expect(warm.pages).toHaveLength(3);
    }
  });

  test('lays out the same through a retained session', () => {
    const part = load(fill(14) + leading('after') + fill(3) + sect);
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, { measurer, session });
    const again = layoutSemanticDocument(part, 1, { measurer, session });
    expect(again.pages).toEqual(first.pages);
    expect(first.pages).toEqual(lay(part).pages);
  });
});

const floatingTable =
  '<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpX="0" w:tblpY="0"/>' +
  '<w:tblW w:type="dxa" w:w="1000"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
  ['r0', 'r1', 'r2'].map((text) => `<w:tr><w:tc>${paragraph(text)}</w:tc></w:tr>`).join('') +
  '</w:tbl>';

describe('lines that still move to the next sheet', () => {
  for (const count of [12, 14]) {
    test(`a floating table anchored after ${count} lines moves with its paragraph`, () => {
      // The table anchors at the paragraph start, so the break line cannot stay behind.
      const layout = lay(load(fill(count) + floatingTable + leading('after') + sect));
      expect(pageTexts(layout)).toEqual([lastFill(count), '', 'after']);
      const tables = layout.pages.flatMap((page, index) =>
        page.fragments.flatMap((fragment) =>
          fragment.kind === 'table' ? [{ index, rows: fragment.rows }] : []
        )
      );
      expect(tables.map(({ index }) => index)).toEqual([1]);
      for (const row of tables[0]!.rows)
        expect(row.box.y + row.box.height).toBeLessThanOrEqual(290);
      expect(fragmentsAt(layout, count + 1)[0]!.fragment.outOfFlow).toBeUndefined();
    });
  }

  test('a paragraph that anchors text frames keeps the ordinary fit', () => {
    const framed = `<w:framePr w:x="400" w:y="0" w:w="1000" w:vAnchor="text"/>${exact}`;
    const layout = lay(load(fill(14) + paragraph('frame', framed) + leading('after') + sect));
    const [first] = fragmentsAt(layout, 15);
    expect(first!.fragment.outOfFlow).toBeUndefined();
    expect(first!.page).toBe(1);
  });

  test('an empty paragraph that does not fit starts the next sheet', () => {
    const layout = lay(load(fill(14) + `<w:p><w:pPr>${exact}</w:pPr></w:p>` + sect));
    expect(fragmentsAt(layout, 14).map(({ page }) => page)).toEqual([1]);
  });

  test('text in front of the break moves with its line', () => {
    const textFirst = `<w:p><w:pPr>${exact}</w:pPr><w:r><w:t>lead</w:t></w:r>${br}<w:r><w:t>after</w:t></w:r></w:p>`;
    const layout = lay(load(fill(14) + textFirst + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), 'lead', 'after']);
  });

  test('a paragraph with nothing after its break stays when only its space before overflows', () => {
    // 13 lines leave 30pt: the 20pt break line fits, its 20pt space before does not.
    const before = '<w:spacing w:before="400" w:after="0" w:line="400" w:lineRule="exact"/>';
    const breakOnly = `<w:p><w:pPr>${before}</w:pPr>${br}</w:p>`;
    const layout = lay(load(fill(13) + breakOnly + paragraph('after') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(13), 'after']);
  });

  test('a paragraph with nothing after its break keeps the ordinary fit', () => {
    // Out of scope for this rule: the break line still takes the next sheet.
    const breakOnly = `<w:p><w:pPr>${exact}</w:pPr>${br}</w:p>`;
    const layout = lay(load(fill(14) + breakOnly + paragraph('after') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), '', 'after']);
  });
});
