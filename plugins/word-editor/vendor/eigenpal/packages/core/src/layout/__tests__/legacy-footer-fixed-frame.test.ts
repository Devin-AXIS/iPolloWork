import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { shiftParagraphFragment } from '../note-fragment-geometry.ts';
import { fragmentSignature } from '../semantic-fragment-signature.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';
import { caretAt, caretStopsForBlocks, spansInSelection } from '../semantic-interaction.ts';
import { presenceSelectionRects } from '../selection-rects.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';

const frame =
  '<w:framePr w:w="400" w:wrap="around" w:vAnchor="text" w:hAnchor="page" w:x="4000" w:yAlign="center"/>';
const field =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
const decorated =
  '<w:r><w:t xml:space="preserve">- </w:t></w:r>' +
  field +
  '<w:r><w:t xml:space="preserve"> -</w:t></w:r>';
const body = `<w:p><w:pPr><w:pStyle w:val="Footer"/>${frame}</w:pPr><w:r><w:tab/></w:r>${decorated}</w:p><w:p><w:pPr><w:pStyle w:val="Footer"/><w:ind w:right="360"/><w:jc w:val="center"/></w:pPr>${decorated}</w:p>`;
function part(xml: string, kind = 'ftr') {
  const loaded = readOoxmlPart(
    `<w:${kind} xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:foreign">${xml}</w:${kind}>`,
    { name: '/word/footer1.xml', contentType: 'application/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const stylesWith = (extra = '') =>
  buildStyleCascadeTable(
    part(
      `${FORMAT_DOC_DEFAULTS}<w:style w:type="paragraph" w:styleId="Footer"><w:pPr><w:tabs><w:tab w:val="center" w:pos="4000"/></w:tabs>${extra}</w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>`,
      'styles'
    ).root
  );
const styles = stylesWith();
const measurer = createFixedMeasurer(6, 14);
const geometry = {
  pageNumber: 1,
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 72,
  marginRight: 72,
  marginTop: 72,
  marginBottom: 72,
};
const layout = (content = body, pageGeometry = geometry, kind = 'ftr', cascade = styles) =>
  layoutHeaderFooterStory(
    part(content, kind),
    468,
    measurer,
    'fixed-frame',
    undefined,
    cascade,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pageGeometry
  );
const paragraphs = (story: ReturnType<typeof layout>) =>
  story.fragments.map((p) => {
    if (p.kind !== 'paragraph') throw Error('paragraph required');
    return p;
  });
function documentOf(story: ReturnType<typeof layout>): SemanticLayout {
  return {
    revision: 0,
    pages: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 612, height: 792 },
        contentBox: { x: 72, y: 72, width: 468, height: 648 },
        fragments: [],
        footer: {
          kind: 'footer',
          variant: 'default',
          partName: story.partName,
          part: story.part,
          box: { x: 72, y: 730, width: 468, height: story.flowHeight },
          fragments: story.fragments,
        },
      },
    ],
  } as SemanticLayout;
}

test('positions and clips a fixed PAGE frame while preserving both authored fields', () => {
  const source = part(body),
    before = serializeOoxmlPart(source);
  const initial = layout();
  const projected = initial.withPageContext({ pageNumber: 5, pageCount: 5, sectionPageCount: 5 });
  const [framed, anchor] = paragraphs(projected);
  expect(framed!.clipToBox).toBe(true);
  expect(framed!.box).toEqual({ x: 128, y: 0, width: 20, height: 14 });
  expect(anchor!.box.y).toBe(0);
  expect(projected.flowHeight).toBe(14);
  expect(framed!.lines[0]!.spans.map((s) => s.text).join('')).toBe('\t- 5 -');
  expect(anchor!.lines[0]!.spans.map((s) => s.text).join('')).toBe('- 5 -');
  expect(framed!.lines[0]!.spans.find((s) => s.projected)!.box.x).toBeGreaterThan(
    framed!.box.x + framed!.box.width
  );
  expect(serializeOoxmlPart(source)).toBe(before);
  expect(serializeOoxmlPart(projected.part).match(/fldCharType="begin"/g)).toHaveLength(2);
  const saved = serializeOoxmlPart(projected.part);
  const reopened = readOoxmlPart(saved, { name: source.name, contentType: source.contentType });
  expect(reopened.ok).toBe(true);
  if (reopened.ok) expect(serializeOoxmlPart(reopened.part)).toBe(saved);
});

test('recomputes PAGE and page-X conversion without sharing a stale clipping origin', () => {
  const narrow = layout(),
    widerMargin = layout(body, { ...geometry, marginLeft: 90 });
  expect(paragraphs(widerMargin)[0]!.box.x).toBe(110);
  for (const pageNumber of [1, 12, 123]) {
    const value = narrow.withPageContext({ pageNumber, pageCount: 200, sectionPageCount: 200 });
    expect(
      paragraphs(value)[0]!
        .lines[0]!.spans.map((s) => s.text)
        .join('')
    ).toBe(`\t- ${pageNumber} -`);
    expect(paragraphs(value)[0]!.box.width).toBe(20);
    expect(value.flowHeight).toBe(14);
  }
});

test('supports fully contained fields and independent valid anchor decoration', () => {
  const contained = layout(body.replace('w:w="400"', 'w:w="5000"'));
  const [framed] = paragraphs(contained);
  expect(framed!.clipToBox).toBe(true);
  const last = framed!.lines[0]!.spans.at(-1)!;
  expect(last.box.x + last.box.width).toBeLessThan(framed!.box.x + framed!.box.width);
  const differentDecoration =
    body.slice(0, body.indexOf('</w:p>') + 6) +
    body.slice(body.indexOf('</w:p>') + 6).replace(decorated, field);
  expect(paragraphs(layout(differentDecoration))[0]!.clipToBox).toBe(true);
});

test('accepts the switches Word writes after PAGE in a fixed frame', () => {
  const plain = paragraphs(layout())[0]!;
  for (const instruction of [
    ' PAGE \\* MERGEFORMAT ',
    ' PAGE \\# "0" ',
    ' page ',
    'PAGE \\* roman \\* MERGEFORMAT',
    ' PAGE \\* Arabic ',
  ]) {
    const [framed, anchor] = paragraphs(layout(body.replaceAll(' PAGE ', instruction)));
    expect(framed!.clipToBox).toBe(true);
    expect(framed!.box).toEqual(plain.box);
    expect(anchor!.box.y).toBe(0);
  }
  // Switches the page-field projection does not evaluate stay in ordinary flow with their
  // cached text: the frame lane must never claim a field whose value it cannot refresh.
  for (const instruction of [
    ' PAGEREF anchor ',
    'PAGE \\* Ordinal \\* MERGEFORMAT',
    ' PAGE \\* CardText ',
    ' PAGE MERGEFORMAT ',
  ]) {
    expect(
      paragraphs(layout(body.replaceAll(' PAGE ', instruction)))[0]!.clipToBox
    ).toBeUndefined();
  }
});

test('an empty anchor retains its line and clips the fixed frame without deleting its PAGE field', () => {
  const split = body.indexOf('</w:p>') + 6;
  const empty = body.slice(0, split) + body.slice(split).replace(decorated, '');
  const source = part(empty),
    before = serializeOoxmlPart(source);
  for (const pageNumber of [1, 49, 123]) {
    const projected = layout(empty).withPageContext({
      pageNumber,
      pageCount: 200,
      sectionPageCount: 200,
    });
    const [framed, anchor] = paragraphs(projected);
    expect(framed!.clipToBox).toBe(true);
    expect(framed!.box.width).toBe(20);
    expect(anchor!.box.y).toBe(0);
    expect(anchor!.box.height).toBe(14);
    expect(projected.flowHeight).toBe(14);
    expect(anchor!.lines[0]!.spans).toHaveLength(0);
    expect(framed!.lines[0]!.spans.map((span) => span.text).join('')).toBe(`\t- ${pageNumber} -`);
    expect(
      framed!.lines[0]!.spans.filter((span) => span.text.trim()).every(
        (span) => span.box.x >= framed!.box.x + framed!.box.width
      )
    ).toBe(true);
    expect(
      caretAt(documentOf(projected), { paragraphId: anchor!.paragraphId, offset: 0 })
    ).not.toBeNull();
    expect(serializeOoxmlPart(projected.part)).toBe(before);
  }
  expect(serializeOoxmlPart(source)).toBe(before);
  expect(before.match(/fldCharType="begin"/g)).toHaveLength(1);
});

test('empty formatting runs do not turn an empty anchor into visible content', () => {
  const split = body.indexOf('</w:p>') + 6;
  for (const emptyContent of ['', '<w:r/>', '<w:r><w:rPr><w:b/></w:rPr></w:r>']) {
    const empty = body.slice(0, split) + body.slice(split).replace(decorated, emptyContent);
    expect(paragraphs(layout(empty))[0]!.clipToBox).toBe(true);
    const contained = paragraphs(layout(empty.replace('w:w="400"', 'w:w="5000"')))[0]!;
    expect(contained.clipToBox).toBe(true);
    expect(contained.lines[0]!.spans.at(-1)!.box.x).toBeLessThan(
      contained.box.x + contained.box.width
    );
  }
});

test('unknown, hidden, whitespace and non-PAGE anchors are not mistaken for an empty anchor', () => {
  const split = body.indexOf('</w:p>') + 6;
  for (const content of [
    '<w:r><w:t> </w:t></w:r>',
    '<w:r><w:tab/></w:r>',
    '<w:r><w:br/></w:r>',
    '<w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r>',
    '<w:bookmarkStart w:id="1" w:name="kept"/><w:bookmarkEnd w:id="1"/>',
    '<x:r/>',
    field.replace(' PAGE ', ' NUMPAGES '),
  ]) {
    const variant = body.slice(0, split) + body.slice(split).replace(decorated, content);
    expect(paragraphs(layout(variant))[0]!.clipToBox).toBeUndefined();
  }
});

test('defers partial-width reflow and rejects unknown or unsafe frame structures', () => {
  const variants = [
    body.replace('w:w="400"', 'w:w="4000"'),
    body.replace('w:w="400"', 'w:w="0"'),
    body.replace('w:x="4000"', 'w:x="99999"'),
    body.replace('w:w="400"', 'w:w="NaN"'),
    body.replace('w:x="4000"', 'x:x="4000"'),
    body.replace('w:yAlign="center"', 'w:yAlign="top"'),
    body.replace('w:hAnchor="page"', 'w:hAnchor="margin"'),
    body.replace('w:w="400"', 'w:w="400" w:h="200"'),
    body.replace(frame, frame + frame),
    body.replace(' PAGE ', ' NUMPAGES '),
    body.replace('<w:tab/>', '<w:br/>'),
    body.replace(frame, frame + '<w:bidi/>'),
    body.replace(frame, frame + '<w:spacing w:after="20"/>'),
    body.replace(frame, ''),
    body.replace('w:w="400"', 'w:w="400" x:w="400"'),
  ];
  for (const xml of variants) {
    const [framed, anchor] = paragraphs(layout(xml));
    expect(framed!.clipToBox).toBeUndefined();
    expect(anchor!.box.y).toBeGreaterThan(0);
  }
  expect(
    paragraphs(layout(body, { ...geometry, pageWidth: Infinity }))[0]!.clipToBox
  ).toBeUndefined();
  expect(paragraphs(layout(body, { ...geometry, pageWidth: 1585 }))[0]!.clipToBox).toBeUndefined();
  expect(paragraphs(layout(body, geometry, 'hdr'))[0]!.clipToBox).toBeUndefined();
});

test('refuses inherited direction, frame, spacing and unknown layout properties', () => {
  for (const inherited of [
    '<w:bidi/>',
    '<w:textDirection w:val="tbRl"/>',
    frame,
    '<w:spacing w:before="40"/>',
    '<w:unknownLayout/>',
  ]) {
    expect(
      paragraphs(layout(body, geometry, 'ftr', stylesWith(inherited)))[0]!.clipToBox
    ).toBeUndefined();
  }
  expect(
    paragraphs(layout(body, geometry, 'ftr', stylesWith('<w:widowControl w:val="0"/>')))[0]!
      .clipToBox
  ).toBe(true);
});

test('clipping participates in signatures and follows vertical fragment translations', () => {
  const [framed] = paragraphs(layout());
  expect(fragmentSignature(framed!)).not.toBe(
    fragmentSignature({ ...framed!, clipToBox: undefined } as unknown as ParagraphFragmentRecord)
  );
  const shifted = shiftParagraphFragment(framed!, 30);
  expect(shifted.clipToBox).toBe(true);
  expect(shifted.box.y).toBe(30);
  expect(shifted.lines[0]!.spans[0]!.box.y).toBe(30);
});

test('hidden PAGE glyphs have no floating caret, presence highlight or outside-frame hit', () => {
  const story = layout().withPageContext({ pageNumber: 5, pageCount: 5, sectionPageCount: 5 });
  const model = documentOf(story),
    [framed, anchor] = paragraphs(story);
  const fieldSpan = framed!.lines[0]!.spans.find((s) => s.projected)!;
  const start = { paragraphId: framed!.paragraphId, offset: fieldSpan.range.start };
  const end = { ...start, offset: fieldSpan.range.end };
  expect(caretAt(model, start)).toBeNull();
  expect(
    presenceSelectionRects(model, { anchor: start, head: end }, [
      framed!.paragraphId,
      anchor!.paragraphId,
    ])
  ).toEqual([]);
  expect(
    caretStopsForBlocks(model, 0, story.fragments)
      .filter((s) => s.position.paragraphId === framed!.paragraphId)
      .every((s) => s.x >= framed!.box.x && s.x <= framed!.box.x + framed!.box.width)
  ).toBe(true);
  expect(
    hitTestFragments(model, 0, story.fragments, { x: fieldSpan.box.x + 1, y: 3 })?.position
      .paragraphId
  ).toBe(anchor!.paragraphId);
  expect(framed!.range.end).toBe(6);
  const hit = hitTestFragments(model, 0, [framed!], { x: framed!.box.x + 15, y: 3 });
  expect(
    hit === null ||
      (hit.caret.x >= framed!.box.x && hit.caret.x <= framed!.box.x + framed!.box.width)
  ).toBe(true);
  expect(
    spansInSelection(model, { anchor: start, head: end }, [
      framed!.paragraphId,
      anchor!.paragraphId,
    ])
  ).toContain(fieldSpan);
});

test('presence uses footer story order without highlighting another PAGE field', () => {
  const story = layout(body.replace(frame, ''));
  const model = documentOf(story),
    [first, second] = paragraphs(story);
  const fieldSpan = first!.lines[0]!.spans.find((span) => span.projected)!;
  const start = { paragraphId: first!.paragraphId, offset: fieldSpan.range.start };
  const end = { ...start, offset: fieldSpan.range.end };
  const order = [first!.paragraphId, second!.paragraphId];
  const onlyFirst = presenceSelectionRects(model, { anchor: start, head: end }, order);
  expect(onlyFirst).toHaveLength(1);
  expect(onlyFirst[0]!.y).toBe(658);
  expect(onlyFirst[0]!.x).toBe(fieldSpan.box.x);
  const secondField = second!.lines[0]!.spans.find((span) => span.projected)!;
  const throughSecond = { paragraphId: second!.paragraphId, offset: secondField.range.end };
  expect(presenceSelectionRects(model, { anchor: throughSecond, head: start }, order)).toHaveLength(
    2
  );
  expect(
    presenceSelectionRects(
      model,
      {
        anchor: { paragraphId: 'missing', offset: 0 },
        head: { paragraphId: 'missing', offset: 1 },
      },
      order
    )
  ).toEqual([]);
});
