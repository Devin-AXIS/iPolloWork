import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  EMPTY_TABLE_CELL_STYLE_FORMATTING,
} from '../style-cascade.ts';
import { resolveRunStyle } from '../run-style.ts';
import { paragraphAlignment } from '../paragraph-flow.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const read = (xml: string) => {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};
const styles = (size = 24) =>
  read(`<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:pPr><w:jc w:val="left"/></w:pPr><w:rPr><w:rFonts w:ascii="Ubuntu"/><w:sz w:val="${size}"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Derived"><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="Sized"><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
  </w:styles>`).root;
const settings = (value: string, uri = 'http://schemas.microsoft.com/office/word') =>
  read(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="${uri}" w:val="${value}"/></w:compat></w:settings>`
  ).root;
const cellStyle = {
  ...EMPTY_TABLE_CELL_STYLE_FORMATTING,
  paragraphProperties: [{ localName: 'jc', attributes: { val: 'center' } }],
  runProperties: [{ localName: 'sz', attributes: { val: '18' } }],
};
const ppr = (style: string) =>
  read(`<w:pPr xmlns:w="${W}"><w:pStyle w:val="${style}"/></w:pPr>`).root;

test('legacy default 11/12pt and left alignment defer to table formatting', () => {
  for (const size of [22, 24]) {
    const table = buildStyleCascadeTable(styles(size));
    const cell = cascadeParagraphFormatting(table, undefined, cellStyle);
    expect(resolveRunStyle(cell.runProperties)).toMatchObject({
      fontSizePt: 9,
      fontFamily: 'Ubuntu',
    });
    expect(paragraphAlignment(cell.paragraphProperties)).toBe('center');
    expect(resolveRunStyle(cell.markRunProperties).fontSizePt).toBe(9);
    expect(
      resolveRunStyle(cascadeParagraphFormatting(table, undefined).runProperties).fontSizePt
    ).toBe(size / 2);
    expect(
      resolveRunStyle(
        cascadeParagraphFormatting(table, undefined, EMPTY_TABLE_CELL_STYLE_FORMATTING)
          .runProperties
      ).fontSizePt
    ).toBe(size / 2);
  }
});

test('derived styles, non-default sizes and direct run formatting keep their priority', () => {
  const table = buildStyleCascadeTable(styles());
  const cell = cascadeParagraphFormatting(table, ppr('Derived'), cellStyle);
  expect(resolveRunStyle(cell.runProperties).fontSizePt).toBe(12);
  expect(
    resolveRunStyle(
      cascadeRunProperties(
        cell.runProperties,
        [{ localName: 'sz', attributes: { val: '28' } }],
        table
      )
    ).fontSizePt
  ).toBe(14);
  expect(
    resolveRunStyle(
      cascadeParagraphFormatting(buildStyleCascadeTable(styles(26)), undefined, cellStyle)
        .runProperties
    ).fontSizePt
  ).toBe(13);
});

test('the compatibility opt-in is namespace scoped and participates in warm layout invalidation', () => {
  const legacy = buildStyleCascadeTable(styles());
  for (const value of ['1', 'true', 'on']) {
    const strict = buildStyleCascadeTable(styles(), undefined, settings(value));
    expect(strict.cacheToken).not.toBe(legacy.cacheToken);
    const cell = cascadeParagraphFormatting(strict, undefined, cellStyle);
    expect(resolveRunStyle(cell.runProperties).fontSizePt).toBe(12);
    expect(paragraphAlignment(cell.paragraphProperties)).toBe('left');
  }
  expect(
    buildStyleCascadeTable(styles(), undefined, settings('true', 'urn:unrelated')).cacheToken
  ).toBe(legacy.cacheToken);
  const source = read(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblStyle w:val="Sized"/><w:tblW w:w="3000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Table text</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const measurer = createFixedMeasurer(6, 12);
  const strict = buildStyleCascadeTable(styles(), undefined, settings('1'));
  for (const [revision, styleCascade] of [legacy, strict, legacy].entries()) {
    const options = { measurer, styleCascade };
    const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
    expect(warm.pages).toEqual(layoutSemanticDocument(source, revision, options).pages);
    expect(
      warm.pages
        .flatMap((page) => page.fragments)
        .flatMap((block) =>
          block.kind === 'table'
            ? block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
            : []
        )
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
        .flatMap((line) => line.spans)
        .find((span) => span.text.includes('Table'))!.style.fontSizePt
    ).toBe(styleCascade === strict ? 12 : 9);
  }
});

test('an absent lower-level size does not erase the document default style size', () => {
  const root = read(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>`
  ).root;
  const table = buildStyleCascadeTable(root);
  expect(
    resolveRunStyle(
      cascadeParagraphFormatting(table, undefined, EMPTY_TABLE_CELL_STYLE_FORMATTING).runProperties
    ).fontSizePt
  ).toBe(11);
});

const probeStyles = (tableStyles: string) =>
  read(`<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableNormal" w:default="1"><w:name w:val="Normal Table"/></w:style>
  ${tableStyles}
  </w:styles>`).root;
const probeSettings = (mode: number, strict: boolean) =>
  read(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/>${
      strict
        ? '<w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>'
        : ''
    }</w:compat></w:settings>`
  ).root;
const probeDocument = (tblPr: string, rows = 1) =>
  read(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Body text</w:t></w:r></w:p><w:tbl><w:tblPr>${tblPr}<w:tblW w:w="3000" w:type="dxa"/><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>${'<w:tr><w:tc><w:p><w:r><w:t>Table text</w:t></w:r></w:p></w:tc></w:tr>'.repeat(rows)}</w:tbl><w:p/></w:body></w:document>`
  );
const probeSizes = (
  source: ReturnType<typeof read>,
  styleCascade: ReturnType<typeof buildStyleCascadeTable>
) => {
  const pages = layoutSemanticDocument(source, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade,
  }).pages;
  const spans = pages
    .flatMap((page) => page.fragments)
    .flatMap((block) =>
      block.kind === 'table'
        ? block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
        : [block]
    )
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans);
  return {
    body: spans.find((span) => span.text.includes('Body'))!.style.fontSizePt,
    table: spans.filter((span) => span.text.includes('Table')).map((span) => span.style.fontSizePt),
  };
};

test('a table style without a size keeps the default paragraph style size in every mode', () => {
  const unsized = '<w:style w:type="table" w:styleId="Probe"><w:name w:val="Probe"/></w:style>';
  for (const mode of [12, 15]) {
    for (const strict of [false, true]) {
      const cascade = buildStyleCascadeTable(
        probeStyles(unsized),
        undefined,
        probeSettings(mode, strict)
      );
      for (const tblPr of ['', '<w:tblStyle w:val="Probe"/>']) {
        expect(probeSizes(probeDocument(tblPr), cascade)).toEqual({ body: 12, table: [12] });
      }
    }
  }
});

test('a legacy table style size replaces the default paragraph style size unless opted out', () => {
  const sized =
    '<w:style w:type="table" w:styleId="Probe"><w:name w:val="Probe"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style>';
  const document = probeDocument('<w:tblStyle w:val="Probe"/>');
  const legacy = buildStyleCascadeTable(probeStyles(sized), undefined, probeSettings(12, false));
  expect(probeSizes(document, legacy)).toEqual({ body: 12, table: [9] });
  for (const mode of [12, 15]) {
    const strict = buildStyleCascadeTable(probeStyles(sized), undefined, probeSettings(mode, true));
    expect(probeSizes(document, strict)).toEqual({ body: 12, table: [12] });
  }
});

test('inherited and conditional table style sizes count as table style sizes', () => {
  const inherited = `<w:style w:type="table" w:styleId="Base"><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="Probe"><w:basedOn w:val="Base"/></w:style>`;
  const legacy = buildStyleCascadeTable(
    probeStyles(inherited),
    undefined,
    probeSettings(12, false)
  );
  expect(probeSizes(probeDocument('<w:tblStyle w:val="Probe"/>'), legacy)).toEqual({
    body: 12,
    table: [9],
  });
  const conditional = `<w:style w:type="table" w:styleId="Probe"><w:tblStylePr w:type="firstRow"><w:rPr><w:sz w:val="20"/></w:rPr></w:tblStylePr></w:style>`;
  const headed = buildStyleCascadeTable(
    probeStyles(conditional),
    undefined,
    probeSettings(12, false)
  );
  // A condition that states run formatting makes the style state it for every row: the
  // second row takes the document default size, not the default paragraph style's.
  expect(probeSizes(probeDocument('<w:tblStyle w:val="Probe"/>', 2), headed)).toEqual({
    body: 12,
    table: [10, 11],
  });
});
