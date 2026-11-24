import { expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { tableTextStructureUnchanged } from '../table-text-change.ts';
import { editableTableParagraph } from '../table-ordinary-paragraph.ts';
import { load, row, table } from './table-row-keep-fixtures.ts';

const source = () => {
  const part = load(table([row('First'), row('Second')]));
  const body = part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  return body.children.find((node) => node.kind === 'table') as OoxmlElement;
};

function changeFirst(
  root: OoxmlElement,
  name: string,
  change: (node: OoxmlElement) => OoxmlElement
): OoxmlElement {
  let done = false;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (done || node.kind === 'textValue') return node;
    if (node.localName === name) {
      done = true;
      return change(node);
    }
    const children = node.children.map(visit);
    return children.every((child, i) => child === node.children[i]) ? node : { ...node, children };
  };
  return visit(root) as OoxmlElement;
}

for (const name of ['tblPr', 'tblGrid', 'tr', 'tcPr', 'pPr']) {
  test(`table inline proof refuses changed ${name}`, () => {
    const before = source();
    const after = changeFirst(before, name, (node) => ({
      ...node,
      attributes: [...node.attributes],
    }));
    expect(tableTextStructureUnchanged(before, after)).toBe(false);
  });
}

test('table inline proof refuses changed paragraph membership', () => {
  const before = source();
  const after = changeFirst(before, 'tc', (node) => ({
    ...node,
    children: node.children.slice(0, -1),
  }));
  expect(tableTextStructureUnchanged(before, after)).toBe(false);
});

test('table inline proof preserves demoted paragraph properties', () => {
  const before = changeFirst(source(), 'pPr', (node) => ({ ...node, kind: 'generic' }));
  const after = changeFirst(before, 'pPr', (node) => ({ ...node, children: [] }));
  expect(tableTextStructureUnchanged(before, after)).toBe(false);
});

for (const content of [
  '<w:hyperlink><w:r><w:t>Link</w:t></w:r></w:hyperlink>',
  '<w:r><w:drawing/></w:r>',
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
  '<w:pPr><w:rPr><w:ins w:id="1"/></w:rPr></w:pPr>',
  '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>',
]) {
  test(`table inline proof refuses nonordinary content: ${content}`, () => {
    const part = load(`<w:p>${content}</w:p>`);
    const body = part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
    expect(editableTableParagraph(body.children[0]!)).toBe(false);
  });
}
