import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { squareWrapZone } from './float-over-table-harness.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>${props}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const table = (width = 80, offset = 0, extra = '') =>
  `<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="text" w:tblpX="1" w:tblpY="${offset * 20 + 1}" ${extra}/><w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="${width * 20}"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:left w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${width * 20}"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>`;
const part = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const measurer = createFixedMeasurer(6, 12);
const options = {
  measurer,
  geometry: { width: 200, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
};
const render = (source: ReturnType<typeof part>) => layoutSemanticDocument(source, 0, options);
const tables = (layout: ReturnType<typeof render>) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((f): f is TableFragmentRecord => f.kind === 'table');
const paragraphs = (layout: ReturnType<typeof render>) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph');

test('an earlier page float does not turn subsequent page floats into inline tables', () => {
  const source = part(
    Array.from(
      { length: 3 },
      (_, index) =>
        p(`Page ${index}`, index ? '<w:pageBreakBefore/>' : '') + table(60) + p(`After ${index}`)
    ).join('')
  );
  const config = {
    ...options,
    inlineDrawingLayout: {
      ownerPartName: '/word/document.xml',
      project: () => null,
      resourceOf: () => {
        throw new Error('no picture resources');
      },
    },
  };
  const session = createLayoutSession();
  const cold = layoutSemanticDocument(source, 0, config);
  expect(cold.pages).toHaveLength(3);
  expect(tables(cold)).toHaveLength(3);
  expect(tables(cold).every(isOutOfFlowTableFragment)).toBe(true);
  for (const page of cold.pages) {
    const floated = page.fragments.find((block) => block.kind === 'table')!;
    const anchor = page.fragments.find(
      (block) => block.kind === 'paragraph' && block.paragraphId === floated.floatingWrap?.anchorId
    ) as ParagraphFragmentRecord;
    expect(anchor.lines[0]!.box.y).toBe(floated.box.y);
    expect(anchor.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(
      floated.box.x + floated.box.width
    );
  }
  expect(layoutSemanticDocument(source, 0, { ...config, session }).pages).toEqual(cold.pages);
  expect(layoutSemanticDocument(source, 1, { ...config, session }).pages).toEqual(cold.pages);
});

test('text wraps beside a floating table without an image layout port', () => {
  const layout = render(part(p('Lead') + table() + p('word '.repeat(30)) + p('Tail')));
  expect(layout.pages).toHaveLength(1);
  const floating = tables(layout)[0]!;
  const anchor = paragraphs(layout)[1]!;
  expect(isOutOfFlowTableFragment(floating)).toBe(true);
  expect(floating.box.y).toBe(12);
  expect(anchor.lines[0]!.box.y).toBe(12);
  expect(anchor.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
  expect(anchor.lines.find((line) => line.box.y >= 52)!.spans[0]!.box.x).toBe(0);
});

test('a full-width table clears its anchor without chasing the displaced line', () => {
  const layout = render(part(p('Lead') + table(200) + p('Anchor') + p('Tail')));
  expect(layout.pages).toHaveLength(1);
  expect(tables(layout)[0]!.box.y).toBe(12);
  expect(paragraphs(layout)[1]!.lines[0]!.box.y).toBeGreaterThanOrEqual(52);
});

test('near-full-width floating tables keep their caption and heading below the table', () => {
  for (const rtl of [false, true]) {
    const source = part(
      p('Lead') +
        table(184).replace('w:tblpX="1"', 'w:tblpXSpec="center"') +
        p('Source caption') +
        p(rtl ? 'ما يقرب من سبعين بالمئة' : 'A complete heading', rtl ? '<w:bidi/>' : '')
    );
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    for (let revision = 0; revision < 2; revision++) {
      const layout = layoutSemanticDocument(source, revision, { ...options, session, cache });
      const floating = tables(layout)[0]!;
      const [caption, heading] = paragraphs(layout).slice(1);
      expect(caption!.lines[0]!.box.y).toBeGreaterThanOrEqual(floating.box.y + floating.box.height);
      expect(caption!.lines).toHaveLength(1);
      expect(heading!.lines).toHaveLength(1);
      expect(layout.pages).toEqual(render(source).pages);
    }
  }
});

test('top, bottom and side text distances expand the wrap region', () => {
  const layout = render(
    part(
      table(80, 12, 'w:topFromText="240" w:bottomFromText="240" w:rightFromText="200"') +
        p('word '.repeat(40))
    )
  );
  const anchor = paragraphs(layout)[0]!;
  expect(anchor.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(90);
  expect(
    anchor.lines.filter((line) => line.box.y < 64).every((line) => line.spans[0]!.box.x >= 90)
  ).toBe(true);
});

test('floating-table wrapping agrees between warm and cold layouts', () => {
  const source = part(p('Lead') + table() + p('word '.repeat(30)) + p('Tail'));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (let revision = 0; revision < 2; revision++) {
    const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
    const cold = layoutSemanticDocument(source, revision, options);
    expect(warm.pages).toEqual(cold.pages);
  }
});

test('a text table taller than a page retains row pagination and every row', () => {
  const base = table();
  const row = base.slice(base.indexOf('<w:tr>'), base.indexOf('</w:tr>') + 7);
  const source = part(base.replace(row, row.repeat(8)) + p('Anchor'));
  const layout = render(source);
  expect(layout.pages.length).toBeGreaterThan(1);
  expect(tables(layout).every((fragment) => !isOutOfFlowTableFragment(fragment))).toBe(true);
  expect(tables(layout).flatMap((fragment) => fragment.rows)).toHaveLength(8);
  for (const page of layout.pages)
    for (const block of page.fragments)
      expect(block.box.y + block.box.height).toBeLessThanOrEqual(page.contentBox.height + 0.001);
});

test('moves a floating table with its anchor when its band cannot fit the page remainder', () => {
  const source = part(
    p('Lead', '<w:spacing w:line="3600" w:lineRule="exact"/>') + table() + p('Anchor')
  );
  const layout = render(source);
  expect(layout.pages).toHaveLength(2);
  expect(layout.pages[0]!.fragments.every((fragment) => fragment.kind !== 'table')).toBe(true);
  expect(tables(layout)[0]!.box.y).toBe(0);
  expect(layout.pages[1]!.fragments.some((fragment) => fragment.kind === 'paragraph')).toBe(true);
});

test('keeps a negative offset, and the earlier line it meets wraps beside the table', () => {
  const clear = render(
    part(p('Lead') + table(80, -6).replace('w:tblpX="1"', 'w:tblpX="2001"') + p('Anchor'))
  );
  expect(tables(clear)[0]!.box.y).toBe(6);
  // The band of a raised table that leaves a passage wraps the earlier lines it crosses.
  const colliding = render(part(p('Lead') + table(80, -6) + p('Anchor')));
  const lead = paragraphs(colliding)[0]!.lines[0]!;
  expect(tables(colliding)[0]!.box.y).toBe(6);
  expect(lead.box.y).toBe(0);
  expect(lead.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
});

test('wraps in the anchor column without narrowing another column', () => {
  const lead = p('Lead').replace('</w:r>', '<w:br w:type="column"/></w:r>');
  const source = part(
    lead +
      table(40) +
      p('word '.repeat(10)) +
      '<w:sectPr><w:cols w:num="2" w:space="200"/></w:sectPr>'
  );
  const layout = render(source);
  const floating = tables(layout)[0]!;
  const anchor = paragraphs(layout).find(
    (fragment) => fragment.paragraphId === floating.floatingWrap?.anchorId
  )!;
  // The legacy text anchor aligns the cell content. The fixture has no left cell margin.
  expect(floating.box.x).toBeCloseTo(105, 6);
  expect(floating.floatingWrap?.columnIndex).toBe(1);
  expect(anchor.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(
    floating.box.x + floating.box.width
  );
});

test('distance-only table edits invalidate wrapping while preserving warm/cold geometry', () => {
  const initial = part(p('Lead') + table() + p('word '.repeat(30)) + p('Tail'));
  const body = initial.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  )!;
  if (body.kind === 'textValue') throw new Error('body');
  const changedPart = part(
    p('Lead') + table(80, 0, 'w:rightFromText="400"') + p('word '.repeat(30)) + p('Tail')
  );
  const changedBody = changedPart.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  )!;
  if (changedBody.kind === 'textValue') throw new Error('body');
  const changed = {
    ...initial,
    root: {
      ...initial.root,
      children: initial.root.children.map((node) =>
        node === body
          ? {
              ...body,
              children: body.children.map((child, index) =>
                index === 1 ? changedBody.children[1]! : child
              ),
            }
          : node
      ),
    },
  };
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (const [revision, source] of [initial, changed, initial].entries()) {
    const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
    const cold = layoutSemanticDocument(source, revision, options);
    expect(warm.pages).toEqual(cold.pages);
    expect(paragraphs(warm)[1]!.lines[0]!.spans[0]!.box.x).toBe(source === changed ? 100 : 80);
  }
});

test('a raised table stays on its anchor page beside a taller earlier line', () => {
  const lead = p('Lead', '<w:spacing w:line="200" w:lineRule="exact"/>').replace(
    '<w:r>',
    '<w:r><w:rPr><w:sz w:val="72"/></w:rPr>'
  );
  const source = part(lead + table(80, -6) + p('Anchor'));
  const layout = layoutSemanticDocument(source, 0, {
    ...options,
    geometry: { ...options.geometry, height: 60 },
  });
  // The lead line wraps beside the table, which keeps its place 6 pt above the anchor.
  expect(layout.pages).toHaveLength(1);
  expect(tables(layout)[0]!.box.y).toBe(4);
  expect(paragraphs(layout)[0]!.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
});

test('negative offsets clear preceding in-flow tables and authored top padding', () => {
  const inline = table().replace(/<w:tblpPr[^>]*\/>/, '');
  const layout = render(part(inline + table(80, -6, 'w:topFromText="120"') + p('Anchor')));
  const [first, floating] = tables(layout);
  expect(isOutOfFlowTableFragment(first!)).toBe(false);
  expect(floating!.box.y).toBeGreaterThanOrEqual(first!.box.y + first!.box.height + 6);
});

test('a top distance above the anchor wraps the earlier line, and a lower one clears it', () => {
  // A 12 pt top distance rises above the anchor at offsets 0 and 6: the lead wraps beside it.
  for (const offset of [0, 6]) {
    const layout = render(part(p('Lead') + table(80, offset, 'w:topFromText="240"') + p('Anchor')));
    expect(tables(layout)[0]!.box.y).toBe(12 + offset);
    expect(paragraphs(layout)[0]!.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
  }
  const layout = render(part(p('Lead') + table(80, 18, 'w:topFromText="240"') + p('Anchor')));
  const ink = paragraphs(layout)[0]!.lines[0]!.spans[0]!.box;
  expect(tables(layout)[0]!.box.y).toBeCloseTo(Math.max(30, ink.y + ink.height + 12), 6);
});

test('top-clearance displacement participates in page admission', () => {
  // At offset 18 the band starts below the anchor top, so the table clears the lead line.
  for (const offset of [18]) {
    const source = part(p('Lead') + table(80, offset, 'w:topFromText="240"') + p('Anchor'));
    const small = { ...options, geometry: { ...options.geometry, height: 60 } };
    const session = createLayoutSession();
    const warm = layoutSemanticDocument(source, 0, { ...small, session });
    const cold = layoutSemanticDocument(source, 0, small);
    expect(warm.pages).toEqual(cold.pages);
    expect(warm.pages).toHaveLength(2);
    expect(warm.pages[0]!.fragments.every((fragment) => fragment.kind !== 'table')).toBe(true);
    const floating = tables(warm)[0]!;
    expect(floating.box.y).toBe(offset);
    expect(floating.box.y + floating.box.height).toBeLessThanOrEqual(60);
  }
});

test('text-relative vertical alignments float at the anchor top and supersede offsets', () => {
  for (const alignment of ['top', 'inside', 'center', 'bottom', 'outside', 'inline']) {
    const source = part(table(80, 1000, `w:tblpYSpec="${alignment}"`) + p('Anchor'));
    const layout = render(source);
    expect(layout.pages).toHaveLength(1);
    const floating = tables(layout)[0]!;
    expect(isOutOfFlowTableFragment(floating)).toBe(true);
    expect(floating.box.y).toBe(0);
    expect(floating.rows).toHaveLength(1);
    // ECMA-376 Part 1, 17.4.65: the anchor paragraph wraps beside the table.
    const anchor = paragraphs(layout).at(-1)!.lines[0]!;
    expect(anchor.box.y).toBe(0);
    expect(anchor.spans[0]!.box.x).toBeGreaterThanOrEqual(floating.box.x + floating.box.width);
  }
});

test('tables whose cells wrap around earlier drawings retain safe row pagination', () => {
  const text = 'word '.repeat(10);
  const source = part(
    p('Lead', '<w:spacing w:line="2000" w:lineRule="exact"/>') +
      table(80)
        .replace('<w:trHeight w:val="800" w:hRule="exact"/>', '')
        .replace('>Cell<', `>${text}<`) +
      p('Anchor')
  );
  const body = source.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  )!;
  if (body.kind === 'textValue') throw new Error('body');
  const zone = squareWrapZone({
    anchorParagraphId: body.children[0]!.id,
    top: 100,
    height: 100,
    left: 0,
    width: 60,
    contentWidth: 200,
  });
  const config = {
    ...options,
    inlineDrawingLayout: {
      ownerPartName: '/word/document.xml',
      project: () => null,
      resourceOf: () => {
        throw new Error('no picture resources');
      },
    },
    drawingExclusionPass: 0,
    drawingExclusionZonesByPage: new Map([[0, [zone]]]),
  };
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (let revision = 0; revision < 2; revision++) {
    const warm = layoutSemanticDocument(source, revision, { ...config, session, cache });
    const cold = layoutSemanticDocument(source, revision, config);
    expect(warm.pages).toEqual(cold.pages);
    expect(tables(warm).every((fragment) => !isOutOfFlowTableFragment(fragment))).toBe(true);
    for (const page of warm.pages)
      for (const fragment of page.fragments)
        expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(
          page.contentBox.height + 0.001
        );
    const cellText = tables(warm)
      .flatMap((fragment) =>
        fragment.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
      )
      .flatMap((block) =>
        block.kind === 'paragraph'
          ? block.lines.flatMap((line) => line.spans.map((span) => span.text))
          : []
      )
      .join('');
    expect(cellText).toBe(text);
  }
});

test('a sole no-overlap table still wraps its surrounding paragraph', () => {
  const source = part(
    p('Lead') +
      table().replace('<w:tblPr>', '<w:tblPr><w:tblOverlap w:val="never"/>') +
      p('word '.repeat(30))
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (let revision = 0; revision < 2; revision++) {
    const layout = layoutSemanticDocument(source, revision, { ...options, session, cache });
    expect(layout.pages).toEqual(render(source).pages);
    const floating = tables(layout)[0]!;
    const anchor = paragraphs(layout)[1]!;
    expect(isOutOfFlowTableFragment(floating)).toBe(true);
    expect(floating.box.y).toBe(12);
    expect(anchor.lines[0]!.box.y).toBe(12);
    expect(anchor.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
    expect(anchor.lines.find((line) => line.box.y >= 52)!.spans[0]!.box.x).toBe(0);
  }
});

// Word clears text beside a floating table at the GRID edge plus the table's own authored
// outer border width plus `w:rightFromText`. Captured from a six-case control whose grid
// runs 72..222pt: a 1pt border with a 9.35pt distance starts text at 232.35 and a 4pt
// border with the same distance at 235.35, both exact. A zero distance and an unbordered
// table are NOT explained by that control and stay on the plain grid-plus-distance edge.
const borderedFloat = (sz: number, rightFromText: number) =>
  `<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="text" w:tblpX="1" w:tblpY="1" w:leftFromText="0" w:rightFromText="${rightFromText}"/><w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="2000"/>${
    sz === 0
      ? ''
      : `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
          .map((side) => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="auto"/>`)
          .join('')}</w:tblBorders>`
  }<w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>`;

const wrapEdgeOf = (sz: number, rightFromText: number) => {
  const layout = render(part(p('Lead') + borderedFloat(sz, rightFromText) + p('word '.repeat(40))));
  const floating = tables(layout)[0]!;
  const anchor = paragraphs(layout)[1]!;
  expect(isOutOfFlowTableFragment(floating)).toBe(true);
  return {
    gridRight: floating.box.x + floating.box.width,
    textStart: anchor.lines[0]!.spans[0]!.box.x,
  };
};

test('text beside a bordered floating table clears the grid, the border and the distance', () => {
  const thin = wrapEdgeOf(8, 187);
  expect(thin.textStart).toBeCloseTo(thin.gridRight + 1 + 9.35, 6);

  const thick = wrapEdgeOf(32, 187);
  expect(thick.textStart).toBeCloseTo(thick.gridRight + 4 + 9.35, 6);

  const far = wrapEdgeOf(8, 720);
  expect(far.textStart).toBeCloseTo(far.gridRight + 1 + 36, 6);
});

test('an unbordered float and a zero wrap distance keep the plain grid edge', () => {
  const unbordered = wrapEdgeOf(0, 187);
  expect(unbordered.textStart).toBeCloseTo(unbordered.gridRight + 9.35, 6);

  const touching = wrapEdgeOf(8, 0);
  expect(touching.textStart).toBeCloseTo(touching.gridRight, 6);
});
