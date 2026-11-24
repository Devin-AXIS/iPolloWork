import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { hitTestFragments, hitTestPage } from '../semantic-hit-test.ts';
import {
  caretAt,
  caretStopsForBlocks,
  documentOrder,
  selectionRects,
} from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { isBottomToTopCaret } from '../table-cell-text-direction.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function layout(bodyXml: string): SemanticLayout {
  return layoutSemanticDocument(loadPart(bodyXml), 0, { measurer: createFixedMeasurer() });
}

function firstTable(result: SemanticLayout): TableFragmentRecord {
  const table = result.pages[0]!.fragments[0];
  if (table?.kind !== 'table') throw new Error('expected table');
  return table;
}

describe('bottom-to-top table cell text', () => {
  test('lays text along the row height instead of the narrow column width', () => {
    const result = layout(
      '<w:tbl><w:tblGrid><w:gridCol w:w="510"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:textDirection w:val="btLr"/><w:vAlign w:val="center"/></w:tcPr>' +
        paragraph('vertical label') +
        '</w:tc></w:tr></w:tbl>'
    );
    const cell = firstTable(result).rows[0]!.cells[0]!;
    const block = cell.blocks[0]!;
    if (block.kind !== 'paragraph') throw new Error('expected paragraph');
    expect(cell.textDirection).toBe('btLr');
    expect(cell.box).toMatchObject({ width: 25.5, height: 100 });
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]!.spans.map((span) => span.text).join('')).toBe('vertical label');

    const span = block.lines[0]!.spans[0]!;
    const paintedPoint = {
      x: cell.box.x + (span.box.y - cell.box.y) + span.box.height / 2,
      y: cell.box.y + cell.box.height - (span.box.x - cell.box.x) - span.box.width / 2,
    };
    const hit = hitTestPage(result, 0, paintedPoint)!;
    expect(hit.position.paragraphId).toBe(block.paragraphId);
    expect(isBottomToTopCaret(hit.caret)).toBe(true);
    const caret = caretAt(result, { paragraphId: block.paragraphId, offset: 0 })!;
    expect(isBottomToTopCaret(caret)).toBe(true);
    expect(hit.caret).toEqual(caretAt(result, hit.position, { preferredPageIndex: 0 }));
    expect(hit.caret.x).toBeGreaterThanOrEqual(cell.box.x);
    expect(hit.caret.x).toBeLessThanOrEqual(cell.box.x + cell.box.width);
    expect(caret.x).toBeGreaterThanOrEqual(cell.box.x);
    expect(caret.x).toBeLessThanOrEqual(cell.box.x + cell.box.width);
    const selection = {
      anchor: { paragraphId: block.paragraphId, offset: 0 },
      head: { paragraphId: block.paragraphId, offset: 'vertical label'.length },
    };
    const [rect] = selectionRects(result, selection, documentOrder(result));
    expect(rect!.width).toBeCloseTo(block.lines[0]!.box.height, 3);
    expect(rect!.height).toBeGreaterThan(rect!.width);
  });

  test('keeps caret geometry available in furniture and note stories', () => {
    const bodyLayout = layout(
      '<w:tbl><w:tblGrid><w:gridCol w:w="510"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:textDirection w:val="btLr"/></w:tcPr>' +
        paragraph('story label') +
        '</w:tc></w:tr></w:tbl>'
    );
    const page = bodyLayout.pages[0]!;
    // The table alone: headers and notes keep a final table without the body's empty paragraph.
    const fragments = page.fragments.filter((fragment) => fragment.kind === 'table');
    const storyLayouts: SemanticLayout[] = [
      {
        ...bodyLayout,
        pages: [
          {
            ...page,
            fragments: [],
            header: {
              kind: 'header',
              variant: 'default',
              partName: '/word/header1.xml',
              box: page.contentBox,
              fragments,
            },
          },
        ],
      },
      {
        ...bodyLayout,
        pages: [
          {
            ...page,
            fragments: [],
            footnotes: {
              kind: 'footnotes',
              placement: 'pageBottom',
              box: page.contentBox,
              notes: [
                {
                  noteKind: 'footnote',
                  noteId: 1,
                  scopeId: 'footnote:1',
                  mark: '1',
                  box: page.contentBox,
                  fragments,
                },
              ],
            },
          },
        ],
      },
    ];
    const cell = firstTable(bodyLayout).rows[0]!.cells[0]!;
    const point = { x: cell.box.x + cell.box.width / 2, y: cell.box.y + cell.box.height / 2 };
    for (const storyLayout of storyLayouts) {
      const hit = hitTestFragments(storyLayout, 0, fragments, point)!;
      expect(isBottomToTopCaret(hit.caret)).toBe(true);
      const stops = caretStopsForBlocks(storyLayout, 0, fragments);
      expect(stops.length).toBeGreaterThan(1);
      expect(stops.every(isBottomToTopCaret)).toBe(true);
    }
  });

  describe('bottom-to-top text in auto, minimum, and exact rows', () => {
    const upright = (jc: string, text: string): string =>
      `<w:p><w:pPr><w:ind w:left="6" w:right="6"/><w:jc w:val="${jc}"/></w:pPr>` +
      (text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : '') +
      '</w:p>';
    const cell = (properties: string, body: string): string =>
      `<w:tc><w:tcPr><w:tcW w:w="850" w:type="dxa"/>${properties}</w:tcPr>${body}</w:tc>`;
    const turned = '<w:textDirection w:val="btLr"/>';
    const table = (rows: string): string =>
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="850"/><w:gridCol w:w="850"/></w:tblGrid>' +
      `${rows}</w:tbl><w:p/>`;
    const finite = (value: unknown): boolean =>
      JSON.stringify(value, (_key, entry) =>
        typeof entry === 'number' && !Number.isFinite(entry) ? 'NON-FINITE' : entry
      ).includes('NON-FINITE') === false;
    const turnedParagraph = (result: SemanticLayout, row = 0) => {
      const block = firstTable(result).rows[row]!.cells[0]!.blocks[0]!;
      if (block.kind !== 'paragraph') throw new Error('expected paragraph');
      return block;
    };

    test('a centred merge head beside turned cells gets a finite span and centres in it', () => {
      const result = layout(
        table(
          `<w:tr><w:trPr><w:trHeight w:val="1000"/></w:trPr>` +
            cell(`<w:vMerge w:val="restart"/>${turned}`, upright('center', 'head label')) +
            cell(turned, upright('center', 'side')) +
            '</w:tr>' +
            `<w:tr><w:trPr><w:trHeight w:val="1000"/></w:trPr>` +
            cell(`<w:vMerge/>${turned}`, upright('left', '')) +
            cell(turned, upright('center', 'side')) +
            '</w:tr>'
        )
      );
      const tableRecord = firstTable(result);
      expect(finite(tableRecord)).toBe(true);
      const head = tableRecord.rows[0]!.cells[0]!;
      expect(head.rowSpan).toBe(2);
      const line = turnedParagraph(result).lines[0]!;
      expect(line.spans.map((span) => span.text).join('')).toBe('head label');
      // The line runs the span's height, and the label sits halfway along it.
      const start = line.spans[0]!.box.x;
      const last = line.spans.at(-1)!.box;
      const before = start - line.box.x;
      const after = line.box.x + line.box.width - (last.x + last.width);
      expect(before).toBeGreaterThan(1);
      expect(before).toBeCloseTo(after, 3);
    });

    test('an auto-height row keeps one height for turned text, whatever the alignment', () => {
      const heights = ['left', 'center', 'right', 'both'].map((jc) => {
        // The turned text never sizes the row, so the neighbour gives it room for the label.
        const side = ['side', 'b', 'c'].map((text) => paragraph(text)).join('');
        const result = layout(
          table(`<w:tr>${cell(turned, upright(jc, 'label'))}${cell('', side)}</w:tr>`)
        );
        expect(finite(firstTable(result))).toBe(true);
        const line = turnedParagraph(result).lines[0]!;
        expect(line.spans.map((span) => span.text).join('')).toBe('label');
        return firstTable(result).rows[0]!.box.height;
      });
      expect(new Set(heights).size).toBe(1);
      expect(heights[0]).toBeLessThan(50);
    });

    test('an incomplete row keeps the turned line inside its cell for every alignment', () => {
      const nested =
        '<w:tbl><w:tblGrid><w:gridCol w:w="700"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="2400" w:hRule="exact"/></w:trPr>' +
        `<w:tc>${paragraph('nested')}</w:tc></w:tr></w:tbl>`;
      for (const ownOverflow of [false, true]) {
        const heights = ['left', 'center', 'right'].map((alignment) => {
          const body = ownOverflow
            ? Array.from({ length: 6 }, (_, index) => upright(alignment, `label${index}`)).join('')
            : upright(alignment, 'label');
          const neighbour = ownOverflow
            ? paragraph('side')
            : paragraph('a') + paragraph('b') + nested + paragraph('z');
          const result = layout(
            (ownOverflow ? '' : Array.from({ length: 40 }, () => paragraph('filler')).join('')) +
              table(
                '<w:tr><w:trPr><w:trHeight w:val="2600" w:hRule="atLeast"/></w:trPr>' +
                  cell(turned, body) +
                  cell('', neighbour) +
                  '</w:tr>'
              )
          );
          const fragment = result.pages
            .flatMap((page) => page.fragments)
            .find((item) => item.kind === 'table');
          if (fragment?.kind !== 'table') throw new Error('expected table');
          const row = fragment.rows[0]!;
          const turnedCell = row.cells[0]!;
          for (const block of turnedCell.blocks) {
            if (block.kind !== 'paragraph') continue;
            for (const line of block.lines) {
              expect(line.box.x + line.box.width).toBeLessThanOrEqual(
                turnedCell.box.x + turnedCell.box.height + 0.001
              );
            }
          }
          return row.box.height;
        });
        expect(heights[1]).toBeCloseTo(heights[0]!, 3);
        expect(heights[2]).toBeCloseTo(heights[0]!, 3);
      }
    });

    test('a positional tab does not give an auto row an unbounded line length', () => {
      for (const alignment of ['right', 'center']) {
        const content = `<w:p><w:r><w:t>Head</w:t><w:ptab w:alignment="${alignment}" w:relativeTo="margin"/><w:t>label</w:t></w:r></w:p>`;
        for (const merged of [false, true]) {
          const result = layout(
            table(
              `<w:tr>${cell(turned + (merged ? '<w:vMerge w:val="restart"/>' : ''), content)}` +
                `${cell('', ['a', 'b', 'c', 'd'].map((text) => paragraph(text)).join(''))}</w:tr>` +
                (merged
                  ? `<w:tr>${cell(turned + '<w:vMerge/>', paragraph(''))}${cell('', paragraph('next'))}</w:tr>`
                  : '')
            )
          );
          expect(result.pages).toHaveLength(1);
          expect(finite(firstTable(result))).toBe(true);
          expect(firstTable(result).box.height).toBeLessThan(100);
          expect(
            turnedParagraph(result)
              .lines.flatMap((line) => line.spans)
              .map((span) => span.text)
              .join('')
          ).toContain('label');
        }
      }
    });

    test('an exact row still aligns the turned text along its fixed height', () => {
      const result = layout(
        table(
          `<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>` +
            `${cell(turned, upright('right', 'label'))}${cell('', paragraph('side'))}</w:tr>`
        )
      );
      expect(firstTable(result).rows[0]!.box.height).toBe(100);
      const line = turnedParagraph(result).lines[0]!;
      const span = line.spans[0]!;
      expect(line.box.x + line.box.width).toBeCloseTo(span.box.x + span.box.width, 3);
    });

    test('turned text longer than its row wraps and keeps the row on the page', () => {
      const words = Array.from({ length: 120 }, (_, index) => `word${index}`).join(' ');
      const result = layout(
        table(
          `<w:tr>${cell(turned, upright('center', words))}${cell('', paragraph('side'))}</w:tr>`
        )
      );
      const tableRecord = firstTable(result);
      expect(finite(tableRecord)).toBe(true);
      const block = turnedParagraph(result);
      expect(block.lines.length).toBeGreaterThan(1);
      expect(tableRecord.rows[0]!.box.height).toBeLessThanOrEqual(
        result.pages[0]!.contentBox.height + 0.001
      );
    });
  });
});
