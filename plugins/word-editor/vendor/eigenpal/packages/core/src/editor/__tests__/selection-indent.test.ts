// The effective indent read, and the exact-value indent write behind the ruler.
//
// Nearly every case here exists because a review found the rule easy to get wrong:
//
// - `w:firstLine` and `w:hanging` are MUTUALLY EXCLUSIVE and hanging WINS (§17.3.1.12), so
//   the one signed offset the contract publishes is `hanging > 0 ? -hanging : firstLine`,
//   never their sum.
// - `w:ind` cascades ATTRIBUTE BY ATTRIBUTE, so a write that drops the opposite spelling
//   instead of zeroing it leaves a style-inherited value in the cascade — and, hanging
//   winning, the edit silently does nothing.
// - A uniform multi-paragraph selection must REPORT its indent. Agreeing over a freshly
//   allocated object with `===` reports every such selection as mixed.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { directParagraphProperties } from '../surface-formatting.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/** A style whose OWN `w:ind` states a hanging indent — the cascade trap. */
const STYLES =
  '<w:style w:type="paragraph" w:styleId="Hang"><w:name w:val="Hang"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Indented"><w:name w:val="Indented"/>' +
  '<w:pPr><w:ind w:left="1440"/></w:pPr></w:style>';

/** Level 0 carries the indent, so a list item authoring no `w:ind` still sits indented. */
const NUMBERING =
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>' +
  '<w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';

function docx(body: string, opts: { styles?: boolean; numbering?: boolean } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (opts.styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        (opts.numbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  const rels: string[] = [];
  if (opts.styles) {
    files['word/styles.xml'] = strToU8(`<w:styles xmlns:w="${W}">${STYLES}</w:styles>`);
    rels.push(`<Relationship Id="rId8" Type="${STY}" Target="styles.xml"/>`);
  }
  if (opts.numbering) {
    files['word/numbering.xml'] = strToU8(`<w:numbering xmlns:w="${W}">${NUMBERING}</w:numbering>`);
    rels.push(`<Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/>`);
  }
  if (rels.length > 0) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    );
  }
  return zipSync(files);
}

function mount(body: string, opts: { styles?: boolean; numbering?: boolean } = {}) {
  const opened = mountPaginatedSurface(document.createElement('div'), docx(body, opts), {
    scale: 1,
  });
  if (!opened.ok) throw new Error(opened.reason);
  return opened.surface;
}

/** Put the caret in paragraph `index`. */
function caretIn(surface: PaginatedSurface, index = 0): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
}

/** Select from the start of paragraph `from` to the start of paragraph `to`. */
function selectParagraphs(surface: PaginatedSurface, from: number, to: number): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[from]!, offset: 0 },
    head: { paragraphId: ids[to]!, offset: 0 },
  });
}

const para = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const IND = (attrs: string) => `<w:ind ${attrs}/>`;

/**
 * The paragraph's OWN `w:ind` attributes — read through the same lens the write merges
 * against, so the assertion and the implementation cannot disagree about the shape.
 */
function ownIndent(surface: PaginatedSurface, index = 0): Record<string, string> {
  const paragraphId = surface.session.paragraphIds()[index]!;
  const direct = directParagraphProperties(surface.session.part(), paragraphId);
  return direct.find((property) => property.localName === 'ind')?.attributes ?? {};
}

describe('the effective indent read', () => {
  test('a plain paragraph reports its direct indent, in twips', () => {
    const surface = mount(para('body', IND('w:left="720" w:right="360"')));
    caretIn(surface);
    expect(surface.formatting().indent).toMatchObject({ left: 720, right: 360, firstLine: 0 });
  });

  test('a right-to-left paragraph reports its sides as `w:left` and `w:right` name them', () => {
    // Layout puts `w:left` on the right margin here. The read stays logical so the ruler and
    // the dialog write back to the attribute they read from.
    const surface = mount(para('body', `<w:bidi/>${IND('w:left="720" w:right="360"')}`));
    caretIn(surface);
    expect(surface.formatting().indent).toMatchObject({ left: 720, right: 360, rtl: true });
    surface.setIndent({ left: 1080 });
    expect(ownIndent(surface)).toMatchObject({ left: '1080', right: '360' });
    const ltr = mount(para('body', IND('w:left="720"')));
    caretIn(ltr);
    expect(ltr.formatting().indent?.rtl).toBeUndefined();
  });

  test('a UNIFORM two-paragraph selection reports the indent, not null', () => {
    // The regression that matters: agreeing over a freshly built object with `===` reports
    // every multi-paragraph selection as mixed, so Select All would hide all four handles.
    const surface = mount(para('one', IND('w:left="720"')) + para('two', IND('w:left="720"')));
    selectParagraphs(surface, 0, 1);
    const indent = surface.formatting().indent;
    expect(indent?.left).toBe(720);
    expect(indent?.mixed.left).toBe(false);
  });

  test('a mixed selection reports the FIRST paragraph and flags the field', () => {
    const surface = mount(para('one', IND('w:left="720"')) + para('two', IND('w:left="1440"')));
    selectParagraphs(surface, 0, 1);
    const indent = surface.formatting().indent;
    // Word draws the handles at the first selected paragraph rather than hiding them.
    expect(indent?.left).toBe(720);
    expect(indent?.mixed.left).toBe(true);
    // Disagreeing on one field leaves the others agreed, so their handles stay honest.
    expect(indent?.mixed.right).toBe(false);
  });

  test('hanging WINS over firstLine, and is reported as a negative offset', () => {
    const surface = mount(para('body', IND('w:left="720" w:firstLine="720" w:hanging="360"')));
    caretIn(surface);
    // Not 720 - 360 = 360. The two are mutually exclusive and hanging governs.
    expect(surface.formatting().indent?.firstLine).toBe(-360);
  });

  test('a negative w:firstLine survives as a hanging indent', () => {
    // Regression: the non-list reader flattened this to zero while the list reader read it
    // signed, so a body paragraph rendered flush where Word renders a hanging.
    const surface = mount(para('body', IND('w:left="720" w:firstLine="-360"')));
    caretIn(surface);
    expect(surface.formatting().indent?.firstLine).toBe(-360);
  });

  test('a hostile hanging is clamped rather than reaching geometry', () => {
    const surface = mount(para('body', IND('w:hanging="999999999"')));
    caretIn(surface);
    const firstLine = surface.formatting().indent?.firstLine ?? 0;
    expect(Math.abs(firstLine)).toBeLessThanOrEqual(31_680);
  });

  test('a styled paragraph reports the style indent it inherits', () => {
    const surface = mount(para('body', '<w:pStyle w:val="Indented"/>'), { styles: true });
    caretIn(surface);
    expect(surface.formatting().indent?.left).toBe(1440);
  });

  test('a list item reports the indent its numbering gives it', () => {
    // The case that justifies publishing indent on the fragment at all: the numbering merge
    // happens after the cascade, so the paragraph's property bag reads zero here.
    const surface = mount(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>item</w:t></w:r></w:p>',
      { numbering: true }
    );
    caretIn(surface);
    expect(surface.formatting().indent).toMatchObject({ left: 1080, firstLine: -360 });
  });

  test('a caret inside a table reports no indent', () => {
    // The value would be right but unplaceable: it is measured from the cell's content
    // edge, and the ruler is drawn against the page margin.
    const surface = mount(
      '<w:tbl><w:tr><w:tc>' + para('cell', IND('w:left="720"')) + '</w:tc></w:tr></w:tbl>'
    );
    caretIn(surface);
    expect(surface.formatting().indent).toBeNull();
  });
});

describe('setIndent', () => {
  test('naming one field leaves the paragraph other w:ind attributes alone', () => {
    const surface = mount(para('body', IND('w:left="720" w:right="360" w:hanging="180"')));
    caretIn(surface);
    surface.setIndent({ left: 1440 });
    const authored = ownIndent(surface);
    expect(authored.left).toBe('1440');
    // Replacing the element wholesale dropped these; merging keeps them.
    expect(authored.right).toBe('360');
    expect(authored.hanging).toBe('180');
  });

  test('a w:start paragraph keeps ONE spelling', () => {
    const surface = mount(para('body', IND('w:start="720"')));
    caretIn(surface);
    surface.setIndent({ left: 1440 });
    const authored = ownIndent(surface);
    expect(authored.start).toBe('1440');
    // Adding `w:left` beside it would leave the element stating two different indents,
    // with nothing to make two readers agree about which governs.
    expect(authored.left).toBeUndefined();
  });

  test('a signed first line writes BOTH spellings, the unused one as an explicit zero', () => {
    const surface = mount(para('body'));
    caretIn(surface);
    surface.setIndent({ firstLine: 720 });
    expect(ownIndent(surface)).toMatchObject({ firstLine: '720', hanging: '0' });
    surface.setIndent({ firstLine: -360 });
    expect(ownIndent(surface)).toMatchObject({ hanging: '360', firstLine: '0' });
  });

  test('a first-line write beats a style-inherited hanging', () => {
    // The cascade trap: `w:ind` cascades attribute by attribute, so DROPPING the direct
    // hanging would leave the style's 360 in the cascade — and hanging wins, so the
    // paragraph would not move at all. The explicit zero is what makes this land.
    const surface = mount(para('body', '<w:pStyle w:val="Hang"/>'), { styles: true });
    caretIn(surface);
    expect(surface.formatting().indent?.firstLine).toBe(-360);
    surface.setIndent({ firstLine: 720 });
    expect(surface.formatting().indent?.firstLine).toBe(720);
  });

  test('null clears back to the style, which zero does not', () => {
    const surface = mount(para('body', '<w:pStyle w:val="Indented"/>' + IND('w:left="2880"')), {
      styles: true,
    });
    caretIn(surface);
    expect(surface.formatting().indent?.left).toBe(2880);
    surface.setIndent({ left: null });
    // Falls back to the style's 1440 rather than to nothing.
    expect(surface.formatting().indent?.left).toBe(1440);
  });

  test('it writes every paragraph the selection touches', () => {
    const surface = mount(para('one') + para('two'));
    selectParagraphs(surface, 0, 1);
    surface.setIndent({ left: 720 });
    expect(ownIndent(surface, 0).left).toBe('720');
    expect(ownIndent(surface, 1).left).toBe('720');
  });

  test('an empty update commits nothing', () => {
    const surface = mount(para('body'));
    caretIn(surface);
    const before = surface.session.revision();
    expect(surface.setIndent({})).toBe(false);
    expect(surface.session.revision()).toBe(before);
  });
});
