// Bounded layout-side style cascade (docDefaults, basedOn, last-wins duplicates).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  MAX_STYLE_BASED_ON_DEPTH,
  MAX_STYLE_DEFINITIONS,
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  cascadeTableFormatting,
  cascadedBottomBorder,
  tableCellStyleFormatting,
  isValidStyleId,
} from '../style-cascade.ts';
import { resolveRunStyle } from '../run-style.ts';
import { formatRevisionOf } from '../revision-projection.ts';
import { paragraphSpacing } from '../paragraph-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadStyles(body: string): OoxmlElement {
  const result = readOoxmlPart(`<w:styles xmlns:w="${W}">${body}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function loadDocument(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphPPr(body: string) {
  return loadDocument(body).root.children[0]!.children[0]!.children.find(
    (child) => child.kind === 'paragraphProperties'
  );
}

const HEADING1_FIRST =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:rPr><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr></w:style>`;

const HEADING1_LAST =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:before="360" w:after="200"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/>` +
  `<w:color w:val="1B3A5C"/><w:sz w:val="36"/></w:rPr></w:style>`;

const HEADING2_LAST =
  `<w:style w:type="paragraph" w:styleId="Heading2">` +
  `<w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:before="280" w:after="160"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Arial"/><w:b/>` +
  `<w:color w:val="2E75B6"/><w:sz w:val="30"/></w:rPr></w:style>`;

const DOC_DEFAULTS =
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Arial"/><w:sz w:val="22"/>` +
  `</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>`;

describe('isValidStyleId guards attacker-controlled ids', () => {
  test('rejects empty, over-long, control, and dangerous keys', () => {
    expect(isValidStyleId(undefined)).toBe(false);
    expect(isValidStyleId('')).toBe(false);
    expect(isValidStyleId('a'.repeat(129))).toBe(false);
    expect(isValidStyleId('bad\nid')).toBe(false);
    expect(isValidStyleId('__proto__')).toBe(false);
    expect(isValidStyleId('constructor')).toBe(false);
    expect(isValidStyleId('Heading1')).toBe(true);
  });
});

describe('a restyled STYLE definition is not a format change on every span', () => {
  test("the style's rPrChange record stays out of the cascade; a run's own survives", () => {
    // Editing a style with tracking on writes `w:rPrChange` INSIDE the style's `rPr`.
    // Cascaded into span property lists it read as "this text's formatting is a pending
    // decision" on every span of every paragraph using the style — a whole document marked
    // grey over one style edit. The record is about the STYLE; only the formatting flows.
    const table = buildStyleCascadeTable(
      loadStyles(
        `<w:style w:type="paragraph" w:styleId="Normal" w:default="1">` +
          `<w:name w:val="Normal"/>` +
          `<w:rPr><w:b/><w:rPrChange w:id="0" w:author="Author" ` +
          `w:date="2026-07-07T20:18:00Z"><w:rPr/></w:rPrChange></w:rPr></w:style>`
      )
    );
    const part = loadDocument(
      `<w:p><w:r><w:t xml:space="preserve">plain </w:t></w:r>` +
        `<w:r><w:rPr><w:i/><w:rPrChange w:id="77" w:author="Author" ` +
        `w:date="2026-07-07T20:18:00Z"><w:rPr/></w:rPrChange></w:rPr>` +
        `<w:t>changed</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      styleCascade: table,
    });
    const spans = linesOf(layout).flatMap((line) => line.spans);
    const marks = spans.map((span) => formatRevisionOf(span.props));
    // The plain run inherits the style but is NOT a tracked format change…
    expect(marks[0]).toBeNull();
    // …while the style's actual FORMATTING still cascades.
    expect(spans[0]!.style.bold).toBe(true);
    // A run's own rPrChange keeps its own attribution, not the style's.
    expect(marks[1]?.id).toBe('77');
  });
});

describe('buildStyleCascadeTable last-wins and docDefaults', () => {
  test('explicit outline levels win over English names while localized names remain neutral', () => {
    const table = buildStyleCascadeTable(
      loadStyles(
        '<w:style w:type="paragraph" w:styleId="Conflict"><w:name w:val="Heading 1"/>' +
          '<w:pPr><w:outlineLvl w:val="4"/></w:pPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Demoted"><w:name w:val="Heading 2"/>' +
          '<w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Localized"><w:name w:val="Titre 2"/></w:style>'
      )
    );
    expect(table.styles.get('Conflict')?.outlineLevel).toBe(4);
    expect(table.styles.get('Demoted')?.outlineLevel).toBeNull();
    expect(table.styles.get('Localized')?.outlineLevel).toBeNull();
  });

  test('duplicate Heading1 keeps the last definition', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_FIRST + HEADING1_LAST));
    const style = table.styles.get('Heading1')!;
    expect(resolveRunStyle(style.runProperties)).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 18,
      bold: true,
      color: '1B3A5C',
    });
    expect(paragraphSpacing(style.paragraphProperties)).toEqual({ before: 18, after: 10 });
  });

  test('docDefaults populate the table', () => {
    const table = buildStyleCascadeTable(loadStyles(DOC_DEFAULTS));
    expect(resolveRunStyle(table.docDefaultsRun)).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 11,
    });
  });

  test('duplicate last-wins also for default flags', () => {
    const twoDefaults =
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="20"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Body">` +
      `<w:rPr><w:sz w:val="28"/></w:rPr></w:style>`;
    expect(buildStyleCascadeTable(loadStyles(twoDefaults)).defaultParagraphStyleId).toBe('Body');

    const bodyClearsDefault =
      twoDefaults +
      `<w:style w:type="paragraph" w:styleId="Body">` +
      `<w:rPr><w:sz w:val="32"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(bodyClearsDefault));
    // Last Body definition dropped the default flag, so no default paragraph remains.
    expect(table.defaultParagraphStyleId).toBeNull();
    expect(resolveRunStyle(table.styles.get('Body')!.runProperties).fontSizePt).toBe(16);
  });

  test('hostile style ids are dropped, not stored', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="__proto__">` +
      `<w:rPr><w:sz w:val="40"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Safe">` +
      `<w:basedOn w:val="constructor"/>` +
      `<w:rPr><w:sz w:val="24"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    expect(table.styles.has('__proto__')).toBe(false);
    expect(table.styles.get('Safe')!.basedOn).toBeNull();
  });
});

describe('default paragraph style when pStyle is absent', () => {
  test('applies w:default paragraph style to bare paragraphs', () => {
    const styles =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:pPr><w:spacing w:before="120" w:after="80"/></w:pPr>` +
      `<w:rPr><w:color w:val="336699"/><w:sz w:val="26"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    expect(table.defaultParagraphStyleId).toBe('Normal');
    const cascaded = cascadeParagraphFormatting(table, undefined);
    expect(paragraphSpacing(cascaded.paragraphProperties)).toEqual({ before: 6, after: 4 });
    expect(resolveRunStyle(cascaded.runProperties)).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 13,
      color: '336699',
    });
  });

  test('explicit pStyle still wins over the default paragraph style', () => {
    const styles =
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="20"/><w:color w:val="111111"/></w:rPr></w:style>` +
      HEADING1_LAST;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const cascaded = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    );
    expect(resolveRunStyle(cascaded.runProperties)).toMatchObject({
      fontSizePt: 18,
      color: '1B3A5C',
      bold: true,
    });
  });
});

describe('character rStyle cascade and default character style', () => {
  test('the default character style contributes nothing, named or not', () => {
    const styles =
      `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">` +
      `<w:rPr><w:color w:val="AA5500"/><w:sz w:val="40"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    expect(table.defaultCharacterStyleId).toBe('DefaultParagraphFont');
    const inherited = [{ localName: 'sz', attributes: { val: '18' } }];
    for (const direct of [
      [],
      [{ localName: 'rStyle', attributes: { val: 'DefaultParagraphFont' } }],
    ]) {
      const style = resolveRunStyle(cascadeRunProperties(inherited, direct, table));
      expect(style.fontSizePt).toBe(9);
      expect(style.color ?? null).toBeNull();
    }
  });

  test('a character style based on the default one applies only its own properties', () => {
    const styles =
      `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">` +
      `<w:rPr><w:color w:val="AA5500"/><w:sz w:val="40"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Strong"><w:basedOn w:val="DefaultParagraphFont"/>` +
      `<w:rPr><w:b/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const style = resolveRunStyle(
      cascadeRunProperties(
        [{ localName: 'sz', attributes: { val: '18' } }],
        [{ localName: 'rStyle', attributes: { val: 'Strong' } }],
        table
      )
    );
    expect(style).toMatchObject({ fontSizePt: 9, bold: true });
    expect(style.color ?? null).toBeNull();
  });

  test('explicit rStyle basedOn chain with direct formatting precedence', () => {
    const styles =
      `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">` +
      `<w:rPr><w:color w:val="000000"/><w:sz w:val="20"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="BaseChar"><w:basedOn w:val="DefaultParagraphFont"/>` +
      `<w:rPr><w:i/><w:sz w:val="28"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Emph"><w:basedOn w:val="BaseChar"/>` +
      `<w:rPr><w:color w:val="CC0000"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const merged = cascadeRunProperties(
      [{ localName: 'rFonts', attributes: { ascii: 'Arial' } }],
      [
        { localName: 'rStyle', attributes: { val: 'Emph' } },
        { localName: 'sz', attributes: { val: '40' } },
      ],
      table
    );
    expect(resolveRunStyle(merged)).toMatchObject({
      fontFamily: 'Arial',
      italic: true,
      color: 'CC0000',
      fontSizePt: 20, // direct wins over BaseChar's 14pt
    });
  });

  test('a run with no character style and no direct rPr keeps the inherited list by identity', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_LAST));
    const inherited = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    ).runProperties;
    expect(cascadeRunProperties(inherited, [], table)).toBe(inherited);
  });

  test('rStyle cycles stop without hanging', () => {
    const styles =
      `<w:style w:type="character" w:styleId="A"><w:basedOn w:val="B"/>` +
      `<w:rPr><w:sz w:val="30"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="B"><w:basedOn w:val="A"/>` +
      `<w:rPr><w:color w:val="00AA00"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const merged = cascadeRunProperties(
      [],
      [{ localName: 'rStyle', attributes: { val: 'A' } }],
      table
    );
    expect(resolveRunStyle(merged)).toMatchObject({ fontSizePt: 15, color: '00AA00' });
  });

  test('paragraph-typed style named by rStyle contributes nothing', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="Heading1">` +
      `<w:rPr><w:sz w:val="48"/><w:color w:val="FF0000"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const merged = cascadeRunProperties(
      [],
      [
        { localName: 'rStyle', attributes: { val: 'Heading1' } },
        { localName: 'sz', attributes: { val: '22' } },
      ],
      table
    );
    expect(resolveRunStyle(merged)).toMatchObject({ fontSizePt: 11, color: null });
  });
});

describe('paragraph-mark rPr does not size content runs', () => {
  test('direct w:pPr/w:rPr sz stays on the mark cascade only', () => {
    const styles =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:styleId="BodyText"><w:basedOn w:val="Normal"/>` +
      `<w:rPr><w:sz w:val="20"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const cascaded = cascadeParagraphFormatting(
      table,
      paragraphPPr(
        `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:rPr><w:sz w:val="13"/></w:rPr></w:pPr>` +
          `<w:r><w:t>next Interest Period</w:t></w:r></w:p>`
      )
    );
    expect(resolveRunStyle(cascaded.runProperties).fontSizePt).toBe(10);
    expect(resolveRunStyle(cascaded.markRunProperties).fontSizePt).toBe(6.5);
  });

  test('layout paints BodyText size when content runs omit sz and the mark is 13 half-points', () => {
    const styles =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:styleId="BodyText"><w:basedOn w:val="Normal"/>` +
      `<w:rPr><w:sz w:val="20"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:rPr><w:sz w:val="13"/></w:rPr></w:pPr>` +
        `<w:r><w:t>[We request that the next Interest Period</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      styleCascade: table,
    });
    expect(linesOf(layout)[0]!.spans[0]!.style.fontSizePt).toBe(10);
  });

  test('list marker resolution reads markRunProperties and keeps level rPr last', () => {
    const numberingBody =
      `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
      `<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
      `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>`;
    const numberingWithLevelRpr = (rPr: string) => {
      const result = readOoxmlPart(
        `<w:numbering xmlns:w="${W}">${numberingBody}${rPr}</w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
        { name: '/word/numbering.xml', contentType: 'app/xml' }
      );
      if (!result.ok) throw new Error(result.reason);
      return buildNumberingIndex(result.part.root);
    };
    const styles =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:styleId="BodyText"><w:basedOn w:val="Normal"/>` +
      `<w:rPr><w:sz w:val="20"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const listParagraph =
      `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` +
      `<w:rPr><w:sz w:val="52"/><w:b/><w:u w:val="single"/></w:rPr></w:pPr>` +
      `<w:r><w:t>BIG</w:t></w:r></w:p>`;
    const part = loadDocument(listParagraph);
    const paragraph = part.root.children.find((child) => child.localName === 'body')!.children[0]!;

    const fromMark = resolveStoryListItems([paragraph], numberingWithLevelRpr(''), table).get(
      paragraph.id
    )!;
    expect(fromMark.markerStyle.fontSizePt).toBe(26);
    expect(fromMark.markerStyle.bold).toBe(true);
    // The mark's underline never reaches the number; only the level's own does.
    expect(fromMark.markerStyle.underline?.variant ?? 'none').toBe('none');

    const fromLevel = resolveStoryListItems(
      [paragraph],
      numberingWithLevelRpr('<w:rPr><w:sz w:val="20"/><w:u w:val="double"/></w:rPr>'),
      table
    ).get(paragraph.id)!;
    expect(fromLevel.markerStyle.fontSizePt).toBe(10);
    expect(fromLevel.markerStyle.bold).toBe(true);
    expect(fromLevel.markerStyle.underline?.variant).toBe('double');
  });
});

describe('cascadeParagraphFormatting basedOn, cycles, depth, overrides', () => {
  test('basedOn inherits parent size while own color wins', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="Base">` +
      `<w:rPr><w:sz w:val="40"/><w:color w:val="111111"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/>` +
      `<w:rPr><w:color w:val="AABBCC"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const cascaded = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    );
    expect(resolveRunStyle(cascaded.runProperties)).toMatchObject({
      fontSizePt: 20,
      color: 'AABBCC',
    });
  });

  test('basedOn cycles stop without hanging', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/>` +
      `<w:rPr><w:sz w:val="30"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/>` +
      `<w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const cascaded = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    );
    expect(resolveRunStyle(cascaded.runProperties)).toMatchObject({
      fontSizePt: 15,
      color: 'FF0000',
    });
  });

  test('basedOn depth is capped', () => {
    const parts: string[] = [];
    for (let i = 0; i <= MAX_STYLE_BASED_ON_DEPTH + 4; i += 1) {
      const id = `S${i}`;
      const based = i === 0 ? '' : `<w:basedOn w:val="S${i - 1}"/>`;
      const sz = 20 + i;
      parts.push(
        `<w:style w:type="paragraph" w:styleId="${id}">${based}` +
          `<w:rPr><w:sz w:val="${sz}"/></w:rPr></w:style>`
      );
    }
    const tip = `S${MAX_STYLE_BASED_ON_DEPTH + 4}`;
    const table = buildStyleCascadeTable(loadStyles(parts.join('')));
    const cascaded = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="${tip}"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    );
    expect(cascaded.runProperties.some((property) => property.localName === 'sz')).toBe(true);
    const size = resolveRunStyle(cascaded.runProperties).fontSizePt;
    expect(size).toBeGreaterThan(0);
    expect(size).not.toBe(10);
  });

  test('direct run formatting overrides inherited style', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_LAST));
    const inherited = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    ).runProperties;
    const merged = cascadeRunProperties(inherited, [
      { localName: 'sz', attributes: { val: '24' } },
      { localName: 'color', attributes: { val: '00FF00' } },
    ]);
    expect(resolveRunStyle(merged)).toMatchObject({
      fontFamily: 'Arial',
      bold: true,
      fontSizePt: 12,
      color: '00FF00',
    });
  });

  test('direct paragraph spacing overrides style spacing', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_LAST));
    const cascaded = cascadeParagraphFormatting(
      table,
      paragraphPPr(
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/>` +
          `<w:spacing w:before="40" w:after="60"/></w:pPr>` +
          `<w:r><w:t>x</w:t></w:r></w:p>`
      )
    );
    expect(paragraphSpacing(cascaded.paragraphProperties)).toEqual({ before: 2, after: 3 });
  });

  test('cascaded bottom border inherits from style unless direct pBdr wins', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="Ruled">` +
      `<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="24" w:color="FF0000" w:space="4"/>` +
      `</w:pBdr></w:pPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const styled = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Ruled"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    );
    expect(cascadedBottomBorder(styled.paragraphPropertyNodes)).toMatchObject({
      color: 'FF0000',
      widthPt: 3,
      spacePt: 4,
    });
  });
});

describe('bounded cacheToken fingerprint', () => {
  test('cacheToken is a bounded hex fingerprint, not the full styles dump', () => {
    const many: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      many.push(
        `<w:style w:type="paragraph" w:styleId="S${i}">` +
          `<w:rPr><w:sz w:val="${20 + (i % 40)}"/><w:color w:val="${(0x100000 + i)
            .toString(16)
            .slice(-6)
            .toUpperCase()}"/></w:rPr></w:style>`
      );
    }
    const table = buildStyleCascadeTable(loadStyles(many.join('')));
    expect(table.styles.size).toBe(200);
    expect(table.cacheToken).toMatch(/^[0-9a-f]{16}$/);
    expect(table.cacheToken.length).toBe(16);
  });

  test('identical tables share a token; a property change invalidates', () => {
    const base =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="22"/><w:color w:val="111111"/></w:rPr></w:style>`;
    const a = buildStyleCascadeTable(loadStyles(base));
    const b = buildStyleCascadeTable(loadStyles(base));
    expect(a.cacheToken).toBe(b.cacheToken);

    const changed =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="22"/><w:color w:val="222222"/></w:rPr></w:style>`;
    const c = buildStyleCascadeTable(loadStyles(changed));
    expect(c.cacheToken).not.toBe(a.cacheToken);
  });

  test('table, row, and conditional style properties each invalidate the token', () => {
    const tableStyle = (tblWidth: string, header: string, conditionalHeader: string) =>
      `<w:style w:type="table" w:styleId="Grid">` +
      `<w:tblPr><w:tblW w:type="dxa" w:w="${tblWidth}"/></w:tblPr>` +
      `<w:trPr><w:tblHeader w:val="${header}"/></w:trPr>` +
      `<w:tblStylePr w:type="firstRow"><w:trPr>` +
      `<w:tblHeader w:val="${conditionalHeader}"/></w:trPr></w:tblStylePr>` +
      '</w:style>';
    const base = buildStyleCascadeTable(loadStyles(tableStyle('2400', 'off', 'off')));
    const same = buildStyleCascadeTable(loadStyles(tableStyle('2400', 'off', 'off')));
    const changedTable = buildStyleCascadeTable(loadStyles(tableStyle('4800', 'off', 'off')));
    const styledHeader = buildStyleCascadeTable(loadStyles(tableStyle('2400', 'on', 'off')));
    const conditionalHeader = buildStyleCascadeTable(loadStyles(tableStyle('2400', 'off', 'on')));

    expect(same.cacheToken).toBe(base.cacheToken);
    expect(changedTable.cacheToken).not.toBe(base.cacheToken);
    expect(styledHeader.cacheToken).not.toBe(base.cacheToken);
    expect(conditionalHeader.cacheToken).not.toBe(base.cacheToken);
  });

  test('layout cache misses after styles change via producer token', () => {
    const measurer = createFixedMeasurer(6, 14);
    const cache = createParagraphLayoutCache<never>();
    const part = loadDocument(`<w:p><w:r><w:t>body</w:t></w:r></w:p>`);
    const stylesA =
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="22"/></w:rPr></w:style>`;
    const stylesB =
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:sz w:val="44"/></w:rPr></w:style>`;
    const tableA = buildStyleCascadeTable(loadStyles(stylesA));
    const tableB = buildStyleCascadeTable(loadStyles(stylesB));
    expect(tableA.cacheToken).not.toBe(tableB.cacheToken);

    const first = layoutSemanticDocument(part, 1, {
      measurer,
      styleCascade: tableA,
      cache,
    });
    const second = layoutSemanticDocument(part, 2, {
      measurer,
      styleCascade: tableB,
      cache,
    });
    expect(linesOf(first)[0]!.spans[0]!.style.fontSizePt).toBe(11);
    expect(linesOf(second)[0]!.spans[0]!.style.fontSizePt).toBe(22);
  });

  test('definition count is capped', () => {
    const parts: string[] = [];
    for (let i = 0; i < MAX_STYLE_DEFINITIONS + 10; i += 1) {
      parts.push(
        `<w:style w:type="paragraph" w:styleId="X${i}"><w:rPr><w:sz w:val="20"/></w:rPr></w:style>`
      );
    }
    const table = buildStyleCascadeTable(loadStyles(parts.join('')));
    expect(table.styles.size).toBe(MAX_STYLE_DEFINITIONS);
  });
});

describe('layout applies Heading1 / Heading2 cascade', () => {
  const measurer = createFixedMeasurer(6, 14);

  test('Heading1 fixture: Arial bold 18pt #1B3A5C with spacing 18/10', () => {
    const table = buildStyleCascadeTable(
      loadStyles(DOC_DEFAULTS + HEADING1_FIRST + HEADING1_LAST + HEADING2_LAST)
    );
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
        `<w:r><w:t>Table of Contents</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    const [line] = linesOf(layout);
    const span = line!.spans[0]!;
    expect(span.style).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 18,
      bold: true,
      color: '1B3A5C',
    });
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind === 'paragraph') {
      expect(fragment.spacing).toEqual({ before: 18, after: 10 });
      expect(fragment.box.y).toBe(0);
      expect(fragment.lines[0]!.box.y).toBe(18);
    }
  });

  test('sibling Heading2 last-wins values', () => {
    const table = buildStyleCascadeTable(
      loadStyles(
        `<w:style w:type="paragraph" w:styleId="Heading2">` +
          `<w:rPr><w:color w:val="000000"/><w:sz w:val="20"/></w:rPr></w:style>` +
          HEADING2_LAST
      )
    );
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Section</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 15,
      bold: true,
      color: '2E75B6',
    });
  });

  test('docDefaults apply to bare runs with no pStyle', () => {
    const table = buildStyleCascadeTable(loadStyles(DOC_DEFAULTS));
    const part = loadDocument(`<w:p><w:r><w:t>body</w:t></w:r></w:p>`);
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 11,
    });
  });

  test('the default paragraph style reaches layout, and the default character style does not', () => {
    const styles =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:rPr><w:color w:val="102030"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">` +
      `<w:rPr><w:i/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const part = loadDocument(`<w:p><w:r><w:t>plain</w:t></w:r></w:p>`);
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 11,
      color: '102030',
      italic: false,
    });
  });

  test('a pStyle naming a character style or no style applies the default paragraph style', () => {
    const styles =
      DOC_DEFAULTS +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:color w:val="102030"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Strong"><w:rPr><w:b/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    for (const named of ['Strong', 'Missing']) {
      const cascaded = cascadeParagraphFormatting(
        table,
        paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="${named}"/></w:pPr></w:p>`)
      );
      expect(paragraphSpacing(cascaded.paragraphProperties).after).toBe(8);
      const run = cascaded.runProperties.find((property) => property.localName === 'color');
      expect(run?.attributes?.val).toBe('102030');
      expect(cascaded.runProperties.some((property) => property.localName === 'b')).toBe(false);
      // Contextual spacing compares it as a default-style paragraph.
      expect(cascaded.styleId).toBe('Normal');
    }
  });

  test('rStyle in a run reaches layout with direct override', () => {
    const styles =
      DOC_DEFAULTS +
      `<w:style w:type="character" w:styleId="Strong">` +
      `<w:rPr><w:b/><w:color w:val="990000"/><w:sz w:val="28"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const part = loadDocument(
      `<w:p><w:r><w:rPr><w:rStyle w:val="Strong"/><w:sz w:val="20"/></w:rPr>` +
        `<w:t>emph</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      bold: true,
      color: '990000',
      fontSizePt: 10,
    });
  });

  test('direct run rPr still wins over Heading1', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_LAST));
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
        `<w:r><w:rPr><w:sz w:val="20"/><w:color w:val="00AA00"/></w:rPr>` +
        `<w:t>mixed</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      fontFamily: 'Arial',
      bold: true,
      fontSizePt: 10,
      color: '00AA00',
    });
  });
});

describe('the eastAsia font slot cascades from docDefaults to the painted spans', () => {
  // The docDefaults case is the one that bit: Word's own templates author the body's CJK
  // face as `w:eastAsiaTheme="minorEastAsia"` in `w:docDefaults/w:rPrDefault`, and no run
  // in the document ever re-states it. Dropping it measured and painted every ideograph
  // in the LATIN face.
  const THEME_FONTS = {
    major: 'Aharoni',
    minor: 'Grandview',
    majorEastAsia: null,
    minorEastAsia: 'SimSun',
  };
  const THEMED_DEFAULTS =
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="22"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>`;

  test('docDefaults resolve both slots through the theme part', () => {
    const table = buildStyleCascadeTable(loadStyles(THEMED_DEFAULTS), THEME_FONTS);
    expect(resolveRunStyle(table.docDefaultsRun, table.themeFonts)).toMatchObject({
      fontFamily: 'Grandview',
      fontFamilyEastAsia: 'SimSun',
    });
  });

  test('a Latin-only direct rFonts does not evict the inherited eastAsia face', () => {
    const table = buildStyleCascadeTable(loadStyles(THEMED_DEFAULTS), THEME_FONTS);
    const merged = cascadeRunProperties(
      [],
      [{ localName: 'rFonts', attributes: { ascii: 'Courier New' } }],
      table
    );
    expect(resolveRunStyle([...table.docDefaultsRun, ...merged], table.themeFonts)).toMatchObject({
      fontFamily: 'Courier New',
      fontFamilyEastAsia: 'SimSun',
    });
  });

  test('a mixed CJK+Latin run splits into slot-homogeneous spans, measured per face', () => {
    const table = buildStyleCascadeTable(loadStyles(THEMED_DEFAULTS), THEME_FONTS);
    const measured: { text: string; family: string | null }[] = [];
    const fixed = createFixedMeasurer(6, 14);
    const recording = {
      measure: (text: string, style: Parameters<typeof fixed.measure>[1]) => {
        measured.push({ text, family: style.fontFamily });
        return fixed.measure(text, style);
      },
      lineMetrics: fixed.lineMetrics,
    };
    const part = loadDocument(`<w:p><w:r><w:t>甲方shall</w:t></w:r></w:p>`);
    const layout = layoutSemanticDocument(part, 1, {
      measurer: recording,
      styleCascade: table,
    });
    const spans = linesOf(layout).flatMap((line) => line.spans);
    expect(spans.map((span) => span.text)).toEqual(['甲方', 'shall']);
    // The span keeps the run's REAL resolution — both faces — and carries the slot
    // beside it; the face swap happens at the measurer/paint boundary. Formatting
    // readback and the format painter therefore see one Latin answer for both spans.
    expect(spans[0]!.fontSlot).toBe('eastAsia');
    expect(spans[1]!.fontSlot).toBeUndefined();
    expect(spans[0]!.style).toBe(spans[1]!.style);
    expect(spans[0]!.style.fontFamily).toBe('Grandview');
    expect(spans[0]!.style.fontFamilyEastAsia).toBe('SimSun');
    // Model offsets stay contiguous across the split, so the caret walks through it.
    expect(spans[0]!.range.end).toBe(spans[1]!.range.start);
    // The measurer saw the CJK text only under the eastAsia face, never the Latin one.
    const families = new Set(
      measured.filter((call) => call.text.includes('甲')).map((call) => call.family)
    );
    expect(families).toEqual(new Set(['SimSun']));
  });
});

describe('cache token theme material', () => {
  test.each([true, false])(
    'undefined theme faces still key the table (styles: %s)',
    (withStyles) => {
      // A theme part with no East Asian, complex-script, or supplemental scheme hands the
      // cascade `undefined` for those faces. The comparator behind the cache token refuses
      // `undefined`, which once failed layout for every such document.
      const sparse = {
        major: 'Aptos Display',
        minor: 'Aptos',
        majorEastAsia: undefined,
        minorEastAsia: undefined,
        majorBidi: undefined,
        minorBidi: undefined,
        majorSupplemental: undefined,
        minorSupplemental: undefined,
      };
      const styles = withStyles ? loadStyles(DOC_DEFAULTS) : null;
      const table = buildStyleCascadeTable(styles, sparse);
      expect(table.cacheToken).toMatch(/^[0-9a-f]{16}$/);
      // Absent and null mean the same theme, so they must share a token.
      const explicit = buildStyleCascadeTable(styles, {
        major: 'Aptos Display',
        minor: 'Aptos',
        majorEastAsia: null,
        minorEastAsia: null,
        majorBidi: null,
        minorBidi: null,
      });
      expect(explicit.cacheToken).toBe(table.cacheToken);
      // Normalization must keep every real face in the cache key.
      for (const slot of [
        'major',
        'minor',
        'majorEastAsia',
        'minorEastAsia',
        'majorBidi',
        'minorBidi',
      ]) {
        expect(
          buildStyleCascadeTable(styles, { ...sparse, [slot]: 'Fixture Font' }).cacheToken
        ).not.toBe(table.cacheToken);
      }
      for (const slot of ['majorSupplemental', 'minorSupplemental']) {
        expect(
          buildStyleCascadeTable(styles, { ...sparse, [slot]: { Jpan: 'Yu Mincho' } }).cacheToken
        ).not.toBe(table.cacheToken);
      }
    }
  );
});
