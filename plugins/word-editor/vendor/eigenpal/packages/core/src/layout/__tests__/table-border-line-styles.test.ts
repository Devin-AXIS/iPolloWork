// Table edges in the patterned and multi-stroke `ST_Border` line styles (ECMA-376 §17.18.2)
// on `w:tcBorders` (§17.4.66) and `w:tblBorders` (§17.4.38).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableCellFragmentRecord } from '../semantic-records.ts';
import type { TableBorderStrokeRecord } from '../table-borders.ts';
import { readBorderSide, resolveBorderConflict } from '../table-borders.ts';
import { borderDashPatternPt, threeDBorderTones } from '../border-line-styles.ts';
import { borderStrokeWidthPt } from '../border-metrics.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function firstCell(top: string): TableCellFragmentRecord {
  const body =
    '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
    `<w:tcW w:w="4000" w:type="dxa"/><w:tcBorders>${top}</w:tcBorders></w:tcPr>` +
    '<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (table?.kind !== 'table') throw new Error('The table was not laid out');
  return table.rows[0]!.cells[0]!;
}

const top = (val: string, sz: number, color = '000000') =>
  `<w:top w:val="${val}" w:sz="${sz}" w:space="0" w:color="${color}"/>`;

function topStrokes(cell: TableCellFragmentRecord): readonly TableBorderStrokeRecord[] {
  return (cell.borders?.strokes ?? []).filter((stroke) => stroke.side === 'top');
}

function contentTop(cell: TableCellFragmentRecord): number {
  const paragraph = cell.blocks[0];
  if (paragraph?.kind !== 'paragraph') throw new Error('The cell paragraph is missing');
  return paragraph.box.y - cell.box.y;
}

describe('table border line styles', () => {
  test('a thin-thick band paints its strokes and gaps, and content clears the band', () => {
    const single = firstCell(top('single', 24));
    const cell = firstCell(top('thinThickLargeGap', 24));
    // A 1.5pt stroke, a gap of the authored 3pt, and a 0.75pt stroke: a 5.25pt band.
    const strokes = topStrokes(cell);
    expect(strokes.map((stroke) => stroke.height)).toEqual([1.5, 0.75]);
    expect(strokes[1]!.y - strokes[0]!.y).toBeCloseTo(4.5, 6);
    expect(strokes.every((stroke) => stroke.cssStyle === 'solid')).toBe(true);
    expect(contentTop(cell) - contentTop(single)).toBeCloseTo(5.25 - 3, 6);
  });

  test('a three-dimensional band paints three toned strokes', () => {
    const cell = firstCell(top('threeDEngrave', 48, '33CCCC'));
    const strokes = topStrokes(cell);
    // Outer strokes of 1.5pt from an authored 3pt; the authored 6pt in the middle.
    expect(strokes.map((stroke) => stroke.height)).toEqual([1.5, 6, 1.5]);
    // Engrave: dark, middle and light tones from top to bottom.
    expect(strokes.map((stroke) => stroke.color)).toEqual(
      [...threeDBorderTones('33CCCC')].reverse()
    );
    expect(strokes[2]!.color).toBe('33CCCC');
    expect(strokes[0]!.color).toBe('114444');
  });

  test('dashDotStroked paints a fixed 3pt hatch whatever its size', () => {
    for (const sz of [4, 48]) {
      const [stroke, ...rest] = topStrokes(firstCell(top('dashDotStroked', sz)));
      expect(rest).toEqual([]);
      expect(stroke!.hatch).toBe(true);
      expect(stroke!.height).toBe(3);
    }
  });

  test('the dash family publishes its measured dash lengths', () => {
    const [dotDash] = topStrokes(firstCell(top('dotDash', 12)));
    expect(dotDash!.dashPt).toEqual([10.5, 4.5, 4.5, 4.5]);
    expect(borderDashPatternPt('dotted', 2)).toEqual([2, 2]);
    expect(borderDashPatternPt('dashed', 1)).toEqual([4, 4]);
    expect(borderDashPatternPt('dashSmallGap', 1)).toEqual([4, 1]);
    expect(borderDashPatternPt('dotDotDash', 1)).toEqual([6, 2, 2, 2, 2, 2]);
  });

  test('a wide band still weighs by its authored size in a conflict', () => {
    const edge = (val: string, sz: number) =>
      readBorderSide({
        kind: 'element',
        namespaceUri: W,
        localName: 'top',
        attributes: [
          { localName: 'val', namespaceUri: W, value: val },
          { localName: 'sz', namespaceUri: W, value: String(sz) },
        ],
        children: [],
      } as never);
    const compound = edge('thinThickSmallGap', 4);
    expect(compound.state === 'edge' && compound.widthPt).toBe(2);
    // A 0.5pt thin-thick band (2pt painted) loses to a 1.5pt single rule.
    expect(resolveBorderConflict(compound, edge('single', 12))).toEqual(edge('single', 12));
  });

  test('three-dimensional bands and tones follow the measured rule', () => {
    expect(borderStrokeWidthPt('threeDEmboss', 2.875)).toBe(2.875 + 1.5);
    expect(borderStrokeWidthPt('threeDEmboss', 3)).toBe(6);
    expect(borderStrokeWidthPt('dashDotStroked', 0.5)).toBe(3);
    expect(threeDBorderTones(null)).toEqual(['C0C0C0', '606060', '000000']);
    expect(threeDBorderTones('FFFFFF')).toEqual(['FFFFFF', 'A0A0A0', '808080']);
    expect(threeDBorderTones('800000')).toEqual(['D50000', '400000', '2B0000']);
    expect(threeDBorderTones('336699')).toEqual(['5991C8', '234669', '1E3C59']);
    expect(threeDBorderTones('E0E0E0')).toEqual(['E0E0E0', '959595', '8B8B8B']);
  });
});
