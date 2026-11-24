// A `wrapTopAndBottom` picture moves the text of its OWN paragraph below its band. That skip
// travels with the paragraph: every fresh page repeats it. A line that the own band alone
// pushes past the bottom of an empty page cannot fit a later page either, so it stays on the
// first empty page and overflows once, as an oversized line does.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const measurer = createFixedMeasurer(6, 14);
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// US Letter in EMU: 612 x 792 pt.
const PAGE_CX = 7772400;
const PAGE_CY = 10058400;

/** A page-relative, top-and-bottom picture at x 0, sizes and y in EMU. */
function pagePicture(allowOverlap: '0' | '1', y: number, cx = PAGE_CX, cy = PAGE_CY): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
    ` allowOverlap="${allowOverlap}" layoutInCell="1" relativeHeight="1">` +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:wrapTopAndBottom/><wp:docPr id="1" name="pic"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const text = (value: string) => `<w:p><w:r><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;
const LEAD = text('Lead paragraph before the picture.');
const SECTION_END = '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>Lead section end.</w:t></w:r></w:p>';

const documentXml = (body: string) =>
  `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`;

function layoutBody(body: string, session?: ReturnType<typeof createLayoutSession>) {
  const part = load(documentXml(body));
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    ...(session ? { session } : {}),
  });
}

type Summary = {
  readonly lines: readonly (readonly [string, number, number, string, number])[];
  readonly drawings: readonly (readonly [number, number, number, number, string | null])[];
};

/** Per page: each line as [paragraph, start, end, text, y], each picture as its box. */
function summary(layout: SemanticLayout): readonly Summary[] {
  return layout.pages.map((page) => ({
    lines: page.fragments.flatMap((fragment) =>
      'lines' in fragment && fragment.lines
        ? fragment.lines.map(
            (line) =>
              [
                line.range.paragraphId,
                line.range.start,
                line.range.end,
                line.spans.map((span) => span.text).join(''),
                Math.round(line.box.y * 100) / 100,
              ] as const
          )
        : []
    ),
    drawings: (page.anchoredDrawings ?? []).map(
      (drawing) =>
        [
          Math.round(drawing.x * 100) / 100,
          Math.round(drawing.y * 100) / 100,
          Math.round(drawing.width * 100) / 100,
          Math.round(drawing.height * 100) / 100,
          drawing.layoutFallback ?? null,
        ] as const
    ),
  }));
}

const FULL_PAGE_PICTURE = [-72, -72, 612, 792, null] as const;

describe('a full-page top-and-bottom picture in its own paragraph', () => {
  for (const allowOverlap of ['0', '1'] as const) {
    test(`after text in the same section adds no blank pages (allowOverlap ${allowOverlap})`, () => {
      const layout = layoutBody(`${LEAD}<w:p>${pagePicture(allowOverlap, 1)}</w:p>`);
      const pages = summary(layout);
      expect(pages).toHaveLength(2);
      expect(pages[0]!.lines.map((line) => line[3])).toEqual([
        'Lead paragraph before the picture.',
      ]);
      expect(pages[0]!.drawings).toEqual([]);
      // The paragraph moves whole to the next page, and its picture goes with it.
      expect(pages[1]!.drawings).toEqual([FULL_PAGE_PICTURE]);
      expect(pages[1]!.lines).toHaveLength(1);
      const [paragraphId, start, end] = pages[1]!.lines[0]!;
      expect([start, end]).toEqual([0, 1]);
      for (const offset of [0, 1]) {
        expect(caretAt(layout, { paragraphId, offset }, measurer)?.pageIndex).toBe(1);
      }
    });

    test(`places the paragraph as a new section would (allowOverlap ${allowOverlap})`, () => {
      const sameSection = summary(layoutBody(`${LEAD}<w:p>${pagePicture(allowOverlap, 1)}</w:p>`));
      const newSection = summary(
        layoutBody(`${LEAD}${SECTION_END}<w:p>${pagePicture(allowOverlap, 1)}</w:p>`)
      );
      expect(newSection).toHaveLength(2);
      expect(newSection[1]!.drawings).toEqual([FULL_PAGE_PICTURE]);
      const place = (page: Summary) => page.lines.map((line) => [line[1], line[2], line[4]]);
      expect(place(sameSection[1]!)).toEqual(place(newSection[1]!));
    });
  }

  test('keeps the text after the picture on its line and the next paragraph after it', () => {
    const pages = summary(
      layoutBody(
        `${LEAD}<w:p>${pagePicture('0', 1)}<w:r><w:t>after</w:t></w:r></w:p>${text('tail')}`
      )
    );
    expect(pages.map((page) => page.lines.map((line) => [line[3], line[4]]))).toEqual([
      [['Lead paragraph before the picture.', 0]],
      // The band is where the page puts the picture: it ends 720 pt into the content box.
      [['after', 720]],
      [['tail', 0]],
    ]);
    expect(pages.map((page) => page.drawings)).toEqual([[], [FULL_PAGE_PICTURE], []]);
  });

  test('a band that leaves no room for its line adds no blank pages', () => {
    // 760 pt from the page top: the band ends 688 pt into the 648 pt content box.
    const pages = summary(
      layoutBody(`${LEAD}<w:p>${pagePicture('0', 0, PAGE_CX, 9652000)}</w:p>${text('tail')}`)
    );
    expect(pages.map((page) => page.lines.map((line) => [line[3], line[4]]))).toEqual([
      [['Lead paragraph before the picture.', 0]],
      [['', 688]],
      [['tail', 0]],
    ]);
    expect(pages[1]!.drawings).toEqual([[-72, -72, 612, 760, null]]);
  });

  test('a band that ends on the page moves the lines before and after it below it', () => {
    // 640 pt from the page top: the band ends 568 pt into the content box. The paragraph
    // before the anchor meets the band, so it starts below it as the anchor line does.
    const pages = summary(
      layoutBody(`${LEAD}<w:p>${pagePicture('0', 0, PAGE_CX, 8128000)}</w:p>${text('tail')}`)
    );
    expect(pages.map((page) => page.lines.map((line) => line[3]))).toEqual([
      ['Lead paragraph before the picture.', '', 'tail'],
    ]);
    expect(pages[0]!.lines[0]![4]).toBe(568);
    expect(pages[0]!.drawings).toEqual([[-72, -72, 612, 640, null]]);
  });

  test('two full-page pictures in a row take one page each', () => {
    const pages = summary(
      layoutBody(
        `${LEAD}<w:p>${pagePicture('0', 1)}</w:p><w:p>${pagePicture('1', 1)}</w:p>${text('tail')}`
      )
    );
    expect(pages.map((page) => page.drawings)).toEqual([
      [],
      [FULL_PAGE_PICTURE],
      [FULL_PAGE_PICTURE],
      [],
    ]);
    expect(pages[3]!.lines.map((line) => line[3])).toEqual(['tail']);
  });

  test('two columns move the paragraph to the next page once', () => {
    const pages = summary(
      layoutBody(
        `${LEAD}<w:p>${pagePicture('0', 1)}</w:p>${text('tail')}` +
          '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>'
      )
    );
    expect(pages.map((page) => page.drawings)).toEqual([[], [FULL_PAGE_PICTURE], []]);
    expect(pages[2]!.lines.map((line) => line[3])).toEqual(['tail']);
  });

  test('a band that fits an empty page keeps its line below the band', () => {
    // Control: 600 pt from the page top, 528 pt into the content box, leaves room for the line
    // on the page after the break.
    const pages = summary(
      layoutBody(
        '<w:p><w:r><w:t>Lead</w:t><w:br w:type="page"/></w:r></w:p>' +
          `<w:p>${pagePicture('0', 0, PAGE_CX, 7620000)}</w:p>`
      )
    );
    expect(pages).toHaveLength(2);
    expect(pages[1]!.lines.map((line) => line[4])).toEqual([528]);
    expect(pages[1]!.drawings).toEqual([[-72, -72, 612, 600, null]]);
  });

  for (const edited of ['lead', 'tail'] as const) {
    test(`an incremental pass after an edit to the ${edited} gives the same pages as a full pass`, () => {
      const body = (lead: string, tail: string) =>
        `${text(lead)}<w:p>${pagePicture('0', 1)}</w:p>${text(tail)}`;
      const session = createLayoutSession();
      layoutBody(body('Lead paragraph before the picture.', 'tail'), session);
      const next =
        edited === 'lead'
          ? body('Edited lead paragraph.', 'tail')
          : body('Lead paragraph before the picture.', 'edited tail');
      const retained = summary(layoutBody(next, session));
      const fresh = summary(layoutBody(next));
      expect(retained).toEqual(fresh);
      expect(fresh.map((page) => page.drawings)).toEqual([[], [FULL_PAGE_PICTURE], []]);
    });
  }
});
