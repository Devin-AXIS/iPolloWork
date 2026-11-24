// A `wp:wrapTopAndBottom` anchor does not end its line. The text before and after it shares
// one line, which moves below the band when the band crosses it. A close that ran for every
// piece after the anchor once gave each later run a line of its own: a paragraph-final
// whitespace run became a phantom blank line, and every line below it moved down the page.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { caretAt } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type LineRecord } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const measurer = createFixedMeasurer(6, 14);

const BAND =
  '<w:r><w:drawing>' +
  '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="914400" cy="914400"/>' +
  '<wp:wrapTopAndBottom/>' +
  '<wp:docPr id="1" name="band"/>' +
  `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
  '</wp:anchor></w:drawing></w:r>';

function document(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

function linesOf(xml: string, fragmentIndex = 0): readonly LineRecord[] {
  const part = load(xml);
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  });
  return paragraphFragmentsOf(layout.pages[0]!)[fragmentIndex]!.lines;
}

const textOf = (lines: readonly LineRecord[]): readonly string[] =>
  lines.map((line) => line.spans.map((span) => span.text).join(''));

describe('a topAndBottom anchor keeps the runs around it on one line', () => {
  test('a paragraph-final whitespace-only run stays on the line it follows', () => {
    const lines = linesOf(
      document(
        `<w:p>${BAND}<w:r><w:t>banded text</w:t></w:r>` +
          '<w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>'
      )
    );
    expect(textOf(lines)).toEqual(['banded text ']);
  });

  test('an ordinary run after the anchor continues the line before it', () => {
    const lines = linesOf(
      document(
        `<w:p>${BAND}<w:r><w:t xml:space="preserve">banded </w:t></w:r>` +
          '<w:r><w:t>text</w:t></w:r></w:p>'
      )
    );
    expect(textOf(lines)).toEqual(['banded text']);
  });

  test('text authored before the anchor shares its line, which moves below the band', () => {
    const lines = linesOf(
      document(`<w:p><w:r><w:t>before</w:t></w:r>${BAND}<w:r><w:t>after</w:t></w:r></w:p>`)
    );
    expect(textOf(lines)).toEqual(['beforeafter']);
    // The band starts at the paragraph top and is 72 pt tall.
    expect(lines[0]!.box.y).toBeCloseTo(72, 6);
  });

  test('the trailing space keeps its model range, so the caret reaches past it', () => {
    const xml = document(
      `<w:p>${BAND}<w:r><w:t>banded text</w:t></w:r>` +
        '<w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>'
    );
    const part = load(xml);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    const line = fragment.lines[0]!;
    const space = line.spans.at(-1)!;
    expect(space.text).toBe(' ');
    const end = space.range.end;
    const caret = caretAt(layout, { paragraphId: fragment.paragraphId, offset: end }, measurer);
    expect(caret).not.toBeNull();
    expect(caret!.y).toBeCloseTo(line.box.y, 6);
    const before = caretAt(
      layout,
      { paragraphId: fragment.paragraphId, offset: end - 1 },
      measurer
    );
    expect(before).not.toBeNull();
    expect(before!.y).toBeCloseTo(line.box.y, 6);
    expect(caret!.x).toBeGreaterThan(before!.x);
  });
});

describe('cases the band rule must leave alone', () => {
  test('an empty paragraph still produces one line', () => {
    expect(linesOf(document(`<w:p>${BAND}</w:p>`))).toHaveLength(1);
    expect(linesOf(document('<w:p/>'))).toHaveLength(1);
  });

  test('a whitespace-only run in mid-paragraph keeps its line', () => {
    const lines = linesOf(
      document(
        `<w:p>${BAND}<w:r><w:t>one</w:t></w:r>` +
          '<w:r><w:t xml:space="preserve"> </w:t></w:r>' +
          '<w:r><w:t>two</w:t></w:r></w:p>'
      )
    );
    expect(textOf(lines)).toEqual(['one two']);
  });

  test('an explicit break after the anchor still ends its line', () => {
    const lines = linesOf(
      document(`<w:p>${BAND}<w:r><w:t>one</w:t><w:br/><w:t>two</w:t></w:r></w:p>`)
    );
    expect(textOf(lines)).toEqual(['one\n', 'two']);
  });

  test('a paragraph that ends with an explicit break keeps its empty final line', () => {
    const lines = linesOf(document(`<w:p>${BAND}<w:r><w:t>one</w:t><w:br/></w:r></w:p>`));
    expect(textOf(lines)).toEqual(['one\n', '']);
  });
});
