// Paragraph spacing and bottom borders (task 7.3).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  AUTO_PARAGRAPH_SPACING_PT,
  MAX_PARAGRAPH_SPACING_PT,
  appliedSpaceBefore,
  collapsedSpaceBefore,
  paragraphBorders,
  paragraphSpacing,
} from '../paragraph-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';
import { fragmentsOfParagraph, linesOf, type PageGeometry } from '../semantic-records.ts';
import { propertiesOf } from '../paragraph-flow.ts';

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
const lay = (part: OoxmlPart, geometry?: PageGeometry, revision = 1) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    styleCascade: elevenPointDefaults(),
    ...(geometry ? { geometry } : {}),
  });

const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

const BOTTOM = (attrs: string) => `<w:pBdr><w:bottom ${attrs}/></w:pBdr>`;

describe('paragraphSpacing resolves w:spacing before/after', () => {
  test('twips convert to points', () => {
    expect(
      paragraphSpacing([{ localName: 'spacing', attributes: { before: '240', after: '200' } }])
    ).toEqual({ before: 12, after: 10 });
  });

  test('hostile and non-numeric values are clamped or dropped', () => {
    expect(
      paragraphSpacing([
        { localName: 'spacing', attributes: { before: '999999999', after: 'expression(1)' } },
      ])
    ).toEqual({ before: MAX_PARAGRAPH_SPACING_PT, after: 0 });
    expect(
      paragraphSpacing([{ localName: 'spacing', attributes: { before: '-400', after: '0' } }])
    ).toEqual({ before: 0, after: 0 });
  });

  test('adjacent collapse takes the larger gap, not the sum', () => {
    expect(collapsedSpaceBefore(12, 10)).toBe(2);
    expect(collapsedSpaceBefore(8, 10)).toBe(0);
    expect(collapsedSpaceBefore(10, 0)).toBe(10);
  });

  test('appliedSpaceBefore suppresses mid-section top-of-page before', () => {
    expect(appliedSpaceBefore(18, 0, true, false)).toBe(0);
    expect(appliedSpaceBefore(18, 0, true, true)).toBe(18);
    expect(appliedSpaceBefore(18, 10, false, false)).toBe(8);
  });
});

// `w:beforeAutospacing` / `w:afterAutospacing` (§17.3.1.2, §17.3.1.13). Word writes the pair
// `w:before="100" w:beforeAutospacing="1"` on every paragraph of a document that has been
// through its HTML filter, and the 100 twips beside the flag is NOT the value: the flag means
// the consumer picks, and Word picks HTML's `<p>` margin. Reading the literal laid such a
// document out 9pt tight per paragraph boundary, which is enough to lose a page.
describe('paragraphSpacing resolves w:beforeAutospacing / w:afterAutospacing', () => {
  const AUTO = {
    localName: 'spacing',
    attributes: {
      before: '100',
      after: '100',
      beforeAutospacing: '1',
      afterAutospacing: '1',
    },
  };

  test('auto replaces the measurement beside it rather than adding to it', () => {
    expect(paragraphSpacing([AUTO])).toEqual({
      before: AUTO_PARAGRAPH_SPACING_PT,
      after: AUTO_PARAGRAPH_SPACING_PT,
    });
  });

  test('each side is independent', () => {
    expect(
      paragraphSpacing([
        {
          localName: 'spacing',
          attributes: { before: '100', after: '240', afterAutospacing: '1' },
        },
      ])
    ).toEqual({ before: 5, after: AUTO_PARAGRAPH_SPACING_PT });
  });

  test('an explicit off keeps the authored measurement', () => {
    for (const off of ['0', 'false', 'off']) {
      expect(
        paragraphSpacing([
          { localName: 'spacing', attributes: { before: '240', beforeAutospacing: off } },
        ])
      ).toEqual({ before: 12, after: 0 });
    }
  });

  test('a list item resolves auto to 0, the way HTML collapses li margins', () => {
    expect(paragraphSpacing([AUTO], { inList: true })).toEqual({ before: 0, after: 0 });
    // A TABLE CELL does not. A captured control at 10pt, line pitch 11.52pt, puts 26.16pt
    // between two auto-spaced paragraphs in the body and the SAME 26.16pt between two in a
    // cell; with an empty paragraph between them, exactly twice that.
    expect(paragraphSpacing([AUTO], { inTableCell: true })).toEqual({
      before: AUTO_PARAGRAPH_SPACING_PT,
      after: AUTO_PARAGRAPH_SPACING_PT,
    });
    // Suppression is about the auto value only — an authored measurement still applies.
    expect(
      paragraphSpacing([{ localName: 'spacing', attributes: { before: '240' } }], { inList: true })
    ).toEqual({ before: 12, after: 0 });
  });

  test('the flags merge per attribute, like the measurements they sit beside', () => {
    // A style turns auto spacing on; the paragraph overrides only `@before`. The flag must
    // survive, or direct formatting silently reverts the paragraph to the style's 100 twips.
    expect(
      paragraphSpacing([AUTO, { localName: 'spacing', attributes: { before: '400' } }])
    ).toEqual({ before: AUTO_PARAGRAPH_SPACING_PT, after: AUTO_PARAGRAPH_SPACING_PT });
    // ...and a style that turns it off is not undone by a later element that says nothing.
    expect(
      paragraphSpacing([
        AUTO,
        { localName: 'spacing', attributes: { beforeAutospacing: '0', afterAutospacing: '0' } },
        { localName: 'spacing', attributes: { before: '400' } },
      ])
    ).toEqual({ before: 20, after: 5 });
  });
});

describe('layout applies Word’s auto spacing, not the twips beside the flag', () => {
  const AUTO_PPR =
    '<w:spacing w:after="100" w:afterAutospacing="1" w:before="100" w:beforeAutospacing="1"/>';

  test('two body paragraphs sit 14pt apart, not 5pt', () => {
    const layout = lay(load(paragraph('one', AUTO_PPR) + paragraph('two', AUTO_PPR)));
    const [first, second] = layout.pages[0]!.fragments;
    if (first!.kind !== 'paragraph' || second!.kind !== 'paragraph') throw new Error('paragraphs');
    expect(first!.spacing.after).toBe(AUTO_PARAGRAPH_SPACING_PT);
    // Collapsed against the previous after, so the gap is one 14pt band and not two.
    expect(second!.lines[0]!.box.y - first!.lines[0]!.box.y).toBe(14 + AUTO_PARAGRAPH_SPACING_PT);
  });

  test('the same paragraphs in a table cell get the same auto spacing as in the body', () => {
    const cell = `<w:tc>${paragraph('one', AUTO_PPR)}${paragraph('two', AUTO_PPR)}</w:tc>`;
    const layout = lay(load(`<w:tbl><w:tr>${cell}</w:tr></w:tbl>`));
    const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    if (table?.kind !== 'table') throw new Error('table fragment');
    const paragraphs = table.rows[0]!.cells[0]!.blocks.filter(
      (block) => block.kind === 'paragraph'
    );
    expect(paragraphs).toHaveLength(2);
    // Adjacent margins collapse: the follower's `before` is dropped so the pair contributes
    // ONE gap, not two. The gap is therefore the full auto value, which is what the reference
    // draws — 26.16pt between two auto-spaced paragraphs at a 11.52pt line pitch, in a cell
    // exactly as in the body.
    const spacings = paragraphs.map((fragment) =>
      fragment.kind === 'paragraph' ? fragment.spacing : undefined
    );
    // The cell's own edges eat the auto gap — the reference adds nothing across a row
    // boundary — so only the interior boundary keeps it. `after` on the first paragraph is
    // the whole gap; the follower's `before` is dropped by the ordinary margin collapse.
    expect(spacings[0]).toEqual({ before: 0, after: AUTO_PARAGRAPH_SPACING_PT });
    expect(spacings[1]).toEqual({ before: 0, after: 0 });
  });
});

describe('paragraphBorders resolves w:pBdr bottom', () => {
  test('val/color/sz/space become a typed edge in points', () => {
    const part = load(
      paragraph('x', BOTTOM('w:val="single" w:sz="24" w:space="4" w:color="C00000"'))
    );
    const pPr = part.root.children[0]!.children[0]!.children.find(
      (child) => child.kind === 'paragraphProperties'
    );
    expect(paragraphBorders(pPr)).toEqual({
      bottom: { val: 'single', color: 'C00000', widthPt: 3, spacePt: 4 },
    });
  });

  test('nil/none and hostile colour/size are refused', () => {
    const nil = load(paragraph('x', BOTTOM('w:val="nil" w:sz="24"')));
    const pPr = nil.root.children[0]!.children[0]!.children.find(
      (child) => child.kind === 'paragraphProperties'
    );
    expect(paragraphBorders(pPr)).toEqual({});

    const hostile = load(
      paragraph('x', BOTTOM('w:val="single" w:sz="999999" w:space="999999" w:color="red"'))
    );
    const hostilePr = hostile.root.children[0]!.children[0]!.children.find(
      (child) => child.kind === 'paragraphProperties'
    );
    const edge = paragraphBorders(hostilePr).bottom!;
    expect(edge.color).toBeNull();
    expect(edge.widthPt).toBeLessThanOrEqual(12);
    expect(edge.spacePt).toBeLessThanOrEqual(3168);
  });
});

describe('layout accounts for spacing in pagination and fragment geometry', () => {
  test('before/after shift fragment boxes and the flow cursor', () => {
    const part = load(
      paragraph('one', '<w:spacing w:after="240"/>') +
        paragraph('two', '<w:spacing w:before="120"/>')
    );
    const layout = lay(part);
    const [first, second] = layout.pages[0]!.fragments;
    expect(first!.kind).toBe('paragraph');
    expect(second!.kind).toBe('paragraph');
    if (first!.kind !== 'paragraph' || second!.kind !== 'paragraph') return;
    // First ends with 12pt after; second asks for 6pt before → collapsed gap is 12pt.
    expect(first!.spacing).toEqual({ before: 0, after: 12 });
    expect(second!.spacing.before).toBe(0); // fully collapsed into the prior after
    expect(second!.box.y).toBe(first!.box.y + first!.box.height);
    expect(second!.lines[0]!.box.y - first!.lines[0]!.box.y).toBe(14 + 12);
  });

  test('explicit before is honoured on the first paragraph of a document/section', () => {
    const layout = lay(load(paragraph('title', '<w:spacing w:before="200"/>')));
    const [fragment] = layout.pages[0]!.fragments;
    expect(fragment!.kind).toBe('paragraph');
    if (fragment!.kind !== 'paragraph') return;
    expect(fragment!.spacing.before).toBe(10);
    expect(fragment!.box.y).toBe(0);
    expect(fragment!.lines[0]!.box.y).toBe(10);
  });

  test('spacing contributes to pagination', () => {
    // Content height 80pt; each plain line is 14pt. With 40pt after on every paragraph,
    // far fewer fit per page than without spacing.
    const many = Array.from({ length: 8 }, (_, index) =>
      paragraph(`line ${index}`, '<w:spacing w:after="800"/>')
    ).join('');
    const withSpacing = lay(load(many), SMALL);
    const plain = lay(
      load(Array.from({ length: 8 }, (_, index) => paragraph(`line ${index}`)).join('')),
      SMALL
    );
    expect(withSpacing.pages.length).toBeGreaterThan(plain.pages.length);
  });
});

describe('comprehensive fixture: bottom border rule and vertical spacing', () => {
  const FIXTURE =
    paragraph('above', '<w:spacing w:after="200"/>') +
    paragraph(
      '',
      `<w:spacing w:before="100" w:after="120"/>` +
        BOTTOM('w:val="single" w:sz="16" w:space="2" w:color="FF0000"')
    ) +
    paragraph('below', '<w:spacing w:before="40"/>');

  test('empty bordered paragraph occupies Word-like space and publishes the rule', () => {
    const part = load(FIXTURE);
    const layout = lay(part);
    const fragments = layout.pages[0]!.fragments.filter((f) => f.kind === 'paragraph');
    expect(fragments).toHaveLength(3);
    const empty = fragments[1]!;
    if (empty.kind !== 'paragraph') return;

    // One caret line (empty paragraph), plus border space (2pt) + width (2pt) + after (6pt).
    expect(empty.lines).toHaveLength(1);
    expect(empty.lines[0]!.box.height).toBe(14);
    expect(empty.bottomBorder).toBeDefined();
    expect(empty.bottomBorder!.edge).toEqual({
      val: 'single',
      color: 'FF0000',
      widthPt: 2,
      spacePt: 2,
    });
    // Rule sits below the empty line by `space`.
    expect(empty.bottomBorder!.box.y).toBe(empty.lines[0]!.box.y + 14 + 2);
    expect(empty.bottomBorder!.box.height).toBe(2);
    expect(empty.bottomBorder!.box.width).toBe(empty.box.width);
    // Fragment height covers before remainder + line + border extent + after.
    expect(empty.box.height).toBe(empty.spacing.before + 14 + 2 + 2 + empty.spacing.after);
  });

  test('vertical spacing collapses against the prior after and advances the next paragraph', () => {
    const part = load(FIXTURE);
    const layout = lay(part);
    const fragments = layout.pages[0]!.fragments.filter((f) => f.kind === 'paragraph');
    const [above, empty, below] = fragments;
    if (above!.kind !== 'paragraph' || empty!.kind !== 'paragraph' || below!.kind !== 'paragraph')
      return;

    // above after=10pt, empty before=5pt → empty's applied before collapses to 0.
    expect(above!.spacing.after).toBe(10);
    expect(empty!.spacing.before).toBe(0);
    // empty after=6pt, below before=2pt → below collapses to 0; gap is empty's after.
    expect(empty!.spacing.after).toBe(6);
    expect(below!.spacing.before).toBe(0);
    expect(below!.box.y).toBe(empty!.box.y + empty!.box.height);
    expect(below!.lines[0]!.box.y).toBe(
      empty!.bottomBorder!.box.y + empty!.bottomBorder!.box.height + 6
    );
  });

  test('flattened props still round-trip spacing; borders resolve from the tree', () => {
    const part = load(FIXTURE);
    const emptyPara = part.root.children[0]!.children[1]!;
    const pPr = emptyPara.children.find((child) => child.kind === 'paragraphProperties');
    const props = propertiesOf(pPr);
    expect(paragraphSpacing(props)).toEqual({ before: 5, after: 6 });
    // propertiesOf does not flatten nested pBdr children — borders read the tree.
    expect(props.some((property) => property.localName === 'pBdr')).toBe(true);
    expect(paragraphBorders(pPr).bottom?.color).toBe('FF0000');
  });
});

describe('Word 2013+ top-of-page space-before suppression', () => {
  function firstParagraphOnPage(
    layout: ReturnType<typeof lay>,
    pageIndex: number
  ): Extract<
    NonNullable<ReturnType<typeof lay>['pages'][number]>['fragments'][number],
    { kind: 'paragraph' }
  > {
    const fragment = layout.pages[pageIndex]!.fragments.find((entry) => entry.kind === 'paragraph');
    expect(fragment?.kind).toBe('paragraph');
    if (!fragment || fragment.kind !== 'paragraph') {
      throw new Error(`expected paragraph on page ${pageIndex}`);
    }
    return fragment;
  }

  test('empty hard page-break paragraph suppresses before on the next page', () => {
    const layout = lay(
      load(
        paragraph('before') +
          '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
          paragraph('heading', '<w:spacing w:before="360"/>')
      )
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const heading = firstParagraphOnPage(layout, 1);
    expect(heading.lines[0]!.spans.map((span) => span.text).join('')).toBe('heading');
    expect(heading.spacing.before).toBe(0);
    expect(heading.box.y).toBe(0);
    expect(heading.lines[0]!.box.y).toBe(0);
  });

  test('pageBreakBefore retains before at the top of the new page', () => {
    const layout = lay(
      load(
        paragraph('first') + paragraph('second', '<w:pageBreakBefore/><w:spacing w:before="200"/>')
      )
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const second = firstParagraphOnPage(layout, 1);
    expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('second');
    expect(second.spacing.before).toBe(10);
    expect(second.lines[0]!.box.y).toBe(10);
  });

  test('pageBreakBefore drops before at the top of the new page in compatibility mode 15', () => {
    const part = load(
      paragraph('first') + paragraph('second', '<w:pageBreakBefore/><w:spacing w:before="200"/>')
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      styleCascade: elevenPointDefaults(),
      compatibilityMode: 15,
    });
    const second = firstParagraphOnPage(layout, 1);
    expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('second');
    expect(second.spacing.before).toBe(0);
    expect(second.lines[0]!.box.y).toBe(0);
  });

  for (const [label, between, before] of [
    ['opens a continuous section', '', 10],
    ['follows the first paragraph of a continuous section', paragraph('zero'), 0],
  ] as const) {
    test(`in mode 15, pageBreakBefore on a paragraph that ${label}`, () => {
      // The first section ends with an empty mark; the second, continuous, holds the rest.
      const part = load(
        paragraph('first') +
          '<w:p><w:pPr><w:sectPr/></w:pPr></w:p>' +
          between +
          paragraph('second', '<w:pageBreakBefore/><w:spacing w:before="200"/>') +
          '<w:sectPr><w:type w:val="continuous"/></w:sectPr>'
      );
      const layout = layoutSemanticDocument(part, 1, {
        measurer,
        styleCascade: elevenPointDefaults(),
        compatibilityMode: 15,
      });
      const second = firstParagraphOnPage(layout, 1);
      expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('second');
      expect(second.spacing.before).toBe(before);
      expect(second.lines[0]!.box.y).toBe(before);
    });
  }

  const leadingTable =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' +
    paragraph('cell') +
    '</w:tc></w:tr></w:tbl>';
  for (const [label, body] of [
    ['opens the document', leadingTable],
    [
      'opens a section on a new page',
      `${paragraph('first')}<w:p><w:pPr><w:sectPr/></w:pPr></w:p>${leadingTable}`,
    ],
  ] as const) {
    test(`in mode 15, pageBreakBefore after a table that ${label} drops before`, () => {
      const part = load(
        body + paragraph('second', '<w:pageBreakBefore/><w:spacing w:before="200"/>')
      );
      const layout = layoutSemanticDocument(part, 1, {
        measurer,
        styleCascade: elevenPointDefaults(),
        compatibilityMode: 15,
      });
      const second = firstParagraphOnPage(layout, layout.pages.length - 1);
      expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('second');
      expect(second.spacing.before).toBe(0);
    });
  }

  test('natural pagination suppresses before when a paragraph moves to the next page', () => {
    // Content height 80pt; first paragraph's after pushes the second onto page 2.
    const layout = lay(
      load(
        paragraph('first', '<w:spacing w:after="1200"/>') +
          paragraph('second', '<w:spacing w:before="200"/>')
      ),
      SMALL
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const second = firstParagraphOnPage(layout, 1);
    expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('second');
    expect(second.spacing.before).toBe(0);
    expect(second.lines[0]!.box.y).toBe(0);
  });

  test('first paragraph after a section break retains before spacing', () => {
    const layout = lay(
      load(
        paragraph('cover') +
          '<w:p><w:pPr><w:sectPr>' +
          '<w:pgSz w:w="4000" w:h="4000"/>' +
          '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/>' +
          '</w:sectPr></w:pPr></w:p>' +
          paragraph('body', '<w:spacing w:before="360"/>') +
          '<w:sectPr>' +
          '<w:pgSz w:w="4000" w:h="4000"/>' +
          '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/>' +
          '</w:sectPr>'
      )
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const body = firstParagraphOnPage(layout, 1);
    expect(body.lines[0]!.spans.map((span) => span.text).join('')).toBe('body');
    expect(body.spacing.before).toBe(18);
    expect(body.lines[0]!.box.y).toBe(18);
  });

  test('document-first paragraph retains explicit before', () => {
    const layout = lay(load(paragraph('title', '<w:spacing w:before="360"/>')));
    const title = firstParagraphOnPage(layout, 0);
    expect(title.spacing.before).toBe(18);
    expect(title.lines[0]!.box.y).toBe(18);
  });
});

describe('bottom border survives across a multi-line paragraph', () => {
  test('only the final fragment carries the rule', () => {
    const long = paragraph(
      Array.from({ length: 40 }, (_, index) => `word${index}`).join(' '),
      BOTTOM('w:val="single" w:sz="8" w:space="1" w:color="000000"')
    );
    const layout = lay(load(long), SMALL);
    const fragments = fragmentsOfParagraph(layout, '/word/document.xml#0.0.0');
    expect(fragments.length).toBeGreaterThan(1);
    for (const fragment of fragments.slice(0, -1)) {
      expect(fragment.bottomBorder).toBeUndefined();
      expect(fragment.spacing.after).toBe(0);
    }
    const last = fragments[fragments.length - 1]!;
    expect(last.bottomBorder).toBeDefined();
    expect(last.bottomBorder!.box.y).toBeGreaterThan(last.lines[last.lines.length - 1]!.box.y);
  });
});

describe('linesOf still walks every line when spacing and borders are present', () => {
  test('source ranges remain contiguous', () => {
    const layout = lay(
      load(paragraph('hello', `<w:spacing w:after="200"/>${BOTTOM('w:val="single" w:sz="8"')}`))
    );
    const lines = linesOf(layout);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.range).toMatchObject({ start: 0, end: 5 });
  });
});

// Spacing-after never decides its own line's fit (§17.3.1.33, issue #615): Word fits the
// LINE box, and trailing space that crosses the page boundary clips at the break. The
// signature-block idiom (`w:after="10867"` on an empty paragraph) otherwise mints a blank
// trailing page Word does not produce.
describe('after-spacing stays out of the page-fit decision', () => {
  // SMALL content height is 80pt; each fixed-measurer line is 14pt.

  test('an empty final paragraph with oversized after does not mint a trailing page', () => {
    const body =
      Array.from({ length: 4 }, (_, index) => paragraph(`line ${index}`)).join('') +
      paragraph('', '<w:spacing w:after="10867"/>');
    const layout = lay(load(body), SMALL);
    // Lines sit at 0/14/28/42; the empty mark's line fits at 56..70 of 80.
    expect(layout.pages).toHaveLength(1);
    const withoutTrailing = lay(
      load(Array.from({ length: 4 }, (_, index) => paragraph(`line ${index}`)).join('')),
      SMALL
    );
    expect(layout.pages.length).toBe(withoutTrailing.pages.length);
  });

  test('a line that fits stays on its page even when line + after overflows', () => {
    const body =
      Array.from({ length: 4 }, (_, index) => paragraph(`line ${index}`)).join('') +
      paragraph('fits', '<w:spacing w:after="800"/>') +
      paragraph('next');
    const layout = lay(load(body), SMALL);
    expect(layout.pages).toHaveLength(2);
    const fits = layout.pages[0]!.fragments.filter((f) => f.kind === 'paragraph').at(-1)!;
    if (fits.kind !== 'paragraph') throw new Error('expected paragraph');
    expect(fits.lines[0]!.spans.map((span) => span.text).join('')).toBe('fits');
    expect(fits.lines[0]!.box.y).toBe(56);
    // The clipped after-spacing leaves no residual: the next paragraph opens page 2 at 0.
    const next = layout.pages[1]!.fragments.find((f) => f.kind === 'paragraph')!;
    if (next.kind !== 'paragraph') throw new Error('expected paragraph');
    expect(next.lines[0]!.spans.map((span) => span.text).join('')).toBe('next');
    expect(next.spacing.before).toBe(0);
    expect(next.lines[0]!.box.y).toBe(0);
  });

  test('a lone paragraph whose after exceeds the page keeps to one page', () => {
    const layout = lay(load(paragraph('only', '<w:spacing w:after="10867"/>')), SMALL);
    expect(layout.pages).toHaveLength(1);
  });
});
