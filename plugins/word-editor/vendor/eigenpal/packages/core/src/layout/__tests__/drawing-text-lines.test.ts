// DrawingML shape text lines: proportional spacing keeps each line's descent at the bottom of
// its box, and lowered stories lay out under a cascade free of the document's styles.

import { describe, expect, test } from 'bun:test';
import { drawingTextCascade } from '../drawing-text-cascade.ts';
import { applyLineSpacing } from '../paragraph-style.ts';
import { buildStyleCascadeTable, resolveParagraphLayoutInputs } from '../style-cascade.ts';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// A 23 pt line in a face whose ascent and descent sum to 1.2207 em.
const NATURAL_HEIGHT = 28.0761;
const NATURAL_BASELINE = 21.896;

function element(xml: string): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name: '/word/test.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error('parse failed');
  return parsed.part.root;
}

describe('descent-anchored line spacing', () => {
  test('a reduced multiple removes space above the glyphs', () => {
    const line = applyLineSpacing(
      { rule: 'auto', value: 216, descentAnchored: true },
      NATURAL_HEIGHT,
      NATURAL_BASELINE
    );
    expect(line.height).toBeCloseTo(NATURAL_HEIGHT * 0.9, 6);
    // The descent below the baseline is the natural one.
    expect(line.height - line.baseline).toBeCloseTo(NATURAL_HEIGHT - NATURAL_BASELINE, 6);
    expect(line.baseline).toBeCloseTo(NATURAL_BASELINE + (line.height - NATURAL_HEIGHT), 6);
  });

  test('an enlarged multiple adds space above the glyphs', () => {
    const line = applyLineSpacing(
      { rule: 'auto', value: 360, descentAnchored: true },
      NATURAL_HEIGHT,
      NATURAL_BASELINE
    );
    expect(line.height).toBeCloseTo(NATURAL_HEIGHT * 1.5, 6);
    expect(line.baseline).toBeCloseTo(NATURAL_BASELINE + NATURAL_HEIGHT * 0.5, 6);
  });

  test('document paragraphs keep their own rules', () => {
    const reduced = applyLineSpacing(
      { rule: 'auto', value: 216 },
      NATURAL_HEIGHT,
      NATURAL_BASELINE
    );
    // A document line under a reduced multiple scales its baseline with the line.
    expect(reduced.baseline).toBeCloseTo(NATURAL_BASELINE * (216 / 240), 6);
    const grown = applyLineSpacing({ rule: 'auto', value: 360 }, NATURAL_HEIGHT, NATURAL_BASELINE);
    expect(grown.baseline).toBeCloseTo(NATURAL_BASELINE, 6);
  });

  test('exact and at-least lines ignore the flag', () => {
    for (const descentAnchored of [undefined, true] as const) {
      const flag = descentAnchored ? { descentAnchored } : {};
      const exact = applyLineSpacing(
        { rule: 'exact', value: 20, ...flag },
        NATURAL_HEIGHT,
        NATURAL_BASELINE
      );
      expect(exact).toEqual({ height: 20, baseline: 16 });
      const floor = applyLineSpacing(
        { rule: 'atLeast', value: 40, ...flag },
        NATURAL_HEIGHT,
        NATURAL_BASELINE
      );
      expect(floor.baseline).toBeCloseTo(NATURAL_BASELINE + 40 - NATURAL_HEIGHT, 6);
    }
  });
});

describe('DrawingML story cascade', () => {
  const styles = element(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault>` +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:pPr><w:ind w:left="720"/><w:jc w:val="right"/></w:pPr></w:style></w:styles>'
  );
  const themeFonts = { major: 'Cambria', minor: 'Calibri' };
  const base = buildStyleCascadeTable(styles, themeFonts);

  test('drops the styles and defaults, keeps theme fonts, and turns on the line rule', () => {
    const cascade = drawingTextCascade(base);
    expect(cascade.styles.size).toBe(0);
    expect(cascade.docDefaultsRun).toEqual([]);
    expect(cascade.docDefaultsParagraph).toEqual([]);
    expect(cascade.defaultParagraphStyleId).toBeNull();
    expect(cascade.themeFonts).toBe(base.themeFonts);
    expect(cascade.typography).toBe(base.typography);
    expect(cascade.drawingTextLines).toBe(true);
    expect(cascade.cacheToken).not.toBe(base.cacheToken);
  });

  test('is derived once per base cascade', () => {
    expect(drawingTextCascade(base)).toBe(drawingTextCascade(base));
    expect(drawingTextCascade(undefined)).toBe(drawingTextCascade(undefined));
    expect(drawingTextCascade(undefined)).not.toBe(drawingTextCascade(base));
  });

  test('a lowered paragraph inherits nothing from the document style', () => {
    const paragraph = element(
      `<w:p xmlns:w="${W}"><w:pPr><w:spacing w:before="0" w:after="0" w:line="216" w:lineRule="auto"/></w:pPr></w:p>`
    );
    const document = resolveParagraphLayoutInputs(paragraph, 400, base);
    expect(document.indent.left).toBeGreaterThan(0);
    expect(document.lineSpacing.descentAnchored).toBeUndefined();
    const lowered = resolveParagraphLayoutInputs(paragraph, 400, drawingTextCascade(base));
    expect(lowered.indent.left).toBe(0);
    expect(lowered.alignment).not.toBe('right');
    expect(lowered.lineSpacing).toMatchObject({ rule: 'auto', value: 216, descentAnchored: true });
  });
});
