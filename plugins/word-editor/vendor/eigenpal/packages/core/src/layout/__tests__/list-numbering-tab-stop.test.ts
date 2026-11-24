// The `w:suff="tab"` advance of a numbered paragraph whose marker ENDS BEFORE the text
// indent (§17.9.30, §17.15.3 `w:doNotUseIndentAsNumberingTabStop`).
//
// The hanging indent is an implicit stop for that tab, but not the only one: an authored
// stop between the marker and the indent is nearer, so the first line starts there and gets
// the extra width. Continuation lines keep the indent. With `doNotUseIndentAsNumberingTabStop`
// the indent stops competing: the first authored stop past the marker wins wherever it is,
// and the indent is only the fallback when there is none.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Every glyph is 6pt wide, so the `1.` marker is 12pt and a four-letter word is 24pt.
const measurer = createFixedMeasurer(6, 14);

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// Level 0: marker slot at 36pt (left 72pt, hanging 36pt), so `1.` ends at 48pt.
function numbering(
  levelExtra = '',
  suffix = 'tab',
  ind = '<w:ind w:left="1440" w:hanging="720"/>',
  jc = 'left'
) {
  return buildNumberingIndex(
    read(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
        `<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:suff w:val="${suffix}"/>` +
        `<w:lvlText w:val="%1."/><w:lvlJc w:val="${jc}"/><w:pPr>${levelExtra}${ind}</w:pPr>` +
        `<w:rPr><w:sz w:val="22"/></w:rPr></w:lvl>` +
        `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
      '/word/numbering.xml'
    ).root
  );
}

const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr>` +
  `</w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Stops">` +
  `<w:name w:val="Stops"/><w:pPr><w:tabs><w:tab w:val="left" w:pos="1200"/></w:tabs></w:pPr>` +
  `</w:style></w:styles>`;

function cascade(settings = '') {
  return buildStyleCascadeTable(
    read(STYLES, '/word/styles.xml').root,
    undefined,
    read(`<w:settings xmlns:w="${W}">${settings}</w:settings>`, '/word/settings.xml').root
  );
}

const FLAG = '<w:compat><w:doNotUseIndentAsNumberingTabStop/></w:compat>';

const item = (pPr = '', text = 'Text') =>
  `<w:p><w:pPr>${pPr}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

const tabs = (...stops: string[]) => `<w:tabs>${stops.join('')}</w:tabs>`;
const stop = (pos: number, val = 'left') => `<w:tab w:val="${val}" w:pos="${pos}"/>`;

function layout(
  body: string,
  options: {
    settings?: string;
    levelExtra?: string;
    suffix?: string;
    width?: number;
  } = {}
): SemanticLayout {
  const part = read(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  return layoutSemanticDocument(part, 1, {
    measurer,
    // A bidi paragraph reads the same level from its leading (right) side.
    numberingIndex: numbering(options.levelExtra, options.suffix),
    styleCascade: cascade(options.settings),
    geometry: {
      width: options.width ?? 400,
      height: 400,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
}

function firstParagraph(result: SemanticLayout) {
  return paragraphFragmentsOf(result.pages[0]!)[0]!;
}

/** Where the first line's text starts. */
function textStart(body: string, options?: Parameters<typeof layout>[1]): number {
  return firstParagraph(layout(body, options)).lines[0]!.spans[0]!.box.x;
}

describe('a numbering tab stops at an authored stop before the text indent', () => {
  test('without a stop, the text starts at the indent', () => {
    expect(textStart(item())).toBe(72);
  });

  test('a direct stop between the marker and the indent wins', () => {
    expect(textStart(item(tabs(stop(1200))))).toBe(60);
  });

  test('a legacy numbering stop wins the same way', () => {
    expect(textStart(item(tabs(stop(1200, 'num'))))).toBe(60);
  });

  test('a stop the marker already covers is skipped', () => {
    // 900tw = 45pt, inside the 36..48pt marker.
    expect(textStart(item(tabs(stop(900))))).toBe(72);
    expect(textStart(item(tabs(stop(900), stop(1200))))).toBe(60);
    // A stop exactly at the marker end is not PAST it.
    expect(textStart(item(tabs(stop(960))))).toBe(72);
  });

  test('a paragraph-style stop is inherited, and a direct clear removes it', () => {
    expect(textStart(item('<w:pStyle w:val="Stops"/>'))).toBe(60);
    expect(textStart(item(`<w:pStyle w:val="Stops"/>${tabs(stop(1200, 'clear'))}`))).toBe(72);
  });

  test('a numbering-level stop is inherited, and a direct clear removes it', () => {
    const levelExtra = tabs(stop(1200, 'num'));
    expect(textStart(item(), { levelExtra })).toBe(60);
    expect(textStart(item(tabs(stop(1200, 'clear'))), { levelExtra })).toBe(72);
  });

  test('default-interval stops before the indent do not compete', () => {
    // A 12pt grid puts default stops at 60pt; the implicit indent stop still wins.
    const settings = '<w:defaultTabStop w:val="240"/>';
    expect(textStart(item(), { settings })).toBe(72);
  });

  test('a stop past the indent does not pull the text right', () => {
    expect(textStart(item(tabs(stop(1800))))).toBe(72);
  });

  test('space and nothing suffixes ignore tab stops', () => {
    const body = item(tabs(stop(1200)));
    // The 11pt marker ends at 48; the space suffix is 569/2048 em of its size.
    expect(textStart(body, { suffix: 'space' })).toBeCloseTo(48 + (569 / 2048) * 11, 6);
    expect(textStart(body, { suffix: 'nothing' })).toBe(48);
  });

  test('the marker stays in its slot and later lines keep the indent', () => {
    const text = Array(12).fill('aaaa').join(' ');
    const paragraph = firstParagraph(layout(item(tabs(stop(1200)), text), { width: 200 }));
    expect(paragraph.marker!.box.x).toBe(36);
    expect(paragraph.marker!.box.x + paragraph.marker!.box.width).toBe(48);
    expect(paragraph.lines[0]!.spans[0]!.box.x).toBe(60);
    for (const line of paragraph.lines.slice(1)) expect(line.spans[0]!.box.x).toBe(72);
  });

  test('the first line wraps against the width the stop gives it', () => {
    // 206pt wide. From 72pt the first line has 134pt: four words (4 x 24 + 3 x 6 = 114pt).
    // From 60pt it has 146pt: five words (5 x 24 + 4 x 6 = 144pt).
    const text = Array(12).fill('aaaa').join(' ');
    const words = (body: string) =>
      firstParagraph(layout(body, { width: 206 }))
        .lines[0]!.spans.map((span) => span.text)
        .join('')
        .trim()
        .split(' ').length;
    expect(words(item('', text))).toBe(4);
    expect(words(item(tabs(stop(1200)), text))).toBe(5);
  });

  test('a table cell places its numbered first line by the same rule', () => {
    const cell = (pPr: string) =>
      `<w:tbl><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${item(pPr)}</w:tc>` +
      `</w:tr></w:tbl>`;
    const gap = (pPr: string) => {
      // The walk flattens table interiors, so the cell paragraph is the first one.
      const paragraph = firstParagraph(layout(cell(pPr)));
      return paragraph.lines[0]!.spans[0]!.box.x - paragraph.marker!.box.x;
    };
    // The marker slot is at 36pt; the text sits 36pt past it at the indent, 24pt at the stop.
    expect(gap('')).toBe(36);
    expect(gap(tabs(stop(1200)))).toBe(24);
  });

  test('the same document lays out the same twice', () => {
    const body = item(tabs(stop(1200)));
    expect(layout(body).pages).toEqual(layout(body).pages);
  });
});

describe('doNotUseIndentAsNumberingTabStop', () => {
  test('the first stop past the marker wins, even past the indent', () => {
    expect(textStart(item(tabs(stop(1800))), { settings: FLAG })).toBe(90);
  });

  test('a stop before the indent still wins', () => {
    expect(textStart(item(tabs(stop(1200))), { settings: FLAG })).toBe(60);
  });

  test('without a stop, the text falls back to the indent, not the default interval', () => {
    expect(textStart(item(), { settings: FLAG })).toBe(72);
    const grid = `${FLAG}<w:defaultTabStop w:val="1100"/>`;
    expect(textStart(item(), { settings: grid })).toBe(72);
  });

  test('an authored stop exactly at the indent is still the first stop', () => {
    expect(textStart(item(tabs(stop(1440), stop(1800))), { settings: FLAG })).toBe(72);
  });

  test('an explicit off value keeps the indent as the stop', () => {
    const off = '<w:compat><w:doNotUseIndentAsNumberingTabStop w:val="0"/></w:compat>';
    expect(textStart(item(tabs(stop(1800))), { settings: off })).toBe(72);
  });
});

describe('right-to-left numbered paragraphs mirror the same rule', () => {
  test('the stop is measured from the leading edge', () => {
    const rtl = (pPr: string) =>
      `<w:p><w:pPr><w:bidi/>${pPr}<w:numPr>` +
      `<w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>`;
    const width = 400;
    const end = (pPr: string) => {
      const line = firstParagraph(layout(rtl(pPr), { width })).lines[0]!;
      return Math.max(...line.spans.map((span) => span.box.x + span.box.width));
    };
    expect(end('')).toBe(width - 72);
    expect(end(tabs(stop(1200)))).toBe(width - 60);
  });
});
