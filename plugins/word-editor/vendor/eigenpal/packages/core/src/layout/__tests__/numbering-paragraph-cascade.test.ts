import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  resolveParagraphLayoutInputs,
  type TableCellStyleFormatting,
} from '../style-cascade.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { layoutSemanticDocument, createFixedMeasurer } from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { propertiesOf } from '../paragraph-flow.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const num = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
function read(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const styles = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:spacing w:after="240" w:line="360"/><w:jc w:val="left"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Custom"><w:basedOn w:val="Normal"/><w:pPr>${num}</w:pPr></w:style><w:style w:type="paragraph" w:styleId="OwnFormat"><w:basedOn w:val="Normal"/><w:pPr>${num}<w:spacing w:before="0" w:after="120" w:line="240"/><w:jc w:val="center"/><w:pBdr><w:bottom w:val="nil"/></w:pBdr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TabClearBase"><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="clear" w:pos="2880"/></w:tabs></w:pPr></w:style><w:style w:type="paragraph" w:styleId="NumOnTabClearBase"><w:basedOn w:val="TabClearBase"/><w:pPr>${num}</w:pPr></w:style></w:styles>`
  ).root
);
function numbering(after = '360', override = '') {
  return buildNumberingIndex(
    read(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:spacing w:before="360" w:after="${after}" w:line="480"/><w:jc w:val="right"/><w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs><w:pBdr><w:bottom w:val="single" w:sz="8"/></w:pBdr><w:shd w:fill="FFFF00"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/>${override}</w:num></w:numbering>`
    ).root
  );
}
function document(props = num) {
  return read(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${props}</w:pPr><w:r><w:t>Item</w:t></w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`
  );
}
function inputs(props = num, index = numbering(), tableCellStyle?: TableCellStyleFormatting) {
  const part = document(props);
  const blocks = part.root.children[0]!.children as OoxmlElement[];
  const items = resolveStoryListItems(blocks, index, styles);
  const item = items.get(blocks[0]!.id);
  return resolveParagraphLayoutInputs(blocks[0]!, 400, styles, item, tableCellStyle);
}
test('direct numbering applies level properties over styles; direct properties win last', () => {
  const level = inputs();
  expect(level.spacing).toEqual({ before: 18, after: 18 });
  expect(level.lineSpacing).toEqual({ rule: 'auto', value: 480 });
  expect(level.alignment).toBe('right');
  expect(level.borders.bottom?.widthPt).toBe(1);
  expect(JSON.stringify(level.tabStops)).toContain('144');
  const direct = inputs(num + '<w:spacing w:after="80" w:line="240"/><w:jc w:val="center"/>');
  expect(direct.spacing).toEqual({ before: 18, after: 4 });
  expect(direct.alignment).toBe('center');
  expect(direct.lineSpacing.value).toBe(240);
});
// Style numbering: the level sits directly below the style that states the `w:numPr`, the
// same rank the list indent uses. `Normal` is a base of that style, so the level outranks it.
test('style numbering applies level properties over the base styles of the numbered style', () => {
  const inherited = inputs('<w:pStyle w:val="Custom"/>');
  expect(inherited.spacing).toEqual({ before: 18, after: 18 });
  expect(inherited.alignment).toBe('right');
  expect(inherited.lineSpacing.value).toBe(480);
  expect(inherited.borders.bottom?.widthPt).toBe(1);
  expect(JSON.stringify(inherited.tabStops)).toContain('144');
});
test('the numbered style outranks its own level properties', () => {
  const own = inputs('<w:pStyle w:val="OwnFormat"/>');
  expect(own.spacing).toEqual({ before: 0, after: 6 });
  expect(own.alignment).toBe('center');
  expect(own.lineSpacing.value).toBe(240);
  expect(own.borders.bottom).toBeUndefined();
});
test('a base of the numbered style cannot clear a level tab stop', () => {
  const tabs = inputs('<w:pStyle w:val="NumOnTabClearBase"/>');
  expect(JSON.stringify(tabs.tabStops)).toContain('144');
});
test('a direct numPr stating only ilvl puts the level above the whole chain', () => {
  const ilvlOnly = inputs('<w:pStyle w:val="Custom"/><w:numPr><w:ilvl w:val="0"/></w:numPr>');
  expect(ilvlOnly.spacing).toEqual({ before: 18, after: 18 });
  expect(ilvlOnly.alignment).toBe('right');
  const own = inputs('<w:pStyle w:val="OwnFormat"/><w:numPr><w:ilvl w:val="0"/></w:numPr>');
  expect(own.spacing).toEqual({ before: 18, after: 18 });
  expect(own.alignment).toBe('right');
});
test('a table style stays below the level for both kinds of numbering', () => {
  const pPr = read(
    `<w:pPr xmlns:w="${W}"><w:jc w:val="center"/><w:pBdr><w:bottom w:val="nil"/></w:pBdr></w:pPr>`
  ).root;
  const cell = {
    paragraphProperties: propertiesOf(pPr),
    paragraphPropertyNodes: [pPr],
    runProperties: [],
  };
  for (const props of [num, '<w:pStyle w:val="Custom"/>']) {
    const resolved = inputs(props, numbering(), cell);
    expect(resolved.alignment).toBe('right');
    expect(resolved.borders.bottom?.widthPt).toBe(1);
  }
  expect(inputs('<w:pStyle w:val="OwnFormat"/>', numbering(), cell).alignment).toBe('center');
});
test('level overrides replace the base paragraph formatting', () => {
  const override =
    '<w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:spacing w:afterLines="50"/><w:jc w:val="center"/></w:pPr></w:lvl></w:lvlOverride>';
  const resolved = inputs(num, numbering('360', override));
  expect(resolved.spacing).toEqual({ before: 0, after: 6 });
  expect(resolved.alignment).toBe('center');
});
test('numbering formatting changes invalidate cached layout', () => {
  const part = document();
  const cache = createParagraphLayoutCache();
  const options = { styleCascade: styles, measurer: createFixedMeasurer(6, 14), cache };
  const first = layoutSemanticDocument(part, 1, { ...options, numberingIndex: numbering('360') });
  const next = layoutSemanticDocument(part, 2, { ...options, numberingIndex: numbering('720') });
  const cold = layoutSemanticDocument(part, 2, {
    ...options,
    cache: createParagraphLayoutCache(),
    numberingIndex: numbering('720'),
  });
  expect(next.pages).toEqual(cold.pages);
  expect(next.pages).not.toEqual(first.pages);
});
