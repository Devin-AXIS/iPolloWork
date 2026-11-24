import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { load } from './anchored-drawing-test-fixtures.ts';

const measurer = createFixedMeasurer(6, 14);
const BIG = '<w:rPr><w:sz w:val="40"/></w:rPr>';
const BIG_UNDERLINED = '<w:rPr><w:sz w:val="40"/><w:u w:val="single"/></w:rPr>';
const SMALL = '<w:rPr><w:sz w:val="16"/></w:rPr>';

/** Line heights of the one paragraph `runs` makes. */
function lineHeights(runs: string): readonly number[] {
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p>${runs}</w:p></w:body></w:document>`
  );
  const page = layoutSemanticDocument(part, 1, { measurer }).pages[0]!;
  return paragraphFragmentsOf(page)[0]!.lines.map((line) => line.box.height);
}

const text = (props: string, value: string) =>
  `<w:r>${props}<w:t xml:space="preserve">${value}</w:t></w:r>`;

// Spaces, ideographic spaces, and tabs add no line height, in every compatibility mode.
describe('spaces and tabs take no line height', () => {
  const empty = lineHeights('')[0]!;
  const small = lineHeights(text(SMALL, 'X'))[0]!;

  test('a paragraph of large tabs or spaces measures as an empty paragraph', () => {
    expect(lineHeights(`<w:r>${BIG}<w:tab/></w:r>`)).toEqual([empty]);
    expect(lineHeights(text(BIG, '   '))).toEqual([empty]);
  });

  test('large spaces before, after, or between text leave the text height', () => {
    expect(lineHeights(text(BIG, ' ') + text(SMALL, 'X'))).toEqual([small]);
    expect(lineHeights(text(SMALL, 'X') + text(BIG_UNDERLINED, '     '))).toEqual([small]);
    expect(lineHeights(text(SMALL, 'X') + `<w:r>${BIG}<w:tab/></w:r>` + text(SMALL, 'Y'))).toEqual([
      small,
    ]);
  });

  test('large ideographic spaces take no line height either', () => {
    expect(lineHeights(text(BIG, '\u3000\u3000\u3000'))).toEqual([empty]);
    expect(
      lineHeights(text(SMALL, 'X') + text(BIG_UNDERLINED, '\u3000\u3000') + text(SMALL, 'Y'))
    ).toEqual([small]);
  });

  test('a no-break space and a line break still count', () => {
    const big = lineHeights(text(BIG, 'X'))[0]!;
    expect(lineHeights(text(BIG, ' ') + text(SMALL, 'X'))).toEqual([big]);
    expect(lineHeights(`<w:r>${BIG}<w:tab/><w:br/></w:r>` + text(SMALL, 'X'))[0]).toBe(big);
  });
});
