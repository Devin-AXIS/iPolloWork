// A hidden paragraph mark (`w:pPr/w:rPr/w:vanish`, or `w:specVanish`) on a paragraph that
// shows nothing else takes no room in the flow: no line box, no spacing. The paragraph stays
// in the tree, still counts in its list, and keeps its line wherever nothing follows it in
// the same container to take the join.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { numberingFlowBlocks } from '../hidden-paragraph-mark.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type PageGeometry } from '../semantic-records.ts';
import { storyBlocks } from '../story-roots.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

const measurer = createFixedMeasurer(6, 14);

/** Four 14pt lines fill the 60pt content height. */
const SMALL: PageGeometry = {
  width: 200,
  height: 80,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function read(xml: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function load(body: string): OoxmlPart {
  return read(`<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${body}</w:body></w:document>`);
}

const text = (value: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${value}</w:t></w:r>`;

const para = (content: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;

/** An empty paragraph with spacing, whose mark carries `markRPr`. */
const emptyMarked = (markRPr: string, extra = '') =>
  para('', `${extra}<w:spacing w:before="240" w:after="240"/><w:rPr>${markRPr}</w:rPr>`);

const HIDDEN = '<w:vanish/>';

function layout(body: string, options: Record<string, unknown> = {}) {
  return layoutSemanticDocument(load(body), 1, { measurer, geometry: SMALL, ...options });
}

function lineTexts(result: ReturnType<typeof layout>): string[] {
  return linesOf(result).map((line) => line.spans.map((span) => span.text).join(''));
}

function linePlacements(result: ReturnType<typeof layout>): string[] {
  return result.pages.flatMap((page, pageIndex) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map(
            (line) => `${pageIndex}:${line.box.y}:${line.spans.map((span) => span.text).join('')}`
          )
        : []
    )
  );
}

describe('an empty paragraph with a hidden mark leaves the flow', () => {
  test('a run of them takes no line and no spacing', () => {
    const hidden = Array.from({ length: 6 }, () => emptyMarked(HIDDEN)).join('');
    const withHidden = layout(`${para(text('first'))}${hidden}${para(text('second'))}`);
    const without = layout(`${para(text('first'))}${para(text('second'))}`);

    expect(linePlacements(withHidden)).toEqual(linePlacements(without));
    expect(withHidden.pages).toHaveLength(1);
  });

  test('the paragraph stays in the tree and in the numbering walk', () => {
    const part = load(`${para(text('first'))}${emptyMarked(HIDDEN)}${para(text('second'))}`);
    const body = part.root.children[0]!;
    expect(body.children.filter((child) => child.kind === 'paragraph')).toHaveLength(3);

    const blocks = storyBlocks(part);
    expect(blocks).toHaveLength(2);
    expect(numberingFlowBlocks(blocks).map((block) => block.id)).toEqual(
      body.children.filter((child) => child.kind === 'paragraph').map((child) => child.id)
    );
  });

  test('w:specVanish hides the mark too', () => {
    const result = layout(
      `${para(text('first'))}${emptyMarked('<w:specVanish/>')}${para(text('second'))}`
    );
    expect(lineTexts(result)).toEqual(['first', 'second']);
  });

  test('a paragraph whose runs are all directly hidden leaves with its mark', () => {
    const hidden = para(text('drafting note', HIDDEN), `<w:rPr>${HIDDEN}</w:rPr>`);
    const result = layout(`${para(text('first'))}${hidden}${para(text('second'))}`);
    expect(lineTexts(result)).toEqual(['first', 'second']);
  });

  test('inside a table cell, a following paragraph takes the join', () => {
    const cell = (content: string) =>
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
    const withHidden = layout(cell(`${emptyMarked(HIDDEN)}${para(text('cell'))}`));
    const without = layout(cell(para(text('cell'))));
    const boxes = (result: ReturnType<typeof layout>) =>
      result.pages.flatMap((page) => page.fragments.map((fragment) => fragment.box));
    expect(boxes(withHidden)).toEqual(boxes(without));
    expect(lineTexts(withHidden)).toEqual(['cell', '']);
  });
});

describe('an empty paragraph with a hidden mark before a table', () => {
  const table = (value: string) =>
    `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>${para(text(value))}</w:tc></w:tr></w:tbl>`;
  const hiddenNoBefore = (after = 0) =>
    para('', `<w:spacing w:before="0" w:after="${after}"/><w:rPr>${HIDDEN}</w:rPr>`);

  test('between two tables takes no line and no space after', () => {
    const tops = (body: string) => linesOf(layout(body)).map((line) => line.box.y);
    const joined = tops(`${table('one')}${hiddenNoBefore(240)}${table('two')}`);
    expect(lineTexts(layout(`${table('one')}${hiddenNoBefore(240)}${table('two')}`))).toEqual([
      'one',
      'two',
      '',
    ]);
    const adjacent = tops(`${table('one')}${table('two')}`);
    expect(joined[1]! - joined[0]!).toBeCloseTo(adjacent[1]! - adjacent[0]!, 6);
  });

  test('after a paragraph leaves that paragraph and the table as neighbours', () => {
    expect(lineTexts(layout(`${para(text('a'))}${hiddenNoBefore()}${table('cell')}`))).toEqual([
      'a',
      'cell',
      '',
    ]);
  });

  // Captured references drop this paragraph in both modes, with no automatic gap left.
  test('an automatic space before without a measurement takes no line either', () => {
    const autoOnly = para(
      '',
      `<w:spacing w:before="0" w:beforeAutospacing="1" w:after="0"/><w:rPr>${HIDDEN}</w:rPr>`
    );
    const body = `${para(text('a'))}${autoOnly}${table('cell')}`;
    const cascade = (compat: string) =>
      buildStyleCascadeTable(
        read(`<w:styles xmlns:w="${W}"/>`, '/word/styles.xml').root,
        undefined,
        read(
          `<w:settings xmlns:w="${W}"><w:compat>${compat}</w:compat></w:settings>`,
          '/word/settings.xml'
        ).root
      );
    const tops = (source: string, compat: string) =>
      linesOf(layout(source, { styleCascade: cascade(compat) })).map((line) => line.box.y);
    for (const compat of ['', '<w:doNotUseHTMLParagraphAutoSpacing/>']) {
      expect(lineTexts(layout(body, { styleCascade: cascade(compat) }))).toEqual(['a', 'cell', '']);
      // No automatic gap stays behind: the table sits where it would without the paragraph.
      expect(tops(body, compat)).toEqual(tops(`${para(text('a'))}${table('cell')}`, compat));
    }
  });
});

describe('paragraphs that keep their line', () => {
  const kept = (body: string, expected: string[]) => {
    expect(lineTexts(layout(body))).toEqual(expected);
  };

  test('a mark with w:vanish="0" is shown', () => {
    kept(`${para(text('a'))}${emptyMarked('<w:vanish w:val="0"/>')}${para(text('b'))}`, [
      'a',
      '',
      'b',
    ]);
  });

  test('an empty paragraph with a visible mark stays a blank line', () => {
    kept(`${para(text('a'))}${emptyMarked('<w:b/>')}${para(text('b'))}`, ['a', '', 'b']);
  });

  test('visible text before a hidden mark stays on the page', () => {
    kept(`${para(text('a'))}${para(text('kept'), `<w:rPr>${HIDDEN}</w:rPr>`)}${para(text('b'))}`, [
      'a',
      'keptb',
    ]);
  });

  test('a tab counts as content', () => {
    kept(
      `${para(text('a'))}${para('<w:r><w:tab/></w:r>', `<w:rPr>${HIDDEN}</w:rPr>`)}${para(text('b'))}`,
      ['a', '\t', 'b']
    );
  });

  test('content the check does not recognise counts as content', () => {
    const math = `<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>`;
    const body = `${para(text('a'))}${para(math, `<w:rPr>${HIDDEN}</w:rPr>`)}${para(text('b'))}`;
    expect(storyBlocks(load(body))).toHaveLength(3);
  });

  test('the last paragraph of the story has nothing to join', () => {
    kept(`${para(text('a'))}${emptyMarked(HIDDEN)}`, ['a', '']);
  });

  test('a paragraph before a table keeps its line when it states a space before', () => {
    const table = `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>${para(text('cell'))}</w:tc></w:tr></w:tbl>`;
    // The body ends with the table, so the empty paragraph read after it ends the list.
    kept(`${emptyMarked(HIDDEN)}${table}`, ['', 'cell', '']);
  });

  test('the last paragraph of a content control does not join the next block', () => {
    const control = `<w:sdt><w:sdtContent>${para(text('in'))}${emptyMarked(HIDDEN)}</w:sdtContent></w:sdt>`;
    kept(`${control}${para(text('out'))}`, ['in', '', 'out']);
  });

  test('a paragraph carrying a section break keeps its box', () => {
    const sectPr = '<w:sectPr><w:pgSz w:w="4000" w:h="1600"/></w:sectPr>';
    const body = `${para(text('a'))}${emptyMarked(HIDDEN, sectPr)}${para(text('b'))}`;
    expect(storyBlocks(load(body))).toHaveLength(3);
  });
});

describe('list numbering', () => {
  const num = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
  const numberingIndex = buildNumberingIndex(
    read(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
      '/word/numbering.xml'
    ).root
  );

  test('a hidden list paragraph still advances the counter', () => {
    const body =
      para(text('one'), num) +
      para('', `${num}<w:rPr>${HIDDEN}</w:rPr>`) +
      para(text('three'), num);
    const result = layout(body, { numberingIndex });
    const markers = result.pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
      )
    );
    expect(lineTexts(result).map((value) => value.trim())).toEqual(['one', 'three']);
    expect(markers).toEqual(['1.', '3.']);
  });
});

describe('pagination', () => {
  test('hidden empty paragraphs no longer push content onto another page', () => {
    // Four visible lines fill the page exactly. Each hidden paragraph laid out as an empty
    // line with spacing would push the fourth line onto a second page.
    const visible = ['a', 'b', 'c'].map((value) => para(text(value))).join('');
    const hidden = Array.from({ length: 3 }, () => emptyMarked(HIDDEN)).join('');
    const result = layout(`${visible}${hidden}${para(text('d'))}`);
    expect(result.pages).toHaveLength(1);
    expect(lineTexts(result)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('contextual spacing still sees a removed paragraph as the neighbour', () => {
  const styleCascade = buildStyleCascadeTable(
    read(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style></w:styles>`,
      '/word/styles.xml'
    ).root
  );
  const TALL: PageGeometry = {
    width: 200,
    height: 400,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };
  const styled = (value: string, style: string, spacing: string, extra = '') =>
    para(
      value ? text(value) : '',
      `${style ? `<w:pStyle w:val="${style}"/>` : ''}<w:spacing ${spacing}/>${extra}`
    );
  const hiddenIn = (style: string) =>
    styled('', style, 'w:before="240" w:after="240"', `<w:rPr>${HIDDEN}</w:rPr>`);

  /**
   * Space between the bottom of the line `first` and the top of the line `second`. Adjacent
   * space after and space before collapse to the larger of the two.
   */
  function gap(body: string): number {
    const result = layoutSemanticDocument(load(body), 1, {
      measurer,
      geometry: TALL,
      styleCascade,
    });
    const lines = linesOf(result);
    const line = (value: string) => {
      const found = lines.find(
        (candidate) => candidate.spans.map((span) => span.text).join('') === value
      );
      if (!found) throw new Error(`no line ${value}`);
      return found.box;
    };
    const first = line('first');
    return Math.round((line('second').y - (first.y + first.height)) * 100) / 100;
  }

  test('a same-style removed paragraph drops the space before of the paragraph after it', () => {
    const first = styled('first', '', 'w:after="200"');
    const second = styled('second', 'ListParagraph', 'w:before="240"');
    expect(gap(first + second)).toBe(12);
    expect(gap(first + hiddenIn('ListParagraph') + second)).toBe(10);
    expect(gap(first + hiddenIn('ListParagraph') + hiddenIn('ListParagraph') + second)).toBe(10);
  });

  test('a removed paragraph of another style keeps the space the visible neighbour would drop', () => {
    const first = styled('first', 'ListParagraph', 'w:after="0"');
    const second = styled('second', 'ListParagraph', 'w:before="240"');
    expect(gap(first + second)).toBe(0);
    expect(gap(first + hiddenIn('') + second)).toBe(12);
  });

  test('a same-style removed paragraph drops the space after of the paragraph before it', () => {
    const first = styled('first', 'ListParagraph', 'w:after="200"');
    const second = styled('second', '', 'w:before="0"');
    expect(gap(first + second)).toBe(10);
    expect(gap(first + hiddenIn('ListParagraph') + second)).toBe(0);
  });

  test('inside a table cell', () => {
    const cell = (content: string) =>
      `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
    const first = styled('first', '', 'w:after="200"');
    const second = styled('second', 'ListParagraph', 'w:before="240"');
    expect(gap(cell(first + second))).toBe(12);
    expect(gap(cell(first + hiddenIn('ListParagraph') + second))).toBe(10);
  });
});
