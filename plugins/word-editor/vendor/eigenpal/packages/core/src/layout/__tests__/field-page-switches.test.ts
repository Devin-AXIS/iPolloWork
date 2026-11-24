// The `\*` number-format switches on PAGE / NUMPAGES / SECTIONPAGES: what the allowlist
// accepts, what each format renders, and how the result reaches footers and the body.
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import {
  allowlistedPageField,
  detectStoryPageFields,
  matchAllowlistedPageField,
  MAX_FIELD_INSTRUCTION_CHARS,
} from '../field-instruction.ts';
import {
  pageFieldPlaceholder,
  projectPageFieldValue,
  substituteBodyPageFields,
} from '../field-page-furniture.ts';
import type { BlockFragmentRecord, StyleSpanRecord } from '../semantic-records.ts';
import { formatPageFieldNumber, PAGE_FIELD_UNREPRESENTABLE } from '../field-page-switches.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const measurer = createFixedMeasurer(6, 14);

describe('page-field number-format switches', () => {
  test('accepts the numeric formats after any keyword case', () => {
    expect(matchAllowlistedPageField('PAGE \\* Arabic \\* MERGEFORMAT')).toEqual({
      kind: 'PAGE',
      numberFormat: 'decimal',
    });
    expect(matchAllowlistedPageField(' NUMPAGES  \\*  Arabic  \\* MERGEFORMAT ')).toEqual({
      kind: 'NUMPAGES',
      numberFormat: 'decimal',
    });
    expect(matchAllowlistedPageField('sectionpages \\* ArabicDash')).toEqual({
      kind: 'SECTIONPAGES',
      numberFormat: 'numberInDash',
    });
    expect(matchAllowlistedPageField('page \\* roman')?.numberFormat).toBe('lowerRoman');
  });

  test('reads the roman and alphabetic variant from the first character of the argument', () => {
    const formatOf = (instruction: string) => matchAllowlistedPageField(instruction)?.numberFormat;
    expect(formatOf('PAGE \\* roman')).toBe('lowerRoman');
    expect(formatOf('PAGE \\* ROMAN')).toBe('upperRoman');
    expect(formatOf('PAGE \\* Roman')).toBe('upperRoman');
    expect(formatOf('PAGE \\* rOMAN')).toBe('lowerRoman');
    expect(formatOf('PAGE \\* alphabetic')).toBe('lowerLetter');
    expect(formatOf('PAGE \\* ALPHABETIC')).toBe('upperLetter');
    expect(formatOf('PAGE \\* Alphabetic')).toBe('upperLetter');
    expect(formatOf('PAGE \\* aLPHABETIC')).toBe('lowerLetter');
    // Case never changes the decimal forms.
    expect(formatOf('PAGE \\* arabic')).toBe('decimal');
    expect(formatOf('PAGE \\* ARABICDASH')).toBe('numberInDash');
  });

  test('lets the last number format win and keeps MERGEFORMAT and CHARFORMAT inert', () => {
    const formatOf = (instruction: string) => matchAllowlistedPageField(instruction)?.numberFormat;
    expect(formatOf('PAGE \\* roman \\* ALPHABETIC')).toBe('upperLetter');
    expect(formatOf('PAGE \\* ALPHABETIC \\* roman')).toBe('lowerRoman');
    expect(formatOf('PAGE \\* ArabicDash \\* Arabic')).toBe('decimal');
    expect(formatOf('PAGE \\* MERGEFORMAT \\* roman')).toBe('lowerRoman');
    expect(formatOf('PAGE \\* roman \\* CHARFORMAT')).toBe('lowerRoman');
    expect(matchAllowlistedPageField('PAGE \\* CHARFORMAT')).toEqual({ kind: 'PAGE' });
    expect(matchAllowlistedPageField('PAGE \\* MERGEFORMAT \\* MERGEFORMAT')).toEqual({
      kind: 'PAGE',
    });
  });

  test('reads attached and quoted arguments', () => {
    const formatOf = (instruction: string) => matchAllowlistedPageField(instruction)?.numberFormat;
    expect(formatOf('PAGE \\*roman')).toBe('lowerRoman');
    expect(formatOf('PAGE \\*Arabic\\*MERGEFORMAT')).toBe('decimal');
    expect(formatOf('PAGE \\* roman\\* MERGEFORMAT')).toBe('lowerRoman');
    expect(formatOf('PAGE \\* "Roman"')).toBe('upperRoman');
    expect(formatOf('PAGE \\* "MERGEFORMAT" \\* alphabetic')).toBe('lowerLetter');
  });

  test('lets a number format outrank a picture that comes first', () => {
    expect(matchAllowlistedPageField('PAGE \\# "000" \\* roman')).toEqual({
      kind: 'PAGE',
      numberFormat: 'lowerRoman',
    });
    expect(matchAllowlistedPageField('PAGE \\# "000" \\* Arabic')).toEqual({
      kind: 'PAGE',
      numberFormat: 'decimal',
    });
    expect(matchAllowlistedPageField('NUMPAGES \\# 0 \\* roman')).toEqual({
      kind: 'NUMPAGES',
      numberFormat: 'lowerRoman',
    });
    // Formatting-only switches after the picture keep it.
    expect(matchAllowlistedPageField('PAGE \\# "000" \\* MERGEFORMAT')).toEqual({
      kind: 'PAGE',
      picture: '000',
    });
    expect(matchAllowlistedPageField('PAGE \\# "000" \\* CHARFORMAT')).toEqual({
      kind: 'PAGE',
      picture: '000',
    });
  });

  test('leaves every other switch shape inert', () => {
    for (const instruction of [
      // A picture after any `\*` switch, or a second picture, is an error result.
      'PAGE \\* roman \\# "000"',
      'PAGE \\* Arabic \\# "000"',
      'PAGE \\* MERGEFORMAT \\# "000"',
      'PAGE \\* CHARFORMAT \\# "000"',
      'PAGE \\# "0" \\# "00"',
      // Formats and switches this engine does not evaluate.
      'PAGE \\* Ordinal',
      'PAGE \\* CardText',
      'PAGE \\* OrdText',
      'PAGE \\* Hex',
      'PAGE \\* Upper',
      'PAGE \\* roman \\* Upper',
      'PAGE \\* bogus',
      // Only ASCII spellings: case mapping must not fold other letters onto a format name.
      'PAGE \\* arab\u0131c',
      'PAGE \\n Arabic',
      'PAGE \\@ "d"',
      // Malformed arguments and stray words.
      'PAGE \\*',
      'PAGE \\* ""',
      'PAGE \\* "roman',
      'PAGE \\* ro"man',
      'PAGE \\#',
      'PAGE \\* roman extra',
      'PAGE extra \\* roman',
      'PAGE\\*roman',
      '\\* roman',
      'PAGEX \\* roman',
      'DATE \\* roman',
    ]) {
      expect([instruction, allowlistedPageField(instruction)]).toEqual([instruction, null]);
    }
  });

  test('stays bounded on long hostile switch runs', () => {
    const switches = ' \\* MERGEFORMAT'.repeat(Math.floor((MAX_FIELD_INSTRUCTION_CHARS - 4) / 15));
    expect(allowlistedPageField(`PAGE${switches}`)).toBe('PAGE');
    expect(allowlistedPageField(`PAGE${switches} \\* roman`.padEnd(5000, ' x'))).toBeNull();
    expect(allowlistedPageField(`PAGE \\* "${'r'.repeat(MAX_FIELD_INSTRUCTION_CHARS)}`)).toBeNull();
  });
});

describe('page-field number formats', () => {
  test('renders roman numerals, repeating M past 3999', () => {
    expect(formatPageFieldNumber(1, 'lowerRoman')).toBe('i');
    expect(formatPageFieldNumber(27, 'upperRoman')).toBe('XXVII');
    expect(formatPageFieldNumber(702, 'lowerRoman')).toBe('dccii');
    expect(formatPageFieldNumber(3999, 'upperRoman')).toBe('MMMCMXCIX');
    expect(formatPageFieldNumber(4000, 'lowerRoman')).toBe('mmmm');
    expect(formatPageFieldNumber(5001, 'upperRoman')).toBe('MMMMMI');
    expect(formatPageFieldNumber(32767, 'lowerRoman')).toBe(`${'m'.repeat(32)}dcclxvii`);
    expect(formatPageFieldNumber(32768, 'lowerRoman')).toBe(PAGE_FIELD_UNREPRESENTABLE);
  });

  test('renders letters by repeating one letter, up to 780', () => {
    expect(formatPageFieldNumber(1, 'lowerLetter')).toBe('a');
    expect(formatPageFieldNumber(26, 'upperLetter')).toBe('Z');
    expect(formatPageFieldNumber(27, 'lowerLetter')).toBe('aa');
    expect(formatPageFieldNumber(52, 'upperLetter')).toBe('ZZ');
    expect(formatPageFieldNumber(53, 'lowerLetter')).toBe('aaa');
    expect(formatPageFieldNumber(703, 'upperLetter')).toBe('A'.repeat(28));
    expect(formatPageFieldNumber(780, 'lowerLetter')).toBe('z'.repeat(30));
    expect(formatPageFieldNumber(781, 'lowerLetter')).toBe(PAGE_FIELD_UNREPRESENTABLE);
  });

  test('renders zero as a space in roman and letters, and as digits otherwise', () => {
    expect(formatPageFieldNumber(0, 'lowerRoman')).toBe(' ');
    expect(formatPageFieldNumber(0, 'upperLetter')).toBe(' ');
    expect(formatPageFieldNumber(0, 'decimal')).toBe('0');
    expect(formatPageFieldNumber(0, 'numberInDash')).toBe('- 0 -');
  });

  test('renders Arabic and ArabicDash digits', () => {
    expect(formatPageFieldNumber(3, 'decimal')).toBe('3');
    expect(formatPageFieldNumber(22, 'numberInDash')).toBe('- 22 -');
    expect(formatPageFieldNumber(Number.NaN, 'decimal')).toBe('');
    expect(formatPageFieldNumber(-1, 'lowerRoman')).toBe('');
  });

  test('outranks the section page-number format, which still binds a field without switches', () => {
    const roman = { pageNumber: 4, pageCount: 22, sectionPageCount: 2, format: 'lowerRoman' };
    expect(projectPageFieldValue('PAGE', roman)).toBe('iv');
    expect(projectPageFieldValue('PAGE', roman, { numberFormat: 'decimal' })).toBe('4');
    expect(projectPageFieldValue('PAGE', roman, { numberFormat: 'upperLetter' })).toBe('D');
    expect(projectPageFieldValue('PAGE', roman, { numberFormat: 'numberInDash' })).toBe('- 4 -');
    expect(projectPageFieldValue('PAGE', roman, { picture: '000' })).toBe('004');
    expect(projectPageFieldValue('NUMPAGES', roman, { numberFormat: 'upperLetter' })).toBe('V');
    expect(projectPageFieldValue('SECTIONPAGES', roman, { numberFormat: 'upperRoman' })).toBe('II');
  });

  test('renders a PAGE field in a section page-number format with the same rules', () => {
    const page = (pageNumber: number, format: string) =>
      projectPageFieldValue('PAGE', { pageNumber, pageCount: 9, format });
    expect(page(28, 'upperLetter')).toBe('BB');
    expect(page(52, 'lowerLetter')).toBe('zz');
    expect(page(5000, 'upperRoman')).toBe('MMMMM');
    expect(page(0, 'lowerRoman')).toBe(' ');
    expect(page(781, 'upperLetter')).toBe(PAGE_FIELD_UNREPRESENTABLE);
    expect(page(3, 'numberInDash')).toBe('- 3 -');
    expect(page(3, 'japaneseCounting')).toBe('3');
  });

  test('measures a body placeholder in the shape of the format', () => {
    expect(pageFieldPlaceholder({ numberFormat: 'decimal' })).toBe('0');
    expect(pageFieldPlaceholder({ numberFormat: 'numberInDash' })).toBe('-\u00a01\u00a0-');
    expect(pageFieldPlaceholder({ numberFormat: 'upperRoman' })).toBe('I');
    expect(pageFieldPlaceholder({ numberFormat: 'lowerLetter' })).toBe('a');
  });
});

function complexField(instruction: string, cached: string): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    (cached ? `<w:r><w:t xml:space="preserve">${cached}</w:t></w:r>` : '') +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  );
}

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;

function packageOf(body: string, sectPr: string, footer?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${footer ?? '<w:p/>'}</w:ftr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>` +
        (footer ? '<w:footerReference w:type="default" r:id="rId1"/>' : '') +
        `${sectPr}<w:pgSz w:w="12240" w:h="15840"/>` +
        '<w:pgMar w:top="1080" w:right="720" w:bottom="1080" w:left="720" w:footer="500"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function furnitureOf(pkg: OoxmlPackage, part: OoxmlPart): readonly (PageFurniture | undefined)[] {
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return enumerateDocumentSections(part).map((section, index) => {
    const parts = bySection[index];
    if (!parts || parts.footers.size === 0) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const footers = new Map();
    for (const [variant, footer] of parts.footers) {
      footers.set(variant, layoutHeaderFooterStory(footer, width, measurer, 'switches'));
    }
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: new Map(),
      footers,
    };
  });
}

function layoutOf(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'switches',
    sectionFurniture: furnitureOf(loaded.package, part),
  });
}

function spansOf(fragments: readonly { kind: string }[]): string[] {
  return fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? (fragment as { lines: readonly { spans: readonly { text: string }[] }[] }).lines.flatMap(
          (line) => line.spans.map((span) => span.text)
        )
      : []
  );
}

const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const threePages = ['one', 'two', 'three']
  .map((label) => `<w:p>${text(`Body ${label}`)}</w:p>`)
  .join(pageBreak);

describe('footer page fields with number-format switches', () => {
  const footer =
    '<w:p>' +
    text('Page ') +
    complexField('PAGE \\* Arabic \\* MERGEFORMAT', '2') +
    text(' of ') +
    complexField('NUMPAGES \\* Arabic \\* MERGEFORMAT', '8') +
    text(' | ') +
    complexField('PAGE \\* roman', 'ii') +
    text(' | ') +
    '<w:fldSimple w:instr=" SECTIONPAGES \\* ALPHABETIC "><w:r><w:t>H</w:t></w:r></w:fldSimple>' +
    text(' | ') +
    complexField('PAGE \\* ArabicDash', '- 2 -') +
    text(' | ') +
    complexField('PAGE \\* Ordinal', '2nd') +
    '</w:p>';

  test('detects the switched fields as live page fields', () => {
    const loaded = readOoxmlPackage(packageOf(threePages, '', footer));
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: true,
    });
  });

  test('paints the computed value on every page and keeps an unsupported switch inert', () => {
    const layout = layoutOf(packageOf(threePages, '', footer));
    expect(layout.pages.map((page) => spansOf(page.footer?.fragments ?? []).join(''))).toEqual([
      'Page 1 of 3 | i | C | - 1 - | 2nd',
      'Page 2 of 3 | ii | C | - 2 - | 2nd',
      'Page 3 of 3 | iii | C | - 3 - | 2nd',
    ]);
  });

  test('lets the switches outrank a non-decimal section format', () => {
    const switched =
      '<w:p>' +
      complexField('PAGE \\# "000"', 'X') +
      text(' ') +
      complexField('PAGE \\* Arabic \\* MERGEFORMAT', 'X') +
      text(' ') +
      complexField('PAGE', 'X') +
      text(' ') +
      complexField('PAGE \\* ALPHABETIC', 'X') +
      '</w:p>';
    const layout = layoutOf(
      packageOf(threePages, '<w:pgNumType w:fmt="lowerRoman" w:start="3"/>', switched)
    );
    expect(layout.pages.map((page) => spansOf(page.footer?.fragments ?? []).join(''))).toEqual([
      '003 3 iii C',
      '004 4 iv D',
      '005 5 v E',
    ]);
  });
});

describe('body page fields with number-format switches', () => {
  /** The field's painted text and the gap the flow measured for it, on the second page. */
  function fieldOnSecondPage(instruction: string, sectPr = '') {
    const filler = Array.from(
      { length: 60 },
      (_unused, index) => `<w:p>${text(`Line ${index + 1}`)}</w:p>`
    ).join('');
    const field = `<w:p>${complexField(instruction, '')}${text('END')}</w:p>`;
    const layout = layoutOf(packageOf(filler + field, sectPr));
    expect(layout.pages.length).toBe(2);
    for (const fragment of layout.pages[1]!.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const line of fragment.lines) {
        const end = line.spans.find((span) => span.text === 'END');
        const painted = line.spans[0];
        if (!end || !painted || painted === end) continue;
        return {
          field: painted.text,
          gap: end.box.x - painted.box.x,
          charWidth: end.box.width / 'END'.length,
        };
      }
    }
    throw new Error('field line not found');
  }

  test('substitutes the formatted value and measures its shape', () => {
    const dashed = fieldOnSecondPage('PAGE \\* ArabicDash \\* MERGEFORMAT');
    expect(dashed.field).toBe('- 2 -');
    expect(dashed.gap).toBeCloseTo(5 * dashed.charWidth, 6);
    expect(fieldOnSecondPage('PAGE \\* ROMAN').field).toBe('II');
    expect(fieldOnSecondPage('NUMPAGES \\* alphabetic').field).toBe('b');
  });

  test('paints a spaced value as one span', () => {
    // A placeholder that broke into words at its spaces left one span per word, and finalize
    // painted the whole value into each of them.
    for (const [instruction, value] of [
      ['PAGE \\* ArabicDash', '- 2 -'],
      ['PAGE \\# "Page 0 of"', 'Page 2 of'],
    ] as const) {
      const filler = Array.from({ length: 60 }, () => `<w:p>${text('Line')}</w:p>`).join('');
      const field = `<w:p>${text('[')}${complexField(instruction, '')}${text(']')}</w:p>`;
      const layout = layoutOf(packageOf(filler + field, ''));
      const painted = spansOf(layout.pages[1]!.fragments).join('');
      expect(painted).toContain(`[${value}]`);
    }
  });

  test('renders Arabic under a roman section', () => {
    const roman = '<w:pgNumType w:fmt="upperRoman"/>';
    expect(fieldOnSecondPage('PAGE', roman).field).toBe('II');
    expect(fieldOnSecondPage('PAGE \\* Arabic', roman).field).toBe('2');
  });
});

describe('body page-field substitution', () => {
  const atom = (text: string, start: number): StyleSpanRecord =>
    ({
      text,
      range: { paragraphId: 'p', start, end: start + 1 },
      fieldAtom: { formField: false, pageField: { kind: 'PAGE', numberFormat: 'numberInDash' } },
    }) as unknown as StyleSpanRecord;
  const plain = (text: string, start: number): StyleSpanRecord =>
    ({ text, range: { paragraphId: 'p', start, end: start + text.length } }) as StyleSpanRecord;

  test('paints the value once when the placeholder spans several pieces or lines', () => {
    const block = {
      kind: 'paragraph',
      lines: [
        { spans: [plain('[', 0), atom('-', 1), atom('\u00a01', 1)] },
        { spans: [atom('\u00a0-', 1), plain(']', 2), atom('-\u00a01\u00a0-', 3)] },
      ],
    } as unknown as BlockFragmentRecord;
    const [result] = substituteBodyPageFields([block], { pageNumber: 7, pageCount: 9 });
    if (result?.kind !== 'paragraph') throw new Error('paragraph expected');
    expect(result.lines.map((line) => line.spans.map((span) => span.text))).toEqual([
      ['[', '- 7 -', ''],
      ['', ']', '- 7 -'],
    ]);
  });
});
