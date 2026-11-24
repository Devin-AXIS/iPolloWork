import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { applyHAnsiFontSlots } from '../hansi-font-slots.ts';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle, type ThemeFonts } from '../run-style.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const fonts: OoxmlProperty[] = [
  {
    localName: 'rFonts',
    attributes: {
      ascii: 'Times New Roman',
      hAnsi: 'Arial',
      eastAsia: 'SimSun',
    },
  },
];
function piece(text: string, props = fonts, start = 0): FieldAwarePiece {
  return { text, props, start, end: start + text.length, style: resolveRunStyle(props) };
}
function read(text: string, hAnsi = 'Arial') {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" ' +
    `w:hAnsi="${hAnsi}" w:eastAsia="SimSun"/><w:sz w:val="28"/><w:b/><w:i/>` +
    `</w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!loaded.ok) throw Error(loaded.reason);
  return loaded.part;
}

test('one source run measures ascii, hAnsi and eastAsia independently without changing OOXML', () => {
  const part = read('文 A é'),
    before = serializeOoxmlPart(part),
    base = createFixedMeasurer(7, 14);
  const calls: [string, string | null][] = [];
  const layout = layoutSemanticDocument(part, 0, {
    measurer: {
      ...base,
      measure(text, style) {
        calls.push([text, style.fontFamily]);
        return base.measure(text, style);
      },
    },
  });
  expect(calls).toContainEqual(['é', 'Arial']);
  expect(calls).toContainEqual(['文', 'SimSun']);
  expect(calls).toContainEqual(['A', 'Times New Roman']);
  const spans = layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
    )
  );
  expect(spans.map((span) => span.text).join('')).toBe('文 A é');
  expect(
    spans.every((span) => span.style.fontSizePt === 14 && span.style.bold && span.style.italic)
  ).toBe(true);
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('literal pieces keep UTF-16 ranges and whole combining clusters across source runs', () => {
  const original = piece('Aé\u0301B'),
    out = applyHAnsiFontSlots([original]);
  expect(out.map((p) => [p.text, p.start, p.end, p.style.fontFamily])).toEqual([
    ['A', 0, 1, 'Times New Roman'],
    ['é\u0301', 1, 3, 'Arial'],
    ['B', 3, 4, 'Times New Roman'],
  ]);
  expect(original.text).toBe('Aé\u0301B');
  const split = applyHAnsiFontSlots([piece('é'), piece('\u0301', fonts, 1)]);
  expect(split.map((p) => p.style.fontFamily)).toEqual(['Arial', 'Arial']);
  const ascii = applyHAnsiFontSlots([piece('e'), piece('\u0301', fonts, 1)]);
  expect(ascii.map((p) => p.style.fontFamily)).toEqual(['Times New Roman', 'Times New Roman']);
  const equal = (face: string): OoxmlProperty[] => [
    { localName: 'rFonts', attributes: { ascii: face, hAnsi: face } },
  ];
  const plain = [piece('é', equal('Arial'))];
  expect(applyHAnsiFontSlots(plain)).toBe(plain);
  const equalSlots = applyHAnsiFontSlots([
    piece('é', equal('Arial')),
    piece('\u0301', equal('Tahoma'), 1),
  ]);
  expect(equalSlots.map((p) => p.style.fontFamily)).toEqual(['Arial', 'Arial']);
});

test('independent inheritance and same-level theme precedence select the hAnsi face', () => {
  const inherited = piece('é', [
    ...fonts,
    { localName: 'rFonts', attributes: { ascii: 'Calibri' } },
  ]);
  expect(applyHAnsiFontSlots([inherited])[0]!.style.fontFamily).toBe('Arial');
  const theme: ThemeFonts = { minor: 'Cambria', major: 'Georgia' };
  const themed = piece('é', [
    ...fonts,
    {
      localName: 'rFonts',
      attributes: {
        hAnsi: 'Arial',
        hAnsiTheme: 'minorHAnsi',
      },
    },
  ]);
  expect(applyHAnsiFontSlots([themed], theme)[0]!.style.fontFamily).toBe('Cambria');
  const direct = piece('é', [
    ...themed.props,
    { localName: 'rFonts', attributes: { hAnsi: 'Tahoma' } },
  ]);
  expect(applyHAnsiFontSlots([direct], theme)[0]!.style.fontFamily).toBe('Tahoma');
});

test('existing East Asian hints, explicit complex scripts and symbol faces keep their lanes', () => {
  const hinted = [...fonts, { localName: 'rFonts', attributes: { hint: 'eastAsia' } }];
  const eastAsianText = (props: OoxmlProperty[]) =>
    applyHAnsiFontSlots(applyEastAsiaFontSlots([piece('·Ωé', props)]))
      .filter((p) => p.fontSlot === 'eastAsia')
      .map((p) => p.text)
      .join('');
  // A Japanese East Asian language keeps the accented letter in the hAnsi face.
  const japanese = [...hinted, { localName: 'lang', attributes: { eastAsia: 'ja-JP' } }];
  expect(eastAsianText(japanese)).toBe('·Ω');
  const out = applyHAnsiFontSlots(applyEastAsiaFontSlots([piece('·Ωé', japanese)]));
  expect(out.find((p) => p.text === 'é')!.style.fontFamily).toBe('Arial');
  // A Chinese or absent East Asian language sends it to the East Asian face.
  expect(eastAsianText(hinted)).toBe('·Ωé');
  expect(eastAsianText([...hinted, { localName: 'lang', attributes: { eastAsia: 'zh-CN' } }])).toBe(
    '·Ωé'
  );
  for (const flag of ['cs', 'rtl']) {
    const p = piece('é', [
      ...fonts,
      { localName: 'rFonts', attributes: { cs: 'Complex' } },
      { localName: flag },
    ]);
    expect(applyHAnsiFontSlots([p])[0]).toBe(p);
  }
  const symbol = piece('é', [
    { localName: 'rFonts', attributes: { ascii: 'Wingdings', hAnsi: 'Arial' } },
  ]);
  expect(applyHAnsiFontSlots([symbol])[0]).toBe(symbol);
});

test('projected atoms change face only for a uniform slot and controls remain intact', () => {
  const uniform = { ...piece('éé'), projected: true, start: 4, end: 5 };
  const out = applyHAnsiFontSlots([uniform])[0]!;
  expect([out.start, out.end, out.text, out.style.fontFamily]).toEqual([4, 5, 'éé', 'Arial']);
  const mixed = { ...piece('Aé'), projected: true, end: 1 };
  expect(applyHAnsiFontSlots([mixed])[0]).toBe(mixed);
  for (const override of [{ breakKind: 'line' as const }, { anchoredAtom: true as const }]) {
    const p = { ...piece('é'), ...override };
    expect(applyHAnsiFontSlots([p])[0]).toBe(p);
  }
});

test('a cached atomic field result splits by face and keeps its one model range', () => {
  const atom: FieldAwarePiece = {
    ...piece('café über'),
    projected: true,
    fieldAtom: { formField: false },
    start: 7,
    end: 8,
  };
  const out = applyHAnsiFontSlots([atom]);
  expect(out.map((p) => [p.text, p.start, p.end, p.style.fontFamily])).toEqual([
    ['caf', 7, 8, 'Times New Roman'],
    ['é', 7, 8, 'Arial'],
    [' ', 7, 8, 'Times New Roman'],
    ['ü', 7, 8, 'Arial'],
    ['ber', 7, 8, 'Times New Roman'],
  ]);
  expect(out.every((p) => p.fieldAtom === atom.fieldAtom)).toBe(true);
  // A measurement reservation stays whole.
  const reserved = { ...atom, measureText: 'café über' };
  expect(applyHAnsiFontSlots([reserved])[0]).toBe(reserved);
});

test('a changed hAnsi face invalidates cached measurements without changing text or ascii', () => {
  const cache = createParagraphLayoutCache(),
    base = createFixedMeasurer(7, 14),
    calls: string[] = [];
  const measurer = {
    ...base,
    measure(text: string, style: Parameters<typeof base.measure>[1]) {
      calls.push(style.fontFamily ?? '');
      return base.measure(text, style);
    },
  };
  const first = read('é', 'Arial');
  layoutSemanticDocument(first, 0, { cache, measurer, producer: 'font-test' });
  calls.length = 0;
  layoutSemanticDocument(first, 1, { cache, measurer, producer: 'font-test' });
  expect(calls).toEqual([]);
  calls.length = 0;
  layoutSemanticDocument(read('é', 'Tahoma'), 2, { cache, measurer, producer: 'font-test' });
  expect(calls).toContain('Tahoma');
});

test('definite Unicode lanes keep ASCII, CJK, complex scripts and supplementary text separate', () => {
  const original = piece('A1éΩЖअก文（ﺎ𠀀😀');
  const eastAsia = applyEastAsiaFontSlots([original]);
  const out = applyHAnsiFontSlots(eastAsia);
  expect(
    out
      .filter((p) => p.fontSlot === 'hAnsi')
      .map((p) => p.text)
      .join('')
  ).toBe('éΩЖअก');
  expect(
    out
      .filter((p) => p.fontSlot === 'eastAsia')
      .map((p) => p.text)
      .join('')
  ).toBe(
    eastAsia
      .filter((p) => p.fontSlot === 'eastAsia')
      .map((p) => p.text)
      .join('')
  );
  expect(out.map((p) => p.text).join('')).toBe(original.text);
  expect(out.map((p) => p.end - p.start).reduce((sum, length) => sum + length, 0)).toBe(
    original.text.length
  );
  const ascii = [piece('Basic Latin A-01')];
  expect(applyHAnsiFontSlots(ascii)).toBe(ascii);
  const nbsp = applyHAnsiFontSlots([piece('§1 2')]);
  expect(nbsp.map((p) => [p.text, p.style.fontFamily])).toEqual([
    ['§', 'Arial'],
    ['1', 'Times New Roman'],
    [' ', 'Arial'],
    ['2', 'Times New Roman'],
  ]);
  const noHAnsi = piece('é', [{ localName: 'rFonts', attributes: { ascii: 'Calibri' } }]);
  expect(applyHAnsiFontSlots([noHAnsi])[0]).toBe(noHAnsi);
});

test('an explicit ascii face beside an hAnsi theme reference keeps the ascii slot', () => {
  const theme: ThemeFonts = { minor: 'Verdana', major: 'Georgia' };
  const props: OoxmlProperty[] = [
    { localName: 'rFonts', attributes: { ascii: 'Georgia', hAnsiTheme: 'minorHAnsi' } },
  ];
  const style = resolveRunStyle(props, theme);
  expect(style.fontFamily).toBe('Georgia');
  const out = applyHAnsiFontSlots([{ text: 'Aé', props, start: 0, end: 2, style }], theme);
  expect(out.map((p) => [p.text, p.style.fontFamily])).toEqual([
    ['A', 'Georgia'],
    ['é', 'Verdana'],
  ]);
});

test('a layout with no named faces uses the format defaults beneath an authored rPrDefault', () => {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr><w:t>Aé文</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  const stylesXml = readOoxmlPart(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault>' +
      '</w:docDefaults></w:styles>',
    { name: '/word/styles.xml', contentType: 'application/xml' }
  );
  if (!loaded.ok || !stylesXml.ok) throw Error('parse');
  const calls: [string, string | null][] = [];
  const base = createFixedMeasurer(7, 14);
  layoutSemanticDocument(loaded.part, 0, {
    styleCascade: buildStyleCascadeTable(stylesXml.part.root),
    measurer: {
      ...base,
      measure(text, style) {
        calls.push([text, style.fontFamily]);
        return base.measure(text, style);
      },
    },
  });
  expect(calls).toContainEqual(['A', 'Georgia']);
  expect(calls).toContainEqual(['é', 'Times New Roman']);
  expect(calls).toContainEqual(['文', 'SimSun']);
});
