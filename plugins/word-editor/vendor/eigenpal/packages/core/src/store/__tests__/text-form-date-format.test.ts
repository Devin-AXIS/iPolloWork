import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  paragraphTextOf,
  readOoxmlPart,
  serializeOoxmlPart,
  textFormFieldsOf,
  validateTreeOp,
  type OoxmlParagraphNode,
} from '../index.ts';

import { parseTextFormDate } from '../store/text-form-date-format.ts';
import { formatTextFormValue, textFormInputLength } from '../store/text-form-field-options.ts';
function dateField(value: string, format: string) {
  const opened = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="DateInput"/><w:textInput><w:type w:val="date"/><w:default w:val="7"/><w:format w:val="${format}"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${value}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  const body = opened.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children[0] as OoxmlParagraphNode;
  const field = textFormFieldsOf(paragraph)[0]!;
  return { part: opened.part, paragraph, field };
}

for (const [locale, format, expected] of [
  ['en-GB', 'MM/dd/yyyy', '02/01/2030'],
  ['en-GB', 'dd/MM/yyyy', '01/02/2030'],
  ['en-GB', 'MMMM d, yyyy', 'February 1, 2030'],
  ['en-US', 'dd/MM/yyyy', '02/01/2030'],
] as const) {
  test(`date input ${locale} is independent of output ${format}`, () => {
    const { part, paragraph, field } = dateField('1/2/2030', format);
    const op = {
      op: 'commitTextFormField',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      locale,
    } as const;
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (result.ok) expect(paragraphTextOf(result.part, paragraph.id)).toBe(expected);
    const defaults = {
      op: 'setTextFormFieldDefault',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      text: '1/2/2030',
      locale,
    } as const;
    expect(validateTreeOp(part, defaults)).toBeNull();
    const edited = applyTreeOp(part, defaults);
    if (edited.ok) expect(paragraphTextOf(edited.part, paragraph.id)).toBe(expected);
    expect(edited.ok).toBe(true);
  });
}
test('date input falls back when preferred slash order is invalid', () => {
  for (const locale of ['en-US', 'en-GB'] as const) {
    for (const value of ['12/31/2030', '31/12/2030']) {
      expect(parseTextFormDate(value, locale)).toEqual({ year: 2030, month: 12, day: 31 });
    }
    expect(parseTextFormDate('2/30/2030', locale)).toBeNull();
  }
});
test('date input supports ISO and the two-digit year cutoff', () => {
  expect(parseTextFormDate('2030-02-01', 'en-GB')).toEqual({ year: 2030, month: 2, day: 1 });
  expect(parseTextFormDate('1/2/29', 'en-GB')).toEqual({ year: 2029, month: 2, day: 1 });
  expect(parseTextFormDate('1/2/30', 'en-GB')).toEqual({ year: 1930, month: 2, day: 1 });
});

for (const year of ['0100', '0400', '0999', '1000', '9999']) {
  test(`date pictures retain all four digits of year ${year}`, () => {
    for (const [format, expected] of [
      ['M/d/yyyy', `1/2/${year}`],
      ['MM/dd/yyyy', `01/02/${year}`],
      ['d/M/yyyy', `2/1/${year}`],
      ['dd/MM/yyyy', `02/01/${year}`],
      ['yyyy-MM-dd', `${year}-01-02`],
      ['d MMMM yyyy', `2 January ${year}`],
      ['MMMM d, yyyy', `January 2, ${year}`],
    ] as const) {
      expect(formatTextFormValue(`${year}-01-02`, { type: 'date', format }, 'fill')).toBe(expected);
      expect(parseTextFormDate(expected, format.startsWith('d') ? 'en-GB' : 'en-US')).toEqual({
        year: Number(year),
        month: 1,
        day: 2,
      });
    }
    expect(
      textFormInputLength(
        `January 2, ${year}`,
        { type: 'date', format: 'MMMM d, yyyy' },
        `January 1, ${year}`
      )
    ).toBe(8);
  });

  test(`saved year ${year} remains editable after changing the locale and date picture`, () => {
    const { part, paragraph, field } = dateField(`${year}-01-02`, 'MM/dd/yyyy');
    const initial = applyTreeOp(part, {
      op: 'setTextFormFieldDefault',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      text: `${year}-01-02`,
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const reopened = readOoxmlPart(serializeOoxmlPart(initial.part), {
      name: part.name,
      contentType: part.contentType,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const reopenedBody = reopened.part.root.children[0]!;
    if (reopenedBody.kind === 'textValue') throw new Error('body');
    const reopenedParagraph = reopenedBody.children[0] as OoxmlParagraphNode;
    const saved = textFormFieldsOf(reopenedParagraph)[0]!;
    expect(saved.defaultText).toBe(`01/02/${year}`);
    for (const [format, expected] of [
      ['MM/dd/yyyy', `01/02/${year}`],
      ['dd/MM/yyyy', `02/01/${year}`],
      ['yyyy-MM-dd', `${year}-01-02`],
      ['MMMM d, yyyy', `January 2, ${year}`],
    ] as const) {
      const op = {
        op: 'setTextFormFieldDefault',
        paragraphId: reopenedParagraph.id,
        fieldNodeId: saved.fieldNodeId,
        text: saved.defaultText,
        locale: 'ja-JP',
        options: { type: 'date', format, maxLength: 0, enabled: true },
      } as const;
      expect(validateTreeOp(reopened.part, op)).toBeNull();
      const edited = applyTreeOp(reopened.part, op);
      expect(edited.ok).toBe(true);
      if (edited.ok) expect(paragraphTextOf(edited.part, reopenedParagraph.id)).toBe(expected);
    }
  });
}

test('padding preserves the supported year range and Gregorian leap-day rules', () => {
  for (const value of ['0099-01-02', '10000-01-02', '0100-02-29']) {
    expect(formatTextFormValue(value, { type: 'date', format: 'yyyy-MM-dd' }, 'fill')).toBeNull();
  }
  expect(formatTextFormValue('0400-02-29', { type: 'date', format: 'yyyy-MM-dd' }, 'fill')).toBe(
    '0400-02-29'
  );
});
test('date input defaults to en-US and rejects malformed operation locales', () => {
  const { part, paragraph, field } = dateField('1/2/2030', 'dd/MM/yyyy');
  const op = {
    op: 'commitTextFormField',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
  } as const;
  const result = applyTreeOp(part, op);
  expect(result.ok).toBe(true);
  if (result.ok) expect(paragraphTextOf(result.part, paragraph.id)).toBe('02/01/2030');
  const invalid = { ...op, locale: 'not_a_locale' } as unknown as typeof op;
  expect(validateTreeOp(part, invalid)).toBe('invalidArgs');
  expect(applyTreeOp(part, invalid).ok).toBe(false);
});

for (const [locale, input, month, day] of [
  ['en-US', '1/2/2030', 1, 2],
  ['en-GB', '1/2/2030', 2, 1],
  ['pl-PL', '01.02.2030', 2, 1],
  ['de-DE', '1.2.2030', 2, 1],
  ['fr-FR', '01/02/2030', 2, 1],
  ['pt-BR', '01/02/2030', 2, 1],
  ['hi-IN', '1/2/2030', 2, 1],
  ['tr-TR', '01.02.2030', 2, 1],
  ['id-ID', '1/2/2030', 2, 1],
  ['he-IL', '1.2.2030', 2, 1],
  ['ja-JP', '2030/2/1', 2, 1],
  ['zh-CN', '2030/2/1', 2, 1],
  ['ko-KR', '2030. 2. 1.', 2, 1],
  ['sv-SE', '2030-02-01', 2, 1],
  ['ar-EG', '١/٢/٢٠٣٠', 2, 1],
  ['en-GB-u-nu-arab', '١/٢/٢٠٣٠', 2, 1],
  ['en-US', 'February 1, 2030', 2, 1],
  ['pl-PL', '1 February 2030', 2, 1],
] as const) {
  test(`${locale} parses ${input} as a Gregorian date`, () => {
    expect(parseTextFormDate(input, locale)).toEqual({ year: 2030, month, day });
  });
}

for (const locale of ['en-US', 'en-GB', 'pl-PL', 'ja-JP', 'ko-KR', 'ar-EG', 'fa-IR', 'th-TH']) {
  test(`accepts Intl's Gregorian numeric pattern and digits for ${locale}`, () => {
    const text = new Intl.DateTimeFormat(locale, {
      calendar: 'gregory',
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(new Date(Date.UTC(2030, 1, 1)));
    expect(parseTextFormDate(text, locale)).toEqual({ year: 2030, month: 2, day: 1 });
    expect(parseTextFormDate('2030-02-01', locale)).toEqual({ year: 2030, month: 2, day: 1 });
  });
}

for (const [locale, value] of [
  ['en-US', '2/29/2030'],
  ['pl-PL', '29.02.2030'],
  ['en-GB', '31/04/2030'],
  ['ja-JP', '2030/13/1'],
  ['en-US', '1/2/030'],
  ['en-GB', '1/2/0'],
  ['en-US', '1/2/20300'],
  ['en-US', '1/2-2030'],
  ['en-GB', '01/02/2030 junk'],
  ['en-US', '2030-02-30'],
  ['en-GB', '0000-01-01'],
  ['en-US', '0/1/2030'],
  ['pl-PL', '1 lutego 2030'],
  ['en-US', '1/2/2030 12:00'],
] as const) {
  test(`${locale} refuses invalid or unsupported input ${value}`, () => {
    expect(parseTextFormDate(value, locale)).toBeNull();
  });
}

test('valid leap days, canonical locale tags, and deterministic fallback', () => {
  expect(parseTextFormDate('29.02.2032', 'pl-pl')).toEqual({ year: 2032, month: 2, day: 29 });
  for (const locale of [undefined, 'not_a_locale', 'zz-ZZ', '']) {
    expect(parseTextFormDate('1/2/2030', locale)).toEqual({ year: 2030, month: 1, day: 2 });
  }
});

test('changing locale or reopening a saved default does not reinterpret its authored picture', () => {
  const { part, paragraph, field } = dateField('01/02/2030', 'MM/dd/yyyy');
  const first = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
    text: '2030-01-02',
    locale: 'en-US',
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  for (const format of ['MM/dd/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy']) {
    const next = applyTreeOp(first.part, {
      op: 'setTextFormFieldDefault',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      text: '01/02/2030',
      locale: 'en-GB',
      options: { type: 'date', format, maxLength: 0, enabled: true },
    });
    expect(next.ok).toBe(true);
    if (next.ok)
      expect(paragraphTextOf(next.part, paragraph.id)).toBe(
        format === 'yyyy-MM-dd'
          ? '2030-01-02'
          : format === 'dd/MM/yyyy'
            ? '02/01/2030'
            : '01/02/2030'
      );
  }
});

test('changing a saved date picture preserves the original input limit', () => {
  const { part, paragraph, field } = dateField('01/02/2030', 'MM/dd/yyyy');
  const initial = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
    text: '1/2/2030',
    locale: 'en-US',
    options: { type: 'date', format: 'MMMM d, yyyy', maxLength: 10, enabled: true },
  });
  expect(initial.ok).toBe(true);
  if (!initial.ok) return;
  const change = {
    op: 'setTextFormFieldDefault',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
    text: 'January 2, 2030',
    locale: 'en-GB',
    options: { type: 'date', format: 'yyyy-MM-dd', maxLength: 10, enabled: true },
  } as const;
  const result = applyTreeOp(initial.part, change);
  expect(result.ok).toBe(true);
  if (result.ok) expect(paragraphTextOf(result.part, paragraph.id)).toBe('2030-01-02');
  expect(validateTreeOp(initial.part, { ...change, text: 'January 3, 2030' })).toBe('invalidArgs');
  expect(
    validateTreeOp(initial.part, { ...change, options: { ...change.options, maxLength: 9 } })
  ).toBe('invalidArgs');
});

test('ISO interpretation takes precedence over colliding regional year-day-month patterns', () => {
  for (const locale of ['ky', 'ug']) {
    expect(parseTextFormDate('2030-01-02', locale)).toEqual({ year: 2030, month: 1, day: 2 });
  }
});

test('clearing a saved date picture keeps the default reopenable at its original input limit', () => {
  const { part, paragraph, field } = dateField('01/02/2030', 'MM/dd/yyyy');
  const initial = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
    text: '1/2/2030',
    locale: 'en-US',
    options: { type: 'date', format: 'MMMM d, yyyy', maxLength: 10, enabled: true },
  });
  expect(initial.ok).toBe(true);
  if (!initial.ok) return;
  const change = {
    op: 'setTextFormFieldDefault',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
    text: 'January 2, 2030',
    locale: 'pl-PL',
    options: { type: 'date', format: '', maxLength: 10, enabled: true },
  } as const;
  const cleared = applyTreeOp(initial.part, change);
  expect(cleared.ok).toBe(true);
  if (!cleared.ok) return;
  const reopened = applyTreeOp(cleared.part, change);
  expect(reopened.ok).toBe(true);
  expect(
    validateTreeOp(cleared.part, { ...change, options: { ...change.options, maxLength: 12 } })
  ).toBeNull();
  expect(validateTreeOp(cleared.part, { ...change, text: 'January 3, 2030' })).toBe('invalidArgs');
  expect(
    validateTreeOp(cleared.part, { ...change, options: { ...change.options, maxLength: 9 } })
  ).toBe('invalidArgs');
});
