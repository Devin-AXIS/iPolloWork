// The authored page margin against header and footer height (ECMA-376 §17.6.11 `w:pgMar`,
// §17.10 headers and footers).
//
// A non-negative `w:top` is a minimum and a negative one is exact. Neither is ever shrunk by a
// limit on how much of the sheet furniture may take: a section that asks for a deep top margin
// gets it, header or not. A header taller than the margin pushes the body below itself by its
// full height; the only bound is one point of column, so pagination always has a box. The
// bottom margin mirrors all of this against the footer.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument, type PageFurniture } from '../index.ts';
import { createPageContentInsets, type HeaderFooterVariantName } from '../page-furniture-insets.ts';
import type { HeaderFooterStoryLayout } from '../hf-layout.ts';

const LETTER = 792;
const DISTANCE = 36;

function furniture(header?: number, footer?: number): PageFurniture {
  const story = (flowHeight: number) => ({ flowHeight }) as HeaderFooterStoryLayout;
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map<HeaderFooterVariantName, HeaderFooterStoryLayout>(
      header === undefined ? [] : [['default', story(header)]]
    ),
    footers: new Map<HeaderFooterVariantName, HeaderFooterStoryLayout>(
      footer === undefined ? [] : [['default', story(footer)]]
    ),
  };
}

function insets(options: {
  readonly top: number;
  readonly bottom: number;
  readonly header?: number;
  readonly footer?: number;
  readonly pageHeight?: number;
}) {
  return createPageContentInsets({
    furniture: furniture(options.header, options.footer),
    pageHeight: options.pageHeight ?? LETTER,
    marginTop: options.top,
    marginBottom: options.bottom,
    headerDistance: DISTANCE,
    footerDistance: DISTANCE,
    pageIndexStart: 0,
  })(0);
}

describe('§17.6.11 w:pgMar top margin deeper than two fifths of the sheet', () => {
  test('with no header the body starts at the authored w:top', () => {
    expect(insets({ top: 350, bottom: 72 }).top).toBeCloseTo(350, 6);
  });

  test('a header shorter than the margin leaves the authored w:top in place', () => {
    expect(insets({ top: 350, bottom: 72, header: 24 }).top).toBeCloseTo(350, 6);
  });

  test('a small sheet keeps a w:top past two fifths of its height', () => {
    // 283.5pt sheet, w:top 128.7pt: more than 0.4 of the height, still the body top.
    const box = insets({ top: 128.7, bottom: 50, header: 12, pageHeight: 283.5 });
    expect(box.top).toBeCloseTo(128.7, 6);
    expect(box.height).toBeCloseTo(283.5 - 128.7 - 50, 6);
  });

  test('a negative w:top past two fifths stays exact under a tall header', () => {
    expect(insets({ top: -350, bottom: 72, header: 400 }).top).toBeCloseTo(350, 6);
  });
});

describe('§17.10 header and footer height past the authored margin', () => {
  test('a header taller than a deep margin pushes the body below its full height', () => {
    expect(insets({ top: 350, bottom: 72, header: 368 }).top).toBeCloseTo(DISTANCE + 368, 6);
  });

  test('a header past two fifths of the sheet still pushes by its full height', () => {
    expect(insets({ top: 72, bottom: 72, header: 517 }).top).toBeCloseTo(DISTANCE + 517, 6);
  });

  test('a deep w:bottom holds under a short footer, a tall footer pushes past it', () => {
    expect(insets({ top: 72, bottom: 350, footer: 24 }).bottom).toBeCloseTo(350, 6);
    expect(insets({ top: 72, bottom: 72, footer: 517 }).bottom).toBeCloseTo(DISTANCE + 517, 6);
  });

  test('a header taller than the page pushes the body below the sheet edge', () => {
    // 80 lines of 11.5pt: the body starts under the whole header, off the sheet, and keeps
    // one point of column there, so each page holds one line.
    const box = insets({ top: 72, bottom: 72, header: 920 });
    expect(box.top).toBeCloseTo(DISTANCE + 920, 6);
    expect(box.height).toBeCloseTo(1, 6);
  });

  test('a header past the bottom margin keeps its full push, not one point short of it', () => {
    // 60 lines of 11.5pt: the body top lands at 726pt, below the 720pt bottom margin.
    const box = insets({ top: 72, bottom: 72, header: 690 });
    expect(box.top).toBeCloseTo(726, 6);
    expect(box.height).toBeCloseTo(1, 6);
  });

  test('a header and a footer that meet keep the header push and one point of column', () => {
    const box = insets({ top: 72, bottom: 72, header: 402.5, footer: 402.5 });
    expect(box.top).toBeCloseTo(DISTANCE + 402.5, 6);
    expect(box.height).toBeCloseTo(1, 6);
  });

  test('a footer that meets a deep top margin leaves the same one-point column', () => {
    const box = insets({ top: 700, bottom: 72, footer: 400 });
    expect(box.top).toBeCloseTo(700, 6);
    expect(box.height).toBeCloseTo(1, 6);
  });
});

describe('§17.6.11 w:pgMar deep top margin through the body flow', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function layoutWithTop(topTwips: number) {
    const body = Array.from(
      { length: 40 },
      (_unused, index) => `<w:p><w:r><w:t>Line ${index + 1}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr>` +
          '<w:pgSz w:w="8391" w:h="5670"/>' +
          `<w:pgMar w:top="${topTwips}" w:right="1440" w:bottom="1000" w:left="1440"` +
          ' w:header="720" w:footer="720" w:gutter="0"/>' +
          '</w:sectPr></w:body></w:document>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    return layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      producer: 'test',
    });
  }

  test('every page of a 283.5pt sheet starts its body at w:top 128.7pt', () => {
    const layout = layoutWithTop(2574);
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      expect(page.contentBox.y - page.box.y).toBeCloseTo(128.7, 6);
    }
  });

  test('a negative w:top of the same size is the same exact body top', () => {
    for (const page of layoutWithTop(-2574).pages) {
      expect(page.contentBox.y - page.box.y).toBeCloseTo(128.7, 6);
    }
  });
});
