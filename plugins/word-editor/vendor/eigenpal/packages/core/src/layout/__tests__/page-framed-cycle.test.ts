// A page- or margin-positioned table or picture near the page bottom can make the reflow cycle:
// on the anchor's page the object covers its anchor, which moves on and takes the object along,
// which frees the anchor again. An edited layout enters that cycle from the previous pages, so
// it settles again from scratch and must match a fresh layout, with no text under the object.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { observeExclusionLayoutPassesForTest } from '../exclusion-pass-observer.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { LayoutBox, PageRecord, SemanticLayout } from '../semantic-records.ts';
import { layoutContext, load, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, i) => p(`${prefix}${i}`)).join('');
const textOf = (line: { spans: readonly { text: string }[] }) =>
  line.spans.map((span) => span.text).join('');

/** Every block and object on every page as `page:text@y`, in page order. */
const placed = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page, index) => [
    ...page.fragments.map(
      (fragment) =>
        `${index}:${fragment.kind === 'table' ? 'T' : fragment.lines.map(textOf).join('|')}` +
        `@${fragment.box.y.toFixed(1)}`
    ),
    ...(page.anchoredDrawings ?? []).map((drawing) => `${index}:picture@${drawing.y.toFixed(1)}`),
  ]);

/** The boxes of the floating tables and pictures a page paints. */
const objectsOn = (page: PageRecord): LayoutBox[] => [
  ...page.fragments.filter((fragment) => fragment.kind === 'table').map((table) => table.box),
  ...(page.anchoredDrawings ?? []),
];

/** Text lines that run under a floating table or picture on their page. */
const covered = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    objectsOn(page).flatMap((box) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines
              .filter((line) =>
                line.spans.some(
                  (span) =>
                    span.text.length > 0 &&
                    span.box.y < box.y + box.height - 0.5 &&
                    span.box.y + span.box.height > box.y + 0.5
                )
              )
              .map(textOf)
          : []
      )
    )
  );

/** `run()` and the exclusion layout passes it took. */
function countingPasses<T>(run: () => T): { result: T; passes: number } {
  let passes = 0;
  const stop = observeExclusionLayoutPassesForTest(() => (passes += 1));
  try {
    return { result: run(), passes };
  } finally {
    stop();
  }
}

/** Where `Head` starts: its page and its top. */
const headOf = (layout: SemanticLayout) => {
  for (const [index, page] of layout.pages.entries())
    for (const fragment of page.fragments)
      if (fragment.kind === 'paragraph' && textOf(fragment.lines[0]!).startsWith('Head'))
        return { page: index, y: fragment.box.y };
  throw new Error('no Head paragraph');
};

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** A 468pt-wide floating table of one exact 60pt row. */
const table = (tblpPr: string) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="9360"/></w:tblPr>` +
  '<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr>' +
  '<w:trHeight w:val="1200" w:hRule="exact"/></w:trPr><w:tc><w:p><w:r><w:t>cell</w:t></w:r>' +
  '</w:p></w:tc></w:tr></w:tbl>';
/** A body laid out with the fixed measurer. */
const layTables = (body: string, revision: number, session?: LayoutSession) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, revision, {
    measurer: createFixedMeasurer(),
    session,
  });
};

describe('page-positioned tables', () => {
  const long = `Head ${'word '.repeat(40)}`;
  // Both tables are 60pt tall, 578pt down the 648pt text area of a Letter page.
  for (const [name, tblpPr, head, count] of [
    ['page', '<w:tblpPr w:vertAnchor="page" w:tblpY="13000"/>', 'Head', 42],
    ['margin', '<w:tblpPr w:vertAnchor="margin" w:tblpY="9000"/>', long, 40],
  ] as const) {
    test(`an edit before a ${name}-positioned table's anchor matches a fresh layout`, () => {
      const body = (before: string, object = table(tblpPr)) =>
        before + object + p(head) + p('After') + lines(3, 'Z');
      const edited = lines(3, 'X') + lines(count, 'L');
      // The conflict the cycle comes from: without the table, its anchor reaches its band.
      const free = headOf(layTables(body(edited, ''), 1));
      expect(free.page).toBe(0);
      expect(free.y).toBeGreaterThan(578 - 40);
      expect(free.y).toBeLessThan(638);
      const session = createLayoutSession();
      layTables(body(lines(count, 'L')), 0, session);
      const warm = layTables(body(edited), 1, session);
      const cold = layTables(body(edited), 1);
      expect(placed(warm)).toEqual(placed(cold));
      expect(covered(cold)).toEqual([]);
      expect(covered(warm)).toEqual([]);
    });
  }
});

describe('page-positioned pictures', () => {
  /** A 468pt-wide, 60pt-tall square-wrapped picture 600pt down the page. */
  const picture = (() => {
    const xml = squareAnchorAtLeft({ text: '' });
    const emu = (pt: number) => String(pt * 12700);
    return xml
      .slice(xml.indexOf('<w:r>'), xml.indexOf('</wp:anchor>') + '</wp:anchor>'.length)
      .concat('</w:drawing></w:r>')
      .replaceAll('1828800', emu(468))
      .replaceAll('914400', emu(60))
      .replace('relativeFrom="column"', 'relativeFrom="margin"')
      .replace(
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0',
        `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(600)}`
      );
  })();
  const lay = (body: string, revision: number, session?: LayoutSession) => {
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"` +
        ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
        ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"' +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<w:body>${body}</w:body></w:document>`
    );
    return layoutSemanticDocument(part, revision, {
      compatibilityMode: 15,
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: layoutContext(part),
      session,
    });
  };
  const body = (count: number, object = picture) =>
    lines(count, 'L') +
    `<w:p>${object}<w:r><w:t>Head</w:t></w:r></w:p>` +
    p('After') +
    lines(3, 'Z');

  test('an edit before the anchor of a page-positioned picture matches a fresh layout', () => {
    // The picture covers 528pt to 588pt of the text area. Without it, its anchor reaches there.
    const free = headOf(lay(body(45, ''), 1));
    expect(free.page).toBe(0);
    expect(free.y).toBeGreaterThan(528 - 14);
    expect(free.y).toBeLessThan(588);
    const session = createLayoutSession();
    lay(body(46), 0, session);
    const warm = lay(body(45), 1, session);
    const cold = lay(body(45), 1);
    expect(placed(warm)).toEqual(placed(cold));
    expect(covered(cold)).toEqual([]);
    expect(covered(warm)).toEqual([]);
  });

  test('a paragraph-positioned picture moves to a fresh page without covering its text', () => {
    const relative = picture.replace(
      'relativeFrom="page"><wp:posOffset>7620000',
      'relativeFrom="paragraph"><wp:posOffset>0'
    );
    const session = createLayoutSession();
    lay(body(45, relative), 0, session);
    const warm = lay(body(46, relative), 1, session);
    const cold = lay(body(46, relative), 1);
    expect(placed(warm)).toEqual(placed(cold));
    expect(covered(warm)).toEqual([]);
    expect(covered(cold)).toEqual([]);
  });
  // Page-positioned paragraph frames have coverage in paragraph-frame-wrapping.test.ts.
});

test('an edit entering a cycle settles from scratch; a later edit away from it does not', () => {
  // The page-positioned table above: a fresh layout settles the cycle in 4 passes; the edit that
  // enters it pays one seeded pass and two more before settling from scratch.
  const body = (before: string, tail: string) =>
    before +
    table('<w:tblpPr w:vertAnchor="page" w:tblpY="13000"/>') +
    p('Head') +
    p('After') +
    tail;
  const before = lines(3, 'X') + lines(42, 'L');
  const session = createLayoutSession();
  layTables(body(lines(42, 'L'), lines(3, 'Z')), 0, session);
  expect(countingPasses(() => layTables(body(before, lines(3, 'Z')), 1)).passes).toBe(4);
  expect(countingPasses(() => layTables(body(before, lines(3, 'Z')), 1, session)).passes).toBe(7);
  // Text added after the cycle's pages keeps the one seeded pass, and lays out like a fresh one.
  const tail = body(before, lines(3, 'Z') + p('Tail'));
  const warm = countingPasses(() => layTables(tail, 2, session));
  expect(warm.passes).toBe(1);
  expect(placed(warm.result)).toEqual(placed(layTables(tail, 2)));
});

for (const width of [144, 468]) {
  test(`a ${width}pt leading picture does not wrap continuation pages`, () => {
    const lay = (words: number, revision: number, session?: LayoutSession) => {
      const part = load(
        squareAnchorAtLeft({ text: 'word '.repeat(words) }).replaceAll(
          '1828800',
          String(width * 12700)
        )
      );
      return layoutSemanticDocument(part, revision, {
        compatibilityMode: 15,
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: layoutContext(part),
        session,
      });
    };
    const session = createLayoutSession();
    lay(2400, 0, session);
    const layout = lay(2500, 1, session);
    const cold = lay(2500, 1);
    const spanBoxes = (value: SemanticLayout) =>
      value.pages.map((page) =>
        page.fragments.flatMap((fragment) =>
          fragment.kind === 'paragraph'
            ? fragment.lines.flatMap((line) => line.spans.map((span) => span.box))
            : []
        )
      );
    expect(spanBoxes(layout)).toEqual(spanBoxes(cold));
    expect(layout.pages.length).toBeGreaterThan(2);
    expect(layout.pages[0]!.anchoredDrawings).toHaveLength(1);
    for (const page of layout.pages.slice(1)) {
      expect(page.anchoredDrawings ?? []).toHaveLength(0);
      const fragment = page.fragments.find((fragment) => fragment.kind === 'paragraph');
      if (fragment?.kind !== 'paragraph') throw new Error('missing continuation');
      const span = fragment.lines[0]!.spans.find((span) => span.text.length > 0)!;
      expect(span.box.x).toBe(0);
      expect(span.box.y).toBe(0);
    }
  });
}

test('a leading picture does not wrap continuation columns', () => {
  const part = load(
    squareAnchorAtLeft({ text: 'word '.repeat(2500) }).replace(
      '</w:body>',
      '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr></w:body>'
    )
  );
  const layout = layoutSemanticDocument(part, 0, {
    compatibilityMode: 15,
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const continuation = layout.pages[0]!.fragments.find(
    (fragment) => fragment.kind === 'paragraph' && fragment.box.x > 0
  );
  if (continuation?.kind !== 'paragraph') throw new Error('missing second column');
  const span = continuation.lines[0]!.spans.find((span) => span.text.length > 0)!;
  expect(span.box.x).toBe(252);
  expect(span.box.y).toBe(0);
});
