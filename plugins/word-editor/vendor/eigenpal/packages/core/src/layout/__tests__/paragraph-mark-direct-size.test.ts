// A paragraph mark's DIRECT `w:pPr/w:rPr` size and the lines of its paragraph.
//
// In anonymous probes, 12pt text under a 24pt direct mark keeps its 12pt line: three such
// paragraphs sit one 12pt line apart in compatibility modes 14 and 15 and with no mode set,
// and two of them in a table cell do too. An empty paragraph with the same mark takes the
// 24pt line, and so does the empty last line after a trailing break. Under the same mark,
// 12pt superscript, subscript and mixed lines and a line with only a 10pt picture keep the
// line of 12pt text too. A 12pt superscript line keeps it under an 8pt document default with
// a 24pt or a 12pt mark, and an equation line keeps its own height. Under a 12pt default, 8pt
// text with an 8pt superscript keeps the line of 8pt text with an 8pt mark, a 24pt mark or no
// mark, and so does an 8pt superscript alone; 10pt text with a 10pt superscript "1" and a
// 10pt mark keeps the line of 10pt text.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  TreeDocumentStore,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  layoutSemanticDocument,
  linesOf,
  type SemanticLayout,
  type TextMeasurer,
} from '../index.ts';
import { createLayoutSession } from '../layout-session.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from '../run-style.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { squareWrapZone } from './float-over-table-harness.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Size-aware metrics: line height 1.15em, baseline 0.9em, script text at its glyph size. */
const size = (style: ResolvedRunStyle) => style.fontSizePt * glyphSizeFactorOf(style);
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * size(style) * 0.5,
  lineMetrics: (style) => ({ height: size(style) * 1.15, baseline: size(style) * 0.9 }),
};
const line = (sizePt: number) => sizePt * 1.15;

function part(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const body = (content: string) =>
  part(`<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${content}</w:body></w:document>`);

/** 12pt Normal, so a paragraph without a direct mark has a 12pt mark. */
const styles = (halfPoints = 24, runProperties = '') => {
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="${halfPoints}"/>${runProperties}</w:rPr></w:style>` +
      '<w:style w:type="character" w:styleId="FootnoteReference">' +
      '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  return buildStyleCascadeTable(styles.part.root);
};

const SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
const mark = (size = 48) => `<w:rPr><w:sz w:val="${size}"/></w:rPr>`;
const paragraph = (content: string, markProperties = mark(), spacing = SPACING) =>
  `<w:p><w:pPr>${spacing}${markProperties}</w:pPr>${content}</w:p>`;
const run = (text: string, properties = '<w:sz w:val="24"/>') =>
  `<w:r><w:rPr>${properties}</w:rPr><w:t>${text}</w:t></w:r>`;

const DRAWING_NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** A 10pt picture, shorter than the 24pt mark. */
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="127000" cy="127000"/><wp:docPr id="1" name="p1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="127000" cy="127000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

const lay = (content: string) =>
  layoutSemanticDocument(body(content), 1, { measurer, styleCascade: styles() });
const tops = (layout: SemanticLayout) => {
  const lines = linesOf(layout);
  return lines.map((record) => record.box.y - lines[0]!.box.y);
};
const heights = (layout: SemanticLayout) => linesOf(layout).map((record) => record.box.height);

describe('a direct mark size leaves a line with text at its own height', () => {
  test('12pt text under a 24pt mark advances one 12pt line per paragraph', () => {
    const layout = lay(
      paragraph(run('Alpha')) + paragraph(run('Beta')) + paragraph(run('Gamma'), mark(24))
    );
    expect(heights(layout)).toEqual([line(12), line(12), line(12)]);
    expect(tops(layout)).toEqual([0, line(12), 2 * line(12)]);
  });

  test('the last line of a wrapped paragraph does not grow from the mark either', () => {
    const layout = lay(paragraph(run('Wrapping words '.repeat(12))));
    const lines = linesOf(layout);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.at(-1)!.box.height).toBeCloseTo(line(12), 5);
    expect(lines.at(-1)!.baseline).toBeCloseTo(12 * 0.9, 5);
  });

  test('a larger mark below smaller text keeps the smaller line, in any line rule', () => {
    for (const [rule, value, expected] of [
      ['auto', 480, 2 * line(10)],
      ['atLeast', 200, line(10)],
      ['atLeast', 400, 20],
      ['exact', 300, 15],
    ] as const) {
      const spacing = `<w:spacing w:before="0" w:after="0" w:line="${value}" w:lineRule="${rule}"/>`;
      const layout = lay(paragraph(run('Short', '<w:sz w:val="20"/>'), mark(), spacing));
      expect(heights(layout)[0]).toBeCloseTo(expected, 5);
    }
  });
});

describe('a line with nothing on it still takes the mark', () => {
  test('an empty paragraph and the empty last line after a trailing break', () => {
    const layout = lay(
      paragraph(run('Alpha'), mark(24)) +
        paragraph('') +
        paragraph(run('Alpha') + '<w:r><w:br/></w:r>') +
        paragraph(run('Gamma'), mark(24))
    );
    expect(heights(layout)).toEqual([line(12), line(24), line(12), line(24), line(12)]);
  });

  test('a line of spaces and tabs is sized by the mark as before', () => {
    const layout = lay(paragraph('<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:tab/></w:r>'));
    expect(heights(layout)[0]).toBeCloseTo(line(24), 5);
  });
});

describe('a line with other content under a direct mark', () => {
  const script = (align: string, text = 'Alpha') =>
    run(text, `<w:sz w:val="24"/><w:vertAlign w:val="${align}"/>`);

  test('super-, subscript and mixed lines keep the line of their full-size text', () => {
    const layout = lay(
      paragraph(script('superscript')) +
        paragraph(script('subscript')) +
        paragraph(run('Alpha') + script('superscript', '1')) +
        paragraph(run('Alpha') + script('subscript', '1')) +
        paragraph(script('superscript'), mark(24)) +
        // A right-to-left mark sizes from `w:szCs`, which does not apply either.
        paragraph(script('superscript'), '<w:rPr><w:rtl/><w:szCs w:val="48"/></w:rPr>')
    );
    expect(heights(layout)).toEqual(Array(6).fill(line(12)));
  });

  test('a superscript line takes the size of its run, not of a smaller cascade', () => {
    // An 8pt Normal style, a 12pt superscript run, and a 24pt, 12pt or 8pt direct mark.
    const layout = layoutSemanticDocument(
      body(
        paragraph(script('superscript')) +
          paragraph(script('superscript'), mark(24)) +
          paragraph(script('superscript'), mark(16)) +
          paragraph(run('Alph') + script('superscript', 'a'), mark(16))
      ),
      1,
      { measurer, styleCascade: styles(16) }
    );
    expect(heights(layout)).toEqual(Array(4).fill(line(12)));
  });

  // 8pt runs under the 12pt Normal style, the way Word writes a paragraph formatted 8pt.
  const small = (text: string) => run(text, '<w:sz w:val="16"/>');
  const smallScript = (text: string) =>
    run(text, '<w:sz w:val="16"/><w:vertAlign w:val="superscript"/>');

  test('a script line smaller than the cascade keeps the line of its own runs', () => {
    const layout = lay(
      paragraph(small('Alpha'), mark(16)) +
        paragraph(small('Alph') + smallScript('a'), mark(16)) +
        paragraph(small('Alph') + smallScript('a'), mark(48)) +
        paragraph(small('Alph') + smallScript('a'), '') +
        paragraph(smallScript('Alpha'), mark(16))
    );
    expect(heights(layout)).toEqual(Array(5).fill(line(8)));
  });

  test('superscript applied to and removed from one character of a small line', () => {
    const versions = [
      paragraph(small('Alpha'), mark(16)),
      paragraph(small('Alph') + smallScript('a'), mark(16)),
      paragraph(small('Alpha'), mark(16)),
    ];
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    versions.forEach((content, index) => {
      const options = { measurer, styleCascade: styles(), session, cache };
      const warm = layoutSemanticDocument(body(content), index + 1, options);
      expect(heights(warm)).toEqual([line(8)]);
      expect(heights(warm)).toEqual(heights(lay(content)));
    });
  });

  test('a footnote reference keeps the line of 10pt text under a 10pt mark', () => {
    const reference = run('1', '<w:rStyle w:val="FootnoteReference"/><w:sz w:val="20"/>');
    const layout = lay(
      paragraph(run('Text', '<w:sz w:val="20"/>') + reference, mark(20)) +
        paragraph(run('Text1', '<w:sz w:val="20"/>'), mark(20))
    );
    expect(heights(layout)).toEqual([line(10), line(10)]);
  });

  test('a right-to-left script line keeps its szCs size, not the Latin cascade size', () => {
    // 12pt `w:sz` and 8pt `w:szCs` in Normal; the run and the mark are right-to-left.
    const rtl = run('\u05d0\u05d1\u05d2', '<w:rtl/><w:vertAlign w:val="superscript"/>');
    const rtlMark = (halfPoints: number) =>
      `<w:rPr><w:rtl/><w:szCs w:val="${halfPoints}"/></w:rPr>`;
    const layout = layoutSemanticDocument(
      body(paragraph(rtl, rtlMark(16)) + paragraph(rtl, rtlMark(48))),
      1,
      { measurer, styleCascade: styles(24, '<w:szCs w:val="16"/>') }
    );
    expect(heights(layout)).toEqual([line(8), line(8)]);
  });

  test('a superscript mark keeps the floor at the smaller glyph size', () => {
    const raised = (size: string) => `<w:rPr>${size}<w:vertAlign w:val="superscript"/></w:rPr>`;
    const layout = lay(
      paragraph(script('superscript'), raised('<w:sz w:val="48"/>')) +
        paragraph(script('superscript'), raised(''))
    );
    expect(heights(layout)[0]).toBeCloseTo(line(12) * 0.65, 5);
    expect(heights(layout)[1]).toBeCloseTo(line(12) * 0.65, 5);
  });

  test('superscript toggled on the last line and wrapped away keeps the line height', () => {
    const words = 'Wrapping words '.repeat(12);
    const versions = [
      paragraph(run('Alpha')),
      paragraph(run('Alph') + script('superscript', 'a')),
      paragraph(run('Alpha')),
      paragraph(script('superscript', '1') + run(words)),
    ];
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    versions.forEach((content, index) => {
      const options = { measurer, styleCascade: styles(), session, cache };
      const warm = layoutSemanticDocument(body(content), index + 1, options);
      expect(heights(warm)).toEqual(Array(heights(warm).length).fill(line(12)));
      expect(heights(warm)).toEqual(heights(lay(content)));
    });
  });

  test('a line holding only an equation keeps its own height', () => {
    const equation = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
    const [marked, unmarked, equationAndText] = heights(
      lay(paragraph(equation) + paragraph(equation, '') + paragraph(equation + run('Text')))
    );
    expect(marked).toBeCloseTo(unmarked!, 5);
    expect(marked).toBeLessThan(line(24));
    expect(equationAndText).toBeLessThan(line(24));
  });

  test('a line holding only an inline picture keeps the line of its run', () => {
    const atLeast = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="atLeast"/>';
    const document = load(
      `<w:document xmlns:w="${W}" ${DRAWING_NS}><w:body>${paragraph(picture)}` +
        `${paragraph(picture + run('Text'))}${paragraph(picture, mark(), atLeast)}` +
        `${paragraph(picture + run('Text'), mark(), atLeast)}</w:body></w:document>`
    );
    const layout = layoutSemanticDocument(document, 1, {
      measurer,
      styleCascade: styles(),
      inlineDrawingLayout: layoutContext(document),
    });
    const [pictureOnly, pictureAndText, atLeastPicture, atLeastPictureAndText] = heights(layout);
    expect(pictureOnly).toBeCloseTo(line(12), 5);
    expect(pictureAndText).toBeCloseTo(line(12), 5);
    expect(atLeastPicture).toBeCloseTo(line(12), 5);
    expect(atLeastPictureAndText).toBeCloseTo(line(12), 5);
  });
});

describe('the estimate of a line before its content', () => {
  // The band starts 20pt down, below a 13.8pt line but above the 27.6pt mark line. A square
  // zone elsewhere on the page keeps the early estimate from being re-measured.
  const zones = (bandTop = 20) => {
    const square = squareWrapZone({
      anchorParagraphId: 'other',
      top: 60,
      height: 10,
      left: 0,
      width: 20,
    });
    const band = {
      ...square,
      drawingNodeId: 'band',
      y: bandTop,
      verticalBand: { x: 0, y: bandTop, width: 180, height: 20 },
      input: {
        ...square.input,
        mode: 'topAndBottom' as const,
        contentBounds: { x: 0, y: bandTop, width: 180, height: 20 },
      },
    };
    return [band, square];
  };

  test('a text line above a full-width band is not moved below it by the mark', () => {
    const source = body(paragraph(run('Alpha')));
    const node = (source.root.children[0] as OoxmlElement).children[0]!;
    const lines = (
      markRunProperties: readonly { localName: string; attributes?: Record<string, string> }[]
    ) =>
      breakParagraph(
        node,
        'p',
        0,
        180,
        measurer,
        undefined,
        null,
        [],
        undefined,
        undefined,
        undefined,
        {
          pageExclusionZones: zones(),
          paragraphStartY: 0,
          markRunProperties,
        }
      );
    const plain = lines([]);
    const marked = lines([{ localName: 'sz', attributes: { val: '48' } }]);
    expect(plain[0]!.exclusionSkipBefore).toBeUndefined();
    expect(marked[0]!.exclusionSkipBefore).toBeUndefined();
    expect(marked[0]!.height).toBeCloseTo(line(12), 5);
  });

  test('a picture line above a full-width band is not moved below it by the mark', () => {
    const document = load(
      `<w:document xmlns:w="${W}" ${DRAWING_NS}><w:body>${paragraph(picture)}</w:body></w:document>`
    );
    const node = (document.root.children[0] as OoxmlElement).children[0]!;
    const cascade = [{ localName: 'sz', attributes: { val: '24' } }];
    const [first] = breakParagraph(
      node,
      'p',
      0,
      180,
      measurer,
      undefined,
      null,
      cascade,
      undefined,
      undefined,
      undefined,
      {
        pageExclusionZones: zones(),
        paragraphStartY: 0,
        markRunProperties: [...cascade, { localName: 'sz', attributes: { val: '48' } }],
        inlineDrawingLayout: layoutContext(document),
      }
    );
    expect(first!.exclusionSkipBefore).toBeUndefined();
    expect(first!.height).toBeCloseTo(line(12), 5);
  });

  type RunProperty = { localName: string; attributes?: Record<string, string> };
  const cascade12: readonly RunProperty[] = [{ localName: 'sz', attributes: { val: '24' } }];
  const size = (halfPoints: number): RunProperty => ({
    localName: 'sz',
    attributes: { val: String(halfPoints) },
  });
  /** First line of one paragraph under a 12pt cascade, with the band `bandTop` down. */
  const firstLine = (
    content: string,
    markRunProperties: readonly RunProperty[],
    bandTop: number,
    lineMeasurer = measurer
  ) => {
    const node = (body(paragraph(content)).root.children[0] as OoxmlElement).children[0]!;
    const [first] = breakParagraph(
      node,
      'p',
      0,
      180,
      lineMeasurer,
      undefined,
      null,
      cascade12,
      undefined,
      undefined,
      undefined,
      { pageExclusionZones: zones(bandTop), paragraphStartY: 0, markRunProperties }
    );
    return first!;
  };
  const small = run('Alpha', '<w:sz w:val="16"/>');

  test('8pt text under an 8pt mark stays above a band the 12pt cascade line crosses', () => {
    // The band starts 11pt down: below the 9.2pt line, above the 13.8pt cascade line.
    const marked = firstLine(small, [...cascade12, size(16)], 11);
    expect(marked.exclusionSkipBefore).toBeUndefined();
    expect(marked.height).toBeCloseTo(line(8), 5);
  });

  test('a mark larger than the cascade leaves the estimate at the cascade', () => {
    const marked = firstLine(small, [...cascade12, size(48)], 20);
    expect(marked.exclusionSkipBefore).toBeUndefined();
    expect(marked.height).toBeCloseTo(line(8), 5);
  });

  test('an empty paragraph still reads the whole mark', () => {
    expect(firstLine('', [...cascade12, size(16)], 11).exclusionSkipBefore).toBeUndefined();
    const large = firstLine('', [...cascade12, size(48)], 20);
    expect(large.exclusionSkipBefore).toBeGreaterThan(0);
    expect(large.height).toBeCloseTo(line(24), 5);
  });

  test('a smaller mark in a taller face leaves the estimate at the cascade', () => {
    // The 8pt mark face measures 23pt, taller than the 13.8pt cascade line.
    const tallFace: TextMeasurer = {
      measure: measurer.measure,
      lineMetrics: (style) => {
        const metrics = measurer.lineMetrics(style);
        return style.fontFamily === 'Tall'
          ? { height: metrics.height * 2.5, baseline: metrics.baseline * 2.5 }
          : metrics;
      },
    };
    const face = { localName: 'rFonts', attributes: { ascii: 'Tall', hAnsi: 'Tall' } };
    const marked = firstLine(small, [...cascade12, face, size(16)], 20, tallFace);
    expect(marked.exclusionSkipBefore).toBeUndefined();
    expect(marked.height).toBeCloseTo(line(8), 5);
  });
});

describe('table cells', () => {
  const cell = (content: string) =>
    '<w:tbl><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>' +
    '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
    `${content}</w:tc></w:tr></w:tbl>`;
  const rowHeights = (layout: SemanticLayout) =>
    layout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'table' ? fragment.rows.map((row) => row.box.height) : []
    );
  // The cell's lines: the empty paragraph the body reads after the table comes last.
  const cellLines = (layout: SemanticLayout) => linesOf(layout).slice(0, -1);
  const heights = (layout: SemanticLayout) => cellLines(layout).map((record) => record.box.height);
  const tops = (layout: SemanticLayout) => {
    const lines = cellLines(layout);
    return lines.map((record) => record.box.y - lines[0]!.box.y);
  };

  test('text paragraphs in a cell keep their lines; under text the end mark sets no floor', () => {
    const twoLines = lay(cell(paragraph(run('Alpha')) + paragraph(run('Beta'))));
    expect(heights(twoLines)).toEqual([line(12), line(12)]);
    expect(tops(twoLines)).toEqual([0, line(12)]);
    const oneLine = lay(cell(paragraph(run('Alpha'))));
    expect(heights(oneLine)).toEqual([line(12)]);
    expect(rowHeights(oneLine)[0]).toBeCloseTo(line(12), 5);
    const threeLines = lay(
      cell(paragraph(run('Alpha')) + paragraph(run('Beta')) + paragraph(run('Gamma')))
    );
    expect(rowHeights(threeLines)[0]).toBeCloseTo(3 * line(12), 5);
  });

  test('an empty paragraph in a cell still takes the mark', () => {
    const layout = lay(cell(paragraph('') + paragraph(run('Beta'))));
    expect(heights(layout)).toEqual([line(24), line(12)]);
  });
});

describe('retained layout, editing and save', () => {
  const shapeOf = (layout: SemanticLayout) =>
    linesOf(layout).map((record) => [record.box.y, record.box.height, record.baseline]);

  test('adding and removing a direct mark size matches a cold layout', () => {
    const options = {
      measurer,
      styleCascade: styles(),
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const versions = [
      paragraph(run('Alpha'), '') + paragraph('', ''),
      paragraph(run('Alpha')) + paragraph(''),
      paragraph(run('Alpha'), '') + paragraph('', ''),
    ];
    versions.forEach((content, index) => {
      const warm = layoutSemanticDocument(body(content), index + 1, options);
      const cold = lay(content);
      expect(shapeOf(warm)).toEqual(shapeOf(cold));
      expect(heights(warm)).toEqual([line(12), index === 1 ? line(24) : line(12)]);
    });
  });

  test('a superscript line and a picture line under a changing mark match a cold layout', () => {
    const script = run('Note', '<w:sz w:val="24"/><w:vertAlign w:val="superscript"/>');
    const document = (markProperties: string) =>
      load(
        `<w:document xmlns:w="${W}" ${DRAWING_NS}><w:body>` +
          `${paragraph(script, markProperties)}${paragraph(picture, markProperties)}` +
          '</w:body></w:document>'
      );
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    ['', mark(), mark(16), '', mark()].forEach((markProperties, index) => {
      const warmPart = document(markProperties);
      const coldPart = document(markProperties);
      const warm = layoutSemanticDocument(warmPart, index + 1, {
        measurer,
        styleCascade: styles(),
        session,
        cache,
        inlineDrawingLayout: layoutContext(warmPart),
      });
      const cold = layoutSemanticDocument(coldPart, 1, {
        measurer,
        styleCascade: styles(),
        inlineDrawingLayout: layoutContext(coldPart),
      });
      expect(shapeOf(warm)).toEqual(shapeOf(cold));
      expect(heights(warm)).toEqual([line(12), line(12)]);
    });
  });

  test('text written into an empty paragraph, then deleted again', () => {
    const store = new TreeDocumentStore(body(paragraph('')));
    const options = { measurer, styleCascade: styles(), session: createLayoutSession() };
    expect(heights(layoutSemanticDocument(store.part, 1, options))).toEqual([line(24)]);
    const target = (store.part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    // The bare store op writes a plain run; the editor carries the mark's direct properties
    // to typed text through its caret format. Either way the line is the run's, not the mark's.
    const typed = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId: target.id, offset: 0, text: 'typed' })
    );
    expect(typed.ok).toBe(true);
    const afterTyping = heights(layoutSemanticDocument(store.part, 2, options));
    expect(afterTyping).toEqual([line(12)]);
    const saved = serializeOoxmlPart(store.part);
    const reopened = layoutSemanticDocument(part(saved), 1, { measurer, styleCascade: styles() });
    expect(heights(reopened)).toEqual(afterTyping);
    const deleted = store.transact((tx) =>
      tx.apply({ op: 'deleteText', paragraphId: target.id, start: 0, end: 5 })
    );
    expect(deleted.ok).toBe(true);
    expect(heights(layoutSemanticDocument(store.part, 3, options))).toEqual([line(24)]);
  });
});
