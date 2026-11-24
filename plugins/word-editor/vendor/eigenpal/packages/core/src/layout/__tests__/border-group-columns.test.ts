// Paragraph border groups in a MULTI-COLUMN section (ECMA-376 §17.3.1.24, §17.6.4).
//
// Consecutive paragraphs with identical `w:pBdr` are one bordered block: the box opens above
// the first and closes below the last. Which COLUMN a paragraph lands in is a layout outcome,
// not an authored property, so it must not decide who is in the group — a run of boxed
// paragraphs flowing into the next column carries on as one box, exactly as it does across a
// page break.
//
// It did not, in a section with unequal column widths. The group key was built from the box's
// resolved right EDGE (`indent.left + available`, and `available` is
// `contentWidth - indent.left - indent.right`), so it folded the content width in. The prepass
// prepares every block at column 0's width while placement prepares each block at the width of
// the column it actually lands in, and with unequal columns those two never agreed: grouping
// collapsed outside column 0 and every paragraph there drew its own box.
//
// The tests below assert the STROKE PATTERN, because that is what a reader sees: one box is
// `top` … `bottom` with bare sides between, and a broken group is `top,bottom` repeated.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function packageWithBody(body: string): OoxmlPart {
  const bytes = zipSync({
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
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

const rule = (side: string) => `<w:${side} w:val="single" w:sz="8" w:space="4" w:color="000000"/>`;
const BOX = `<w:pBdr>${rule('top')}${rule('left')}${rule('bottom')}${rule('right')}</w:pBdr>`;

const bordered = (text: string, extra = '') =>
  `<w:p><w:pPr>${BOX}${extra}</w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

// Short enough that a run of eight boxed paragraphs overflows column 1 into column 2.
const PAGE =
  '<w:pgSz w:w="7200" w:h="2600"/>' +
  '<w:pgMar w:top="360" w:right="720" w:bottom="360" w:left="720"/>';

const EQUAL = '<w:cols w:num="2" w:space="720"/>';
/** 90pt and 150pt: the two columns disagree, which is the whole point. */
const UNEQUAL =
  '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="1800" w:space="600"/><w:col w:w="3000"/></w:cols>';

const sectionOf = (cols: string) => `<w:sectPr>${PAGE}${cols}</w:sectPr>`;

interface Row {
  readonly text: string;
  readonly width: number;
  readonly sides: string;
}

function rowsOf(body: string): Row[] {
  const layout = layoutSemanticDocument(packageWithBody(body), 1, {
    measurer: createFixedMeasurer(6, 14),
  });
  return layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [
            {
              text: fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join(''),
              width: Math.round(fragment.box.width),
              sides: (fragment.borders ?? []).map((stroke) => stroke.side).join(','),
            },
          ]
        : []
    )
  );
}

const run = (count: number) =>
  Array.from({ length: count }, (_, index) => bordered(`p${index}`)).join('');

/** One box: the first opens it, the last closes it, everything between draws bare sides. */
const oneBox = (count: number): string[] => [
  'top,left,right',
  ...Array.from({ length: count - 2 }, () => 'left,right'),
  'bottom,left,right',
];

describe('a bordered run flowing into the next column', () => {
  test('unequal column widths keep it ONE box', () => {
    const rows = rowsOf(run(8) + sectionOf(UNEQUAL));
    // Proof the fixture does what it claims: the run really does reach the second column,
    // and the two columns really are different widths.
    const widths = [...new Set(rows.map((row) => row.width))];
    expect(widths).toHaveLength(2);
    expect(rows.map((row) => row.sides)).toEqual(oneBox(8));
  });

  test('the paragraphs that land in the SECOND column group with each other', () => {
    // The sharpest statement of the bug. These two share a column and a width, so nothing
    // about geometry can excuse them drawing separate boxes.
    const rows = rowsOf(run(8) + sectionOf(UNEQUAL));
    const second = rows.filter((row) => row.width === Math.max(...rows.map((r) => r.width)));
    expect(second.length).toBeGreaterThan(1);
    expect(second.map((row) => row.sides)).toEqual([
      ...Array.from({ length: second.length - 1 }, () => 'left,right'),
      'bottom,left,right',
    ]);
  });

  test('equal column widths are unchanged, and the two agree', () => {
    expect(rowsOf(run(8) + sectionOf(EQUAL)).map((row) => row.sides)).toEqual(oneBox(8));
    expect(rowsOf(run(8) + sectionOf(EQUAL)).map((row) => row.sides)).toEqual(
      rowsOf(run(8) + sectionOf(UNEQUAL)).map((row) => row.sides)
    );
  });
});

describe('what still splits a group', () => {
  test('a different left indent, in a single column', () => {
    const body =
      bordered('a') + bordered('b') + bordered('c', '<w:ind w:left="720"/>') + sectionOf(EQUAL);
    expect(rowsOf(body).map((row) => row.sides)).toEqual([
      'top,left,right',
      'bottom,left,right',
      'top,bottom,left,right',
    ]);
  });

  test('a different RIGHT indent, which the old key carried only through the width', () => {
    const body =
      bordered('a') + bordered('b') + bordered('c', '<w:ind w:right="720"/>') + sectionOf(EQUAL);
    expect(rowsOf(body).map((row) => row.sides)).toEqual([
      'top,left,right',
      'bottom,left,right',
      'top,bottom,left,right',
    ]);
  });

  test('a different left indent inside a MULTI-column section', () => {
    // The indent has to keep splitting the group after the width stopped being in the key.
    const body =
      bordered('a') + bordered('b') + bordered('c', '<w:ind w:left="720"/>') + sectionOf(UNEQUAL);
    expect(rowsOf(body).map((row) => row.sides)).toEqual([
      'top,left,right',
      'bottom,left,right',
      'top,bottom,left,right',
    ]);
  });
});
