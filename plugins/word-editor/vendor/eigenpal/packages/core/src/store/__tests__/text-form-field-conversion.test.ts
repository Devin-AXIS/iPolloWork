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

function numberField(value: string, format: string) {
  const opened = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="NumberInput"/><w:textInput><w:type w:val="number"/><w:default w:val="7"/><w:format w:val="${format}"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${value}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  const body = opened.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children[0] as OoxmlParagraphNode;
  const field = textFormFieldsOf(paragraph)[0]!;
  return { part: opened.part, paragraph, field };
}

for (const [input, expected] of [
  ['abc', '0'],
  ['xyz', '0'],
  ['12abc', '12'],
  ['abc12', '12'],
  ['a1b2c3', '123'],
]) {
  for (const format of ['', '0.00']) {
    test(`numeric field exit converts ${input} with ${format || 'no picture'} like Word`, () => {
      const { part, paragraph, field } = numberField(input!, format);
      const op = {
        op: 'commitTextFormField',
        paragraphId: paragraph.id,
        fieldNodeId: field.fieldNodeId,
      } as const;
      expect(validateTreeOp(part, op)).toBeNull();
      const applied = applyTreeOp(part, op);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(paragraphTextOf(applied.part, paragraph.id)).toBe(expected + (format ? '.00' : ''));
      const nextBody = applied.part.root.children[0]!;
      if (nextBody.kind === 'textValue') throw new Error('body');
      const nextField = textFormFieldsOf(nextBody.children[0] as OoxmlParagraphNode)[0]!;
      expect(nextField.fieldNodeId).toBe(field.fieldNodeId);
      expect(nextField.defaultText).toBe('7');
    });
  }
}

test('malformed numeric punctuation remains an invalid field exit', () => {
  const { part, paragraph, field } = numberField('1.2.3', '0.00');
  const op = {
    op: 'commitTextFormField',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
  } as const;
  expect(validateTreeOp(part, op)).toBe('invalidArgs');
  expect(applyTreeOp(part, op).ok).toBe(false);
  expect(paragraphTextOf(part, paragraph.id)).toBe('1.2.3');
});

for (const [input, format, expected] of [
  ['-12.5', '0.00', '-12.50'],
  ['$1,234.50', '0.00', '1234.50'],
  ['(12.5)', '0.00', '-12.50'],
  ['1e3', '0.00', '13.00'],
  ['abc 12', '0.00', '12.00'],
  ['1 2', '0.00', '12.00'],
  ['1#2', '0.00', '12.00'],
  ['1-2', '0.00', '-12.00'],
  ['1,2', '0.00', '12.00'],
  ['12%', '0.00%', '12.00%'],
  ['0012.50', '', '12'],
  ['12.9', '', '12'],
  ['-12.9', '', '-12'],
  ['1250%', '', '12'],
]) {
  test(`Word numeric conversion: ${input} with ${format || 'empty picture'}`, () => {
    const { part, paragraph, field } = numberField(input!, format!);
    const op = {
      op: 'commitTextFormField',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
    } as const;
    expect(validateTreeOp(part, op)).toBeNull();
    const applied = applyTreeOp(part, op);
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(paragraphTextOf(applied.part, paragraph.id)).toBe(expected!);
  });
}

test('repeated minus signs fail without mutating the field', () => {
  const { part, paragraph, field } = numberField('--12', '0.00');
  const op = {
    op: 'commitTextFormField',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
  } as const;
  expect(validateTreeOp(part, op)).toBe('invalidArgs');
  expect(applyTreeOp(part, op).ok).toBe(false);
  expect(paragraphTextOf(part, paragraph.id)).toBe('--12');
});

for (const input of ['abc 12', 'abc12']) {
  test(`formatted numeric default converts ${input} and survives serialization`, () => {
    const { part, paragraph, field } = numberField('7', '0.00');
    const op = {
      op: 'setTextFormFieldDefault',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      text: input,
    } as const;
    expect(validateTreeOp(part, op)).toBeNull();
    const applied = applyTreeOp(part, op);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(paragraphTextOf(applied.part, paragraph.id)).toBe('12.00');
    const xml = serializeOoxmlPart(applied.part);
    const reopened = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const body = reopened.part.root.children[0]!;
    if (body.kind === 'textValue') throw new Error('body');
    const nextParagraph = body.children[0] as OoxmlParagraphNode;
    expect(paragraphTextOf(reopened.part, nextParagraph.id)).toBe('12.00');
    expect(textFormFieldsOf(nextParagraph)).toHaveLength(1);
    expect(textFormFieldsOf(nextParagraph)[0]!.format).toBe('0.00');
    expect(textFormFieldsOf(nextParagraph)[0]!.defaultText).toBe('12.00');
  });
}

test('formatted numeric default still refuses malformed punctuation atomically', () => {
  const { part, paragraph, field } = numberField('7', '0.00');
  const op = {
    op: 'setTextFormFieldDefault',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
    text: '1.2.3',
  } as const;
  expect(validateTreeOp(part, op)).toBe('invalidArgs');
  expect(applyTreeOp(part, op).ok).toBe(false);
  expect(paragraphTextOf(part, paragraph.id)).toBe('7');
});

for (const input of ['abc 12', '12.9']) {
  test(`unformatted numeric default preserves ${input}, while protected exit converts`, () => {
    const { part, paragraph, field } = numberField('7', '');
    const op = {
      op: 'setTextFormFieldDefault',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      text: input,
    } as const;
    expect(validateTreeOp(part, op)).toBeNull();
    const applied = applyTreeOp(part, op);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(paragraphTextOf(applied.part, paragraph.id)).toBe(input);
    const reopened = readOoxmlPart(serializeOoxmlPart(applied.part), {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const body = reopened.part.root.children[0]!;
    if (body.kind === 'textValue') throw new Error('body');
    const next = body.children[0] as OoxmlParagraphNode;
    const savedField = textFormFieldsOf(next)[0]!;
    expect(paragraphTextOf(reopened.part, next.id)).toBe(input);
    expect(savedField.defaultText).toBe(input);
    expect(savedField.format).toBe('');
    const committed = applyTreeOp(reopened.part, {
      op: 'commitTextFormField',
      paragraphId: next.id,
      fieldNodeId: savedField.fieldNodeId,
    });
    expect(committed.ok).toBe(true);
    if (committed.ok) expect(paragraphTextOf(committed.part, next.id)).toBe('12');
  });
}

test('unformatted numeric default still enforces XML text and maximum length', () => {
  const { part, paragraph, field } = numberField('7', '');
  for (const text of ['abc 12', 'a\tb', 'a\u0000b']) {
    const op = {
      op: 'setTextFormFieldDefault',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      text,
      options: { type: 'number', maxLength: 3, format: '', enabled: true },
    } as const;
    expect(validateTreeOp(part, op)).toBe('invalidArgs');
    expect(applyTreeOp(part, op).ok).toBe(false);
  }
  expect(paragraphTextOf(part, paragraph.id)).toBe('7');
});
