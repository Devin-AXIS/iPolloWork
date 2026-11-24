import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlParagraphNode,
} from '../index.ts';
import { legacyDropdownFieldsOf } from '../store/legacy-dropdown-fields.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { validateTreeOp } from '../store/tree-op-validate.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function fixture(
  result = '<w:r><w:rPr><w:b/></w:rPr><w:t>Green</w:t></w:r>',
  enabled = '',
  wrapper = '',
  separate = true,
  blue = 'Blue'
) {
  const body = `<w:p><w:r><w:t xml:space="preserve">Color: </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Color"/>${enabled}<w:ddList><w:result w:val="1"/><w:default w:val="0"/><w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="${blue}"/></w:ddList></w:ffData></w:fldChar></w:r><w:bookmarkStart w:id="0" w:name="Color"/><w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r>${separate ? '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' : ''}${result}<w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="0"/><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${wrapper ? `<w:sdt><w:sdtPr>${wrapper}</w:sdtPr><w:sdtContent>${body}</w:sdtContent></w:sdt>` : body}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const paragraphs: OoxmlParagraphNode[] = [];
  const visit = (node: OoxmlNode) => {
    if (node.kind === 'paragraph') paragraphs.push(node);
    else if (node.kind !== 'textValue') node.children.forEach(visit);
  };
  visit(parsed.part.root);
  const paragraph = paragraphs[0]!;
  const field = legacyDropdownFieldsOf(paragraph)[0]!;
  return {
    part: parsed.part,
    paragraph,
    field,
    op: {
      op: 'setLegacyDropdown' as const,
      paragraphId: paragraph.id,
      fieldNodeId: paragraph.children
        .flatMap((n) => (n.kind === 'run' ? n.children : []))
        .find((n) => n.kind === 'fldChar')!.id,
      selectedIndex: 2,
    },
  };
}

describe('legacy dropdown choice', () => {
  test('writes index and cached text together, preserving formatting, bookmarks and the definition', () => {
    const { part, field, op } = fixture();
    expect(field).toMatchObject({
      start: 7,
      end: 8,
      selectedIndex: 1,
      entries: ['Red', 'Green', 'Blue'],
    });
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('<w:result w:val="2"/>');
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t>Blue</w:t>');
    expect(xml).toContain('<w:default w:val="0"/>');
    expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="Color"/>');
    expect(xml).toContain('<w:bookmarkEnd w:id="0"/>');
    expect(xml).toContain('FORMDROPDOWN');
    expect(xml).toContain(' tail');
  });
  test('materializes a missing cached result after the separator', () => {
    const { part, op } = fixture('');
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (result.ok) expect(serializeOoxmlPart(result.part)).toContain('<w:t>Blue</w:t>');
  });
  test('creates a separator and cached result for Word fields without a result phase', () => {
    const { part, op } = fixture('', '', '', false);
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const xml = serializeOoxmlPart(result.part);
      expect(xml).toContain('<w:fldChar w:fldCharType="separate"/>');
      expect(xml).toContain('<w:t>Blue</w:t>');
    }
  });
  test('rejects invalid indices, disabled fields, content locks and bindings', () => {
    const { part, op } = fixture();
    for (const selectedIndex of [-1, 3, NaN, 0.5])
      expect(validateTreeOp(part, { ...op, selectedIndex })).toBe('invalidArgs');
    for (const [enabled, wrapper, reason] of [
      ['<w:enabled w:val="0"/>', '', 'locked'],
      ['', '<w:lock w:val="sdtContentLocked"/>', 'locked'],
      ['', '<w:dataBinding w:xpath="/color" w:storeItemID="id"/>', 'bound'],
    ]) {
      const data = fixture(undefined, enabled, wrapper);
      expect(validateTreeOp(data.part, data.op)).toBe(reason);
    }
  });
  test('rejects a label truncated by the bounded render reader', () => {
    const { part, op } = fixture(undefined, '', '', true, 'B'.repeat(300));
    const before = serializeOoxmlPart(part);
    expect(validateTreeOp(part, op)).toBe('unsupported');
    expect(applyTreeOp(part, op).ok).toBe(false);
    expect(serializeOoxmlPart(part)).toBe(before);
  });
  test('refuses structured results without changing the index', () => {
    const { part, op } = fixture(
      '<w:bookmarkStart w:id="3" w:name="Inner"/><w:r><w:t>Green</w:t></w:r><w:bookmarkEnd w:id="3"/>'
    );
    const before = serializeOoxmlPart(part);
    expect(applyTreeOp(part, op).ok).toBe(false);
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('refuses an entry with a line break and stays changeable', () => {
    const { part, op } = fixture(undefined, '', '', true, 'Bl&#10;ue');
    expect(validateTreeOp(part, op)).toBe('invalidArgs');
    expect(applyTreeOp(part, op).ok).toBe(false);
    const red = applyTreeOp(part, { ...op, selectedIndex: 0 });
    expect(red.ok).toBe(true);
    if (!red.ok) return;
    expect(serializeOoxmlPart(red.part)).toContain('<w:t>Red</w:t>');
    const green = applyTreeOp(red.part, { ...op, selectedIndex: 1 });
    expect(green.ok).toBe(true);
    if (!green.ok) return;
    expect(serializeOoxmlPart(green.part)).toContain('<w:t>Green</w:t>');
  });
});
