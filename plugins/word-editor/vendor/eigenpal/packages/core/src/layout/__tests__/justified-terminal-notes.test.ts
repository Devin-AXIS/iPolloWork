import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { applyTreeOp, paragraphTextOf, type OoxmlPart } from '@docx-editor.dev/core/store';
import { isSpaceShrinkWordPiece } from '../space-shrink-piece.ts';
import { JUSTIFIED_SPACE_SHRINK } from '../space-shrink-rule.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';

const measurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].reduce(
      (sum, c) =>
        sum +
        (c === ' '
          ? 4 + (style.shaping?.wordSpacingPt ?? 0)
          : (c === '.' ? 1 : 10) * (style.bold ? 1.2 : 1)),
      0
    ),
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const prefix = 'aa '.repeat(10);
const note = '<w:r><w:footnoteReference w:id="1"/></w:r>';
function layout(tail: string, width = 265, reservedMarkText?: string, mark = '1', enabled = true) {
  const part = loadBody(`<w:p>${run(prefix + 'cc.')}${tail}</w:p>`);
  return layoutPart(part, width, reservedMarkText, mark, enabled);
}
function layoutPart(
  part: OoxmlPart,
  width: number,
  reservedMarkText?: string,
  mark = '1',
  enabled = true
) {
  const paragraph = part.root.children
    .flatMap((n) => n.children)
    .find((n) => n.kind === 'paragraph')!;
  return breakParagraph(
    paragraph,
    paragraph.id,
    0,
    width,
    measurer,
    undefined,
    null,
    [],
    undefined,
    undefined,
    undefined,
    {
      ...(enabled ? { spaceShrink: JUSTIFIED_SPACE_SHRINK } : {}),
      noteMarks: {
        marks: new Map([
          ['footnote:1', mark],
          ['endnote:1', mark],
        ]),
        reservedMarkText,
      },
    }
  );
}
test('a terminal note mark shares the complete word space fit', () => {
  const plain = layout(run('1'));
  const projected = layout(note);
  expect(plain).toHaveLength(1);
  expect(projected).toHaveLength(1);
  expect(projected[0]!.spans.map((s) => s.text).join('')).toBe(prefix + 'cc.1');
  expect(projected[0]!.spans.at(-1)!.noteNav?.direction).toBe('to-note');
  expect(projected[0]!.spans.at(-1)!.range.end - projected[0]!.spans.at(-1)!.range.start).toBe(1);
  expect(projected[0]!.spaceShrink).toBe(true);
});
test('reserved note widths retain their conservative fit', () => {
  expect(layout(note, 265, '999')).toHaveLength(2);
});
test('a projected PAGE field retains its conservative fit', () => {
  expect(layout('<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>')).toHaveLength(
    2
  );
});
test('multiple terminal marks retain their atomic ranges and separate styles', () => {
  const boldNote = '<w:r><w:rPr><w:b/></w:rPr><w:endnoteReference w:id="1"/></w:r>';
  const result = layout(note + run('.') + boldNote, 299, undefined, '10');
  const plain = layout(run('10.') + '<w:r><w:rPr><w:b/></w:rPr><w:t>10</w:t></w:r>', 299);
  expect(plain).toHaveLength(1);
  expect(result).toHaveLength(1);
  expect(result[0]!.spans.map((s) => s.text).join('')).toBe(prefix + 'cc.10.10');
  const marks = result[0]!.spans.filter((s) => s.noteNav);
  expect(marks.map((s) => s.box.width)).toEqual([20, 24]);
  expect(marks.map((s) => s.range.end - s.range.start)).toEqual([1, 1]);
  expect(marks.map((s) => s.noteNav!.scopeId)).toEqual(['footnote:1', 'endnote:1']);
});
test('an oversized marked word carries without dropping its citations', () => {
  const result = layout(note, 245, undefined, '1234');
  expect(result).toHaveLength(2);
  expect(result[1]!.spans.map((s) => s.text).join('')).toBe('cc.1234');
  expect(result[1]!.spans.at(-1)!.range.end - result[1]!.spans.at(-1)!.range.start).toBe(1);
});
test('following tabs and reserved values do not complete eligible terminal words', () => {
  expect(layout(note + '<w:r><w:tab/></w:r>')).toHaveLength(2);
  expect(layout(note, 265, undefined, '1', false)).toHaveLength(2);
});
test('hanging spaces after a citation preserve the complete word fit', () => {
  const result = layout(note + run(' ') + run('  '));
  expect(result).toHaveLength(1);
  expect(result[0]!.spans.map((s) => s.text).join('')).toBe(prefix + 'cc.1   ');
});
test('formatting a citation changes its measured fit without changing its model unit', () => {
  const part = loadBody(`<w:p>${run(prefix + 'cc.')}${note}</w:p>`);
  const before = layoutPart(part, 262);
  expect(before).toHaveLength(1);
  const mark = before[0]!.spans.at(-1)!;
  const changed = applyTreeOp(part, {
    op: 'setRunProperties',
    paragraphId: mark.range.paragraphId,
    start: mark.range.start,
    end: mark.range.end,
    properties: [{ localName: 'b', attributes: {} }],
  });
  expect(changed.ok).toBe(true);
  if (!changed.ok) return;
  const after = layoutPart(changed.part, 262);
  expect(after).toHaveLength(2);
  expect(after[1]!.spans.at(-1)!.style.bold).toBe(true);
  expect(after[1]!.spans.at(-1)!.range).toEqual(mark.range);
  expect(paragraphTextOf(changed.part, mark.range.paragraphId)).toBe(prefix + 'cc.\uFFFC');
});
test('empty and whitespace-only projected marks are not plain hanging spaces', () => {
  for (const text of ['', ' ', '\t', '1 2']) {
    expect(
      isSpaceShrinkWordPiece({
        text,
        start: 0,
        end: 1,
        props: [],
        style: DEFAULT_RUN_STYLE,
        projected: true,
        noteNav: { scopeId: 'footnote:1', direction: 'to-note' },
      })
    ).toBe(false);
  }
  const result = layout(
    '<w:r><w:footnoteReference w:id="1" w:customMarkFollows="1"/><w:t>*</w:t></w:r>'
  );
  expect(result).toHaveLength(1);
  expect(result[0]!.spans.map((s) => s.text).join('')).toBe(prefix + 'cc.*');
  expect(result[0]!.end).toBe(prefix.length + 5);
});
test('retained sessions refresh terminal note widths and keep unchanged page identity', () => {
  const part = loadBody(
    `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run(prefix + 'cc.')}${note}</w:p>`
  );
  const session = createLayoutSession();
  for (const mark of ['1', '99', '1']) {
    const options = {
      measurer,
      compatibilityMode: 15,
      geometry: { width: 265, height: 500, margin: { left: 0, right: 0, top: 0, bottom: 0 } },
      noteMarks: { marks: new Map([['footnote:1', mark]]) },
    };
    const warm = layoutSemanticDocument(part, 1, { ...options, session });
    const cold = layoutSemanticDocument(part, 1, options);
    expect(warm.pages).toEqual(cold.pages);
    const unchanged = layoutSemanticDocument(part, 1, { ...options, session });
    expect(unchanged.pages).toBe(warm.pages);
  }
});
