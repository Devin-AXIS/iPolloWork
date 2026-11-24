import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable, cascadeTableFormatting } from '../style-cascade.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type SemanticLayout, type TextMeasurer } from '../semantic-records.ts';
import { readTableStructure } from '../semantic-table.ts';
import { layoutRowFragment } from '../semantic-table-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
};
function part(xml: string, name = '/word/document.xml') {
  const parsed = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const paragraph = (content = '', extra = '') =>
  `<w:p><w:pPr>${extra}<w:rPr><w:sz w:val="40"/></w:rPr></w:pPr>${content}</w:p>`;
const text = '<w:r><w:rPr><w:sz w:val="10"/></w:rPr><w:t>Small</w:t></w:r>';
// Under text, an end mark sets no row minimum; an empty final paragraph shows whether the
// mark is hidden: 5pt of text alone, or 5pt plus the visible mark's 20pt line.
const marked = paragraph(text) + paragraph();
const cell = (content: string, properties = '<w:hideMark/>') =>
  `<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`;
const row = (cells: string, properties = '') =>
  `<w:tr><w:trPr>${properties}</w:trPr>${cells}</w:tr>`;
const table = (rows: string, properties = '') =>
  `<w:tbl><w:tblPr>${properties}<w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
// A table that opens the body keeps the end mark of its first cell
// (`table-document-start-end-mark.test.ts`), so each fixture follows an empty paragraph.
const documentPart = (body: string) =>
  part(
    `<w:document xmlns:w="${W}" xmlns:x="urn:foreign"><w:body><w:p/>${body}</w:body></w:document>`
  );
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const styles = (body: string) =>
  buildStyleCascadeTable(
    part(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}${body}</w:styles>`, '/word/styles.xml')
      .root
  );
const style = (id: string, content: string, base = '') =>
  `<w:style w:type="table" w:styleId="${id}">${base ? `<w:basedOn w:val="${base}"/>` : ''}${content}</w:style>`;
const geometry = { width: 150, height: 100, margin: { top: 0, bottom: 0, left: 0, right: 0 } };
/** The table's lines: after the leading paragraph, and before the empty one the body reads last. */
const cellLinesOf = (result: Parameters<typeof linesOf>[0]) => linesOf(result).slice(1, -1);

function run(body: string, styleCascade?: ReturnType<typeof styles>) {
  const source = documentPart(body),
    before = serializeOoxmlPart(source);
  const options = { measurer, geometry, session: createLayoutSession(), styleCascade };
  const result = layoutSemanticDocument(source, 0, options);
  expect(layoutSemanticDocument(source, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(source)).toBe(before);
  return result;
}
const rows = (result: SemanticLayout) =>
  result.pages.flatMap((p) => p.fragments.flatMap((f) => (f.kind === 'table' ? f.rows : [])));
const height = (body: string, cascade?: ReturnType<typeof styles>) =>
  rows(run(body, cascade))[0]!.box.height;

for (const [value, hidden] of [
  ['', true],
  ['1', true],
  ['true', true],
  ['on', true],
  ['0', false],
  ['false', false],
  ['off', false],
] as const) {
  test(`hideMark ${value || '(empty)'} sizes the row from printable content`, () => {
    const properties = `<w:hideMark${value ? ` w:val="${value}"` : ''}/>`;
    expect(height(table(row(cell(paragraph(text), properties))))).toBe(5);
    expect(height(table(row(cell(marked, properties))))).toBe(hidden ? 5 : 25);
    // 17.4.25: a hidden end mark leaves an empty cell nothing to size the row with.
    expect(height(table(row(cell(paragraph(), properties))))).toBe(hidden ? 0 : 20);
  });
}

test('an empty cell with a hidden mark takes no row height but keeps an addressable line', () => {
  // 17.4.25: the end-of-cell mark is ignored for row height, and the empty paragraph holds
  // nothing else; the next row starts where the empty one does.
  const result = run(table(row(cell(paragraph())) + row(cell(paragraph(text)))));
  expect(rows(result).map((r) => r.box.height)).toEqual([0, 5]);
  expect(cellLinesOf(result)).toHaveLength(2);
  expect(cellLinesOf(result)[0]!.range).toMatchObject({ start: 0, end: 0 });
  expect(cellLinesOf(result)[0]!.box.height).toBe(0);
  expect(rows(result)[1]!.box.y).toBe(rows(result)[0]!.box.y);
  // A visible mark keeps the line.
  expect(height(table(row(cell(paragraph(), ''))))).toBe(20);
});

test('a hidden mark drops the empty final paragraph after other content', () => {
  // Earlier empty paragraph marks still occupy their own 20pt lines.
  expect(height(table(row(cell(paragraph() + paragraph()))))).toBe(20);
  // The 5pt text sizes the row; the empty final paragraph adds no line or spacing.
  expect(height(table(row(cell(paragraph(text) + paragraph()))))).toBe(5);
  expect(
    height(table(row(cell(paragraph(text) + paragraph('', '<w:spacing w:after="400"/>')))))
  ).toBe(5);
  // A visible mark keeps the final paragraph's line.
  expect(height(table(row(cell(paragraph(text) + paragraph(), ''))))).toBe(25);
});

test('empty-cell margins and paragraph borders reserve space, paragraph spacing does not', () => {
  expect(
    height(
      table(
        row(
          cell(
            paragraph(),
            '<w:hideMark/><w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tcMar>'
          )
        )
      )
    )
  ).toBe(5);
  // The collapsed paragraph's own spacing takes no room.
  expect(height(table(row(cell(paragraph('', '<w:spacing w:before="60" w:after="40"/>')))))).toBe(
    0
  );
  const content = paragraph(
    '',
    '<w:spacing w:before="60" w:after="40"/><w:pBdr><w:top w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/></w:pBdr>'
  );
  const hidden = height(table(row(cell(content))));
  expect(hidden).toBeGreaterThan(5);
  expect(height(table(row(cell(content, ''))))).toBe(hidden);
});

for (const rule of ['atLeast', 'exact'])
  test(`hideMark preserves ${rule} row heights`, () => {
    expect(
      height(table(row(cell(paragraph()), `<w:trHeight w:val="40" w:hRule="${rule}"/>`)))
    ).toBe(2);
  });

test('whole-style inheritance, conditional overrides, and direct false values retain their precedence', () => {
  const cascade = styles(
    style('Base', '<w:tcPr><w:hideMark/></w:tcPr>') +
      style(
        'Derived',
        '<w:tcPr><w:shd w:fill="FFFFFF"/></w:tcPr><w:tblStylePr w:type="firstRow"><w:tcPr><w:hideMark w:val="off"/></w:tcPr></w:tblStylePr>',
        'Base'
      )
  );
  const properties = '<w:tblStyle w:val="Derived"/><w:tblLook w:firstRow="1"/>';
  const result = run(
    table(
      row(cell(marked, '')) + row(cell(marked, '')) + row(cell(marked, '<w:hideMark w:val="0"/>')),
      properties
    ),
    cascade
  );
  expect(rows(result).map((r) => r.box.height)).toEqual([25, 5, 25]);
  expect(height(table(row(cell(marked)), properties), cascade)).toBe(5);
});

test('derived conditional shading does not erase an inherited conditional hideMark', () => {
  const inherited = style(
    'Base',
    '<w:tblStylePr w:type="firstRow"><w:tcPr><w:hideMark/></w:tcPr></w:tblStylePr>'
  );
  const derived = style(
    'Derived',
    '<w:tblStylePr w:type="firstRow"><w:tcPr><w:shd w:fill="FFFFFF"/></w:tcPr></w:tblStylePr>',
    'Base'
  );
  const cascade = styles(inherited + derived);
  for (const [enabled, expected] of [
    ['1', 5],
    ['0', 25],
  ] as const) {
    expect(
      height(
        table(
          row(cell(marked, '')),
          `<w:tblStyle w:val="Derived"/><w:tblLook w:firstRow="${enabled}"/>`
        ),
        cascade
      )
    ).toBe(expected);
  }
  const layers = cascadeTableFormatting(cascade, 'Derived').conditionalStyleLayers!.get(
    'firstRow'
  )!;
  expect(Object.isFrozen(layers)).toBe(true);
});

test('foreign hideMark elements do not change cell metrics', () => {
  expect(height(table(row(cell(marked, '<x:hideMark/>'))))).toBe(25);
});

test('a style-only hideMark edit invalidates a reused layout session', () => {
  const source = documentPart(table(row(cell(marked, '')), '<w:tblStyle w:val="Base"/>'));
  const session = createLayoutSession();
  const hidden = styles(style('Base', '<w:tcPr><w:hideMark/></w:tcPr>'));
  const visible = styles(style('Base', '<w:tcPr><w:hideMark w:val="off"/></w:tcPr>'));
  expect(hidden.cacheToken).not.toBe(visible.cacheToken);
  for (const cascade of [hidden, visible, hidden]) {
    const result = layoutSemanticDocument(source, 0, {
      measurer,
      geometry,
      session,
      styleCascade: cascade,
    });
    expect(rows(result)[0]!.box.height).toBe(cascade === hidden ? 5 : 25);
  }
});

test('hidden and visible cell markers cannot mutate each other through the paragraph break cache', () => {
  const source = documentPart(table(row(cell(marked, ''))));
  const body = source.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body')!;
  if (body.kind === 'textValue') throw new Error('body');
  const node = body.children.find((n) => n.kind === 'table')!;
  const original = readTableStructure(node, 100, 0)!.rows[0]!;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const deps = { measurer, cache, producer: 'hidden-marker-test', nextLineId: () => 'line' };
  for (const hidden of [false, true, false, true]) {
    const changed = {
      ...original,
      cells: original.cells.map((c) => ({ ...c, hideEndMark: hidden })),
    };
    const result = layoutRowFragment(changed, [100], 0, 0, false, 0, deps);
    expect(result.record.box.height).toBe(hidden ? 5 : 25);
  }
  expect(cache.stats.hits).toBeGreaterThan(0);
});

test('an empty numbered cell retains its printable marker metrics', () => {
  const numbering = part(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:rPr><w:sz w:val="12"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    '/word/numbering.xml'
  );
  const source = documentPart(
    table(row(cell(paragraph('', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'))))
  );
  const result = layoutSemanticDocument(source, 0, {
    measurer,
    geometry,
    numberingIndex: buildNumberingIndex(numbering.root),
  });
  expect(rows(result)[0]!.box.height).toBe(20);
  const block = rows(result)[0]!.cells[0]!.blocks[0]!;
  if (block.kind !== 'paragraph') throw new Error('paragraph');
  expect(block.marker?.text).toBe('•');
});

test('hidden markers retain manual line breaks and earlier printable text', () => {
  const result = run(
    table(
      row(cell(paragraph('<w:r><w:rPr><w:sz w:val="10"/></w:rPr><w:t>Small</w:t><w:br/></w:r>')))
    )
  );
  expect(cellLinesOf(result).map((line) => line.box.height)).toEqual([5, 20]);
  expect(rows(result)[0]!.box.height).toBe(25);
});

test('vertical cells exclude hidden markers but retain printable content', () => {
  const properties = '<w:textDirection w:val="btLr"/><w:hideMark/>';
  const result = run(table(row(cell(paragraph(text), properties))));
  expect(cellLinesOf(result)[0]!.box.height).toBe(5);
  expect(height(table(row(cell(paragraph(), properties))))).toBe(0);
  expect(height(table(row(cell(paragraph('', '<w:jc w:val="center"/>'), properties))))).toBe(0);
});

test('merged empty cells with hidden marks take no height across their rows', () => {
  const result = run(
    table(
      row(cell(paragraph(), '<w:vMerge w:val="restart"/><w:hideMark/>')) +
        row(cell(paragraph(), '<w:vMerge/><w:hideMark/>'))
    )
  );
  expect(rows(result).map((r) => r.box.height)).toEqual([0, 0]);
  expect(rows(result)[0]!.cells[0]!.rowSpan).toBe(2);
  const visible = run(
    table(
      row(cell(paragraph(text), '<w:vMerge w:val="restart"/><w:hideMark/>')) +
        row(cell(paragraph(), '<w:vMerge/><w:hideMark/>'))
    )
  );
  expect(rows(visible).reduce((sum, row) => sum + row.box.height, 0)).toBe(5);
});

// `w:hideMark` is per cell. A head that hides its own mark says nothing about the cells
// that continue it, and this row has nothing but continuations, so its end-of-cell
// paragraph is what is left to size it.
test('a continuation cell keeps its own visible mark under a hidden head', () => {
  const result = run(
    table(
      row(cell(paragraph(), '<w:vMerge w:val="restart"/><w:hideMark/>')) +
        row(cell(paragraph(), '<w:vMerge/>'))
    )
  );
  expect(rows(result).map((r) => r.box.height)).toEqual([0, 20]);
});

test('only the markup view keeps the line of a tracked empty paragraph mark', () => {
  const tracked =
    '<w:p><w:pPr><w:rPr><w:sz w:val="40"/><w:ins w:id="1" w:author="Reviewer"/></w:rPr></w:pPr></w:p>';
  const source = documentPart(table(row(cell(tracked))));
  // The markup view paints the mark's change bar and pilcrow; the proposed view paints nothing.
  for (const [displayMode, expected] of [
    ['proposed', 0],
    ['all-markup', 20],
  ] as const) {
    const result = layoutSemanticDocument(source, 0, { measurer, geometry, displayMode });
    expect(rows(result)[0]!.box.height).toBe(expected);
  }
});

test('hideMark keeps a terminal inline picture and its source position', () => {
  const pictureXml = `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Picture"/>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
    <pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill>
    <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
    </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const source = documentPart(table(row(cell(paragraph(pictureXml)))));
  const projections = indexInlineDrawingProjectionsInPart(source);
  const result = layoutSemanticDocument(source, 0, {
    measurer,
    geometry,
    inlineDrawingLayout: {
      ownerPartName: '/word/document.xml',
      projectionForAtom: (id) => projections.get(id) ?? null,
      project: (node) => projections.get(node.id) ?? null,
      resourceOf: () => ({
        kind: 'ready',
        partName: '/word/media/image.png',
        contentId: 'image',
        resourceKey: 'image',
        mime: 'image/png',
        pixelWidth: 72,
        pixelHeight: 36,
        dpiX: 72,
        dpiY: 72,
      }),
    },
  });
  const placedCell = rows(result)[0]!.cells[0]!;
  const line = cellLinesOf(result)[0]!;
  expect(line.range.end - line.range.start).toBe(1);
  expect(line.drawings).toHaveLength(1);
  const picture = line.drawings![0]!;
  expect(picture.height).toBe(36);
  expect(placedCell.box.height).toBeGreaterThanOrEqual(picture.height);
  expect(picture.y).toBeGreaterThanOrEqual(placedCell.box.y);
  expect(picture.y + picture.height).toBeLessThanOrEqual(
    placedCell.box.y + placedCell.box.height + 0.001
  );
});

test('empty paragraphs before a hidden mark take part in row pagination', () => {
  const result = run(table(row(cell(paragraph().repeat(7)))));
  expect(result.pages).toHaveLength(2);
  const lines = cellLinesOf(result);
  expect(lines).toHaveLength(7);
  for (const [index, line] of lines.entries()) {
    expect(line.box.height).toBe(index === lines.length - 1 ? 0 : 20);
    expect(line.box.y + line.box.height).toBeLessThanOrEqual(geometry.height);
  }
  expect(rows(result)[0]!.hasContinuation).toBe(true);
  expect(rows(result)[1]!.isContinuation).toBe(true);
});
