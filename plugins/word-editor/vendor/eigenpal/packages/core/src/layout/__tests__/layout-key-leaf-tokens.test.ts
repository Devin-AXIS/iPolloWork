// Layout keys with leaf elements read inline.
//
// Elements without element children (`w:b`, `w:sz`, `w:t`) make up most of a document. Their
// tokens now sit inside their parent's token instead of behind a memoized digest each. Every
// fact they carry must still reach the key, and their framing must keep them apart from every
// other kind of child.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { layoutNodeTokenVisitTestRecorder, paragraphLayoutKey } from '../layout-cache.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraphOf(xml: string): OoxmlNode {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const body = read.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('missing body');
  return body.children[0]!;
}

const keyOf = (xml: string) =>
  paragraphLayoutKey({ paragraph: paragraphOf(xml), properties: [], width: 100, producer: 'p' });

test('every leaf fact still changes the key', () => {
  const base = keyOf(
    '<w:p><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>text</w:t></w:r></w:p>'
  );
  for (const variant of [
    '<w:p><w:r><w:rPr><w:b w:val="0"/><w:sz w:val="22"/></w:rPr><w:t>text</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>text</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:sz w:val="22"/><w:b/></w:rPr><w:t>text</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>texts</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">text</w:t></w:r></w:p>',
  ])
    expect(keyOf(variant)).not.toBe(base);
  expect(
    keyOf('<w:p><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>text</w:t></w:r></w:p>')
  ).toBe(base);
});

test('leaf, text-only, and nested children cannot stand in for one another', () => {
  const keys = [
    '<w:p><w:r><w:t/></w:r></w:p>',
    '<w:p><w:r><w:t></w:t><w:t/></w:r></w:p>',
    '<w:p><w:r><w:t>x</w:t></w:r></w:p>',
    '<w:p><w:r>x</w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b/></w:rPr></w:r></w:p>',
    '<w:p><w:r><w:rPr/><w:b/></w:r></w:p>',
    '<w:p><w:r><w:b/><w:rPr/></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b><w:b/></w:b></w:rPr></w:r></w:p>',
  ].map(keyOf);
  expect(new Set(keys).size).toBe(keys.length);
});

test('a text edit in one run of a long paragraph re-reads only that run', async () => {
  const { applyTreeOp, readOoxmlPart: read } = await import('@docx-editor.dev/core/store');
  const runs = Array.from(
    { length: 200 },
    (_, index) => `<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>run ${index}</w:t></w:r>`
  ).join('');
  const parsed = read(
    `<w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType: 'app/xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children[0]!;
  const recorder = layoutNodeTokenVisitTestRecorder();
  try {
    const before = paragraphLayoutKey({ paragraph, properties: [], width: 100, producer: 'p' });
    expect(recorder.nodeVisits).toBeGreaterThan(1_000);
    const edited = applyTreeOp(parsed.part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 3,
      text: 'x',
    });
    if (!edited.ok) throw new Error(edited.reason);
    const editedBody = edited.part.root.children[0]!;
    if (editedBody.kind === 'textValue') throw new Error('missing body');
    recorder.reset();
    const after = paragraphLayoutKey({
      paragraph: editedBody.children[0]!,
      properties: [],
      width: 100,
      producer: 'p',
    });
    expect(after).not.toBe(before);
    // The paragraph, the edited run and its inline text; every other run answers from its digest.
    expect(recorder.nodeVisits).toBeLessThanOrEqual(8);
  } finally {
    recorder.dispose();
  }
});

test('a short namespace code cannot stand in for a file namespace with the same text', () => {
  const keyIn = (declarations: string, attribute: string) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}" ${declarations}><w:body><w:p><w:r><w:rPr><w:sz ${attribute}="22"/></w:rPr></w:r></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const body = read.part.root.children[0]!;
    if (body.kind === 'textValue') throw new Error('missing body');
    return paragraphLayoutKey({
      paragraph: body.children[0]!,
      properties: [],
      width: 100,
      producer: 'p',
    });
  };
  const keys = [
    keyIn('', 'w:val'),
    keyIn('xmlns:x="k0"', 'x:val'),
    keyIn('xmlns:x="uk0"', 'x:val'),
    keyIn(`xmlns:x="u${W}"`, 'x:val'),
    keyIn('', 'val'),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  expect(keyIn('xmlns:x="k0"', 'x:val')).toBe(keyIn('xmlns:y="k0"', 'y:val'));
});
