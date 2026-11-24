// `w:rtl` is an additive run property: a write may add or replace it, and a write that
// leaves it out keeps it.

import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${body}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const paragraphId = (target: OoxmlPart) =>
  target.root.children[0]!.children.find((node) => node.kind === 'paragraph')!.id;

function write(
  target: OoxmlPart,
  properties: { localName: string; attributes?: Record<string, string> }[]
) {
  const result = applyTreeOp(target, {
    op: 'setRunProperties',
    paragraphId: paragraphId(target),
    start: 0,
    end: 3,
    properties,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return serializeOoxmlPart(result.part);
}

const rtlRun = '<w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>abc</w:t></w:r>';
const plainRun = '<w:r><w:rPr><w:b/></w:rPr><w:t>abc</w:t></w:r>';

test('a write may add w:rtl', () => {
  const xml = write(part(plainRun), [{ localName: 'b' }, { localName: 'rtl' }]);
  expect(xml).toContain('<w:b/><w:rtl/>');
});

test('a write that leaves w:rtl out keeps it', () => {
  expect(write(part(rtlRun), [{ localName: 'i' }])).toMatch(/<w:i\/>.*<w:rtl\/>/);
  expect(write(part(rtlRun), [{ localName: 'i' }])).not.toContain('<w:b/>');
});

test('an empty write, as Clear Formatting sends, keeps w:rtl', () => {
  const xml = write(part(rtlRun), []);
  expect(xml).toContain('<w:rtl/>');
  expect(xml).not.toContain('<w:b/>');
});

test('a write may replace w:rtl', () => {
  expect(write(part(rtlRun), [{ localName: 'rtl', attributes: { val: '0' } }])).toContain(
    '<w:rtl w:val="0"/>'
  );
});

test('other unaccepted run properties stay refused', () => {
  const result = applyTreeOp(part(plainRun), {
    op: 'setRunProperties',
    paragraphId: paragraphId(part(plainRun)),
    start: 0,
    end: 3,
    properties: [{ localName: 'cs' }],
  });
  expect(result.ok).toBe(false);
});
