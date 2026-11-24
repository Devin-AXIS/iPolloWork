// An edited story's site index is patched from the previous one and equals a full build.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../index.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { locateSites, locateSitesTransient } from '../store/review-site-locations.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const ins = (id: number, body: string) => `<w:ins w:id="${id}" w:author="Ada">${body}</w:ins>`;
const table = (id: number, text: string) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:ins w:id="${id}" w:author="Ada"/></w:trPr><w:tc><w:p>${run(text)}${ins(id + 1, run('cell'))}</w:p></w:tc></w:tr></w:tbl>`;

function read(name: string, body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name,
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error('read');
  return result.part;
}

type Element = Exclude<OoxmlNode, { kind: 'textValue' }>;
const bodyOf = (part: OoxmlPart) => part.root.children[0] as Element;

/** The same part with its body blocks replaced, every other node shared. */
function withBlocks(part: OoxmlPart, blocks: readonly OoxmlNode[]): OoxmlPart {
  const body = { ...bodyOf(part), children: blocks } as OoxmlNode;
  return { ...part, root: { ...part.root, children: [body] } as OoxmlPart['root'] };
}

function expectFullIndex(part: OoxmlPart): void {
  const patched = locateSites(part);
  const full = locateSitesTransient(part);
  expect([...patched].sort(([a], [b]) => a.localeCompare(b))).toEqual(
    [...full].sort(([a], [b]) => a.localeCompare(b))
  );
}

test('removing, inserting and replacing blocks keeps the index whole', () => {
  let part = read(
    '/word/document.xml',
    `<w:p>${run('one ')}${ins(1, run('two'))}</w:p>${table(2, 'row')}<w:p>${run('three')}</w:p><w:p>${ins(4, run('four'))}</w:p>`
  );
  locateSites(part);
  const extra = bodyOf(
    read('/word/extra.xml', `${table(7, 'added')}<w:p>${ins(9, run('new'))}</w:p>`)
  );
  const blocks = () => bodyOf(part).children;

  part = withBlocks(part, [blocks()[0]!, blocks()[2]!, blocks()[3]!]);
  expectFullIndex(part);
  // Another story indexed in between, as one derivation indexes the body and then each header.
  locateSites(read('/word/header1.xml', `<w:p>${ins(11, run('head'))}</w:p>`));
  part = withBlocks(part, [blocks()[0]!, extra.children[0]!, ...blocks().slice(1)]);
  expectFullIndex(part);
  part = withBlocks(part, [...blocks().slice(0, 3), extra.children[1]!]);
  expectFullIndex(part);
});

test('changes far apart in a long story keep the index whole', () => {
  const paragraphs = Array.from(
    { length: 300 },
    (_, at) => `<w:p>${ins(at + 1, run(`p${at}`))}</w:p>`
  );
  let part = read('/word/document.xml', paragraphs.join(''));
  locateSites(part);
  const extra = bodyOf(
    read('/word/far.xml', `<w:p>${ins(900, run('first'))}</w:p><w:p>${run('last')}</w:p>`)
  );
  const blocks = bodyOf(part).children;
  part = withBlocks(part, [extra.children[0]!, ...blocks.slice(1, -1), extra.children[1]!]);
  expectFullIndex(part);
});
