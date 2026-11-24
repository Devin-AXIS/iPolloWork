import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  layoutSemanticDocument,
} from '../index.ts';
import { columnSeparatorBoxes, resolveSectionColumns } from '../section-columns.ts';
import type { SectionColumns } from '../section-properties.ts';

// Letter page with one-inch margins: the content box is 9360 twips (468pt) wide.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function partWithColumns(cols: string, margins = 'w:left="1440" w:right="1440"') {
  const body =
    '<w:p><w:r><w:t>FIRST</w:t></w:r></w:p>' +
    '<w:p><w:r><w:br w:type="column"/></w:r></w:p>' +
    '<w:p><w:r><w:t>SECOND</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    `<w:pgMar w:top="1440" w:bottom="1440" ${margins} w:header="720" w:footer="720" w:gutter="0"/>` +
    `${cols}</w:sectPr>`;
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

function columnsOf(cols: string, margins?: string): SectionColumns {
  return enumerateDocumentSections(partWithColumns(cols, margins))[0]!.properties.columns;
}

function geometry(cols: string) {
  const resolved = resolveSectionColumns(columnsOf(cols), 468);
  return { widths: resolved.widths, lefts: resolved.lefts };
}

describe('explicit column definitions', () => {
  test('decimal widths and gaps truncate to whole twips', () => {
    expect(
      columnsOf(
        '<w:cols w:num="2" w:space="720" w:equalWidth="0">' +
          '<w:col w:w="4319.74" w:space="720.9"/><w:col w:w="4319.74"/></w:cols>'
      ).definitions
    ).toEqual([
      { widthTwips: 4319, gapTwips: 720 },
      { widthTwips: 4319, gapTwips: 0 },
    ]);
  });

  test('universal measures convert to twips', () => {
    expect(
      columnsOf(
        '<w:cols w:num="2" w:space="0.5in" w:equalWidth="0">' +
          '<w:col w:w="2in" w:space="0.5in"/><w:col w:w="3in"/></w:cols>'
      ).definitions
    ).toEqual([
      { widthTwips: 2880, gapTwips: 720 },
      { widthTwips: 4320, gapTwips: 0 },
    ]);
  });

  test('an absent per-column space is no gap, not the w:cols space', () => {
    expect(
      columnsOf(
        '<w:cols w:num="2" w:space="1440" w:equalWidth="0">' +
          '<w:col w:w="2000"/><w:col w:w="3000"/></w:cols>'
      ).definitions
    ).toEqual([
      { widthTwips: 2000, gapTwips: 0 },
      { widthTwips: 3000, gapTwips: 0 },
    ]);
  });

  test('an absent width spans the content width', () => {
    expect(
      columnsOf(
        '<w:cols w:num="2" w:space="720" w:equalWidth="0">' +
          '<w:col w:space="720"/><w:col w:w="3000"/></w:cols>',
        'w:left="1000" w:right="1240"'
      ).definitions
    ).toEqual([
      { widthTwips: 10_000, gapTwips: 720 },
      { widthTwips: 3000, gapTwips: 0 },
    ]);
  });

  test('the final column gap is ignored and extra children are dropped', () => {
    expect(
      columnsOf(
        '<w:cols w:num="2" w:space="720" w:equalWidth="0">' +
          '<w:col w:w="2000" w:space="720"/><w:col w:w="3000" w:space="3000"/>' +
          '<w:col w:w="1500"/></w:cols>'
      ).definitions
    ).toEqual([
      { widthTwips: 2000, gapTwips: 720 },
      { widthTwips: 3000, gapTwips: 0 },
    ]);
  });

  test('an absent count with unequal children is one column of the first width', () => {
    const columns = columnsOf(
      '<w:cols w:space="720" w:equalWidth="0">' +
        '<w:col w:w="2000" w:space="720"/><w:col w:w="6000"/></w:cols>'
    );
    expect(columns.count).toBe(1);
    expect(resolveSectionColumns(columns, 468).widths).toEqual([100]);
  });

  test.each([
    ['an unreadable width', '<w:col w:w="wide" w:space="720"/><w:col w:w="3000"/>'],
    ['a negative width', '<w:col w:w="-720" w:space="720"/><w:col w:w="3000"/>'],
    ['an out-of-range width', '<w:col w:w="99999" w:space="720"/><w:col w:w="3000"/>'],
    ['an unreadable gap', '<w:col w:w="2000" w:space="1e3"/><w:col w:w="3000"/>'],
    ['too few children', '<w:col w:w="2000" w:space="720"/>'],
    ['no children', ''],
  ])('%s drops the whole set, so layout uses equal columns', (_label, children) => {
    const cols = `<w:cols w:num="2" w:space="720" w:equalWidth="0">${children}</w:cols>`;
    expect(columnsOf(cols).definitions).toEqual([]);
    expect(geometry(cols)).toEqual({ widths: [216, 216], lefts: [0, 252] });
  });

  test('equal-width columns ignore w:col children', () => {
    for (const flag of ['', ' w:equalWidth="1"']) {
      const cols = `<w:cols w:num="2" w:space="720"${flag}><w:col w:w="2000" w:space="720"/><w:col w:w="6000"/></w:cols>`;
      expect(geometry(cols)).toEqual({ widths: [216, 216], lefts: [0, 252] });
    }
  });
});

describe('column geometry that does not fit', () => {
  test('unequal widths wider than the content box keep their size and run past it', () => {
    expect(
      geometry(
        '<w:cols w:num="2" w:space="720" w:equalWidth="0">' +
          '<w:col w:w="6000" w:space="720"/><w:col w:w="6000"/></w:cols>'
      )
    ).toEqual({ widths: [300, 300], lefts: [0, 336] });
  });

  test('unequal widths narrower than the content box are not stretched', () => {
    expect(
      geometry(
        '<w:cols w:num="2" w:space="720" w:equalWidth="0">' +
          '<w:col w:w="2000" w:space="720"/><w:col w:w="2000"/></w:cols>'
      )
    ).toEqual({ widths: [100, 100], lefts: [0, 136] });
  });

  test('a very narrow unequal column keeps its stated position', () => {
    const resolved = geometry(
      '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="5" w:space="720"/><w:col w:w="3000"/></w:cols>'
    );
    expect(resolved.lefts).toEqual([0, 36.25]);
    expect(resolved.widths).toEqual([0.72, 150]);
  });

  test('a zero-width unequal column is kept', () => {
    const resolved = geometry(
      '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="0" w:space="720"/><w:col w:w="3000"/></w:cols>'
    );
    expect(resolved.lefts).toEqual([0, 36]);
  });

  test('equal columns keep their gap and shrink to the minimum width', () => {
    expect(geometry('<w:cols w:num="2" w:space="9350"/>')).toEqual({
      widths: [0.72, 0.72],
      lefts: [0, 468.22],
    });
    expect(geometry('<w:cols w:num="3" w:space="9000"/>')).toEqual({
      widths: [0.72, 0.72, 0.72],
      lefts: [0, 450.72, 901.44],
    });
  });

  test('a zero or absent count is one full-width column', () => {
    expect(geometry('<w:cols w:num="0" w:space="720"/>')).toEqual({ widths: [468], lefts: [0] });
  });
});

describe('column layout with decimal widths', () => {
  test('text flows into the stated columns instead of one-point slivers', () => {
    const part = partWithColumns(
      '<w:cols w:num="2" w:space="720" w:equalWidth="0">' +
        '<w:col w:w="4319.74" w:space="720"/><w:col w:w="4319.74"/></w:cols>'
    );
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    expect(layout.pages).toHaveLength(1);
    const boxes = layout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' &&
      fragment.lines.some((line) => line.spans.some((span) => /FIRST|SECOND/.test(span.text)))
        ? [fragment.box]
        : []
    );
    expect(boxes.map((box) => [box.x, box.width])).toEqual([
      [0, 215.95],
      [251.95, 215.95],
    ]);
  });
});

describe('column separators', () => {
  test('a separator sits in the stated gap even beside a column narrower than the minimum', () => {
    const resolved = resolveSectionColumns(
      columnsOf(
        '<w:cols w:num="2" w:sep="1" w:equalWidth="0">' +
          '<w:col w:w="0" w:space="720"/><w:col w:w="3000"/></w:cols>'
      ),
      468
    );
    expect(columnSeparatorBoxes(resolved, 0, 10).map((box) => box.x)).toEqual([17.625]);
  });
});

describe('right-to-left sections', () => {
  test('the first column is the rightmost', () => {
    const columns = columnsOf('<w:cols w:num="2" w:space="720"/><w:bidi/>');
    expect(columns.rightToLeft).toBe(true);
    const resolved = resolveSectionColumns(columns, 468);
    expect(resolved.lefts).toEqual([252, 0]);
    expect(resolved.widths).toEqual([216, 216]);
  });

  test('unequal columns keep their widths and gaps in mirrored order', () => {
    const resolved = resolveSectionColumns(
      columnsOf(
        '<w:cols w:num="2" w:equalWidth="0">' +
          '<w:col w:w="2880" w:space="720"/><w:col w:w="5760"/></w:cols><w:bidi/>'
      ),
      468
    );
    expect(resolved.lefts).toEqual([324, 0]);
    expect(resolved.widths).toEqual([144, 288]);
  });

  test('the separator stays centered in the gap', () => {
    const resolved = resolveSectionColumns(
      columnsOf('<w:cols w:num="2" w:space="720" w:sep="1"/><w:bidi/>'),
      468
    );
    expect(columnSeparatorBoxes(resolved, 0, 100).map((box) => box.x)).toEqual([233.625]);
  });

  test('a single column and a left-to-right section are unchanged', () => {
    expect(columnsOf('<w:cols w:num="1"/><w:bidi/>').rightToLeft).toBeUndefined();
    expect(columnsOf('<w:cols w:num="2" w:space="720"/>').rightToLeft).toBeUndefined();
  });

  test('text flows into the right column first', () => {
    const part = partWithColumns('<w:cols w:num="2" w:space="720"/><w:bidi/>');
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const x = (word: string) =>
      layout.pages[0]!.fragments.find(
        (fragment) =>
          fragment.kind === 'paragraph' &&
          fragment.lines.some((line) => line.spans.some((span) => span.text.includes(word)))
      )!.box.x;
    expect(x('FIRST')).toBeGreaterThan(x('SECOND'));
  });
});
