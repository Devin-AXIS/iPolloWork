// `w:tblOverlap w:val="never"` keeps floating tables apart. It never takes a table out of the
// float: text still wraps around it, and only a later table that would cover an earlier one
// moves. It moves right of the earlier table when it fits between the margins, left of it
// since mode 15, and otherwise below it. The bands that touch include the text distances.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import { noOverlapShift } from '../table-float-overlap.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const LINE = '<w:spacing w:after="0" w:line="280" w:lineRule="exact"/>';
const p = (text = '') =>
  `<w:p><w:pPr>${LINE}</w:pPr>${text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : ''}</w:p>`;

interface FloatSpec {
  readonly width: number;
  readonly position: string;
  readonly overlap?: 'never' | 'overlap';
  readonly extra?: string;
}
/** A four-row, 72pt-tall floating table, its width in twips. */
function table(spec: FloatSpec): string {
  const overlap = spec.overlap ? `<w:tblOverlap w:val="${spec.overlap}"/>` : '';
  const row = `<w:tr><w:trPr><w:trHeight w:val="360" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${spec.width}" w:type="dxa"/></w:tcPr>${p('cell')}</w:tc></w:tr>`;
  return (
    `<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:tblpY="1" ${spec.position} ${spec.extra ?? ''}/>` +
    `${overlap}<w:tblW w:w="${spec.width}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${spec.width}"/></w:tblGrid>${row.repeat(4)}</w:tbl>`
  );
}
function part(body: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages[0]!.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
function paragraphStarting(layout: SemanticLayout, label: string): ParagraphFragmentRecord {
  const found = layout.pages[0]!.fragments.find(
    (fragment): fragment is ParagraphFragmentRecord =>
      fragment.kind === 'paragraph' &&
      (fragment.lines[0]?.spans.some((span) => span.text.startsWith(label)) ?? false)
  );
  if (!found) throw new Error(`no paragraph ${label}`);
  return found;
}

/** Two tables on one anchor: the first at the margin, the second authored at `x2` twips. */
function pair(first: Partial<FloatSpec>, second: Partial<FloatSpec>, between = ''): OoxmlPart {
  return part(
    p('Lead') +
      table({ width: 4320, position: 'w:tblpX="0"', overlap: 'never', ...first }) +
      between +
      table({ width: 4320, position: 'w:tblpX="2880"', overlap: 'never', ...second }) +
      p('Anchor') +
      p('Next')
  );
}
const layoutOf = (source: OoxmlPart, compatibilityMode = 15) =>
  layoutSemanticDocument(source, 0, { measurer, compatibilityMode });

describe('tblOverlap never', () => {
  test('vertically separate tables both float and text wraps beside them', () => {
    const centred = { width: 5360, position: 'w:tblpXSpec="center"', overlap: 'never' as const };
    const layout = layoutOf(
      part(
        p('Lead') +
          table(centred) +
          p() +
          [1, 2, 3, 4, 5, 6, 7, 8].map((index) => p(`Beside${index}`)).join('') +
          table({ ...centred, width: 9000 }) +
          p() +
          p('After')
      )
    );
    const [first, second] = tables(layout);
    expect(isOutOfFlowTableFragment(first!)).toBe(true);
    expect(isOutOfFlowTableFragment(second!)).toBe(true);
    // The first wrapped line sits beside the first table, not below it.
    expect(paragraphStarting(layout, 'Beside1').box.y).toBeLessThan(
      first!.box.y + first!.box.height
    );
  });

  test('a later table moves right of the earlier one when it fits', () => {
    for (const mode of [14, 15]) {
      const layout = layoutOf(pair({}, {}), mode);
      const [first, second] = tables(layout);
      expect(tables(layout).every(isOutOfFlowTableFragment)).toBe(true);
      expect(second!.box.y).toBeCloseTo(first!.box.y, 3);
      // The two wrap bands touch: 9pt right of the first, 9pt left of the second.
      expect(second!.box.x).toBeCloseTo(first!.box.x + first!.box.width + 18, 3);
      // No room is left beside them, so the anchor text starts below both.
      expect(paragraphStarting(layout, 'Anchor').box.y).toBeGreaterThanOrEqual(
        first!.box.y + first!.box.height - 0.001
      );
    }
  });

  test('either table refusing overlap moves the later one', () => {
    for (const [first, second] of [
      [{ overlap: 'never' as const }, { overlap: undefined }],
      [{ overlap: undefined }, { overlap: 'never' as const }],
    ]) {
      const [a, b] = tables(layoutOf(pair(first, second)));
      expect(b!.box.x).toBeCloseTo(a!.box.x + a!.box.width + 18, 3);
    }
    const [a, b] = tables(layoutOf(pair({ overlap: undefined }, { overlap: undefined })));
    expect(b!.box.x).toBeCloseTo(143.95, 3);
    expect(b!.box.y).toBeCloseTo(a!.box.y, 3);
  });

  test('without room on the right, a later table moves below, with both text distances', () => {
    const centred = { width: 5040, position: 'w:tblpXSpec="center"' };
    const layout = layoutOf(
      pair(
        { ...centred, extra: 'w:bottomFromText="360"' },
        { ...centred, extra: 'w:topFromText="360"' }
      )
    );
    const [first, second] = tables(layout);
    expect(second!.box.x).toBeCloseTo(first!.box.x, 3);
    expect(second!.box.y).toBeCloseTo(first!.box.y + first!.box.height + 36, 3);
    // Text keeps wrapping beside the stacked tables.
    expect(paragraphStarting(layout, 'Anchor').box.y).toBeLessThan(
      first!.box.y + first!.box.height
    );
  });

  test('since mode 15 a later table moves left of the earlier one before moving down', () => {
    const source = pair(
      { width: 3600, position: 'w:tblpX="4320"' },
      { width: 2880, position: 'w:tblpX="2880"' }
    );
    const [first, modern] = tables(layoutOf(source, 15));
    expect(modern!.box.x + modern!.box.width).toBeCloseTo(first!.box.x - 18, 3);
    expect(modern!.box.y).toBeCloseTo(first!.box.y, 3);
    const [legacyFirst, legacy] = tables(layoutOf(source, 14));
    expect(legacy!.box.y).toBeCloseTo(legacyFirst!.box.y + legacyFirst!.box.height, 3);
  });

  test('tables on different anchors move apart too, and keep their cells unwrapped', () => {
    for (const overlap of ['never', undefined] as const) {
      const layout = layoutOf(pair({ overlap }, { overlap }, p('Middle')));
      const [first, second] = tables(layout);
      expect(isOutOfFlowTableFragment(second!)).toBe(true);
      if (overlap) expect(second!.box.x).toBeCloseTo(first!.box.x + first!.box.width + 18, 3);
      else expect(second!.box.x).toBeCloseTo(143.95, 3);
      // The cell text starts at the cell's own content edge, never beside the other table.
      const cell = second!.rows[0]!.cells[0]!.blocks[0]!;
      if (cell.kind !== 'paragraph') throw new Error('expected a cell paragraph');
      expect(cell.lines[0]!.spans[0]!.box.x).toBeLessThan(second!.box.x + 10);
    }
  });

  test('incremental layout matches a cold layout through overlap edits', () => {
    const variants = [
      pair({}, {}),
      pair({}, { position: 'w:tblpX="5040"' }),
      pair({}, {}, p('Middle')),
      pair({ overlap: undefined }, { overlap: undefined }),
      pair({}, {}),
    ];
    const session = createLayoutSession();
    for (const [revision, source] of variants.entries()) {
      const warm = layoutSemanticDocument(source, revision, { measurer, session });
      const cold = layoutSemanticDocument(source, revision, { measurer });
      expect(warm.pages).toEqual(cold.pages);
    }
  });

  test('a table that cannot move down on its page takes its anchor to the next page', () => {
    const lead = Array.from({ length: 38 }, (_, index) => p(`Lead${index}`)).join('');
    const wide = { width: 5040, position: 'w:tblpXSpec="center"' };
    const layout = layoutOf(part(lead + pairBody(wide, wide, p('Middle'))));
    for (const page of layout.pages)
      for (const fragment of page.fragments)
        expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(
          page.contentBox.height + 0.001
        );
    expect(tables(layout)).toHaveLength(1);
    const next = layout.pages[1]!.fragments.filter((fragment) => fragment.kind === 'table');
    expect(next).toHaveLength(1);
    expect(next[0]!.box.y).toBe(0);
  });
});

/** The body of {@link pair}, without its own lead paragraph. */
function pairBody(first: Partial<FloatSpec>, second: Partial<FloatSpec>, between = ''): string {
  return (
    table({ width: 4320, position: 'w:tblpX="0"', overlap: 'never', ...first }) +
    between +
    table({ width: 4320, position: 'w:tblpX="2880"', overlap: 'never', ...second }) +
    p('Anchor') +
    p('Next')
  );
}

describe('noOverlapShift', () => {
  const distances = { top: 0, right: 9, bottom: 0, left: 9 };
  const obstacle = { left: -9, top: 0, right: 225, bottom: 72, refusesOverlap: true };
  const candidate = { left: 144, top: 0, width: 216, height: 72, distances, refusesOverlap: true };
  const frame = { left: 0, right: 468 };

  test('moves right until the bands touch', () => {
    expect(noOverlapShift(candidate, [obstacle], frame, false)).toEqual({ dx: 90, dy: 0 });
  });

  test('moves down when neither side fits', () => {
    const wide = { ...candidate, width: 300 };
    expect(noOverlapShift(wide, [obstacle], frame, true)).toEqual({ dx: 0, dy: 72 });
  });

  test('ignores obstacles when neither table refuses overlap', () => {
    expect(
      noOverlapShift(
        { ...candidate, refusesOverlap: false },
        [{ ...obstacle, refusesOverlap: false }],
        frame,
        true
      )
    ).toEqual({ dx: 0, dy: 0 });
  });
});
