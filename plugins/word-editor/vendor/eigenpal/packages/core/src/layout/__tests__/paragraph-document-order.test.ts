// Paragraph reading order across tables, with the per-table id list reused between passes.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { paragraphDocumentOrderOf } from '../paragraph-document-order.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const grid = '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>';
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="2000"/></w:tcPr>${content}</w:tc>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (rows: string) => `<w:tbl><w:tblPr/>${grid}${rows}</w:tbl>`;

function blocksOf(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const root = result.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  ) as OoxmlElement;
  return root.children.flatMap((node) =>
    node.kind === 'paragraph'
      ? [{ kind: 'paragraph' as const, paragraph: node }]
      : node.kind === 'table'
        ? [{ kind: 'table' as const, table: node }]
        : []
  );
}

/** Paragraph texts in the order the map ranks them. */
function textsInOrder(blocks: ReturnType<typeof blocksOf>, order: ReadonlyMap<string, number>) {
  const texts = new Map<string, string>();
  const visit = (node: OoxmlElement): void => {
    if (node.kind === 'paragraph') {
      const text: string[] = [];
      const collect = (child: OoxmlElement): void => {
        for (const leaf of child.children) {
          if (leaf.kind === 'textValue') text.push(leaf.value);
          else collect(leaf);
        }
      };
      collect(node);
      texts.set(node.id, text.join(''));
    }
    for (const child of node.children) if (child.kind !== 'textValue') visit(child);
  };
  for (const block of blocks) visit((block.paragraph ?? block.table)!);
  return [...order].sort((a, b) => a[1] - b[1]).map(([id]) => texts.get(id));
}

const nested = table(`<w:tr>${cell(para('n1'))}${cell(para('n2'))}</w:tr>`);
const body = (lastCell: string) =>
  para('a') +
  table(
    `<w:tr>${cell(para('c1'))}${cell(para('c2') + nested)}</w:tr>` +
      `<w:tr>${cell(para('c3'))}${cell(lastCell)}</w:tr>`
  ) +
  para('z');

test('ranks body, cell, and nested cell paragraphs in reading order on every pass', () => {
  const blocks = blocksOf(body(para('c4')));
  const expected = ['a', 'c1', 'c2', 'n1', 'n2', 'c3', 'c4', 'z'];
  const first = paragraphDocumentOrderOf(blocks, 400, undefined, 'all-markup');
  expect(textsInOrder(blocks, first)).toEqual(expected);
  // The second pass reads the remembered table ids and must agree.
  const second = paragraphDocumentOrderOf(blocks, 400, undefined, 'all-markup');
  expect([...second]).toEqual([...first]);
  // Other inputs read the table again rather than reuse the remembered list.
  const narrow = paragraphDocumentOrderOf(blocks, 300, undefined, 'all-markup', undefined, 14);
  expect(textsInOrder(blocks, narrow)).toEqual(expected);
});

test('an edited table is a new node and is read again', () => {
  const before = blocksOf(body(para('c4')));
  paragraphDocumentOrderOf(before, 400, undefined, 'all-markup');
  const after = blocksOf(body(para('c4') + para('c5')));
  const order = paragraphDocumentOrderOf(after, 400, undefined, 'all-markup');
  expect(textsInOrder(after, order)).toEqual(['a', 'c1', 'c2', 'n1', 'n2', 'c3', 'c4', 'c5', 'z']);
});
