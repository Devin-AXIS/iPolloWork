import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { resolveRunStyle, runStylesEqual } from '../run-style.ts';
import { runBorderStrokesForLine } from '../run-border-strokes.ts';

const border = '<w:bdr w:val="single" w:sz="4" w:space="0" w:color="00AA00"/>';
const run = (text: string, props = border) =>
  `<w:r><w:rPr><w:sz w:val="22"/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
function lines(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${body}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
}

describe('character border groups', () => {
  test('bordered runs cannot merge into unbordered text; nil clears inherited borders', () => {
    const bdr = { localName: 'bdr', attributes: { val: 'single', sz: '4' } };
    const plain = resolveRunStyle([]);
    expect(runStylesEqual(resolveRunStyle([bdr]), plain)).toBe(false);
    expect(
      runStylesEqual(
        resolveRunStyle([bdr, { localName: 'bdr', attributes: { val: 'nil' } }]),
        plain
      )
    ).toBe(true);
  });
  test('adjacent formatting changes share one border without changing advances', () => {
    const [line] = lines(run('box') + run(' bold', border + '<w:b/>') + run(' plain', ''));
    const strokes = runBorderStrokesForLine(line!);
    expect(strokes).toHaveLength(4);
    const top = strokes.find((s) => s.side === 'top')!;
    expect(top.box.x).toBe(-0.5);
    expect(top.box.width).toBe(49);
    expect(top.box.height).toBe(0.5);
    expect(line!.spans.find((span) => !span.style.border)!.box.x).toBe(48);
    expect(top.edge.color).toBe('00AA00');
  });
  test('unbordered text, changed edges and manual line breaks separate groups', () => {
    const separate = lines(
      run('one') + run(' gap ', '') + run('two') + run('three', border.replace('00AA00', 'AA0000'))
    );
    expect(runBorderStrokesForLine(separate[0]!)).toHaveLength(12);
    const broken = lines(run('one') + '<w:r><w:br/></w:r>' + run('two'));
    expect(broken).toHaveLength(2);
    expect(broken.map((line) => runBorderStrokesForLine(line).length)).toEqual([4, 4]);
  });
  test('published wrap gaps remain open and nonzero border spacing expands outward', () => {
    const [line] = lines(run('one') + run('two', border + '<w:b/>'));
    const spans = line!.spans.map((span, i) => ({
      ...span,
      wrapAdvanceBefore: i * 20,
      box: { ...span.box, x: span.box.x + i * 20 },
    }));
    expect(runBorderStrokesForLine({ ...line!, spans })).toHaveLength(8);
    const [spaced] = lines(run('box', border.replace('space="0"', 'space="2"')));
    const top = runBorderStrokesForLine(spaced!).find((s) => s.side === 'top')!;
    expect(top.box.x).toBe(-2.5);
    expect(top.box.width).toBe(23);
  });
  test('justification gaps between adjacent model ranges remain inside one border', () => {
    const [line] = lines(run('one ') + run('two', border + '<w:b/>'));
    const spans = line!.spans.map((span, i) => ({
      ...span,
      box: { ...span.box, x: span.box.x + i * 10 },
    }));
    const strokes = runBorderStrokesForLine({ ...line!, spans });
    expect(strokes).toHaveLength(4);
    expect(strokes[0]!.box.width).toBe(spans.at(-1)!.box.x + spans.at(-1)!.box.width + 1);
  });
});
