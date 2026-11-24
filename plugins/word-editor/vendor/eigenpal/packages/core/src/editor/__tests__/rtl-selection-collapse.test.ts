import { expect, test } from 'bun:test';
import { mount } from './paginated-surface-fixtures.ts';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { caretAt, documentOrder } from '../../layout/semantic-interaction.ts';
import { selectionRects } from '../../layout/selection-rects.ts';
import { collapseHorizontalSelection } from '../surface-selection-collapse.ts';
const paragraph = (text: string, rtl = true) =>
  `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}</w:pPr><w:r><w:rPr>${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
for (const reversed of [false, true]) {
  test(`plain arrows collapse RTL selection at the selected physical edge (reversed=${reversed})`, () => {
    const { surface } = mount(paragraph('אבג'));
    const paragraphId = surface.session.paragraphIds()[0]!;
    const set = () =>
      surface.setSelection({
        anchor: { paragraphId, offset: reversed ? 3 : 0 },
        head: { paragraphId, offset: reversed ? 0 : 3 },
      });
    try {
      set();
      surface.navigate('left');
      expect(surface.state().selection.head.offset).toBe(3);
      set();
      surface.navigate('right');
      expect(surface.state().selection.head.offset).toBe(0);
    } finally {
      surface.destroy();
    }
  });
}
test('mixed bidi selection collapses to its outer selected band instead of an internal endpoint', () => {
  const { surface } = mount(paragraph('אבג ABC דהו'));
  const paragraphId = surface.session.paragraphIds()[0]!;
  try {
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } });
    surface.navigate('left');
    expect(surface.state().selection.head.offset).toBe(4);
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } });
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(0);
  } finally {
    surface.destroy();
  }
});
test.each([false, true])(
  'multiline selection collapse follows its paragraph base direction (rtl=%s)',
  (rtl) => {
    const { surface } = mount(paragraph('אבג', rtl) + paragraph('דהו', rtl));
    const [first, second] = surface.session.paragraphIds();
    const from = { paragraphId: first!, offset: 1 },
      to = { paragraphId: second!, offset: 2 };
    try {
      surface.setSelection({ anchor: from, head: to });
      surface.navigate('left');
      expect(surface.state().selection.head).toEqual(rtl ? to : from);
      surface.setSelection({ anchor: to, head: from });
      surface.navigate('right');
      expect(surface.state().selection.head).toEqual(rtl ? from : to);
    } finally {
      surface.destroy();
    }
  }
);
test('word navigation and shift extension retain their separate selection behavior', () => {
  const { surface } = mount(paragraph('alpha beta gamma', false));
  const paragraphId = surface.session.paragraphIds()[0]!;
  try {
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } });
    surface.navigate('wordRight');
    expect(surface.state().selection.head.offset).toBe(10);
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } });
    surface.navigate('right', true);
    expect(surface.state().selection.anchor.offset).toBe(0);
    expect(surface.state().selection.head.offset).toBe(6);
  } finally {
    surface.destroy();
  }
});

function geometry(text: string) {
  const source = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(text)}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!source.ok) throw Error(source.reason);
  const measurer = createFixedMeasurer(6, 14);
  const layout = layoutSemanticDocument(source.part, 0, { measurer });
  const order = documentOrder(layout);
  const at = (offset: number) => ({ paragraphId: order[0]!, offset });
  const collapse = (start: number, end: number, command: 'left' | 'right') =>
    caretAt(
      layout,
      collapseHorizontalSelection(
        layout,
        { from: at(start), to: at(end) },
        order,
        command,
        measurer
      ),
      measurer
    )!;
  const bands = (start: number, end: number) =>
    selectionRects(layout, { anchor: at(start), head: at(end) }, order, measurer);
  return { collapse, bands, caret: (offset: number) => caretAt(layout, at(offset), measurer)! };
}
test('mixed selection collapse paints at the selected outer edges when both are representable', () => {
  const { collapse, bands } = geometry('אבג ABC דהו');
  const selected = bands(0, 5);
  expect(collapse(0, 5, 'left').x).toBeCloseTo(Math.min(...selected.map((r) => r.x)));
  expect(collapse(0, 5, 'right').x).toBeCloseTo(Math.max(...selected.map((r) => r.x + r.width)));
});
test('single-affinity bidi seams collapse to canonical positions rather than upstream ink edges', () => {
  const { collapse, bands, caret } = geometry('אבג ABC דהו');
  // Both logical ends of ABC share a physical caret under downstream affinity.
  // Its upstream right ink edge has no distinct insertion position.
  const selected = bands(4, 7);
  expect(caret(4).x).toBe(caret(7).x);
  for (const command of ['left', 'right'] as const) {
    const target = collapse(4, 7, command);
    expect(target.position.offset).toBeGreaterThanOrEqual(4);
    expect(target.position.offset).toBeLessThanOrEqual(7);
    expect(target.x).toBe(caret(4).x);
    expect(target.x).toBeLessThan(Math.max(...selected.map((r) => r.x + r.width)));
  }
});
