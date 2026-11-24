// Auto line spacing below a line's text may cross the bottom margin of a plain page, but
// not into a footnote area. The footnote hold-out follows the same fit.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { PageRecord, ParagraphFragmentRecord } from '../semantic-records.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { holdOutReserveNeed, type HoldOutArgs } from '../note-reserve-holdout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
/** Page height; the note area is a 12pt separator plus one 12pt note line. */
const PAGE = 200;
const AREA_TOP = PAGE - 24;
const LINE = 12;

const exact = (text: string, height = LINE) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/></w:pPr><w:r>${text}</w:r></w:p>`;
/** A double-spaced paragraph without widow control, one line per entry. */
const double = (lines: readonly string[]) =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/></w:pPr>${lines
    .map((line, index) => `<w:r>${index ? '<w:br/>' : ''}${line}</w:r>`)
    .join('')}</w:p>`;
const REF = '<w:footnoteReference w:id="1"/>';

function layout(body: string, compatibilityMode = 15) {
  const entries = {
    '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="4000" w:h="${PAGE * 20}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${exact('<w:separator/>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${exact('<w:continuationSeparator/>')}</w:footnote><w:footnote w:id="1">${exact('<w:t>Note</w:t>')}</w:footnote></w:footnotes>`,
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))
  );
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer(5, LINE);
  return layoutSemanticDocument(part, 1, {
    measurer,
    compatibilityMode,
    session: createLayoutSession(),
    notes: {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      documentFootnoteProps: fn,
      footnotePropsBySection: [fn],
      documentEndnoteProps: en,
      endnotePropsBySection: [en],
      measurer,
      compatibilityMode,
      producer: 'footnote-area-line-spacing-test',
    },
  }).pages;
}

const pageOf = (pages: readonly PageRecord[], text: string): number =>
  pages.findIndex((page) =>
    page.fragments.some(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.some((span) => span.text.includes(text)))
    )
  );

describe('line spacing above a footnote area', () => {
  /**
   * A cited opening line, a spacer, then a double-spaced paragraph whose second line box
   * ends `cross` points below the top of the note area (or of the bottom margin without
   * a citation). The glyph band of that line always fits.
   */
  /** The double-spaced line height, read off a layout where everything fits. */
  const doubled = (() => {
    const pages = layout(double(['<w:t>Probe</w:t>']));
    const first = pages[0]!.fragments[0]!;
    if (first.kind !== 'paragraph') throw new Error('expected a paragraph');
    const line = first.lines[0]!;
    // The spacing below the text is what the fit may drop; the test needs it to be real.
    expect(line.trailingSpacing ?? 0).toBeGreaterThan(2);
    return line.box.height;
  })();

  function secondLinePage(cross: number, cites = true, lines = 3, mode = 15): number {
    const spacer = AREA_TOP + cross - 2 * doubled - LINE - (cites ? 0 : AREA_TOP - PAGE);
    const words = ['<w:t>First</w:t>', '<w:t>Second</w:t>', '<w:t>Third</w:t>'].slice(0, lines);
    return pageOf(
      layout(
        exact(`<w:t>Opening</w:t>${cites ? REF : ''}`) +
          exact('<w:t>Spacer</w:t>', spacer) +
          double(words),
        mode
      ),
      'Second'
    );
  }

  test('a line whose spacing below its text crosses the note area moves on', () => {
    expect(secondLinePage(2)).toBe(1);
    expect(secondLinePage(0.5)).toBe(1);
    expect(secondLinePage(0)).toBe(0);
  });

  test('the rule holds for the closing line of a paragraph too', () => {
    expect(secondLinePage(2, true, 2)).toBe(1);
    expect(secondLinePage(0, true, 2)).toBe(0);
  });

  test('legacy modes let the spacing cross the note area as it crosses a bottom margin', () => {
    expect(secondLinePage(2, true, 3, 14)).toBe(0);
    expect(secondLinePage(2, true, 2, 14)).toBe(0);
    expect(secondLinePage(2, true, 3, 12)).toBe(0);
  });

  test('the same spacing may still cross the bottom margin of a page without notes', () => {
    expect(secondLinePage(2, false)).toBe(0);
  });
});

const CONTENT = 648;
const STEP = 14;

function notesPart() {
  const result = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:pPr><w:spacing w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:t>N</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    { name: '/word/footnotes.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function fragment(
  id: string,
  top: number,
  count: number,
  props: string[] = [],
  after = 0
): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${id}#0`,
    paragraphId: id,
    fragmentIndex: 0,
    paragraphEnd: true,
    range: { start: 0, end: count * 10 },
    box: { x: 0, y: top, width: 468, height: count * STEP + after },
    props: props.map((localName) => ({ kind: 'generic', localName, attributes: {}, children: [] })),
    spacing: { before: 0, after, line: null, lineRule: 'auto' },
    indent: { start: 0, end: 0, firstLine: 0, hanging: 0 },
    lines: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      range: { paragraphId: id, start: index * 10, end: (index + 1) * 10 },
      spans: [],
      box: { x: 0, y: top + index * STEP, width: 468, height: STEP },
      contentX: 0,
      baseline: 11,
      leading: 0,
    })),
  } as ParagraphFragmentRecord;
}

function sheet(index: number, fragments: readonly ParagraphFragmentRecord[]): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: 0, width: 612, height: 792 },
    contentBox: { x: 72, y: 72, width: 468, height: CONTENT },
    fragments,
  };
}

/**
 * A page of 40 filler lines beside its own two-line note area. The next page opens with a
 * one-line heading kept with a four-line paragraph whose line `refLine` cites a note.
 */
function headingInput(refLine: number): HoldOutArgs {
  return {
    bodyPage: sheet(0, [fragment('filler', 0, 40)]),
    nextPage: sheet(1, [fragment('heading', 0, 1, ['keepNext']), fragment('cited', STEP, 4)]),
    existingAreaHeight: 2 * STEP,
    ownReservePt: 2 * STEP,
    usedReservePt: 2 * STEP,
    pageBottomRefsOf: (candidate) =>
      candidate.index === 1
        ? [{ noteId: 1, paragraphId: 'cited', atomOffset: (refLine - 1) * 10 + 5 }]
        : [],
    footnotesPart: notesPart(),
    opts: { measurer: createFixedMeasurer(6, STEP), producer: 'area-line-spacing' },
    plainSeparatorHeight: STEP,
    noteLayoutCache: new Map(),
  };
}

describe('footnote hold-out with a heading ahead of the cited paragraph', () => {
  const bodyBottom = 40 * STEP;

  test('the heading returns with the opening lines that end above the reference', () => {
    // The heading and the opening pair fit beside the existing notes; the reference line
    // and its note do not. The hold admits exactly that head.
    const head = 3 * STEP;
    expect(holdOutReserveNeed(headingInput(4))).toBeCloseTo(CONTENT - bodyBottom - head - 0.5);
  });

  test('a reference inside the opening lines keeps the whole group out', () => {
    expect(holdOutReserveNeed(headingInput(2))).toBeGreaterThan(CONTENT - bodyBottom - STEP);
  });
});

describe('footnote hold-out for a reference on a closing line', () => {
  test('the closing pair returns when it and its note fit, with no spare line of room', () => {
    // A two-line opening paragraph ends the next page's first block with the reference on
    // its closing line. It and its note fit beside the existing notes exactly, with no room
    // for one more line.
    const area = 2 * STEP;
    const note = STEP;
    const pair = 2 * STEP;
    const bodyBottom = CONTENT - area - note - pair;
    const args: HoldOutArgs = {
      bodyPage: sheet(0, [fragment('filler', 0, bodyBottom / STEP)]),
      nextPage: sheet(1, [fragment('cited', 0, 2), fragment('later', pair, 10)]),
      existingAreaHeight: area,
      ownReservePt: area,
      usedReservePt: CONTENT - bodyBottom,
      pageBottomRefsOf: (candidate) =>
        candidate.index === 1 ? [{ noteId: 1, paragraphId: 'cited', atomOffset: 15 }] : [],
      footnotesPart: notesPart(),
      opts: { measurer: createFixedMeasurer(6, STEP), producer: 'area-line-spacing' },
      plainSeparatorHeight: STEP,
      noteLayoutCache: new Map(),
    };
    expect(holdOutReserveNeed(args)).toBe(0);
  });
});
