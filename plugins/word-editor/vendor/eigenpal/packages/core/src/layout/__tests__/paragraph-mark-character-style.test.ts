// A paragraph mark's `w:pPr/w:rPr/w:rStyle` character style.
//
// The style joins the mark's cascade at the character level: its `basedOn` chain sits between
// the paragraph style and the mark's direct properties, and its toggles combine by §17.7.3.
// It sizes an empty line (an empty paragraph, or the last line after a trailing break), formats
// a numbering marker, and gives text typed into an empty paragraph its face. It does NOT size a
// line that has content in it: in the anonymous probes behind this file, a 24pt mark under
// 12pt text grows neither a body line nor a table cell, whether the mark states the size
// directly or by style, and a line holding only an inline picture keeps its height too
// (`paragraph-mark-direct-size.test.ts` covers the direct size).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  TreeDocumentStore,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  buildNumberingIndex,
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  linesOf,
  resolveRunStyle,
  resolveStoryListItems,
  type SemanticLayout,
  type StyleCascadeTable,
  type TextMeasurer,
} from '../index.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { usedNumberingFontFamilies } from '../synthesized-font-families.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** Size-aware metrics: line height 1.15em, baseline 0.9em. */
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 }),
};
const line = (sizePt: number) => sizePt * 1.15;

function part(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const body = (content: string) =>
  part('/word/document.xml', `<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`);

// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

/** 12pt Normal; `Big` is a 24pt character style and `Child` inherits it through `basedOn`. */
function styles(extra = '', bigSize = 48): StyleCascadeTable {
  return buildStyleCascadeTable(
    part(
      '/word/styles.xml',
      `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}` +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
        '<w:rPr><w:sz w:val="24"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:default="1" w:styleId="DefaultFont"/>' +
        `<w:style w:type="character" w:styleId="Big"><w:basedOn w:val="DefaultFont"/>` +
        `<w:rPr><w:sz w:val="${bigSize}"/></w:rPr></w:style>` +
        '<w:style w:type="character" w:styleId="Child"><w:basedOn w:val="Big"/>' +
        '<w:rPr><w:color w:val="C00000"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="Small"><w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="Bold"><w:rPr><w:b/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="BoldPara"><w:basedOn w:val="Normal"/>' +
        '<w:rPr><w:b/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="AtLeast"><w:basedOn w:val="Normal"/>' +
        '<w:pPr><w:spacing w:line="260" w:lineRule="atLeast"/></w:pPr></w:style>' +
        extra +
        '</w:styles>'
    ).root
  );
}

const emptyWithMark = (mark: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:rPr>${mark}</w:rPr></w:pPr></w:p>`;
const text = (value: string, mark = '', pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:rPr>${mark}</w:rPr></w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;

function lineHeights(content: string, cascade = styles()): number[] {
  return linesOf(layoutSemanticDocument(body(content), 1, { measurer, styleCascade: cascade })).map(
    (record) => record.box.height
  );
}

function markOf(mark: string, cascade = styles(), pPr = '') {
  const paragraph = body(emptyWithMark(mark, pPr)).root.children[0] as OoxmlElement;
  const pPrNode = (paragraph.children[0] as OoxmlElement).children[0];
  return cascadeParagraphFormatting(cascade, pPrNode);
}

describe('an empty paragraph is sized by its mark character style', () => {
  test('a named style sizes the line the same as a direct size', () => {
    const [styled, direct, none] = lineHeights(
      emptyWithMark('<w:rStyle w:val="Big"/>') +
        emptyWithMark('<w:sz w:val="48"/>') +
        emptyWithMark('')
    );
    expect(styled).toBeCloseTo(line(24), 5);
    expect(direct).toBeCloseTo(line(24), 5);
    expect(none).toBeCloseTo(line(12), 5);
  });

  test('a smaller style shrinks the line below the paragraph style size', () => {
    expect(lineHeights(emptyWithMark('<w:rStyle w:val="Small"/>'))[0]).toBeCloseTo(line(10), 5);
  });

  test('basedOn inherits, and a direct size on the mark wins over the style', () => {
    const [child, override] = lineHeights(
      emptyWithMark('<w:rStyle w:val="Child"/>') +
        emptyWithMark('<w:rStyle w:val="Big"/><w:sz w:val="32"/>')
    );
    expect(child).toBeCloseTo(line(24), 5);
    expect(override).toBeCloseTo(line(16), 5);
  });

  test('missing, paragraph-type and cyclic style ids resolve safely', () => {
    const cyclic = styles(
      '<w:style w:type="character" w:styleId="LoopA"><w:basedOn w:val="LoopB"/>' +
        '<w:rPr><w:sz w:val="40"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="LoopB"><w:basedOn w:val="LoopA"/>' +
        '<w:rPr><w:sz w:val="36"/></w:rPr></w:style>'
    );
    const [missing, paragraphType, loop] = lineHeights(
      emptyWithMark('<w:rStyle w:val="NoSuchStyle"/>') +
        emptyWithMark('<w:rStyle w:val="BoldPara"/>') +
        emptyWithMark('<w:rStyle w:val="LoopA"/>'),
      cyclic
    );
    expect(missing).toBeCloseTo(line(12), 5);
    expect(paragraphType).toBeCloseTo(line(12), 5);
    // The walk stops at the first repeat; the tip is applied last, so its 20pt wins.
    expect(loop).toBeCloseTo(line(20), 5);
  });

  test('a mark with no rPr keeps the content array, and no rStyle adds no default style', () => {
    const bare = markOf('');
    expect(bare.markRunProperties).toBe(bare.runProperties);
    // The default character style states 24pt; a mark that names no style stays at 12pt.
    const withDefault = styles(
      '<w:style w:type="character" w:default="1" w:styleId="LargeDefault">' +
        '<w:rPr><w:sz w:val="48"/></w:rPr></w:style>'
    );
    const colored = markOf('<w:color w:val="00AA00"/>', withDefault);
    expect(resolveRunStyle(colored.markRunProperties).fontSizePt).toBe(12);
  });

  test('theme fonts in the mark style resolve through the theme', () => {
    const themed = buildStyleCascadeTable(
      part(
        '/word/styles.xml',
        `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="Themed">` +
          '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/></w:rPr>' +
          '</w:style></w:styles>'
      ).root,
      { major: 'Major Face', minor: 'Minor Face' }
    );
    const layout = layoutSemanticDocument(body(emptyWithMark('<w:rStyle w:val="Themed"/>')), 1, {
      measurer,
      styleCascade: themed,
    });
    const fragment = layout.pages[0]!.fragments[0]!;
    // The application default is the minor font, so only the style can name the major one.
    expect(fragment.kind === 'paragraph' && fragment.emptyParagraphStyle?.fontFamily).toBe(
      'Major Face'
    );
  });
});

describe('the mark character style follows the toggle rules', () => {
  test('a bold mark style over a bold paragraph style resolves to regular', () => {
    const xor = markOf('<w:rStyle w:val="Bold"/>', styles(), '<w:pStyle w:val="BoldPara"/>');
    expect(resolveRunStyle(xor.markRunProperties).bold).toBe(false);
    expect(resolveRunStyle(markOf('<w:rStyle w:val="Bold"/>').markRunProperties).bold).toBe(true);
  });
});

describe('a numbering marker takes the mark character style', () => {
  const numbering = buildNumberingIndex(
    part(
      '/word/numbering.xml',
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
        '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
        '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    ).root
  );
  const NUM = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

  test('size, basedOn colour, direct override and toggles', () => {
    const cascade = styles();
    const root = body(
      text('a', '<w:rStyle w:val="Big"/>', NUM) +
        text('b', '<w:rStyle w:val="Child"/>', NUM) +
        text('c', '<w:rStyle w:val="Big"/><w:sz w:val="32"/>', NUM) +
        text('d', '<w:rStyle w:val="Bold"/>', '<w:pStyle w:val="BoldPara"/>' + NUM) +
        text('e', '<w:rStyle w:val="NoSuchStyle"/>', NUM)
    ).root;
    const blocks = (root.children[0] as OoxmlElement).children as OoxmlElement[];
    const items = resolveStoryListItems(blocks, numbering, cascade);
    const marker = (index: number) => items.get(blocks[index]!.id)!.markerStyle;
    expect(marker(0).fontSizePt).toBe(24);
    expect([marker(1).fontSizePt, marker(1).color]).toEqual([24, 'C00000']);
    expect(marker(2).fontSizePt).toBe(16);
    expect(marker(3).bold).toBe(false);
    expect(marker(4).fontSizePt).toBe(12);
  });

  test('the font a mark style names is requested for the marker', () => {
    const numberingRoot = part(
      '/word/numbering.xml',
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
        '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
        '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    ).root;
    const stylesRoot = part(
      '/word/styles.xml',
      `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="Face">` +
        '<w:rPr><w:rFonts w:ascii="Marker Face" w:hAnsi="Marker Face"/></w:rPr></w:style></w:styles>'
    ).root;
    const families = usedNumberingFontFamilies(
      [body(text('a', '<w:rStyle w:val="Face"/>', NUM)).root],
      numberingRoot,
      stylesRoot,
      { major: null, minor: null, majorEastAsia: null, minorEastAsia: null }
    );
    expect(families).toContain('Marker Face');
  });
});

describe('a line with content does not grow from the mark character style', () => {
  test('body text keeps its line under a styled or a direct mark', () => {
    const [styled, direct, none] = lineHeights(
      text('styled', '<w:rStyle w:val="Big"/>') +
        text('direct', '<w:sz w:val="48"/>') +
        text('plain')
    );
    expect(styled).toBeCloseTo(line(12), 5);
    expect(none).toBeCloseTo(line(12), 5);
    expect(direct).toBeCloseTo(line(12), 5);
  });

  test('a table cell with text keeps its height; an empty cell grows', () => {
    const cell = (paragraph: string) =>
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr>`;
    const layout = layoutSemanticDocument(
      body(
        '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
          cell(text('plain')) +
          cell(text('styled', '<w:rStyle w:val="Big"/>')) +
          cell(emptyWithMark('<w:rStyle w:val="Big"/>')) +
          cell(emptyWithMark('')) +
          '</w:tbl>'
      ),
      1,
      { measurer, styleCascade: styles() }
    );
    const table = layout.pages[0]!.fragments[0]!;
    if (table.kind !== 'table') throw new Error('expected a table');
    const [plain, styled, emptyStyled, emptyPlain] = table.rows.map((row) => row.box.height);
    expect(styled).toBeCloseTo(plain!, 5);
    expect(emptyPlain).toBeCloseTo(plain!, 5);
    expect(emptyStyled! - emptyPlain!).toBeCloseTo(line(24) - line(12), 5);
  });
});

describe('a line with content ends where the mark character style stops', () => {
  const DRAWING_NS =
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  // A 10pt inline picture, smaller than the 12pt text band around it.
  const picture = (id: number) =>
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="127000" cy="127000"/><wp:docPr id="${id}" name="p${id}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="127000" cy="127000"/></a:xfrm><a:prstGeom prst="rect"/>' +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

  test('a line holding only an inline picture ignores the mark style', () => {
    // In the probe the picture line keeps the same height under no mark, a 24pt style mark
    // and an 8pt style mark, at single and double spacing.
    const heights = (spacing: string) => {
      const marks = ['', '<w:rStyle w:val="Big"/>', '<w:rStyle w:val="Small"/>'];
      const xml =
        `<w:document xmlns:w="${W}" ${DRAWING_NS}><w:body>` +
        marks
          .map(
            (mark, index) =>
              `<w:p><w:pPr>${spacing}<w:rPr>${mark}</w:rPr></w:pPr>${picture(index + 1)}</w:p>`
          )
          .join('') +
        '</w:body></w:document>';
      const document = load(xml);
      return linesOf(
        layoutSemanticDocument(document, 1, {
          measurer,
          styleCascade: styles(),
          inlineDrawingLayout: layoutContext(document),
        })
      ).map((record) => record.box.height);
    };
    const [none, big, small] = heights('<w:spacing w:line="480" w:lineRule="auto"/>');
    expect(none).toBeCloseTo(2 * line(12), 5);
    expect(big).toBeCloseTo(none!, 5);
    expect(small).toBeCloseTo(none!, 5);
    const [singleNone, singleBig] = heights('');
    expect(singleNone).toBeCloseTo(line(12), 5);
    expect(singleBig).toBeCloseTo(singleNone!, 5);
  });

  test('the empty last line after a trailing break takes the mark style', () => {
    // In the probe that line is as tall as the mark's style makes it, the same as a direct size.
    const broken = (mark: string) =>
      `<w:p><w:pPr><w:rPr>${mark}</w:rPr></w:pPr><w:r><w:t>text</w:t></w:r><w:r><w:br/></w:r></w:p>`;
    const [styledText, styledBreak, directText, directBreak] = lineHeights(
      broken('<w:rStyle w:val="Big"/>') + broken('<w:sz w:val="48"/>')
    );
    expect(styledText).toBeCloseTo(line(12), 5);
    expect(styledBreak).toBeCloseTo(line(24), 5);
    expect(directText).toBeCloseTo(line(12), 5);
    expect(directBreak).toBeCloseTo(line(24), 5);
  });

  test('a ligature compatibility rewrite of the mark keeps the style off a text line', () => {
    // No settings part: optional ligatures are off, so the mark list is rewritten after it
    // is resolved, and the unstyled mark has to be found under the rewritten list.
    const cascade = buildStyleCascadeTable(
      part(
        '/word/styles.xml',
        `<w:styles xmlns:w="${W}" xmlns:w14="${W14}">${FORMAT_DOC_DEFAULTS}` +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
          '<w:rPr><w:sz w:val="24"/><w14:ligatures w14:val="standard"/></w:rPr></w:style>' +
          '<w:style w:type="character" w:styleId="Big">' +
          '<w:rPr><w:sz w:val="48"/><w14:ligatures w14:val="all"/></w:rPr></w:style>' +
          '</w:styles>'
      ).root
    );
    expect(cascade.disableOptionalLigatures).toBe(true);
    const [textLine, emptyLine] = lineHeights(
      text('text', '<w:rStyle w:val="Big"/>') + emptyWithMark('<w:rStyle w:val="Big"/>'),
      cascade
    );
    expect(textLine).toBeCloseTo(line(12), 5);
    expect(emptyLine).toBeCloseTo(line(24), 5);
  });
});

describe('footer capacity', () => {
  test('an empty footer mark style shortens the footer and lengthens the body', () => {
    const footer = (mark: string) =>
      part(
        '/word/footer1.xml',
        `<w:ftr xmlns:w="${W}">` +
          emptyWithMark(mark, '<w:pStyle w:val="AtLeast"/>') +
          text('footer text', '<w:sz w:val="16"/>') +
          '</w:ftr>'
      );
    const cascade = styles();
    const height = (mark: string) =>
      layoutHeaderFooterStory(footer(mark), 400, measurer, 'test', undefined, cascade).flowHeight;
    // A 10pt mark line (11.5pt) falls under the 13pt at-least floor; a 12pt line (13.8pt) does not.
    expect(height('<w:rStyle w:val="Small"/>') - height('')).toBeCloseTo(13 - line(12), 5);
    expect(height('<w:rStyle w:val="Small"/>')).toBeCloseTo(height('<w:sz w:val="20"/>'), 5);
  });
});

describe('retained layout, editing and save', () => {
  const shapeOf = (layout: SemanticLayout) =>
    layout.pages.map((page) => page.fragments.map((fragment) => fragment.box));

  test('a changed mark style re-lays the paragraph out in a retained session', () => {
    const content = emptyWithMark('<w:rStyle w:val="Big"/>') + text('after');
    const options = {
      measurer,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(body(content), 1, { ...options, styleCascade: styles() });
    const warm = layoutSemanticDocument(body(content), 2, {
      ...options,
      styleCascade: styles('', 20),
    });
    const cold = layoutSemanticDocument(body(content), 2, {
      measurer,
      styleCascade: styles('', 20),
    });
    expect(shapeOf(warm)).toEqual(shapeOf(cold));
    expect(linesOf(warm)[0]!.box.height).toBeCloseTo(line(10), 5);
  });

  test('typing into the empty paragraph, then saving and reopening', () => {
    const cascade = styles();
    const store = new TreeDocumentStore(body(emptyWithMark('<w:rStyle w:val="Big"/>')));
    const options = { measurer, styleCascade: cascade, session: createLayoutSession() };
    expect(linesOf(layoutSemanticDocument(store.part, 1, options))[0]!.box.height).toBeCloseTo(
      line(24),
      5
    );
    const paragraph = (store.part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    const typed = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId: paragraph.id, offset: 0, text: 'typed' })
    );
    expect(typed.ok).toBe(true);
    // The typed text takes the mark's style, as in the probe, so the line keeps its height.
    expect(linesOf(layoutSemanticDocument(store.part, 2, options))[0]!.box.height).toBeCloseTo(
      line(24),
      5
    );
    const saved = serializeOoxmlPart(store.part);
    expect(saved).toContain('<w:r><w:rPr><w:rStyle w:val="Big"/></w:rPr><w:t>typed</w:t></w:r>');
    const reopened = layoutSemanticDocument(part('/word/document.xml', saved), 1, {
      measurer,
      styleCascade: cascade,
    });
    expect(linesOf(reopened)[0]!.box.height).toBeCloseTo(line(24), 5);
  });
});
