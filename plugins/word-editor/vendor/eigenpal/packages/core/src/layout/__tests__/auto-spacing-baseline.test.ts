import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';

// A face's line is 1.2 times its size, with the baseline at 0.9 of it.
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt * 0.9 }),
};
const layout = (paragraphs: string) =>
  linesOf(
    layoutSemanticDocument(
      loadBody(
        paragraphs +
          '<w:sectPr><w:pgSz w:w="12000" w:h="16000"/>' +
          '<w:pgMar w:left="1000" w:right="1000" w:top="1000" w:bottom="1000"/></w:sectPr>'
      ),
      1,
      { measurer, compatibilityMode: 15 }
    )
  );
test('a multiple below single scales the baseline with the line', () => {
  const [line] = layout(
    '<w:p><w:pPr><w:spacing w:after="0" w:line="192" w:lineRule="auto"/></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:t>Text</w:t></w:r></w:p>'
  );
  // Natural: 24pt high, baseline 18pt. At 0.8 both scale: 19.2pt high, baseline 14.4pt.
  expect(line!.box.height).toBeCloseTo(19.2, 5);
  expect(line!.baseline).toBeCloseTo(14.4, 5);
});
