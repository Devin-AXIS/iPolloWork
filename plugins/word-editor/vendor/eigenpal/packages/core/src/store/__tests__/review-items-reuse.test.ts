// A queue kept across an edit equals the queue derived from scratch.

import { expect, test } from 'bun:test';
import { readOoxmlPart, revisionItemsOf } from '../index.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { createExportReviewDerivationScope } from '../store/review-export-derivation.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type Element = Exclude<OoxmlNode, { kind: 'textValue' }>;

function read(name: string, body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name,
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error('read');
  return result.part;
}

const bodyOf = (part: OoxmlPart) => part.root.children[0] as Element;

function withBlock(part: OoxmlPart, index: number, block: OoxmlNode): OoxmlPart {
  const blocks = [...bodyOf(part).children];
  blocks[index] = block;
  const body = { ...bodyOf(part), children: blocks } as OoxmlNode;
  return { ...part, root: { ...part.root, children: [body] } as OoxmlPart['root'] };
}

function fresh(part: OoxmlPart): string {
  const items = createExportReviewDerivationScope().collectReviewItems({
    storyPart: part,
  } as never);
  return JSON.stringify(items.filter((item) => item.kind === 'revision'));
}

const source = read(
  '/word/document.xml',
  `<w:p><w:r><w:rPr><w:i/><w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr><w:t>styled</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>plain </w:t></w:r><w:ins w:id="2" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins></w:p>`
);
const extra = bodyOf(
  read(
    '/word/extra.xml',
    `<w:p><w:bookmarkStart w:id="9" w:name="b"/><w:r><w:rPr><w:b/></w:rPr></w:r></w:p>`
  )
);

test('a zero-length marker added to a paragraph keeps an equal queue', () => {
  let part = source;
  revisionItemsOf(part);
  const paragraph = bodyOf(part).children[1] as Element;
  const marker = (extra.children[0] as Element).children[0]!;
  part = withBlock(part, 1, {
    ...paragraph,
    children: [marker, ...paragraph.children],
  } as OoxmlNode);
  expect(JSON.stringify(revisionItemsOf(part))).toBe(fresh(part));
});

test('properties around an unchanged formatting record are read again', () => {
  let part = source;
  revisionItemsOf(part);
  const paragraph = bodyOf(part).children[0] as Element;
  const run = paragraph.children[0] as Element;
  const properties = run.children[0] as Element;
  const record = properties.children[1]!;
  const bold = ((extra.children[0] as Element).children[1] as Element).children[0] as Element;
  const restyled = { ...properties, children: [bold.children[0]!, record] } as OoxmlNode;
  const newRun = { ...run, children: [restyled, ...run.children.slice(1)] } as OoxmlNode;
  part = withBlock(part, 0, { ...paragraph, children: [newRun] } as OoxmlNode);
  const items = revisionItemsOf(part);
  expect(JSON.stringify(items)).toBe(fresh(part));
  expect(JSON.stringify(items)).toContain('bold');
});
