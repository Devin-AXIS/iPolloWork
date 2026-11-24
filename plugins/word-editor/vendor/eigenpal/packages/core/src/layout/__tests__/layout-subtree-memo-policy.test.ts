// Layout keys and revision formatting views over nodes that keep no memo entry.
//
// A node without an element grandchild (`w:rPr` of leaves, `w:tcPr`, a plain `w:r`) reads
// inline in its parent's key and answers its formatting view again from its leaves. Every
// fact it carries must still reach the key, the inline and digest roles must stay apart at
// the width boundary, and a view that changes such a node must keep one identity.

import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  keepsSubtreeMemo,
  WIDE_SUBTREE_CHILDREN,
} from '../../store/package/subtree-memo-policy.ts';
import { layoutNodeTokenVisitTestRecorder, paragraphLayoutKey } from '../layout-cache.ts';
import {
  projectRevisionFormatting,
  resolvedFormatChangeOf,
} from '../revision-formatting-projection.ts';
import { revisionAuthorFilter } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function bodyOf(xml: string): OoxmlElement {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root.children[0] as OoxmlElement;
}
const first = (xml: string) => bodyOf(xml).children[0] as OoxmlElement;
const keyOf = (node: OoxmlNode) =>
  paragraphLayoutKey({ paragraph: node, properties: [], width: 100, producer: 'p' });
const element = (node: OoxmlNode | undefined) => node as OoxmlElement;

const leaves = (count: number, last = '<w:b/>') => '<w:i/>'.repeat(count - 1) + last;
const runWith = (properties: string) =>
  `<w:p><w:r><w:rPr>${properties}</w:rPr><w:t>text</w:t></w:r></w:p>`;

test('facts in a node of leaves reach the key on both sides of the width boundary', () => {
  for (const count of [WIDE_SUBTREE_CHILDREN - 1, WIDE_SUBTREE_CHILDREN]) {
    const paragraph = first(runWith(leaves(count)));
    const properties = element(element(paragraph.children[0]).children[0]);
    expect(keepsSubtreeMemo(properties)).toBe(count >= WIDE_SUBTREE_CHILDREN);
    const key = keyOf(paragraph);
    expect(keyOf(first(runWith(leaves(count))))).toBe(key);
    expect(keyOf(first(runWith(leaves(count, '<w:b w:val="0"/>'))))).not.toBe(key);
    expect(keyOf(first(runWith(leaves(count, '<w:caps/>'))))).not.toBe(key);
  }
  // The width boundary changes the child's role, never lets two shapes collide.
  const keys = [14, 15, 16, 17].map((count) => keyOf(first(runWith(leaves(count)))));
  expect(new Set(keys).size).toBe(keys.length);
});

test('nested, inline and digest children cannot stand in for one another', () => {
  const keys = [
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b><w:b/></w:b></w:rPr><w:t>x</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>x</w:t></w:r></w:p>',
    '<w:p><w:r><w:r><w:t>x</w:t></w:r></w:r></w:p>',
    '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
  ].map((xml) => keyOf(first(xml)));
  expect(new Set(keys).size).toBe(keys.length);
});

test('a cell edit re-reads only the edited path and its nodes of leaves', () => {
  const cell = (index: number) =>
    '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/>' +
    `</w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:lang w:val="en-US"/></w:rPr><w:t>c${index}</w:t>` +
    '</w:r><w:r><w:t>plain</w:t></w:r></w:p></w:tc>';
  const rows = Array.from(
    { length: 40 },
    (_, row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(row * 2)}${cell(row * 2 + 1)}</w:tr>`
  ).join('');
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr/>${rows}</w:tbl></w:body></w:document>`;
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  const table = element(element(read.part.root.children[0]).children[0]);
  const recorder = layoutNodeTokenVisitTestRecorder();
  try {
    const before = keyOf(table);
    expect(keyOf(first(`<w:tbl><w:tblPr/>${rows}</w:tbl>`))).toBe(before);
    const paragraph = element(element(element(table.children[20]).children[1]).children[1]);
    const edited = applyTreeOp(read.part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 0,
      text: 'x',
    });
    if (!edited.ok) throw new Error(edited.reason);
    recorder.reset();
    const after = keyOf(element(element(edited.part.root.children[0]).children[0]));
    expect(after).not.toBe(before);
    // Table, row, cell, paragraph and run, each with its nodes of leaves read inline. Every
    // other row answers from its digest.
    expect(recorder.nodeVisits).toBeLessThanOrEqual(40);
  } finally {
    recorder.dispose();
  }
});

test('a view keeps one identity for every node of leaves it reads', () => {
  const paragraph = first(
    '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/>' +
      '<w:rPrChange w:id="1" w:author="Ada"/></w:rPr><w:t>x</w:t></w:r>' +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>y</w:t></w:r></w:p>'
  );
  const changed = element(element(paragraph.children[1]).children[0]);
  const unchanged = element(element(paragraph.children[2]).children[0]);
  expect(keepsSubtreeMemo(changed)).toBe(false);
  expect(keepsSubtreeMemo(unchanged)).toBe(false);
  const filter = revisionAuthorFilter(['Other']);
  for (const [mode, viewFilter] of [
    ['proposed', undefined],
    ['original', undefined],
    ['proposed', filter],
    ['all-markup', filter],
  ] as const) {
    // An unchanged node of leaves is its own view.
    expect(projectRevisionFormatting(unchanged, mode, viewFilter)).toBe(unchanged);
    const view = projectRevisionFormatting(changed, mode, viewFilter);
    expect(projectRevisionFormatting(changed, mode, viewFilter)).toBe(view);
    expect(projectRevisionFormatting(view, mode, viewFilter)).toBe(view);
    const whole = projectRevisionFormatting(paragraph, mode, viewFilter);
    expect(projectRevisionFormatting(paragraph, mode, viewFilter)).toBe(whole);
    // The untouched run keeps its canonical identity inside the view.
    expect(whole.children[2]).toBe(paragraph.children[2]);
    if (mode === 'proposed' && view !== changed) {
      expect(
        view.children.some((child) => child.kind !== 'textValue' && child.localName === 'rPrChange')
      ).toBe(false);
      expect(resolvedFormatChangeOf(view)?.author).toBe('Ada');
    }
  }
});
