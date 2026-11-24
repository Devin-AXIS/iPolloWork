import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { caretAt, hitTestSemantic } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';

const NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
].join(' ');
const paragraph = (content: string, pPr = '') => `<w:p>${pPr}<w:r>${content}</w:r></w:p>`;
const table = (content: string, twips = 6000) =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid>` +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>`;
const text = (value: string) => `<w:t xml:space="preserve">${value}</w:t>`;
const run = (content: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${content}</w:r>`;
const pageBreak = '<w:br w:type="page"/>';
const largeFont = '<w:sz w:val="48"/>';
const rightTab = '<w:pPr><w:tabs><w:tab w:val="right" w:pos="5000"/></w:tabs></w:pPr>';
/** A 100 x 50 pt square-wrapped picture at the top left of its paragraph. */
const squareAnchor =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="1270000" cy="635000"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="pic"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
/** An inline picture, `cx` x `cy` EMU. */
const inlinePicture = (cx: number, cy: number) =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
  '<wp:docPr id="2" name="inline"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  '<pic:nvPicPr><pic:cNvPr id="2" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
/** A 10 x 8 pt inline picture. */
const smallInline = inlinePicture(127000, 101600);

function part(body: string) {
  const result = readOoxmlPart(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function layout(body: string, drawings = false) {
  const source = part(body);
  return layoutSemanticDocument(source, 0, {
    measurer: createFixedMeasurer(),
    ...(drawings ? { inlineDrawingLayout: layoutContext(source) } : {}),
  });
}
function cellParagraph(result: SemanticLayout) {
  const block = result.pages[0]!.fragments[0]!;
  if (block.kind !== 'table') throw new Error('Expected table');
  const p = block.rows[0]!.cells[0]!.blocks[0]!;
  if (p.kind !== 'paragraph') throw new Error('Expected paragraph');
  return p;
}
function cellCaret(result: SemanticLayout, offset: number) {
  const caret = caretAt(result, { paragraphId: cellParagraph(result).paragraphId, offset });
  if (!caret) throw new Error(`No caret at ${offset}`);
  return caret;
}
/** Per line: the visible text, where it starts, and where its last span ends. */
function textPlacement(result: SemanticLayout) {
  return cellParagraph(result).lines.map((line) => {
    const spans = line.spans.filter((span) => span.text !== '\f');
    const last = spans.at(-1)!;
    return [spans.map((span) => span.text).join(''), spans[0]!.box.x, last.box.x + last.box.width];
  });
}
/** Per line, without break spans: text, first x, y, height, baseline, and clearance. */
function lineGeometry(result: SemanticLayout) {
  return cellParagraph(result).lines.map((line) => {
    const spans = line.spans.filter((span) => span.text !== '\f');
    const text = spans.map((span) => span.text).join('');
    const clearance = line.exclusionSkipBefore ?? 0;
    return [text, spans[0]?.box.x, line.box.y, line.box.height, line.baseline, clearance];
  });
}
function lineEndX(result: SemanticLayout) {
  const last = cellParagraph(result).lines[0]!.spans.at(-1)!;
  return last.box.x + last.box.width;
}

describe('manual page breaks inside table cells', () => {
  test('leading, repeated, interior, and trailing breaks retain offsets without adding lines', () => {
    const control = cellParagraph(layout(table(paragraph(text('AlphaBeta')))));
    const result = layout(
      table(paragraph(pageBreak + pageBreak + text('Alpha') + pageBreak + text('Beta') + pageBreak))
    );
    const p = cellParagraph(result);
    expect(p.lines).toHaveLength(1);
    expect(p.box.height).toBe(control.box.height);
    expect(p.lines[0]!.box.width).toBe(control.lines[0]!.box.width);
    expect(p.lines[0]!.spans.map((s) => s.text).join('')).toBe('\f\fAlpha\fBeta\f');
  });

  test('carets beside ignored breaks sit where the text without breaks puts them', () => {
    const control = layout(table(paragraph(text('AlphaBeta'))));
    const result = layout(
      table(paragraph(pageBreak + pageBreak + text('Alpha') + pageBreak + text('Beta') + pageBreak))
    );
    // Each offset in `\f\fAlpha\fBeta\f`, mapped to the same position in `AlphaBeta`.
    const controlOffset = [0, 0, 0, 1, 2, 3, 4, 5, 5, 6, 7, 8, 9, 9];
    for (let offset = 0; offset <= 13; offset++) {
      const caret = cellCaret(result, offset);
      const expected = cellCaret(control, controlOffset[offset]!);
      expect(caret.x).toBeCloseTo(expected.x, 9);
      expect([offset, caret.y, caret.height]).toEqual([offset, expected.y, expected.height]);
    }
    const end = cellCaret(result, 13);
    const hit = hitTestSemantic(result, { x: end.x + 200, y: end.y + 1, pageIndex: 0 });
    expect(hit?.position.offset).toBe(12);
  });

  test('a cell with only page breaks keeps one empty paragraph line', () => {
    const control = cellParagraph(layout(table(paragraph(''))));
    const result = layout(table(paragraph(pageBreak + pageBreak)));
    const p = cellParagraph(result);
    expect(p.lines).toHaveLength(1);
    expect(p.box.height).toBe(control.box.height);
    expect(p.lines[0]!.spans.map((span) => span.text).join('')).toBe('\f\f');
    expect(caretAt(result, { paragraphId: p.paragraphId, offset: 2 })).not.toBeNull();
  });

  test('a break run with a larger font adds no line height', () => {
    const control = cellParagraph(layout(table(paragraph(text('AlphaBeta')))));
    const empty = cellParagraph(layout(table('<w:p/>')));
    const interior = layout(
      table(`<w:p>${run(text('Alpha'))}${run(pageBreak, largeFont)}${run(text('Beta'))}</w:p>`)
    );
    const leading = layout(table(`<w:p>${run(pageBreak, largeFont)}${run(text('Alpha'))}</w:p>`));
    const only = layout(table(`<w:p>${run(pageBreak, largeFont)}</w:p>`));
    expect(cellParagraph(interior).box.height).toBe(control.box.height);
    expect(cellParagraph(leading).box.height).toBe(control.box.height);
    expect(cellParagraph(only).box.height).toBe(empty.box.height);
    const [before, after] = [cellCaret(interior, 5), cellCaret(interior, 6)];
    expect([after.x, after.y, after.height]).toEqual([before.x, before.y, before.height]);
    // A manual line break run still sizes the line that it ends.
    const lineBreak = layout(
      table(`<w:p>${run(text('Alpha'))}${run('<w:br/>', largeFont)}${run(text('Beta'))}</w:p>`)
    );
    expect(cellParagraph(lineBreak).lines[0]!.box.height).toBeGreaterThan(
      control.lines[0]!.box.height
    );
  });

  test('a larger ignored break adds no height beside an inline picture with auto spacing', () => {
    const pPr = '<w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr>';
    const cell = (breakRun: string) =>
      layout(
        table(
          `<w:p>${pPr}${smallInline}${run(text('Alpha'))}${breakRun}${run(text('Beta'))}</w:p>`
        ),
        true
      );
    const lines = (result: SemanticLayout) =>
      cellParagraph(result).lines.map((line) => [line.box.y, line.box.height, line.baseline]);
    const control = cell('');
    const result = cell(run(pageBreak, largeFont));
    expect(lines(result)).toEqual(lines(control));
    expect(cellParagraph(result).box.height).toBe(cellParagraph(control).box.height);
    // A manual line break run still sizes the text band of the line that it ends.
    const lineBreak = cell(run('<w:br/>', largeFont));
    expect(lines(lineBreak)[0]![1]).toBeGreaterThan(lines(control)[0]![1]!);
    // A body page break run still sizes the line that it ends.
    const body = (breakRun: string) => {
      const first = layout(
        `<w:p>${pPr}${smallInline}${run(text('Alpha'))}${breakRun}${run(text('Beta'))}</w:p>`,
        true
      ).pages[0]!.fragments[0]!;
      if (first.kind !== 'paragraph') throw new Error('Expected paragraph');
      return first.lines[0]!.box.height;
    };
    expect(body(run(pageBreak, largeFont))).toBeGreaterThan(body(run(pageBreak)));
  });

  test('breaks that open a cell paragraph add no line before a word that moves', () => {
    const bigBreak = run(pageBreak, largeFont);
    // The first word spans two runs and does not fit beside the break, or does not fit at all.
    for (const [content, twips] of [
      [run(text('Alpha')) + run(text('BetaGam sit')), 1000],
      [run(text('AlphaBetaGammaDelta sit')), 1000],
      [squareAnchor + run(text('Alpha')) + run(text('BetaGam sit')), 2600],
    ] as const) {
      const drawings = content.startsWith(squareAnchor);
      const control = layout(table(`<w:p>${content}</w:p>`, twips), drawings);
      for (const breaks of [bigBreak, run(pageBreak + pageBreak)]) {
        const leading = drawings
          ? squareAnchor + breaks + content.slice(squareAnchor.length)
          : breaks + content;
        const result = layout(table(`<w:p>${leading}</w:p>`, twips), drawings);
        expect(lineGeometry(result)).toEqual(lineGeometry(control));
        expect(cellParagraph(result).box.height).toBe(cellParagraph(control).box.height);
        // The breaks stay on the first line, where the text starts.
        const first = cellParagraph(result).lines[0]!.spans;
        const textX = first.find((span) => span.text !== '\f')!.box.x;
        const breakXs = first.filter((span) => span.text === '\f').map((span) => span.box.x);
        expect(breakXs).toEqual(breaks === bigBreak ? [textX] : [textX, textX]);
      }
    }
  });

  test('a break that opens a line beside a float keeps the clearance and caret of the text', () => {
    // 102 pt and 105 pt cells leave a passage narrower than one glyph beside the 100 pt
    // picture; 160 pt leaves a passage for the words.
    for (const twips of [2040, 2100, 3200]) {
      const words = run(text('Alpha BetaKappaLambda sit ametconsectetur'));
      const control = layout(table(`<w:p>${squareAnchor}${words}</w:p>`, twips), true);
      const result = layout(
        table(`<w:p>${squareAnchor}${run(pageBreak, largeFont)}${words}</w:p>`, twips),
        true
      );
      expect(lineGeometry(result)).toEqual(lineGeometry(control));
      const [before, expected] = [cellCaret(result, 1), cellCaret(control, 1)];
      expect([before.x, before.y]).toEqual([expected.x, expected.y]);
      expect(cellCaret(result, 2)).toMatchObject({ x: expected.x, y: expected.y });
    }
  });

  test('a break that opens a cell paragraph adds no line before a wide inline picture', () => {
    const picture = inlinePicture(120 * 12700, 10 * 12700);
    const control = layout(table(`<w:p>${picture}${run(text(' sit'))}</w:p>`, 2000), true);
    const result = layout(
      table(`<w:p>${run(pageBreak)}${picture}${run(text(' sit'))}</w:p>`, 2000),
      true
    );
    expect(lineGeometry(result)).toEqual(lineGeometry(control));
    expect(cellParagraph(result).box.height).toBe(cellParagraph(control).box.height);
  });

  test('an ignored break is not a wrap opportunity', () => {
    // `Alpha Beta` fits the first line, but `Alpha BetaKappaLambda` does not.
    const control = layout(table(paragraph(text('Alpha BetaKappaLambda sit')), 2000));
    const result = layout(
      table(paragraph(text('Alpha Beta') + pageBreak + text('KappaLambda sit')), 2000)
    );
    expect(textPlacement(result)).toEqual(textPlacement(control));
    const lines = cellParagraph(result).lines.map((line) =>
      line.spans.map((span) => span.text).join('')
    );
    expect(lines).toEqual(['Alpha ', 'Beta\fKappaLambda ', 'sit']);
  });

  test('a larger ignored break adds no height when a wrapped word moves across lines', () => {
    const control = layout(table(paragraph(text('Alpha BetaKappaLambda sit')), 2000));
    const bigBreak = run(pageBreak, largeFont);
    // The break moves to the next line inside the word that wraps.
    const carried = layout(
      table(`<w:p>${run(text('Alpha Beta'))}${bigBreak}${run(text('KappaLambda sit'))}</w:p>`, 2000)
    );
    // The break stays on the line that the wrapped word leaves.
    const kept = layout(
      table(
        `<w:p>${run(text('Alpha'))}${bigBreak}${run(text(' Beta'))}${run(text('KappaLambda sit'))}</w:p>`,
        2000
      )
    );
    const lines = (result: SemanticLayout) =>
      cellParagraph(result).lines.map((line) => [
        line.spans.map((span) => span.text).join(''),
        line.box.y,
        line.box.height,
        line.baseline,
      ]);
    expect(lines(carried)).toEqual([
      ['Alpha ', ...lines(control)[0]!.slice(1)],
      ['Beta\fKappaLambda ', ...lines(control)[1]!.slice(1)],
      lines(control)[2]!,
    ]);
    expect(lines(kept)).toEqual([
      ['Alpha\f ', ...lines(control)[0]!.slice(1)],
      lines(control)[1]!,
      lines(control)[2]!,
    ]);
    expect(textPlacement(carried)).toEqual(textPlacement(control));
    expect(textPlacement(kept)).toEqual(textPlacement(control));
    // Offsets after the break keep their source positions: `K` is offset 11, not 10.
    const [k, c] = [cellCaret(carried, 11), cellCaret(control, 10)];
    expect([k.x, k.y, k.height]).toEqual([c.x, c.y, c.height]);
    expect(cellParagraph(carried).box.height).toBe(cellParagraph(control).box.height);
    expect(cellParagraph(kept).box.height).toBe(cellParagraph(control).box.height);
  });

  test('a justified line that wraps after an ignored break stretches as without the break', () => {
    const pPr = '<w:pPr><w:jc w:val="both"/></w:pPr>';
    const words = 'Loremipsumdolorsit amet';
    const control = layout(table(paragraph(text('Alpha Beta ' + words), pPr), 2000));
    const result = layout(
      table(paragraph(text('Alpha Beta ') + pageBreak + text(words), pPr), 2000)
    );
    expect(textPlacement(result)).toEqual(textPlacement(control));
    // The position after the break starts the wrapped line.
    const wrapped = cellParagraph(control).lines[1]!;
    expect(cellCaret(result, 12)).toMatchObject({ x: wrapped.spans[0]!.box.x, y: wrapped.box.y });
  });

  test('an aligned tab positions the whole segment across an ignored break', () => {
    const control = layout(table(paragraph('<w:tab/>' + text('AlphaBeta'), rightTab)));
    const result = layout(
      table(paragraph('<w:tab/>' + text('Alpha') + pageBreak + text('Beta'), rightTab))
    );
    expect(cellParagraph(result).lines).toHaveLength(1);
    expect(lineEndX(result)).toBeCloseTo(lineEndX(control), 6);
    expect(cellCaret(result, 1).x).toBeCloseTo(cellCaret(control, 1).x, 6);
    expect(cellCaret(result, 7).x).toBeCloseTo(cellCaret(control, 6).x, 6);
  });

  test.each(['left', 'right', 'center', 'decimal'])(
    'an RTL %s tab ignores a page break inside its numeric segment',
    (alignment) => {
      const pPr = `<w:pPr><w:bidi/><w:tabs><w:tab w:val="${alignment}" w:pos="3000"/></w:tabs></w:pPr>`;
      const control = cellParagraph(layout(table(paragraph('<w:tab/>' + text('1234.5'), pPr))));
      const result = cellParagraph(
        layout(table(paragraph('<w:tab/>' + text('12') + pageBreak + text('34.5'), pPr)))
      );
      expect(result.lines).toHaveLength(1);
      const tabBox = (p: typeof control) => p.lines[0]!.spans.find((s) => s.text === '\t')!.box;
      expect(tabBox(result)).toEqual(tabBox(control));
      expect(result.lines[0]!.box.width).toBeCloseTo(control.lines[0]!.box.width, 6);
    }
  );

  test('a space before an ignored break is not line-end whitespace when text follows', () => {
    const bold = run(text('Alpha'), '<w:b/>');
    const control = cellParagraph(layout(table(`<w:p>${bold}${run(text(' Beta'))}</w:p>`)));
    const result = cellParagraph(
      layout(table(`<w:p>${bold}${run(text(' ') + pageBreak + text('Beta'))}</w:p>`))
    );
    const spans = (p: ReturnType<typeof cellParagraph>) =>
      p.lines[0]!.spans.filter((span) => span.text !== '\f').map((span) => [
        span.text.trim(),
        span.box.x,
        span.lineEndWhitespace ?? false,
      ]);
    expect(spans(result)).toEqual([
      ['Alpha', control.lines[0]!.spans[0]!.box.x, false],
      ['', control.lines[0]!.spans[1]!.box.x, false],
      ['Beta', control.lines[0]!.spans[2]!.box.x, false],
    ]);
  });

  test('a same-paragraph anchor wraps the same lines as without the break', () => {
    const words = run(text('word '.repeat(40)));
    const control = layout(
      table(`<w:p>${run(text('Alpha Beta '))}${squareAnchor}${words}</w:p>`),
      true
    );
    const result = layout(
      table(`<w:p>${run(text('Alpha ') + pageBreak + text('Beta '))}${squareAnchor}${words}</w:p>`),
      true
    );
    const lineGeometry = (l: SemanticLayout) =>
      cellParagraph(l).lines.map((line) => [
        line.box.y,
        line.spans.find((span) => span.text.trim() && span.text !== '\f')?.box.x,
      ]);
    expect(lineGeometry(result)).toEqual(lineGeometry(control));
    // Four lines beside the 50 pt picture, then full-width lines below it.
    expect(lineGeometry(result).filter(([, x]) => (x ?? 0) > 50)).toHaveLength(4);
  });

  test('nested cells also ignore manual page breaks', () => {
    const result = layout(
      table(table(paragraph(text('Alpha') + pageBreak + text('Beta'))) + '<w:p/>')
    );
    const outer = result.pages[0]!.fragments[0]!;
    if (outer.kind !== 'table') throw new Error('Expected table');
    const nested = outer.rows[0]!.cells[0]!.blocks[0]!;
    if (nested.kind !== 'table') throw new Error('Expected nested table');
    const p = nested.rows[0]!.cells[0]!.blocks[0]!;
    if (p.kind !== 'paragraph') throw new Error('Expected nested paragraph');
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]!.spans.map((span) => span.text).join('')).toBe('Alpha\fBeta');
  });

  test('manual line breaks still add lines inside cells', () => {
    const p = cellParagraph(layout(table(paragraph(text('Alpha') + '<w:br/>' + text('Beta')))));
    expect(p.lines).toHaveLength(2);
  });

  test('body page breaks still start a new page', () => {
    const result = layout(paragraph(text('Alpha') + pageBreak + text('Beta')));
    expect(result.pages).toHaveLength(2);
  });

  test('a body page break still ends an aligned tab segment', () => {
    const tabbed = (content: string) => {
      const first = layout(paragraph('<w:tab/>' + content, rightTab)).pages[0]!.fragments[0]!;
      if (first.kind !== 'paragraph') throw new Error('Expected paragraph');
      return first.lines[0]!.spans.find((span) => span.text.startsWith('Alpha'))!;
    };
    const alpha = tabbed(text('Alpha') + pageBreak + text('Beta'));
    const alone = tabbed(text('Alpha'));
    expect(alpha.box.x).toBeCloseTo(alone.box.x, 6);
    expect(
      layout(paragraph('<w:tab/>' + text('Alpha') + pageBreak + text('Beta'), rightTab)).pages
    ).toHaveLength(2);
  });

  test('an edit after an ignored break keeps incremental layout equal to a clean pass', () => {
    const before = part(table(paragraph(text('Alpha') + pageBreak + text('Beta'))));
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const measurer = createFixedMeasurer();
    const initial = layoutSemanticDocument(before, 0, { cache, session, measurer });
    const paragraphId = cellParagraph(initial).paragraphId;
    const edited = applyTreeOp(before, { op: 'insertText', paragraphId, offset: 6, text: 'new ' });
    if (!edited.ok) throw new Error(edited.reason);
    const incremental = layoutSemanticDocument(edited.part, 1, { cache, session, measurer });
    const clean = layoutSemanticDocument(edited.part, 1, { measurer: createFixedMeasurer() });
    expect(JSON.parse(JSON.stringify(incremental))).toEqual(JSON.parse(JSON.stringify(clean)));
    expect(
      cellParagraph(incremental)
        .lines[0]!.spans.map((s) => s.text)
        .join('')
    ).toBe('Alpha\fnew Beta');
  });
});
