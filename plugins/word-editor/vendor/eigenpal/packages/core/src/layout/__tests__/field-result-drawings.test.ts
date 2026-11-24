import { expect, test } from 'bun:test';
import { readOoxmlPart, paragraphTextOf } from '@docx-editor.dev/core/store';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { piecesOfParagraphForDisplay } from '../field-projection-walk.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
const picture = (hidden = false) =>
  `<w:r>${hidden ? '<w:rPr><w:vanish/></w:rPr>' : ''}<w:pict><v:shape id="image" type="#_x0000_t75" style="width:48pt;height:36pt"><v:imagedata r:id="image" r:href="externalSource"/></v:shape></w:pict></w:r>`;
const field = (
  result: string,
  instruction = 'INCLUDEPICTURE "https://example.invalid/image.png"'
) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
function setup(content: string, rtl = false, surround = true) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p>${rtl ? '<w:pPr><w:bidi/></w:pPr>' : ''}${surround ? text('A') : ''}${content}${surround ? text('Z') : ''}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  const part = read.part;
  const body = part.root.children[0]!;
  if (body.kind === 'textValue') throw Error('body');
  const paragraph = body.children[0]!;
  if (paragraph.kind !== 'paragraph') throw Error('paragraph');
  const projections = indexInlineDrawingProjectionsInPart(part);
  const context: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    projectionForAtom: (id) => projections.get(id) ?? null,
    project: (node) => projections.get(node.id) ?? null,
    resourceOf: () => ({
      kind: 'ready',
      partName: '/word/media/image.png',
      contentId: 'image',
      resourceKey: 'image',
      mime: 'image/png',
      pixelWidth: 48,
      pixelHeight: 36,
      dpiX: 72,
      dpiY: 72,
    }),
  };
  const layout = (displayMode: 'proposed' | 'original' | 'all-markup' = 'proposed') =>
    layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: context,
      displayMode,
    });
  return { part, paragraph, context, layout };
}
const drawings = (layout: ReturnType<ReturnType<typeof setup>['layout']>) =>
  layout.pages.flatMap((p) =>
    p.fragments.flatMap((f) =>
      f.kind === 'paragraph' ? f.lines.flatMap((l) => l.drawings ?? []) : []
    )
  );
for (const depth of [1, 4]) {
  test(`a cached picture survives ${depth} nested complex results without changing model length`, () => {
    let result = picture();
    for (let i = 0; i < depth; i++) result = field(result);
    const s = setup(result);
    expect(paragraphTextOf(s.part, s.paragraph.id)).toBe('A\uFFFCZ');
    const images = drawings(s.layout());
    expect(images).toHaveLength(1);
    expect(images[0]!.width).toBe(48);
    expect(images[0]!.height).toBe(36);
    expect(images[0]!.start).toBe(1);
  });
}
test('text and multiple cached pictures keep their display order within one atom', () => {
  const s = setup(field(text('left') + picture() + text('middle') + picture() + text('right')));
  const pieces = piecesOfParagraphForDisplay(
    s.paragraph,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    'proposed',
    undefined,
    s.context
  );
  expect(pieces.map((p) => p.text)).toEqual([
    'A',
    'left',
    '\uFFFC',
    'middle',
    '\uFFFC',
    'right',
    'Z',
  ]);
  for (const p of pieces.slice(1, -1)) {
    expect(p.start).toBe(1);
    expect(p.end).toBe(2);
  }
  const layout = s.layout();
  const images = drawings(layout);
  expect(images).toHaveLength(2);
  expect(images[1]!.advanceStart).toBeGreaterThan(images[0]!.advanceEnd);
  const before = caretAt(layout, { paragraphId: s.paragraph.id, offset: 1 });
  const after = caretAt(layout, { paragraphId: s.paragraph.id, offset: 2 });
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  const fragment = layout.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw Error('paragraph');
  const leading = fragment.lines[0]!.spans.find((span) => span.text === 'left')!;
  expect(before!.x).toBe(leading.box.x);
  expect(after!.x).toBeGreaterThanOrEqual(images[1]!.advanceEnd);
});
test('vanished cached pictures remain hidden', () => {
  expect(drawings(setup(field(picture(true))).layout())).toHaveLength(0);
});
test('pictures inside an outer instruction do not enter its displayed result', () => {
  const content =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    field(picture()) +
    '<w:r><w:instrText> IF </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>' +
    text('cache') +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  expect(drawings(setup(content).layout())).toHaveLength(0);
});
test('a deleted cached picture respects the review display mode', () => {
  const s = setup(field('<w:del w:id="1" w:author="Reviewer">' + picture() + '</w:del>'));
  expect(drawings(s.layout('proposed'))).toHaveLength(0);
  expect(drawings(s.layout('original'))).toHaveLength(1);
  expect(drawings(s.layout('all-markup'))).toHaveLength(1);
});

for (const rtl of [false, true]) {
  test(`multiple cached pictures retain separate positions with paragraph RTL=${rtl}`, () => {
    const s = setup(field(picture() + picture()), rtl, false);
    const result = s.layout();
    const images = drawings(result);
    expect(images).toHaveLength(2);
    expect(Math.abs(images[1]!.x - images[0]!.x)).toBe(48);
    const before = caretAt(result, { paragraphId: s.paragraph.id, offset: 0 });
    const after = caretAt(result, { paragraphId: s.paragraph.id, offset: 1 });
    expect(before!.x).toBe(images[0]!.advanceStart);
    expect(after!.x).toBe(images[1]!.advanceEnd);
  });
}
test('a cached picture field owns its first and last line caret boundaries', () => {
  const s = setup(field(Array.from({ length: 12 }, () => picture()).join('')), false, false);
  const result = s.layout();
  const images = drawings(result);
  expect(images).toHaveLength(12);
  expect(images.at(-1)!.y).toBeGreaterThan(images[0]!.y);
  const before = caretAt(result, { paragraphId: s.paragraph.id, offset: 0 });
  const after = caretAt(result, { paragraphId: s.paragraph.id, offset: 1 });
  expect(before!.x).toBe(images[0]!.advanceStart);
  expect(after!.x).toBe(images.at(-1)!.advanceEnd);
  expect(after!.y).toBeGreaterThan(before!.y);
});
