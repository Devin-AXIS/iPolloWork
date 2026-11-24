// The setFieldResult op: plain result rewrites, `w:dirty`, the own-insertion rule, and refusals.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { validateTreeOp } from '../store/tree-op-validate.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function find(node: OoxmlNode, match: (node: OoxmlNode) => boolean): OoxmlNode | undefined {
  if (match(node)) return node;
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    const found = find(child, match);
    if (found) return found;
  }
  return undefined;
}

const field = (result: string) =>
  '<w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText> SEQ Figure </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  result +
  '<w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>';

function opFor(part: OoxmlPart, text: string, author?: string) {
  const paragraph = find(part.root, (node) => node.kind === 'paragraph')!;
  const begin = find(part.root, (node) => node.kind === 'fldChar')!;
  return {
    op: 'setFieldResult' as const,
    paragraphId: paragraph.id,
    fieldNodeId: begin.id,
    text,
    ...(author ? { revision: { author } } : {}),
  };
}

describe('setFieldResult', () => {
  test('rewrites a plain result and marks the begin marker dirty', () => {
    const part = load(`<w:p>${field('<w:r><w:t>1</w:t></w:r>')}</w:p>`);
    const op = opFor(part, 'Figure\t7');
    expect(validateTreeOp(part, op)).toBeNull();
    const applied = applyTreeOp(part, op);
    if (!applied.ok) throw new Error(applied.reason);
    const xml = serializeOoxmlPart(applied.part);
    expect(xml).toContain('<w:fldChar w:dirty="true" w:fldCharType="begin"/>');
    expect(xml).toContain('<w:r><w:t>Figure</w:t><w:tab/><w:t>7</w:t></w:r>');
    expect(xml).toContain('> SEQ Figure </w:instrText>');
  });

  test('an empty result gets a run that keeps the end run formatting', () => {
    const part = load(`<w:p>${field('')}</w:p>`);
    const applied = applyTreeOp(part, opFor(part, 'One'));
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part)).toContain(
      'w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>One</w:t></w:r>'
    );
  });

  test("joins the author's own insertion, and refuses anyone else's", () => {
    const part = load(
      `<w:p><w:ins w:id="1" w:author="Ada" w:date="2026-01-01T00:00:00Z">${field('')}</w:ins></w:p>`
    );
    expect(validateTreeOp(part, opFor(part, 'x'))).toBe('unsupported-revision');
    expect(validateTreeOp(part, opFor(part, 'x', 'Bob'))).toBe('unsupported-revision');
    const op = opFor(part, 'x', 'Ada');
    expect(validateTreeOp(part, op)).toBeNull();
    const applied = applyTreeOp(part, op);
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part)).toMatch(
      /<w:ins [^>]*>(?:(?!<\/w:ins>).)*<w:t>x<\/w:t>(?:(?!<\/w:ins>).)*w:fldCharType="end"\/><\/w:r><\/w:ins>/
    );
  });

  test('refuses a field outside any revision when a revision is given', () => {
    const part = load(`<w:p>${field('<w:r><w:t>1</w:t></w:r>')}</w:p>`);
    expect(validateTreeOp(part, opFor(part, 'x', 'Ada'))).toBe('unsupported-revision');
  });

  test('refuses a result that is not plain runs, a locked field, and bad text', () => {
    const shaped = load(`<w:p>${field('<w:r><w:br/><w:t>1</w:t></w:r>')}</w:p>`);
    expect(validateTreeOp(shaped, opFor(shaped, 'x'))).toBe('field-result-unsupported');
    const locked = load(
      `<w:p>${field('<w:r><w:t>1</w:t></w:r>').replace('fldCharType="begin"', 'fldCharType="begin" w:fldLock="1"')}</w:p>`
    );
    expect(validateTreeOp(locked, opFor(locked, 'x'))).toBe('field-result-unsupported');
    const plain = load(`<w:p>${field('<w:r><w:t>1</w:t></w:r>')}</w:p>`);
    for (const text of ['a\nb', 'a\rb', 'a\u000bb', 'x'.repeat(2049)])
      expect(validateTreeOp(plain, opFor(plain, text))).toBe('invalidArgs');
  });
});
