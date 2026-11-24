import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { caretAt } from '../semantic-interaction.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { selectionRects } from '../selection-rects.ts';
import { documentOrder } from '../document-order.ts';
import { headerRepeatLinesOnPage } from '../semantic-caret-line.ts';

const measurer = createFixedMeasurer(6, 14);
const results = [
  ['hard breaks', '<w:t>aaa</w:t><w:br/><w:t>bbb</w:t><w:br/><w:t>ccc</w:t>'],
  ['soft wraps', '<w:t>ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ</w:t>'],
] as const;

function layoutOf(result: string, height = 400) {
  const read = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:fldSimple w:instr="QUOTE x"><w:r>' +
      result +
      '</w:r></w:fldSimple></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer,
    geometry: { width: 120, height, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

for (const [label, result] of results) {
  for (const fraction of [0.2, 0.8]) {
    test(`clicked field edge stays on its middle line: ${label}, ${fraction}`, () => {
      const layout = layoutOf(result);
      const middle = linesOf(layout)[1]!;
      const span = middle.spans.find((span) => span.projected)!;
      const hit = hitTestPage(
        layout,
        0,
        {
          x: span.box.x + span.box.width * fraction,
          y: middle.box.y + middle.box.height / 2,
        },
        { measurer }
      );
      expect(hit!.caret.lineId).toBe(middle.id);
      const caret = caretAt(layout, hit!.position, {
        measurer,
        preferredPageIndex: hit!.pageIndex,
        preferredLineId: hit!.caret.lineId,
      });
      expect(caret?.lineId).toBe(middle.id);
      expect(caret?.x).toBe(hit!.caret.x);
      expect(caret?.position).toEqual(hit!.position);
    });
  }
  test(`stale line preference falls back to the field boundary: ${label}`, () => {
    const layout = layoutOf(result);
    const lines = linesOf(layout);
    const range = lines[0]!.spans[0]!.range;
    for (const offset of [range.start, range.end]) {
      const position = { paragraphId: range.paragraphId, offset };
      expect(caretAt(layout, position, { measurer, preferredLineId: 'gone' })).toEqual(
        caretAt(layout, position, measurer)
      );
    }
  });
  test(`field selection still covers every painted line: ${label}`, () => {
    const layout = layoutOf(result);
    const lines = linesOf(layout);
    const range = lines[0]!.spans[0]!.range;
    const rects = selectionRects(
      layout,
      {
        anchor: { paragraphId: range.paragraphId, offset: range.start },
        head: { paragraphId: range.paragraphId, offset: range.end },
      },
      documentOrder(layout),
      measurer
    );
    expect(rects.filter((rect) => rect.width > 0).map((rect) => rect.y)).toEqual(
      lines.map((line) => line.box.y)
    );
  });
}

test('line preference respects the requested page', () => {
  const layout = layoutOf(results[0][1], 20);
  expect(layout.pages.length).toBe(3);
  const middle = linesOf(layout)[1]!;
  const range = middle.spans[0]!.range;
  const position = { paragraphId: range.paragraphId, offset: range.end };
  const caret = caretAt(layout, position, {
    measurer,
    preferredLineId: middle.id,
    preferredPageIndex: 1,
  });
  expect(caret?.pageIndex).toBe(1);
  expect(caret?.lineId).toBe(middle.id);
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
test('an empty field-result line uses its published zero-width origin', () => {
  const layout = layoutOf('<w:t>aaa</w:t><w:br/><w:br/><w:t>ccc</w:t>');
  const middle = linesOf(layout)[1]!;
  expect(middle.spans.every((span) => span.text === '\n')).toBe(true);
  const hit = hitTestPage(
    layout,
    0,
    { x: middle.contentX, y: middle.box.y + middle.box.height / 2 },
    { measurer }
  )!;
  const caret = caretAt(layout, hit.position, {
    measurer,
    preferredPageIndex: 0,
    preferredLineId: middle.id,
  });
  expect(caret?.lineId).toBe(middle.id);
  expect(caret?.x).toBe(hit.caret.x);
});

function part(xml: string, name: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
for (const kind of ['header', 'footer'] as const) {
  test(`a shared ${kind} prefers both the clicked line and page`, () => {
    const tag = kind === 'header' ? 'hdr' : 'ftr';
    const story = layoutHeaderFooterStory(
      part(
        `<w:${tag} xmlns:w="${W}"><w:p><w:fldSimple w:instr="QUOTE x"><w:r>` +
          results[0][1] +
          `</w:r></w:fldSimple></w:p></w:${tag}>`,
        `/word/${kind}1.xml`
      ),
      120,
      measurer,
      kind
    );
    const layout = layoutSemanticDocument(
      part(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>one</w:t></w:r></w:p>` +
          '<w:p><w:r><w:br w:type="page"/><w:t>two</w:t></w:r></w:p></w:body></w:document>',
        '/word/document.xml'
      ),
      1,
      {
        measurer,
        geometry: { width: 120, height: 200, margin: { top: 40, bottom: 40, left: 0, right: 0 } },
        furniture: {
          titlePage: false,
          evenAndOddHeaders: false,
          headers: new Map(kind === 'header' ? [['default', story]] : []),
          footers: new Map(kind === 'footer' ? [['default', story]] : []),
        },
      }
    );
    expect(layout.pages.length).toBe(2);
    const fragment = story.fragments.find((fragment) => fragment.kind === 'paragraph')!;
    if (fragment.kind !== 'paragraph') throw Error('Missing paragraph');
    const middle = fragment.lines[1]!;
    const range = middle.spans[0]!.range;
    for (const page of [0, 1])
      for (const offset of [range.start, range.end]) {
        const caret = caretAt(
          layout,
          { paragraphId: range.paragraphId, offset },
          {
            measurer,
            preferredLineId: middle.id,
            preferredPageIndex: page,
          }
        );
        expect(caret?.pageIndex).toBe(page);
        expect(caret?.lineId).toBe(middle.id);
      }
  });
}

test('a repeated table header prefers the clicked middle field line on its sheet', () => {
  const header =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p>' +
    '<w:fldSimple w:instr="QUOTE x"><w:r>' +
    results[0][1] +
    '</w:r></w:fldSimple>' +
    '</w:p></w:tc></w:tr>';
  const row = '<w:tr><w:tc><w:p><w:r><w:t>row</w:t></w:r></w:p></w:tc></w:tr>';
  const layout = layoutSemanticDocument(
    part(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>` +
        '<w:tblCellMar><w:left w:w="0"/><w:right w:w="0"/></w:tblCellMar></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
        header +
        row.repeat(12) +
        '</w:tbl></w:body></w:document>',
      '/word/document.xml'
    ),
    1,
    {
      measurer,
      geometry: { width: 120, height: 100, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
  );
  expect(layout.pages.length).toBeGreaterThan(1);
  const middle = linesOf(layout).filter((line) => line.spans.some((span) => span.projected))[1]!;
  const range = middle.spans[0]!.range;
  for (const page of [0, 1]) {
    const clicked = headerRepeatLinesOnPage(layout, page, range.paragraphId)[1]!.line;
    const caret = caretAt(
      layout,
      { paragraphId: range.paragraphId, offset: range.end },
      {
        measurer,
        preferredLineId: clicked.id,
        preferredPageIndex: page,
      }
    );
    expect(caret?.pageIndex).toBe(page);
    expect(caret?.lineId).toBe(clicked.id);
  }
});
