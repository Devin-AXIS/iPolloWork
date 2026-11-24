import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
function cascade(defaults: string, mode: number | null = 15, paragraphStyle = '') {
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>${defaults}</w:docDefaults>${paragraphStyle}</w:styles>`,
    '/word/styles.xml'
  );
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode ?? ''}"/></w:compat></w:settings>`,
    '/word/settings.xml'
  );
  const before = serializeOoxmlPart(styles);
  const result = buildStyleCascadeTable(styles.root, undefined, settings.root);
  expect(serializeOoxmlPart(styles)).toBe(before);
  return result;
}
const p = '<w:p><w:r><w:t>Text</w:t></w:r></w:p>';
const document = part(
  `<w:document xmlns:w="${W}"><w:body>${p}${p}<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${p}</w:tc></w:tr></w:tbl></w:body></w:document>`,
  '/word/document.xml'
);

test('omitted application defaults match authored spacing in body and cells, including warm reuse', () => {
  const implicit = cascade('');
  const explicit = cascade(
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="278" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
  );
  const empty = cascade('<w:pPrDefault><w:pPr/></w:pPrDefault>');
  expect(implicit.cacheToken).not.toBe(empty.cacheToken);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const measurer = createFixedMeasurer(6, 12);
  for (const styleCascade of [implicit, empty, explicit, implicit]) {
    const options = { measurer, styleCascade };
    const warm = layoutSemanticDocument(document, 0, { ...options, session, cache });
    expect(warm.pages).toEqual(layoutSemanticDocument(document, 0, options).pages);
    const body = warm.pages[0]!.fragments[0]!;
    const table = warm.pages[0]!.fragments.find((block) => block.kind === 'table')!;
    const cell = table.rows[0]!.cells[0]!.blocks[0]!;
    for (const paragraph of [body, cell]) {
      if (paragraph.kind !== 'paragraph') throw new Error('paragraph expected');
      expect(paragraph.spacing.after).toBe(styleCascade === empty ? 0 : 8);
      expect(paragraph.lines[0]!.box.height).toBeCloseTo(styleCascade === empty ? 12 : 13.9, 8);
    }
  }
  expect(layoutSemanticDocument(document, 0, { measurer, styleCascade: implicit }).pages).toEqual(
    layoutSemanticDocument(document, 0, { measurer, styleCascade: explicit }).pages
  );
});

test('empty authored defaults and direct or styled zero suppress fallback', () => {
  expect(cascade('<w:pPrDefault/>').docDefaultsParagraph).toEqual([]);
  const spacing = '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>';
  const style = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr>${spacing}</w:pPr></w:style>`;
  const direct = part(
    `<w:document xmlns:w="${W}"><w:body>${p.replace('<w:p>', `<w:p><w:pPr>${spacing}</w:pPr>`)}</w:body></w:document>`,
    '/word/document.xml'
  );
  for (const [source, styleCascade] of [
    [document, cascade('', 15, style)],
    [direct, cascade('')],
  ] as const) {
    const first = layoutSemanticDocument(source, 0, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade,
    }).pages[0]!.fragments[0]!;
    if (first.kind !== 'paragraph') throw new Error('paragraph expected');
    expect(first.spacing.after).toBe(0);
    expect(first.lines[0]!.box.height).toBe(12);
  }
});

test('application defaults do not depend on document compatibility mode', () => {
  const expected = cascade('').docDefaultsParagraph;
  expect(expected).not.toEqual([]);
  for (const mode of [null, 11, 12, 14, 15, 99]) {
    expect(cascade('', mode).docDefaultsParagraph).toEqual(expected);
    expect(cascade('<w:pPrDefault/>', mode).docDefaultsParagraph).toEqual([]);
  }
});
