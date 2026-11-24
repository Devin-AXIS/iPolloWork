// Revision-tagged semantic layout records (tasks 7.1, 7.3).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  fragmentsOfParagraph,
  lineAtPosition,
  linesOf,
  type PageGeometry,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, geometry?: PageGeometry, revision = 1) =>
  layoutSemanticDocument(part, revision, { measurer, ...(geometry ? { geometry } : {}) });

/** A small page, so pagination happens without needing pages of text. */
const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

// The measurer's 6pt/14pt base describes an 11pt run, so these paragraphs author `w:sz="22"`
// instead of resolving to the 10pt terminal fallback (see `DEFAULT_RUN_STYLE`), which would
// scale every box by 10/11 and turn round assertions into repeating decimals.
const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe('layout records carry revision and stable source ranges (task 7.1)', () => {
  test('the layout is tagged with the revision it came from', () => {
    const layout = lay(load(paragraph('hello')), undefined, 42);
    expect(layout.revision).toBe(42);
  });

  test('every line names its paragraph and its UTF-16 range', () => {
    const part = load(paragraph('hello world'));
    const layout = lay(part);
    const [line] = linesOf(layout);
    expect(line!.range.paragraphId).toBe('/word/document.xml#0.0.0');
    expect(line!.range.start).toBe(0);
    expect(line!.range.end).toBe(11);
  });

  test('style spans cover the line text in order, with their own ranges', () => {
    const part = load(
      '<w:p><w:r><w:t xml:space="preserve">plain </w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const [line] = linesOf(lay(part));
    expect(line!.spans.map((span) => span.text)).toEqual(['plain ', 'bold']);
    expect(line!.spans[0]!.range).toMatchObject({ start: 0, end: 6 });
    expect(line!.spans[1]!.range).toMatchObject({ start: 6, end: 10 });
    // The second span carries the run's accepted properties.
    expect(line!.spans[1]!.props).toEqual([{ localName: 'b' }]);
  });

  test('a position maps back to the line that holds it', () => {
    const part = load(paragraph('hello world'));
    const layout = lay(part);
    const id = '/word/document.xml#0.0.0';
    expect(lineAtPosition(layout, id, 0)).not.toBeNull();
    expect(lineAtPosition(layout, id, 11)).not.toBeNull(); // a caret at the very end resolves
    expect(lineAtPosition(layout, id, 99)).toBeNull();
  });

  test('an empty paragraph still produces one line, so it has a caret target', () => {
    const layout = lay(load('<w:p/>'));
    expect(linesOf(layout)).toHaveLength(1);
    expect(linesOf(layout)[0]!.box.height).toBeGreaterThan(0);
  });

  test('spans are positioned left to right within the line', () => {
    // The measurer's 6pt base describes an 11pt run, so the runs author `w:sz="22"` rather
    // than resolving to the 10pt terminal fallback (see `DEFAULT_RUN_STYLE`).
    const sz = '<w:rPr><w:sz w:val="22"/></w:rPr>';
    const part = load(`<w:p><w:r>${sz}<w:t>abc</w:t></w:r><w:r>${sz}<w:t>de</w:t></w:r></w:p>`);
    const [line] = linesOf(lay(part));
    expect(line!.spans[0]!.box.x).toBe(0);
    expect(line!.spans[1]!.box.x).toBe(18); // 3 characters at 6pt
  });
});

describe('line breaking and pagination (task 7.3)', () => {
  test('text wraps at word boundaries within the content width', () => {
    // 180pt of content at 6pt per character is 30 characters per line.
    const part = load(paragraph('aaaa bbbb cccc dddd eeee ffff gggg hhhh'));
    const layout = lay(part, { ...SMALL, height: 1000 });
    const lines = linesOf(layout);
    expect(lines.length).toBeGreaterThan(1);
    // No line exceeds the available width.
    for (const line of lines) {
      const width = line.spans.reduce((sum, span) => sum + span.box.width, 0);
      expect(width).toBeLessThanOrEqual(180);
    }
    // Every character is accounted for exactly once, in order.
    expect(lines.map((line) => line.spans.map((s) => s.text).join('')).join('')).toBe(
      'aaaa bbbb cccc dddd eeee ffff gggg hhhh'
    );
  });

  test('a hard break ends the line without ending the paragraph', () => {
    const part = load('<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r></w:p>');
    const layout = lay(part);
    expect(linesOf(layout)).toHaveLength(2);
    // Still ONE paragraph fragment.
    expect(layout.pages[0]!.fragments).toHaveLength(1);
  });

  test('content flows onto a second page when the first is full', () => {
    const many = Array.from({ length: 12 }, (_, index) => paragraph(`line ${index}`)).join('');
    const layout = lay(load(many), SMALL);
    expect(layout.pages.length).toBeGreaterThan(1);
    // Nothing overflows its page's content height.
    for (const page of layout.pages) {
      for (const fragment of page.fragments) {
        expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(page.contentBox.height);
      }
    }
  });

  test('a paragraph crossing a page keeps ONE identity across two fragments', () => {
    const long = paragraph(Array.from({ length: 40 }, (_, index) => `word${index}`).join(' '));
    const layout = lay(load(long), SMALL);
    const id = '/word/document.xml#0.0.0';
    const fragments = fragmentsOfParagraph(layout, id);
    expect(fragments.length).toBeGreaterThan(1);
    // Same paragraph, consecutive fragment indices, contiguous ranges.
    expect(fragments.map((fragment) => fragment.fragmentIndex)).toEqual(
      fragments.map((_, index) => index)
    );
    for (let index = 1; index < fragments.length; index += 1) {
      expect(fragments[index]!.range.start).toBe(fragments[index - 1]!.range.end);
    }
  });

  test('pageBreakBefore starts a new page', () => {
    const part = load(paragraph('first') + paragraph('second', '<w:pageBreakBefore/>'));
    const layout = lay(part, { ...SMALL, height: 1000 });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.fragments[0]!.lines[0]!.spans[0]!.text).toBe('first');
    expect(layout.pages[1]!.fragments[0]!.lines[0]!.spans[0]!.text).toBe('second');
  });

  test('w:br w:type="page" forces a page break inside one paragraph', () => {
    const part = load(
      '<w:p><w:r><w:t>before</w:t><w:br w:type="page"/><w:t>after</w:t></w:r></w:p>'
    );
    const layout = lay(part, { ...SMALL, height: 1000 });
    expect(layout.pages).toHaveLength(2);
    const paragraphId = '/word/document.xml#0.0.0';
    const fragments = fragmentsOfParagraph(layout, paragraphId);
    expect(fragments).toHaveLength(2);
    expect(fragments[0]!.lines.map((line) => line.spans.map((s) => s.text).join('')).join('')).toBe(
      'before\f'
    );
    expect(fragments[1]!.lines.map((line) => line.spans.map((s) => s.text).join('')).join('')).toBe(
      'after'
    );
  });

  test('a page break in an otherwise empty paragraph pushes following content to the next page', () => {
    const part = load('<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + paragraph('after'));
    const layout = lay(part, { ...SMALL, height: 1000 });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.fragments[0]!.lines[0]!.spans[0]!.text).toBe('\f');
    // Unlike a column break, a page break does NOT publish an empty remainder on the page
    // it opens — the following block starts flush at the top (Word Online / fixture parity).
    expect(layout.pages[1]!.fragments).toHaveLength(1);
    expect(layout.pages[1]!.fragments[0]!.lines[0]!.spans[0]!.text).toBe('after');
    expect(layout.pages[1]!.fragments[0]!.box.y).toBe(0);
  });

  test('an ordinary w:br remains a line break', () => {
    const part = load('<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r></w:p>');
    const layout = lay(part, { ...SMALL, height: 1000 });
    expect(layout.pages).toHaveLength(1);
    expect(linesOf(layout)).toHaveLength(2);
  });

  test('a left indent narrows the line and offsets it', () => {
    const part = load(paragraph('indented', '<w:ind w:left="720"/>')); // 720 twips = 36pt
    const [fragment] = layout(part).pages[0]!.fragments;
    expect(fragment!.box.x).toBe(36);
    expect(fragment!.box.width).toBe(468 - 36); // letter content width minus the indent
  });

  function layout(part: OoxmlPart) {
    return lay(part);
  }

  test('a larger font makes taller lines', () => {
    const small = lay(load(paragraph('x')));
    const large = lay(load('<w:p><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>x</w:t></w:r></w:p>'));
    expect(linesOf(large)[0]!.box.height).toBeGreaterThan(linesOf(small)[0]!.box.height);
  });

  test('unknown content occupies no text offset, keeping offsets in step with the ops', () => {
    const part = load(
      '<w:p><w:r><w:t>ab</w:t></w:r>' +
        '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
        '<w:r><w:t>cd</w:t></w:r></w:p>'
    );
    const [line] = linesOf(lay(part));
    // 'ab' then 'cd' with no gap: the drawing contributes no addressable offset, exactly as
    // the tree ops and the binding treat it.
    expect(line!.range.end).toBe(4);
    expect(line!.spans.map((span) => span.text).join('')).toBe('abcd');
  });
});

describe('layout is deterministic', () => {
  test('the same tree and measurer produce identical records', () => {
    const part = load(paragraph('deterministic output') + paragraph('second'));
    expect(JSON.stringify(lay(part))).toBe(JSON.stringify(lay(part)));
  });
});

describe('resolved style reaches measurement and the spans (task 7.2)', () => {
  test('a span carries the resolved style, not just the raw properties', () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="C00000"/></w:rPr>' +
        '<w:t>styled</w:t></w:r></w:p>'
    );
    const [line] = linesOf(lay(part));
    const span = line!.spans[0]!;
    expect(span.style.bold).toBe(true);
    expect(span.style.fontSizePt).toBe(22);
    expect(span.style.color).toBe('C00000');
    // The authored properties are retained alongside as evidence.
    expect(span.props).toHaveLength(3);
  });

  test('character spacing widens the line', () => {
    const plain = lay(load('<w:p><w:r><w:t>abcde</w:t></w:r></w:p>'));
    const spaced = lay(
      load('<w:p><w:r><w:rPr><w:spacing w:val="40"/></w:rPr><w:t>abcde</w:t></w:r></w:p>')
    );
    const width = (l: ReturnType<typeof linesOf>) =>
      l[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
    // 40 twips is 2pt per character across five characters.
    expect(width(linesOf(spaced))).toBeCloseTo(width(linesOf(plain)) + 10, 5);
  });

  test('horizontal scaling widens the line proportionally', () => {
    const plain = lay(load('<w:p><w:r><w:t>abcde</w:t></w:r></w:p>'));
    const scaled = lay(
      load('<w:p><w:r><w:rPr><w:w w:val="200"/></w:rPr><w:t>abcde</w:t></w:r></w:p>')
    );
    const width = (l: ReturnType<typeof linesOf>) =>
      l[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
    expect(width(linesOf(scaled))).toBeCloseTo(width(linesOf(plain)) * 2, 5);
  });

  test('caps text is measured as DRAWN, not as authored', () => {
    // Uppercasing changes nothing about width under a fixed measurer, but it must be the
    // drawn string that is measured — a proportional shaper would size them differently.
    const part = load('<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>abc</w:t></w:r></w:p>');
    const [line] = linesOf(lay(part));
    expect(line!.spans[0]!.style.caps).toBe(true);
    // The span keeps the SOURCE text, so a copy reproduces what the document holds.
    expect(line!.spans[0]!.text).toBe('abc');
  });

  test('superscript occupies less line height than baseline text', () => {
    // The paragraph MARK is measured with the line, and it carries its own `w:rPr`. So a
    // paragraph whose run is superscript but whose mark is not stays full height — Word does
    // the same. Raising the run alone therefore proves nothing; the mark has to be raised too
    // for the line itself to shrink.
    const superscriptRun = '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>';
    const baseline = lay(load('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const superscript = lay(
      load(`<w:p><w:pPr>${superscriptRun}</w:pPr><w:r>${superscriptRun}<w:t>x</w:t></w:r></w:p>`)
    );
    expect(linesOf(superscript)[0]!.box.height).toBeLessThan(linesOf(baseline)[0]!.box.height);
  });
});

describe('paragraph alignment moves the published span boxes (w:jc)', () => {
  // Alignment has to be geometry, not CSS: the painter draws the boxes layout publishes and
  // hit testing reads the same ones, so `text-align` would put the caret where no glyph is.
  const geometry: PageGeometry = {
    width: 200,
    height: 400,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };
  const available = geometry.width - 20;
  const firstSpan = (jc: string) =>
    linesOf(lay(load(paragraph('ab cd', jc ? `<w:jc w:val="${jc}"/>` : '')), geometry))[0]!;

  test('left alignment leaves spans at the indent', () => {
    expect(firstSpan('left').spans[0]!.box.x).toBe(0);
  });

  test('right alignment pushes the line flush to the right edge', () => {
    const line = firstSpan('right');
    const last = line.spans[line.spans.length - 1]!;
    // Trailing whitespace hangs past the edge, so the visible text ends exactly at it.
    expect(last.box.x + last.box.width).toBeCloseTo(available, 5);
    expect(line.spans[0]!.box.x).toBeGreaterThan(0);
  });

  test('centre alignment leaves equal slack on both sides', () => {
    const line = firstSpan('center');
    const last = line.spans[line.spans.length - 1]!;
    const leading = line.spans[0]!.box.x;
    const trailing = available - (last.box.x + last.box.width);
    expect(leading).toBeCloseTo(trailing, 5);
  });

  test('`start` and `end` resolve as left and right', () => {
    expect(firstSpan('start').spans[0]!.box.x).toBe(0);
    expect(firstSpan('end').spans[0]!.box.x).toBeGreaterThan(0);
  });

  test('an unknown w:jc value falls back to left rather than throwing', () => {
    expect(firstSpan('someFutureValue').spans[0]!.box.x).toBe(0);
  });

  test('the LAST line of a justified paragraph is never stretched', () => {
    // Two lines: the first is justified, the second is set flush left like Word does.
    const words = Array.from({ length: 14 }, (_, index) => `w${index}`).join(' ');
    const body = paragraph(words, '<w:jc w:val="both"/>');
    const lines = linesOf(lay(load(body), geometry));
    expect(lines.length).toBeGreaterThan(1);
    const last = lines[lines.length - 1]!;
    expect(last.spans[0]!.box.x).toBe(0);
    // Justified earlier lines gain space between words, so a later span sits past where the
    // unjustified cumulative advance would have put it.
    const first = lines[0]!;
    const secondSpan = first.spans[1]!;
    expect(secondSpan.box.x).toBeGreaterThan(first.spans[0]!.box.width);
  });

  test('justification stretches only after expandable spaces, not every span boundary', () => {
    // A leading run + tab + words: Word expands inter-word spaces, never invents slack
    // before a tab. The old uniform step×index shifted every later word by N×step and the
    // caret drifted mid-glyph while paint (word-spacing on real spaces) stayed put.
    const body =
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>` +
      `<w:r><w:t xml:space="preserve">qu</w:t></w:r>` +
      `<w:r><w:tab/></w:r>` +
      `<w:r><w:t xml:space="preserve">alpha beta gamma delta epsilon zeta</w:t></w:r>` +
      `</w:p>`;
    const line = linesOf(lay(load(body), geometry))[0]!;
    expect(line.spans.length).toBeGreaterThan(3);
    expect(line.spans[0]!.text).toBe('qu');
    expect(line.spans[1]!.text).toBe('\t');
    // No justify gap before the tab or between tab and the first word.
    expect(line.spans[1]!.box.x).toBeCloseTo(line.spans[0]!.box.x + line.spans[0]!.box.width, 5);
    expect(line.spans[2]!.box.x).toBeCloseTo(line.spans[1]!.box.x + line.spans[1]!.box.width, 5);
    // Word boundaries that end in a space DO receive slack.
    const afterSpace = line.spans.findIndex(
      (span, index) => index > 0 && line.spans[index - 1]!.text.endsWith(' ')
    );
    expect(afterSpace).toBeGreaterThan(1);
    const previous = line.spans[afterSpace - 1]!;
    const next = line.spans[afterSpace]!;
    expect(next.box.x).toBeGreaterThan(previous.box.x + previous.box.width + 0.25);
    // No eager cluster edges: prefix widths are measured on demand at interaction time
    // (issue #632), so aligned spans publish geometry only.
    for (const span of line.spans) {
      expect(span.caretEdges).toBeUndefined();
    }
  });

  test('alignment composes with indentation instead of replacing it', () => {
    const body = paragraph('ab cd', '<w:jc w:val="right"/><w:ind w:left="200"/>');
    const line = linesOf(lay(load(body), geometry))[0]!;
    const last = line.spans[line.spans.length - 1]!;
    // 200 twips = 10pt of indent; the right edge is measured from it, not from the margin.
    expect(last.box.x + last.box.width).toBeCloseTo(10 + (available - 10), 5);
  });
});

describe('per-section pagination (the per-section lane)', () => {
  // Geometry reaches layout the way a document states it: `w:sectPr`, in twips. A
  // mid-body section lives in the `w:pPr` of its LAST paragraph; the body-level one
  // governs the tail.
  const sect = (widthTwips: number, heightTwips: number, type = '') =>
    `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}` +
    `<w:pgSz w:w="${widthTwips}" w:h="${heightTwips}"/>` +
    '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
    'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
  // 200x300pt portrait and 300x200pt landscape, 10pt margins.
  const PORTRAIT = sect(4000, 6000);
  const LANDSCAPE = sect(6000, 4000);

  test('a landscape section among portrait ones gets its own sheet, sized landscape', () => {
    const part = load(
      paragraph('one', PORTRAIT) + paragraph('two', LANDSCAPE) + paragraph('three') + PORTRAIT
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(3);
    expect(layout.pages.map((page) => [page.box.width, page.box.height])).toEqual([
      [200, 300],
      [300, 200],
      [200, 300],
    ]);
    // Sheets stack with the 24pt gutter, cumulative because heights differ.
    expect(layout.pages.map((page) => page.box.y)).toEqual([0, 324, 548]);
    // Each page's content box reflects ITS section's margins.
    expect(layout.pages[1]!.contentBox.width).toBe(280);
  });

  test('lines break at their OWN section width', () => {
    // 6px per char, portrait content width 180 -> 30 chars; landscape 280 -> 46 chars.
    const text = 'word '.repeat(24).trim();
    const part = load(paragraph(text, PORTRAIT) + paragraph(text) + LANDSCAPE);
    const layout = lay(part);
    const ids = layout.pages.flatMap((page) =>
      page.fragments.map((fragment) => (fragment.kind === 'paragraph' ? fragment.paragraphId : ''))
    );
    const first = fragmentsOfParagraph(layout, ids[0]!);
    const second = fragmentsOfParagraph(layout, ids[ids.length - 1]!);
    expect(first[0]!.lines.length).toBeGreaterThan(second[0]!.lines.length);
    expect(second[0]!.lines[0]!.range.end).toBeGreaterThan(first[0]!.lines[0]!.range.end);
  });

  test('a continuous boundary with identical geometry shares the page', () => {
    const part = load(
      paragraph('one', sect(4000, 6000, 'continuous')) +
        paragraph('two') +
        sect(4000, 6000, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    // Both paragraphs are on the one sheet, and the continued section's content sits
    // BELOW the section it continues — Word flows them as one column.
    const fragments = layout.pages[0]!.fragments;
    expect(fragments).toHaveLength(2);
    expect(fragments[0]!.box.y).toBe(0);
    expect(fragments[1]!.box.y).toBe(14);
  });

  test('a continuous boundary with a DIFFERENT geometry still breaks the page', () => {
    // Two sections cannot share a sheet that has two sizes.
    const part = load(
      paragraph('one', PORTRAIT) + paragraph('two') + sect(6000, 4000, 'continuous')
    );
    expect(lay(part).pages).toHaveLength(2);
  });

  test('w:type on the CONTINUED section decides sharing (ECMA-376 §17.6.22)', () => {
    // `w:type` describes how THIS section starts relative to the previous one. A nextPage
    // section followed by an explicit continuous one must share; the reverse must not.
    const nextThenContinuous = load(
      paragraph('SECTION', sect(4000, 6000)) + paragraph('entry') + sect(4000, 6000, 'continuous')
    );
    const continuousLayout = lay(nextThenContinuous);
    expect(continuousLayout.pages).toHaveLength(1);
    const continuousText = continuousLayout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    ).join('');
    expect(continuousText).toContain('SECTION');
    expect(continuousText).toContain('entry');

    const continuousThenNext = load(
      paragraph('one', sect(4000, 6000, 'continuous')) + paragraph('two') + PORTRAIT
    );
    expect(lay(continuousThenNext).pages).toHaveLength(2);
  });

  test('continuous sharing tolerates mid-page margin changes on the same page size', () => {
    // Word TOC galleries often restyle margins on a continuous section without starting a
    // sheet. Only paper size / orientation must force a break.
    const withMargins = (topTwips: number, type: string) =>
      `<w:sectPr><w:type w:val="${type}"/>` +
      '<w:pgSz w:w="4000" w:h="6000"/>' +
      `<w:pgMar w:top="${topTwips}" w:right="200" w:bottom="200" w:left="200" ` +
      'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
    const part = load(
      paragraph('CONTENTS', withMargins(200, 'nextPage')) +
        '<w:sdt><w:sdtPr><w:docPartObj>' +
        '<w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/>' +
        '</w:docPartObj></w:sdtPr><w:sdtContent>' +
        paragraph('Definitions') +
        paragraph('The Facility') +
        '</w:sdtContent></w:sdt>' +
        withMargins(900, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    const text = layout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    ).join(' ');
    expect(text).toContain('CONTENTS');
    expect(text).toContain('Definitions');
    expect(text).toMatch(/The\s+Facility/);
  });

  test('continuous chains: three sections flow down one sheet in order', () => {
    const part = load(
      paragraph('one', sect(4000, 6000, 'continuous')) +
        paragraph('two', sect(4000, 6000, 'continuous')) +
        paragraph('three') +
        sect(4000, 6000, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.fragments.map((fragment) => fragment.box.y)).toEqual([0, 14, 28]);
  });

  test('a continuous section that does not fit overflows to a new sheet', () => {
    // Short sheet: 80pt content column. Enough fixed-height lines must overflow whether the
    // measurer reports 14pt or the slightly-shorter shaped fallback used in this package.
    const short = sect(4000, 2000);
    const filled = 'a';
    const part = load(
      paragraph(filled, short) +
        Array.from({ length: 10 }, () => paragraph(filled)).join('') +
        sect(4000, 2000, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages.length).toBeGreaterThan(1);
    // The overflow lands on a real second sheet, stacked with the 24pt gutter.
    expect(layout.pages[1]!.box.y).toBe(layout.pages[0]!.box.height + 24);
  });

  test('an EMPTY continuous section between two others does not break the chain', () => {
    const part = load(
      paragraph('one', sect(4000, 6000, 'continuous')) +
        // An empty continuous section: a sectPr-carrying paragraph is the section's last,
        // so this contributes no blocks of its own beyond that paragraph.
        paragraph('two', sect(4000, 6000, 'continuous')) +
        paragraph('three') +
        sect(4000, 6000, 'continuous')
    );
    expect(lay(part).pages).toHaveLength(1);
  });

  test('an absent w:type defaults to nextPage, so identical geometry does NOT share', () => {
    // Only `continuous` shares the sheet. The default must not start sharing pages just
    // because the two sections happen to describe the same page (ECMA-376 17.6.22).
    const part = load(paragraph('one', PORTRAIT) + paragraph('two') + PORTRAIT);
    expect(lay(part).pages).toHaveLength(2);
  });

  test('a trailing page break ends the sheet: the continued section starts after it', () => {
    // `endCursorY` is 0 both when a fresh column is empty and when a page break just
    // closed the sheet. Only the first may be continued onto; Word puts the continued
    // section AFTER the break, not on top of the page the break ended.
    const part = load(
      `<w:p><w:pPr>${PORTRAIT}</w:pPr><w:r><w:t>one</w:t></w:r>` +
        '<w:r><w:br w:type="page"/></w:r></w:p>' +
        paragraph('two') +
        sect(4000, 6000, 'continuous')
    );
    const layout = lay(part);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages.map((page) => page.fragments.map((fragment) => fragment.box.y))).toEqual([
      [0],
      [0],
    ]);
  });

  test('a single-section document paginates against its own sectPr', () => {
    const part = load(paragraph('hello world') + paragraph('again') + PORTRAIT);
    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    expect([layout.pages[0]!.box.width, layout.pages[0]!.box.height]).toEqual([200, 300]);
  });

  describe('a section break mark never manufactures a page', () => {
    // 200x108pt sheets with 10pt margins: six 14pt lines fill the 88pt column, so the
    // seventh has nothing left. That seventh line is what a section boundary lands on in a
    // real document, and whether it fits is a matter of a point or two.
    const SHORT = sect(4000, 2160);
    /** A paragraph that is nothing but the section break it carries. */
    const breakMark = (pPr: string) => `<w:p><w:pPr>${pPr}</w:pPr></w:p>`;
    const FILL = ['a', 'b', 'c', 'd', 'e', 'f'].map((text) => paragraph(text)).join('');
    const pageTexts = (layout: ReturnType<typeof lay>) =>
      layout.pages.map((page) =>
        page.fragments
          .flatMap((fragment) =>
            fragment.kind === 'paragraph'
              ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
              : []
          )
          .join('')
      );

    test('an unfittable break mark rides the page its section ended on', () => {
      const part = load(FILL + breakMark(SHORT) + paragraph('two') + SHORT);
      const layout = lay(part);
      // Two sheets, not three: the mark paints nothing, so a sheet holding only the mark
      // would be a blank page between two sections Word sets adjacent.
      expect(layout.pages).toHaveLength(2);
      expect(pageTexts(layout)).toEqual(['abcdef', 'two']);
      // The mark is still laid out — it is the section's last paragraph and the caret has to
      // reach it — and it is laid out on the page the section already filled.
      expect(layout.pages[0]!.fragments).toHaveLength(7);
      expect(layout.pages[1]!.fragments).toHaveLength(1);
    });

    test('a break mark WITH text is content, and moves to its own page when it must', () => {
      const part = load(
        FILL +
          `<w:p><w:pPr>${SHORT}</w:pPr><w:r><w:t>tail</w:t></w:r></w:p>` +
          paragraph('two') +
          SHORT
      );
      const layout = lay(part);
      expect(layout.pages).toHaveLength(3);
      expect(pageTexts(layout)).toEqual(['abcdef', 'tail', 'two']);
    });

    test('an ordinary empty paragraph still paginates', () => {
      // The exemption belongs to the break, not to emptiness: a plain empty paragraph is a
      // line of the document and takes the next page when the column is full.
      const part = load(FILL + '<w:p/>' + SHORT);
      const layout = lay(part);
      expect(layout.pages).toHaveLength(2);
      expect(pageTexts(layout)).toEqual(['abcdef', '']);
    });
  });
});
