// FORMCHECKBOX as a togglable range: the `setLegacyCheckbox` op rewrites only `w:checked`
// under the field's `w:checkBox`, honours `w:enabled`, and works under forms protection.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../index.ts';
import { legacyCheckboxFieldsOf } from '../store/legacy-checkbox-fields.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { validateTreeOp } from '../store/tree-op-validate.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function partOf(body: string, sectPr = ''): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${sectPr}</w:body></w:document>`,
    metadata
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function checkboxField(checkBoxInner: string, ffDataExtra = ''): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="cb"/>${ffDataExtra}` +
    `<w:checkBox>${checkBoxInner}</w:checkBox></w:ffData></w:fldChar></w:r>` +
    `<w:bookmarkStart w:id="0" w:name="cb"/>` +
    `<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="0"/>`
  );
}

function paragraph(part: OoxmlPart) {
  const found = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children) {
      const hit = found(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const node = found(part.root);
  if (node?.kind !== 'paragraph') throw new Error('no paragraph');
  return node;
}

function checkedValues(part: OoxmlPart): string[] {
  const xml = serializeOoxmlPart(part);
  return [...xml.matchAll(/<w:checked(?: w:val="([^"]*)")?\s*\/>/g)].map((m) => m[1] ?? '');
}

describe('legacyCheckboxFieldsOf', () => {
  test('lists FORMCHECKBOX fields with their offsets, state and enabled flag', () => {
    const part = partOf(
      `<w:p><w:r><w:t xml:space="preserve">Tick: </w:t></w:r>${checkboxField('<w:size w:val="24"/><w:default w:val="0"/><w:checked w:val="1"/>')}` +
        `<w:r><w:t xml:space="preserve"> and </w:t></w:r>${checkboxField('<w:default w:val="0"/>', '<w:enabled w:val="0"/>')}</w:p>`
    );
    const fields = legacyCheckboxFieldsOf(paragraph(part));
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ start: 6, end: 7, checked: true, enabled: true });
    expect(fields[1]).toMatchObject({ start: 12, end: 13, checked: false, enabled: false });
  });

  test('ignores FORMTEXT and FORMDROPDOWN fields', () => {
    const part = partOf(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="t"/><w:textInput/></w:ffData></w:fldChar></w:r>` +
        `<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>x</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    expect(legacyCheckboxFieldsOf(paragraph(part))).toEqual([]);
  });
});

describe('setLegacyCheckbox', () => {
  test('rewrites w:checked and nothing else, replacing every earlier w:checked', () => {
    const part = partOf(
      `<w:p>${checkboxField('<w:size w:val="24"/><w:default w:val="0"/><w:checked w:val="0"/><w:checked w:val="1"/>')}</w:p>`
    );
    const p = paragraph(part);
    const field = legacyCheckboxFieldsOf(p)[0]!;
    expect(field.checked).toBe(false);
    const op = {
      op: 'setLegacyCheckbox',
      paragraphId: p.id,
      fieldNodeId: field.fieldNodeId,
      checked: true,
    } as const;
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkedValues(result.part)).toEqual(['1']);
    expect(legacyCheckboxFieldsOf(paragraph(result.part))[0]!.checked).toBe(true);
    const xml = serializeOoxmlPart(result.part);
    // Order and neighbours survive: size and default first, one checked last; the name,
    // instruction and bookmark are untouched.
    expect(xml).toMatch(/<w:size w:val="24"\/><w:default w:val="0"\/><w:checked w:val="1"\/>/);
    expect(xml).toContain('<w:name w:val="cb"/>');
    expect(xml).toContain('FORMCHECKBOX');
    expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="cb"/>');
    expect(findNode(result.part, field.fieldNodeId)).toBeTruthy();

    const back = applyTreeOp(result.part, { ...op, checked: false });
    expect(back.ok).toBe(true);
    if (back.ok) expect(checkedValues(back.part)).toEqual(['0']);
  });

  test('adds w:checked when the field only had a default', () => {
    const part = partOf(`<w:p>${checkboxField('<w:default w:val="1"/>')}</w:p>`);
    const p = paragraph(part);
    const field = legacyCheckboxFieldsOf(p)[0]!;
    expect(field.checked).toBe(true);
    const result = applyTreeOp(part, {
      op: 'setLegacyCheckbox',
      paragraphId: p.id,
      fieldNodeId: field.fieldNodeId,
      checked: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(checkedValues(result.part)).toEqual(['0']);
  });

  test('refuses a disabled field, a bad target and a non-boolean state', () => {
    const part = partOf(
      `<w:p>${checkboxField('<w:default w:val="0"/>', '<w:enabled w:val="0"/>')}</w:p>`
    );
    const p = paragraph(part);
    const field = legacyCheckboxFieldsOf(p)[0]!;
    expect(
      validateTreeOp(part, {
        op: 'setLegacyCheckbox',
        paragraphId: p.id,
        fieldNodeId: field.fieldNodeId,
        checked: true,
      })
    ).toBe('locked');
    expect(
      validateTreeOp(part, {
        op: 'setLegacyCheckbox',
        paragraphId: p.id,
        fieldNodeId: 'nope',
        checked: true,
      })
    ).toBe('invalidArgs');
    expect(
      validateTreeOp(part, {
        op: 'setLegacyCheckbox',
        paragraphId: p.id,
        fieldNodeId: field.fieldNodeId,
        checked: 'yes' as unknown as boolean,
      })
    ).toBe('invalidArgs');
  });
});
