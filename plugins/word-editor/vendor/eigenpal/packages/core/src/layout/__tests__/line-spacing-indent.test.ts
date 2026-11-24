// Line spacing (17.3.1.33), first-line indent (17.3.1.12) and contextual spacing (17.3.1.9).
//
// All three change where lines land, so all three move page breaks. Word's own Normal style
// since 2013 is `w:line="259" w:lineRule="auto"` — 1.08 — so a flat single-spaced layout is
// ~8% tight on every line of essentially every modern document.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  applyLineSpacing,
  createFixedMeasurer,
  buildNumberingIndex,
  layoutSemanticDocument,
  linesOf,
  paragraphContextualSpacing,
  paragraphLineSpacing,
  buildStyleCascadeTable,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });
// The measurer's 6pt/14pt base describes an 11pt run, so the fixtures author `w:sz="22"`
// rather than leaning on the terminal fallback, which is 10pt (see `DEFAULT_RUN_STYLE`).
const para = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

describe('paragraphLineSpacing reads w:line and w:lineRule', () => {
  test('absent spacing is single', () => {
    expect(paragraphLineSpacing([])).toEqual({ rule: 'auto', value: 240 });
  });

  test('auto is 240ths of a line', () => {
    expect(paragraphLineSpacing([{ localName: 'spacing', attributes: { line: '480' } }])).toEqual({
      rule: 'auto',
      value: 480,
    });
    // Word's Normal since 2013.
    expect(
      paragraphLineSpacing([
        { localName: 'spacing', attributes: { line: '259', lineRule: 'auto' } },
      ])
    ).toEqual({ rule: 'auto', value: 259 });
  });

  test('exact and atLeast are twips, resolved to points', () => {
    expect(
      paragraphLineSpacing([
        { localName: 'spacing', attributes: { line: '360', lineRule: 'exact' } },
      ])
    ).toEqual({ rule: 'exact', value: 18 });
    expect(
      paragraphLineSpacing([
        { localName: 'spacing', attributes: { line: '360', lineRule: 'atLeast' } },
      ])
    ).toEqual({ rule: 'atLeast', value: 18 });
  });

  test('merged per attribute across the cascade, like before/after', () => {
    // A style stating only the rule must not discard the inherited value.
    expect(
      paragraphLineSpacing([
        { localName: 'spacing', attributes: { line: '360' } },
        { localName: 'spacing', attributes: { lineRule: 'exact' } },
      ])
    ).toEqual({ rule: 'exact', value: 18 });
  });

  test('hostile and degenerate values fall back rather than paginate forever', () => {
    expect(paragraphLineSpacing([{ localName: 'spacing', attributes: { line: '0' } }])).toEqual({
      rule: 'auto',
      value: 240,
    });
    expect(paragraphLineSpacing([{ localName: 'spacing', attributes: { line: '-480' } }])).toEqual({
      rule: 'auto',
      value: 240,
    });
    const huge = paragraphLineSpacing([
      { localName: 'spacing', attributes: { line: '99999999', lineRule: 'exact' } },
    ]);
    expect(huge.value).toBeLessThanOrEqual(132 * 12);
  });
});

describe('applyLineSpacing places auto extras below the text', () => {
  test('auto scales the box downward without moving the baseline', () => {
    expect(applyLineSpacing({ rule: 'auto', value: 480 }, 14, 11)).toEqual({
      height: 28,
      baseline: 11,
    });
  });

  // atLeast grows UPWARD, unlike auto. A captured control settles it: Times New Roman 12 pt
  // at `w:line="360" w:lineRule="atLeast"` puts the reference's baseline at 15.36 pt, which
  // is `18 - descent` on the device grid, not the 11.28 that treating it like `auto` gives.
  // See `.cache/pdf/claude-linerule/`.
  // Nothing lies below the glyphs, so no trailing depth may cross the bottom margin.
  test('atLeast is a floor, never a ceiling, and grows upward', () => {
    expect(applyLineSpacing({ rule: 'atLeast', value: 10 }, 14, 11).height).toBe(14);
    expect(applyLineSpacing({ rule: 'atLeast', value: 20 }, 14, 11)).toEqual({
      height: 20,
      baseline: 17,
      trailing: 0,
    });
  });

  test('atLeast below the natural height leaves the baseline alone', () => {
    expect(applyLineSpacing({ rule: 'atLeast', value: 10 }, 14, 11)).toEqual({
      height: 14,
      baseline: 11,
      trailing: 0,
    });
  });

  test('exact taller than the glyphs uses the fixed baseline fraction', () => {
    expect(applyLineSpacing({ rule: 'exact', value: 20 }, 14, 11)).toEqual({
      height: 20,
      baseline: 16,
    });
  });

  test('exact smaller than the glyphs keeps the baseline inside the box', () => {
    const clipped = applyLineSpacing({ rule: 'exact', value: 8 }, 14, 11);
    expect(clipped.height).toBe(8);
    expect(clipped.baseline).toBeLessThanOrEqual(8);
  });
});

describe('line spacing reaches laid-out lines', () => {
  test('double spacing doubles every line box', () => {
    const single = linesOf(lay(para('hello world')));
    const double = linesOf(lay(para('hello world', '<w:spacing w:line="480" w:lineRule="auto"/>')));
    expect(single[0]!.box.height).toBe(14);
    expect(double[0]!.box.height).toBe(28);
  });

  test("Word's 1.08 Normal is 8% taller, not equal", () => {
    const normal = linesOf(lay(para('hello', '<w:spacing w:line="259" w:lineRule="auto"/>')));
    expect(normal[0]!.box.height).toBeCloseTo(14 * (259 / 240), 5);
  });

  test('taller lines paginate sooner', () => {
    const body = Array.from({ length: 8 }, (_, index) => para(`line ${index}`)).join('');
    const spaced = Array.from({ length: 8 }, (_, index) =>
      para(`line ${index}`, '<w:spacing w:line="480" w:lineRule="auto"/>')
    ).join('');
    const geometry =
      '<w:sectPr><w:pgSz w:w="6000" w:h="3000"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>';
    expect(lay(spaced + geometry).pages.length).toBeGreaterThan(lay(body + geometry).pages.length);
  });

  test('a cell paragraph gets the same line spacing as a body paragraph', () => {
    const cell = (pPr: string) =>
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
      `${para('hello', pPr)}</w:tc></w:tr></w:tbl>`;
    const single = linesOf(lay(cell('')));
    const double = linesOf(lay(cell('<w:spacing w:line="480" w:lineRule="auto"/>')));
    expect(double[0]!.box.height).toBe(single[0]!.box.height * 2);
  });
});

describe('first-line indent reaches line geometry', () => {
  // A column narrow enough that a short paragraph wraps: 3000 twips wide, 200 margins,
  // so 130pt of text at 6pt per character.
  const NARROW =
    '<w:sectPr><w:pgSz w:w="3000" w:h="9000"/><w:pgMar w:top="200" w:right="200" ' +
    'w:bottom="200" w:left="200"/></w:sectPr>';
  const narrow = (pPr: string) =>
    linesOf(lay(para('aaa bbb ccc ddd eee fff ggg hhh iii jjj', pPr) + NARROW));

  test('w:firstLine indents the first line only', () => {
    const lines = narrow('<w:ind w:firstLine="720"/>');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!.spans[0]!.box.x).toBe(36);
    expect(lines[1]!.spans[0]!.box.x).toBe(0);
  });

  test('w:hanging pulls the first line LEFT of the others', () => {
    const lines = narrow('<w:ind w:left="720" w:hanging="360"/>');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!.spans[0]!.box.x).toBe(18);
    expect(lines[1]!.spans[0]!.box.x).toBe(36);
  });

  test('w:hanging wins over w:firstLine, which the schema treats as exclusive', () => {
    const lines = narrow('<w:ind w:left="720" w:hanging="360" w:firstLine="720"/>');
    expect(lines[0]!.spans[0]!.box.x).toBe(18);
  });

  test('a LIST paragraph keeps its text out of the marker slot', () => {
    // A numbered paragraph's hanging indent is the marker's slot. Moving the text into it
    // as well draws the bullet on top of its own first word.
    const numbering = readOoxmlPart(
      `<w:numbering xmlns:w="${W}">` +
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">' +
        '<w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/>' +
        '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
        '</w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!numbering.ok) throw new Error(numbering.reason);
    const item =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>alpha</w:t></w:r></w:p>';
    const layout = layoutSemanticDocument(load(item), 1, {
      measurer,
      numberingIndex: buildNumberingIndex(numbering.part.root),
    });
    const fragment = layout.pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
    // Marker in the hanging slot at 18pt; text at the 36pt indent, not on top of it.
    expect(fragment.marker!.box.x).toBe(18);
    expect(fragment.lines[0]!.spans[0]!.box.x).toBe(36);
  });

  test('an indented first line has less room, so it wraps earlier', () => {
    const plain = narrow('');
    const indented = narrow('<w:ind w:firstLine="1440"/>');
    expect(indented[0]!.range.end).toBeLessThan(plain[0]!.range.end);
  });
});

describe('w:contextualSpacing drops the gap between same-style paragraphs', () => {
  function cascade(): ReturnType<typeof buildStyleCascadeTable> {
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}` +
        '<w:style w:type="paragraph" w:styleId="ListParagraph">' +
        '<w:name w:val="List Paragraph"/>' +
        '<w:pPr><w:spacing w:after="160"/><w:contextualSpacing/></w:pPr>' +
        '</w:style></w:styles>',
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    return buildStyleCascadeTable(styles.part.root);
  }

  test('the flag itself reads on/off correctly', () => {
    expect(paragraphContextualSpacing([{ localName: 'contextualSpacing', attributes: {} }])).toBe(
      true
    );
    expect(
      paragraphContextualSpacing([{ localName: 'contextualSpacing', attributes: { val: '0' } }])
    ).toBe(false);
    expect(paragraphContextualSpacing([])).toBe(false);
  });

  test('consecutive same-style items sit flush; a different style keeps its gap', () => {
    const item = (text: string) =>
      `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    const layout = layoutSemanticDocument(load(item('one') + item('two') + para('after')), 1, {
      measurer,
      styleCascade: cascade(),
    });
    const ys = layout.pages[0]!.fragments.map((fragment) => fragment.box.y);
    // Items 1 and 2 share a style, so the 8pt space-after between them is dropped.
    expect(ys[1]! - ys[0]!).toBe(14);
    // The last item keeps its space-after: the paragraph after it is a different style.
    expect(ys[2]! - ys[1]!).toBeGreaterThan(14);
  });

  test('without the flag the same two paragraphs keep their gap', () => {
    const item = (text: string) =>
      `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    const layout = layoutSemanticDocument(load(item('one') + item('two')), 1, { measurer });
    const ys = layout.pages[0]!.fragments.map((fragment) => fragment.box.y);
    expect(ys[1]! - ys[0]!).toBeGreaterThan(14);
  });
});
