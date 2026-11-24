import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  findNode,
  paragraphTextOf,
  readOoxmlPart,
  serializeOoxmlPart,
  textFormFieldsOf,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../index.ts';

const field =
  '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:textInput/></w:ffData></w:fldChar></w:r>' +
  '<w:r><w:instrText> FORMTEXT </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:rPr><w:b/></w:rPr><w:t>Field</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const revision = { author: 'Reviewer', date: '2026-09-15T12:00:00Z' };
const control = (content: string, locked = false) =>
  `<w:sdt><w:sdtPr>${locked ? '<w:lock w:val="contentLocked"/>' : ''}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function open(content: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children[0] as OoxmlParagraphNode;
  return { part: parsed.part, paragraph };
}

function ranges(part: OoxmlPart, paragraphId: string) {
  const p = findNode(part, paragraphId);
  if (p?.kind !== 'paragraph') throw new Error('paragraph');
  return textFormFieldsOf(p).map(({ start, end }) => [start, end]);
}

for (const tracked of [false, true]) {
  for (const wrapper of ['', 'smartTag', 'sdt']) {
    test(`${tracked ? 'tracked' : 'plain'} field-end typing stays outside ${wrapper || 'plain runs'}`, () => {
      const content =
        wrapper === 'sdt'
          ? control(field)
          : wrapper
            ? `<w:${wrapper}>${field}</w:${wrapper}>`
            : field;
      const { part, paragraph } = open(content);
      const result = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: paragraph.id,
        offset: 5,
        text: 'OUT',
        ...(tracked ? { revision } : {}),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(ranges(result.part, paragraph.id)).toEqual([[0, 5]]);
      expect(paragraphTextOf(result.part, paragraph.id)).toBe('FieldOUT');
      expect(serializeOoxmlPart(result.part)).toContain('<w:rPr><w:b/></w:rPr><w:t>OUT</w:t>');
      if (tracked) {
        for (const accept of [false, true]) {
          const resolved = applyTreeOp(result.part, {
            op: accept ? 'acceptAllRevisions' : 'rejectAllRevisions',
          });
          expect(resolved.ok).toBe(true);
          if (!resolved.ok) continue;
          expect(ranges(resolved.part, paragraph.id)).toEqual([[0, 5]]);
          expect(paragraphTextOf(resolved.part, paragraph.id)).toBe(accept ? 'FieldOUT' : 'Field');
        }
      }
    });
  }

  for (const sharedRun of [false, true]) {
    test(`${tracked ? 'tracked' : 'plain'} typing between adjacent fields does not fill either, sharedRun=${sharedRun}`, () => {
      const content = sharedRun
        ? (field + field).replaceAll('<w:rPr><w:b/></w:rPr>', '').replaceAll('</w:r><w:r>', '')
        : field + field;
      const { part, paragraph } = open(content);
      const result = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: paragraph.id,
        offset: 5,
        text: 'OUT',
        ...(tracked ? { revision } : {}),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(ranges(result.part, paragraph.id)).toEqual([
        [0, 5],
        [8, 13],
      ]);
      expect(paragraphTextOf(result.part, paragraph.id)).toBe('FieldOUTField');
    });
  }

  test(`${tracked ? 'tracked' : 'plain'} field-end typing ignores a following locked control`, () => {
    const { part, paragraph } = open(field + control('<w:r><w:t>Locked</w:t></w:r>', true));
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 5,
      text: 'OUT',
      ...(tracked ? { revision } : {}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ranges(result.part, paragraph.id)).toEqual([[0, 5]]);
    expect(paragraphTextOf(result.part, paragraph.id)).toBe('FieldOUTLocked');
  });

  test(`${tracked ? 'tracked' : 'plain'} field-end typing respects an enclosing lock`, () => {
    const { part, paragraph } = open(control(field + '<w:r><w:t>Locked</w:t></w:r>', true));
    expect(
      applyTreeOp(part, {
        op: 'insertText',
        paragraphId: paragraph.id,
        offset: 5,
        text: 'OUT',
        ...(tracked ? { revision } : {}),
      })
    ).toMatchObject({ ok: false, reason: 'locked' });
  });
}

for (const sharedRun of [false, true]) {
  test(`field-end typing extends our pending insertion without nesting revisions, sharedRun=${sharedRun}`, () => {
    const content = field + '<w:r><w:t>Tail</w:t></w:r>';
    const { part, paragraph } = open(
      `<w:ins w:id="0" w:author="${revision.author}" w:date="${revision.date}">${sharedRun ? content.replaceAll('<w:rPr><w:b/></w:rPr>', '').replaceAll('</w:r><w:r>', '') : content}</w:ins>`
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 5,
      text: 'OUT',
      revision,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ranges(result.part, paragraph.id)).toEqual([[0, 5]]);
    expect(serializeOoxmlPart(result.part).match(/<w:ins /g)).toHaveLength(1);
    expect(paragraphTextOf(result.part, paragraph.id)).toBe('FieldOUTTail');
  });

  test(`field-end typing escapes a deleted run, sharedRun=${sharedRun}`, () => {
    const content = (field + '<w:r><w:t>Tail</w:t></w:r>')
      .replaceAll('<w:t>', '<w:delText>')
      .replaceAll('</w:t>', '</w:delText>');
    const { part, paragraph } = open(
      `<w:del w:id="0" w:author="Other">${sharedRun ? content.replaceAll('<w:rPr><w:b/></w:rPr>', '').replaceAll('</w:r><w:r>', '') : content}</w:del>`
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 5,
      text: 'OUT',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const accepted = applyTreeOp(result.part, { op: 'acceptAllRevisions' });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(paragraphTextOf(accepted.part, paragraph.id)).toBe('OUT');
  });
}

for (const sharedRun of [false, true]) {
  test(`field-end insertion retains existing formatting revisions without copying them to new text, sharedRun=${sharedRun}`, () => {
    const properties =
      '<w:rPr><w:b/><w:rPrChange w:id="9" w:author="Other"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr>';
    const content = sharedRun
      ? properties +
        (field + '<w:r><w:t>Tail</w:t></w:r>')
          .replaceAll('<w:rPr><w:b/></w:rPr>', '')
          .replaceAll('</w:r><w:r>', '')
      : field.replace('<w:rPr><w:b/></w:rPr>', properties);
    const { part, paragraph } = open(
      sharedRun ? content.replace(properties + '<w:r>', '<w:r>' + properties) : content
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 5,
      text: 'OUT',
      ...(sharedRun ? { revision } : {}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serializeOoxmlPart(result.part).match(/<w:rPrChange /g)).toHaveLength(sharedRun ? 2 : 1);
    expect(serializeOoxmlPart(result.part)).toContain('<w:rPr><w:b/></w:rPr><w:t>OUT</w:t>');
    expect(ranges(result.part, paragraph.id)).toEqual([[0, 5]]);
  });
}
