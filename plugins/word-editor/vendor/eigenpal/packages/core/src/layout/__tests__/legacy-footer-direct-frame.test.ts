import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const measurer = createFixedMeasurer(6, 14);
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const field =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
const frame =
  '<w:framePr w:wrap="auto" w:vAnchor="text" w:hAnchor="margin" w:xAlign="center" w:y="1"/>';
const properties =
  '<w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLine="720"/><w:tabs><w:tab w:val="center" w:pos="4320"/></w:tabs><w:jc w:val="both"/>';
const content = `<w:p><w:pPr>${frame}${properties}</w:pPr>${field}</w:p><w:p><w:pPr>${properties}</w:pPr></w:p>`;
function partOf(xml = content, footer = true) {
  const parsed = readOoxmlPart(
    footer
      ? `<w:ftr xmlns:w="${WML_NAMESPACE_URI}">${xml}</w:ftr>`
      : `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>${xml}</w:body></w:document>`,
    {
      name: footer ? '/word/footer1.xml' : '/word/document.xml',
      contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${footer ? 'footer' : 'document.main'}+xml`,
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

test('direct PAGE frame formatting shares the empty anchor band and retains the first-line offset', () => {
  for (const wrap of ['auto', 'around']) {
    const part = partOf(content.replace('w:wrap="auto"', `w:wrap="${wrap}"`));
    const before = serializeOoxmlPart(part);
    const story = layoutHeaderFooterStory(part, 400, measurer, 'direct-footer');
    for (const pageNumber of [1, 12, 123]) {
      const projected = story.withPageContext({
        pageNumber,
        pageCount: 200,
        sectionPageCount: 200,
      });
      const [first, anchor] = projected.fragments;
      if (first?.kind !== 'paragraph' || anchor?.kind !== 'paragraph')
        throw new Error('paragraphs required');
      const spans = first.lines[0]!.spans;
      const left = spans[0]!.box.x,
        right = spans.at(-1)!.box.x + spans.at(-1)!.box.width;
      expect(spans.map((span) => span.text).join('')).toBe(String(pageNumber));
      expect((left + right) / 2).toBeCloseTo(218, 4);
      expect(anchor.box.y).toBe(0);
      expect(projected.flowHeight).toBeCloseTo(
        Math.max(first.box.y + first.box.height, anchor.box.height),
        4
      );
      expect(projected.flowHeight).toBeLessThan(first.box.height + anchor.box.height);
      expect(first.paragraphId).not.toBe(anchor.paragraphId);
    }
    expect(serializeOoxmlPart(part)).toBe(before);
  }
});

test('an unused tab stop does not move a zero-indent centered PAGE frame', () => {
  const story = layoutHeaderFooterStory(
    partOf(content.replace('w:firstLine="720"', 'w:firstLine="0"')),
    400,
    measurer,
    'tabs'
  );
  const first = story.fragments[0]!;
  if (first.kind !== 'paragraph') throw new Error('paragraph required');
  const span = first.lines[0]!.spans[0]!;
  expect(span.box.x + span.box.width / 2).toBeCloseTo(200, 4);
  expect(story.fragments[1]!.box.y).toBe(0);
});

test('unsupported direct footer decorations and paragraph geometry retain ordinary flow', () => {
  for (const xml of [
    content.replace('w:firstLine="720"', 'w:hanging="720"'),
    content.replace('w:firstLine="720"', 'w:firstLine="-720"'),
    content.replace('w:firstLine="720"', 'w:firstLine="8000"'),
    content.replace('w:firstLine="720"', 'w:firstLine="720" w:left="200"'),
    content.replace('w:line="360"', 'w:before="200" w:line="360"'),
    content.replace(frame, frame + '<w:pBdr><w:bottom w:val="single"/></w:pBdr>'),
    content.replace('</w:pPr></w:p>', '</w:pPr><w:r><w:t>Footer note</w:t></w:r></w:p>'),
    content.replace(' PAGE ', ' NUMPAGES '),
  ]) {
    const story = layoutHeaderFooterStory(partOf(xml), 400, measurer, 'unsupported');
    expect(story.fragments[1]!.box.y).toBeGreaterThan(0);
  }
});

test('a centered footer frame does not push the final body line onto an extra page', () => {
  const story = layoutHeaderFooterStory(partOf(content), 400, measurer, 'pagination');
  const paragraphs = Array.from(
    { length: 5 },
    (_, i) =>
      `<w:p><w:pPr><w:spacing w:line="400" w:lineRule="exact"/></w:pPr><w:r><w:t>Line ${i + 1}</w:t></w:r></w:p>`
  ).join('');
  const document = partOf(
    paragraphs +
      '<w:sectPr><w:pgSz w:w="10000" w:h="3200"/><w:pgMar w:top="400" w:bottom="600" w:left="1000" w:right="1000" w:footer="200"/></w:sectPr>',
    false
  );
  const session = createLayoutSession();
  const options = {
    session,
    measurer,
    producer: 'footer-pagination',
    sectionFurniture: [
      {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map(),
        footers: new Map([['default' as const, story]]),
      },
    ],
  };
  const layout = layoutSemanticDocument(document, 1, options);
  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0]!.fragments).toHaveLength(5);
  const again = layoutSemanticDocument(document, 1, options);
  expect(again.pages).toBe(layout.pages);
  const cold = layoutSemanticDocument(document, 1, { ...options, session: createLayoutSession() });
  expect(cold.pages).toEqual(layout.pages);
});

test('a shared footer style supplies the supported indent and line spacing', () => {
  const parsed = readOoxmlPart(
    `<w:styles xmlns:w="${WML_NAMESPACE_URI}">${FORMAT_DOC_DEFAULTS}<w:style w:type="paragraph" w:styleId="Footer"><w:pPr>${properties}</w:pPr></w:style></w:styles>`,
    { name: '/word/styles.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const styles = buildStyleCascadeTable(parsed.part.root);
  const source = partOf(content.replaceAll(properties, '<w:pStyle w:val="Footer"/>'));
  const inherited = layoutHeaderFooterStory(source, 400, measurer, 'inherited', undefined, styles);
  const direct = layoutHeaderFooterStory(partOf(), 400, measurer, 'direct');
  expect(inherited.flowHeight).toBeCloseTo(direct.flowHeight, 4);
  expect(inherited.fragments.map((fragment) => fragment.box)).toEqual(
    direct.fragments.map((fragment) => fragment.box)
  );
});
