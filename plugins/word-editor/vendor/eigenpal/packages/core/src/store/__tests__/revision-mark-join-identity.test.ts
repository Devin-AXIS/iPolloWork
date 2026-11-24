import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, serializeOoxmlPart, type OoxmlNode } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part;
}

function paragraphs(root: OoxmlNode): OoxmlNode[] {
  if (root.kind === 'textValue') return [];
  if (root.kind === 'paragraph') return [root];
  return root.children.flatMap(paragraphs);
}

const TWO_MARKS = (kind: string) =>
  `<w:p w14:paraId="00000001"><w:pPr><w:jc w:val="left"/><w:rPr>` +
  `<w:${kind} w:id="1" w:author="Ada"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">One; </w:t></w:r></w:p>` +
  `<w:p w14:paraId="00000002"><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>two</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Signed</w:t></w:r></w:p>`;

// Rejecting an inserted paragraph mark joins the paragraph into the one after it. The joined
// paragraph is the first one, as a join by deleting the mark is, with the properties of the
// mark that remains: the undo of the split that inserted the mark removes the second
// paragraph, so a rejection and that undo keep the same paragraph.
test("rejecting an inserted mark keeps the first paragraph and the last mark's properties", () => {
  const part = load(TWO_MARKS('ins'));
  const [first] = paragraphs(part.root);
  const result = applyTreeOp(part, { op: 'rejectAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const after = paragraphs(result.part.root);
  expect(after).toHaveLength(2);
  expect(after[0]!.id).toBe(first!.id);
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain(
    '<w:p w14:paraId="00000001"><w:pPr><w:jc w:val="right"/></w:pPr>' +
      '<w:r><w:t xml:space="preserve">One; </w:t></w:r><w:r><w:t>two</w:t></w:r></w:p>'
  );
  expect(xml).not.toContain('00000002');
});

// Accepting a deleted mark keeps the paragraph after it: nothing undoes a split there, and
// the paragraph that holds the remaining mark keeps its identity.
test('accepting a deleted mark keeps the second paragraph', () => {
  const part = load(TWO_MARKS('del'));
  const second = paragraphs(part.root)[1]!;
  const result = applyTreeOp(part, { op: 'acceptAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const after = paragraphs(result.part.root);
  expect(after).toHaveLength(2);
  expect(after[0]!.id).toBe(second.id);
  expect(serializeOoxmlPart(result.part)).toContain(
    '<w:p w14:paraId="00000002"><w:pPr><w:jc w:val="right"/></w:pPr>' +
      '<w:r><w:t xml:space="preserve">One; </w:t></w:r><w:r><w:t>two</w:t></w:r></w:p>'
  );
});

test('rejecting an inserted paragraph keeps the paragraph after it', () => {
  const ins = 'w:id="1" w:author="Ada"';
  const part = load(
    `<w:p w14:paraId="00000001"><w:pPr><w:rPr><w:ins ${ins}/></w:rPr></w:pPr>` +
      `<w:bookmarkStart w:id="5" w:name="_Toc1"/><w:bookmarkEnd w:id="5"/>` +
      `<w:ins ${ins}><w:r><w:t>new</w:t></w:r></w:ins></w:p>` +
      `<w:p w14:paraId="00000002"><w:r><w:t>kept</w:t></w:r></w:p>`
  );
  const second = paragraphs(part.root)[1]!;
  const result = applyTreeOp(part, { op: 'rejectAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const after = paragraphs(result.part.root);
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(second.id);
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain('<w:p w14:paraId="00000002"><w:bookmarkStart w:id="5" w:name="_Toc1"/>');
  expect(xml).toContain('<w:bookmarkEnd w:id="5"/><w:r><w:t>kept</w:t></w:r></w:p>');
});

test('accepting a deleted paragraph keeps the paragraph after it', () => {
  const del = 'w:id="1" w:author="Ada"';
  const part = load(
    `<w:p w14:paraId="00000001"><w:pPr><w:rPr><w:del ${del}/></w:rPr></w:pPr>` +
      `<w:del ${del}><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>` +
      `<w:p w14:paraId="00000002"><w:r><w:t>kept</w:t></w:r></w:p>`
  );
  const second = paragraphs(part.root)[1]!;
  const result = applyTreeOp(part, { op: 'acceptAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const after = paragraphs(result.part.root);
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(second.id);
  expect(serializeOoxmlPart(result.part)).toContain(
    '<w:p w14:paraId="00000002"><w:r><w:t>kept</w:t></w:r></w:p>'
  );
});

test('accepting a deleted paragraph keeps its bookmark and comment start', () => {
  const del = 'w:id="1" w:author="Ada"';
  const part = load(
    `<w:p w14:paraId="00000001"><w:pPr><w:rPr><w:del ${del}/></w:rPr></w:pPr>` +
      `<w:bookmarkStart w:id="5" w:name="_Toc1"/><w:commentRangeStart w:id="3"/>` +
      `<w:bookmarkEnd w:id="5"/><w:del ${del}><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>` +
      `<w:p w14:paraId="00000002"><w:r><w:t>kept</w:t></w:r><w:commentRangeEnd w:id="3"/>` +
      `<w:r><w:commentReference w:id="3"/></w:r></w:p>`
  );
  const result = applyTreeOp(part, { op: 'acceptAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(paragraphs(result.part.root)).toHaveLength(1);
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain('<w:bookmarkStart w:id="5" w:name="_Toc1"/>');
  expect(xml).toContain('<w:bookmarkEnd w:id="5"/>');
  expect(xml).toContain('<w:commentRangeStart w:id="3"/>');
  expect(xml.indexOf('commentRangeStart')).toBeLessThan(xml.indexOf('<w:t>kept'));
});

test('rejecting an inserted mark of an empty paragraph keeps that paragraph', () => {
  // A tracked break at a paragraph's start leaves the paragraph empty before its mark.
  const part = load(
    `<w:p w14:paraId="00000001"><w:pPr><w:rPr><w:ins w:id="1" w:author="Ada"/></w:rPr></w:pPr></w:p>` +
      `<w:p w14:paraId="00000002"><w:r><w:t>kept</w:t></w:r></w:p>`
  );
  const first = paragraphs(part.root)[0]!;
  const result = applyTreeOp(part, { op: 'rejectAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const after = paragraphs(result.part.root);
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(first.id);
  expect(serializeOoxmlPart(result.part)).toContain(
    '<w:p w14:paraId="00000001"><w:r><w:t>kept</w:t></w:r></w:p>'
  );
});

// The joined paragraph keeps the last paragraph's content, so a prefix only the last `w:p`
// declared stays declared on the paragraph that holds it.
test('rejecting an inserted mark keeps the namespace the second paragraph declared', () => {
  const part = load(
    `<w:p w14:paraId="00000001"><w:pPr><w:rPr><w:ins w:id="1" w:author="Ada"/></w:rPr></w:pPr>` +
      `<w:r><w:t xml:space="preserve">One; </w:t></w:r></w:p>` +
      `<w:p xmlns:x="urn:example:x" w14:paraId="00000002"><w:r><w:rPr><x:mark/></w:rPr>` +
      `<w:t>two</w:t></w:r></w:p>`
  );
  const result = applyTreeOp(part, { op: 'rejectAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain('xmlns:x="urn:example:x"');
  expect(xml).toContain('<x:mark/>');
  const reread = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  expect(reread.ok).toBe(true);
});
