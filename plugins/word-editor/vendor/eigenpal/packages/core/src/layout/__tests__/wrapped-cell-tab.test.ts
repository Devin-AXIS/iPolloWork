import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  applyTreeOp,
  paragraphTextOf,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { LEGACY_CELL_ANCHOR_SCOPE } from '../cell-anchor-layout.ts';
import { squareWrapZone } from './float-over-table-harness.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text) => text.length * 5,
  lineMetrics: () => ({ height: 12, baseline: 9 }),
};
const geometry = { width: 50, height: 200, margin: { left: 0, right: 0, top: 0, bottom: 0 } };
function document(
  options: {
    alignment?: string;
    trailing?: boolean;
    body?: boolean;
    positional?: boolean;
    rtl?: boolean;
    split?: boolean;
    stop?: number;
    indent?: string;
    repeated?: boolean;
    repeatedSplit?: boolean;
  } = {}
) {
  const tab = options.repeated
    ? options.repeatedSplit
      ? '<w:tab/></w:r><w:r></w:r><w:r><w:tab/>'
      : '<w:tab/><w:tab/>'
    : options.positional
      ? '<w:ptab w:alignment="left" w:relativeTo="margin" w:leader="none"/>'
      : '<w:tab/>';
  const before = options.split
    ? '<w:r><w:t>ABCD</w:t></w:r><w:r><w:t>EFGHI</w:t></w:r>'
    : '<w:r><w:t>ABCDEFGHI</w:t></w:r>';
  const p = `<w:p><w:pPr><w:tabs><w:tab w:val="${options.alignment ?? 'left'}" w:pos="${options.stop ?? 200}"/></w:tabs>${options.indent ?? ''}${options.rtl ? '<w:bidi/>' : ''}</w:pPr>${before}<w:r>${tab}</w:r>${options.trailing ? '' : '<w:r><w:t>J K</w:t></w:r>'}</w:p>`;
  const content = options.body
    ? p
    : `<w:tbl><w:tblPr><w:tblW w:w="1000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>${['top', 'left', 'bottom', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>${p}</w:tc></w:tr></w:tbl>`;
  const r = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!r.ok) throw Error(r.reason);
  return r.part;
}
function layout(part: ReturnType<typeof document>, session = createLayoutSession(), revision = 0) {
  return layoutSemanticDocument(part, revision, {
    measurer,
    geometry,
    compatibilityMode: 15,
    session,
  });
}
function textX(result: ReturnType<typeof layout>, text = 'J') {
  return linesOf(result)
    .flatMap((l) => l.spans)
    .find((s) => s.text.startsWith(text))!.box.x;
}
test('a left tab past the cell edge replays from the next line origin', () => {
  for (const split of [false, true]) {
    const part = document({ split });
    const result = layout(part);
    const lines = linesOf(result);
    expect(textX(result)).toBe(10);
    expect(lines[0]!.spans.map((s) => s.text).join('')).toBe('ABCDEFGHI');
    expect(lines[1]!.spans.map((s) => s.text).join('')).toBe('\tJ K');
    const span = lines[1]!.spans[0]!;
    expect([span.range.start, span.range.end]).toEqual([9, 10]);
    expect(paragraphTextOf(part, span.range.paragraphId)).toBe('ABCDEFGHI\tJ K');
  }
});
test('left and hanging indents recompute the next tab from the continuation origin', () => {
  for (const indent of ['<w:ind w:left="100"/>', '<w:ind w:left="100" w:hanging="100"/>']) {
    expect(textX(layout(document({ indent })))).toBe(10);
  }
});
test('trailing tabs do not create a line', () => {
  const result = layout(document({ trailing: true }));
  // The cell's line, then the empty paragraph the body reads after the table.
  expect(linesOf(result)).toHaveLength(2);
  expect(linesOf(result)[0]!.spans.at(-1)!.text).toBe('\t');
});
test('a body tab past the edge replays like a cell tab; a positional tab keeps its placement', () => {
  expect(textX(layout(document({ body: true })))).toBe(10);
  expect(textX(layout(document({ positional: true })))).toBe(0);
});
test('aligned destinations beyond the cell edge do not use left-tab replay', () => {
  for (const alignment of ['right', 'center', 'decimal']) {
    const result = layout(document({ alignment, stop: 1440 }));
    expect(linesOf(result)[0]!.spans.some((s) => s.text === '\t')).toBe(true);
  }
});
test('RTL tabs retain their prior leading-edge calculation', () => {
  expect(linesOf(layout(document({ rtl: true })))[0]!.spans.some((s) => s.text === '\t')).toBe(
    true
  );
});
test('a fresh-line destination beyond the cell width makes bounded progress', () => {
  const result = layout(document({ stop: 2000 }));
  expect(linesOf(result).slice(0, -1).length).toBeLessThanOrEqual(3);
  expect(
    linesOf(result)
      .flatMap((l) => l.spans)
      .map((s) => s.text)
      .join('')
  ).toBe('ABCDEFGHI\tJ K');
});
test('retained sessions reflow source edits without losing tab ranges', () => {
  let part = document();
  const session = createLayoutSession();
  const initial = layout(part, session, 0);
  const id = linesOf(initial)[0]!.spans[0]!.range.paragraphId;
  const edit = applyTreeOp(part, { op: 'insertText', paragraphId: id, offset: 0, text: 'A' });
  expect(edit.ok).toBe(true);
  if (!edit.ok) return;
  part = edit.part;
  const warm = layout(part, session, 1);
  expect(warm.pages).toEqual(layout(part, createLayoutSession(), 1).pages);
  expect(layout(part, session, 1).pages[0]).toBe(warm.pages[0]);
});

test('an exclusion past the right edge leaves the tab replay in place', () => {
  const part = document({ body: true });
  const body = part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  const paragraph = body.children.find((node) => node.kind === 'paragraph')!;
  const lines = breakParagraph(
    paragraph,
    paragraph.id,
    0,
    50,
    measurer,
    undefined,
    null,
    [],
    { stops: [{ positionPt: 10, alignment: 'left' }], defaultIntervalPt: 36 },
    undefined,
    undefined,
    {
      cellAnchorScope: LEGACY_CELL_ANCHOR_SCOPE,
      paragraphStartY: 0,
      pageExclusionZones: [
        squareWrapZone({ anchorParagraphId: 'earlier', left: 60, top: 0, width: 10, height: 100 }),
      ],
    }
  );
  expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('ABCDEFGHI');
  expect(lines[1]!.spans.find((span) => span.text.startsWith('J'))!.box.x).toBe(10);
});

test('consecutive tabs retain the prior policy across run boundaries', () => {
  const projection = (result: ReturnType<typeof layout>) =>
    linesOf(result).map((line) => ({
      box: line.box,
      spans: line.spans.map((span) => ({
        text: span.text,
        box: span.box,
        start: span.range.start,
        end: span.range.end,
      })),
    }));
  for (const repeatedSplit of [false, true]) {
    const part = document({ repeated: true, repeatedSplit });
    const result = layout(part);
    expect(projection(result)).toEqual(projection(layout(document({ repeated: true }))));
    expect(linesOf(result)[0]!.spans.at(-1)!.text).toBe('\t');
    const session = createLayoutSession();
    const before = layout(document(), session, 0);
    const warm = layout(part, session, 1);
    expect(warm.pages).toEqual(result.pages);
    expect(layout(part, session, 1).pages[0]).toBe(warm.pages[0]);
    expect(textX(before)).toBe(10);
    expect(
      linesOf(result)
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('')
    ).toBe('ABCDEFGHI\t\tJ K');
  }
});

test('a continuation retains the repeated-tab policy from earlier paragraph content', () => {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:tab/><w:tab/><w:t>ABCDEFGHI</w:t><w:tab/><w:t>J K</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  const paragraph = body.children[0]!;
  const lines = breakParagraph(
    paragraph,
    paragraph.id,
    0,
    50,
    measurer,
    undefined,
    null,
    [],
    { stops: [{ positionPt: 10, alignment: 'left' }], defaultIntervalPt: 36 },
    undefined,
    undefined,
    { cellAnchorScope: LEGACY_CELL_ANCHOR_SCOPE, startOffset: 2 }
  );
  expect(lines[0]!.spans.at(-1)!.text).toBe('\t');
  expect(lines[1]!.spans.find((span) => span.text.startsWith('J'))!.box.x).toBe(0);
  expect(lines[0]!.spans[0]!.range.start).toBe(2);
});
