// A tab whose next default stop lies past the right edge opens the next line in body text,
// even with nothing after it, and reaches the first stop there. A custom stop ahead is still
// clamped to the edge.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const tabs = (count: number) => `<w:r>${'<w:tab/>'.repeat(count)}</w:r>`;

/** One paragraph 400pt wide; default stops every 36pt, so eleven fit on a line. */
function layout(content: string, pPr = '') {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    geometry: { width: 400, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

const tabCounts = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) => line.spans.filter((span) => span.text === '\t').length);

test('tabs past the last default stop wrap, with or without text after them', () => {
  expect(tabCounts(layout(tabs(11)))).toEqual([11]);
  expect(tabCounts(layout(tabs(12)))).toEqual([11, 1]);
  expect(tabCounts(layout(tabs(25)))).toEqual([11, 11, 3]);
  expect(tabCounts(layout(run('Text') + tabs(14)))).toEqual([11, 3]);
});

test('the wrapped tab reaches the first stop on the next line', () => {
  const lines = linesOf(layout(run('Text') + tabs(14) + run('End')));
  expect(lines).toHaveLength(2);
  const end = lines[1]!.spans.find((span) => span.text === 'End')!;
  expect(end.box.x).toBeCloseTo(108, 5);
});

test('a legacy document honours a custom stop past the edge on the same line', () => {
  // No compatibility mode is a legacy document: the stop and the text after it pass the edge.
  const result = layout(
    run('Text') + tabs(1) + run('12'),
    '<w:tabs><w:tab w:val="left" w:pos="9000"/></w:tabs>'
  );
  expect(tabCounts(result)).toEqual([1]);
  const tab = linesOf(result)[0]!.spans.find((span) => span.text === '\t')!;
  expect(tab.box.x + tab.box.width).toBeCloseTo(450, 5);
  expect(linesOf(result)[0]!.spans.some((span) => span.text === '12')).toBe(true);
});

test('a custom left stop past the right indent reaches it while its text fits the margin', () => {
  const at = (stop: number, mode: number) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="${stop}"/></w:tabs>` +
        `<w:ind w:right="1000"/></w:pPr>${run('Text') + tabs(1) + run('12')}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    return linesOf(
      layoutSemanticDocument(read.part, 1, {
        measurer: createFixedMeasurer(6, 12),
        styleCascade: elevenPointDefaults(),
        compatibilityMode: mode,
        geometry: { width: 400, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      })
    ).map((line) => line.spans.map((span) => span.text).join(''));
  };
  // The indent edge is 350pt. A stop at 380pt keeps "12" (12pt) on the line in every mode.
  expect(at(7600, 15)).toEqual(['Text\t12']);
  expect(at(7600, 14)).toEqual(['Text\t12']);
  // At 392pt "12" would cross the 400pt margin: modern mode wraps it, legacy keeps it.
  expect(at(7840, 15)).toEqual(['Text\t', '12']);
  expect(at(7840, 14)).toEqual(['Text\t12']);
});
