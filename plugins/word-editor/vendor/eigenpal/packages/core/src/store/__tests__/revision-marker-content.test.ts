// Which property containers resolving a paragraph mark may remove.
import { expect, test } from 'bun:test';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';
import { heldOnlyResolvedMarks } from '../store/revision-marker-content.ts';

const element = (id: string, kind: string, localName: string, children: OoxmlNode[] = []) =>
  ({
    id,
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    attributes: [],
    children,
  }) as unknown as OoxmlNode;

/** `w:pPr` holding `w:rPr` holding one mark, and the mark's id. */
function properties(partName: string, family: string): { node: OoxmlNode; mark: string } {
  const mark = element(`${partName}#${family}2`, 'generic', 'del');
  const rPr = element(`${partName}#${family}1`, 'runProperties', 'rPr', [mark]);
  return {
    node: element(`${partName}#${family}0`, 'paragraphProperties', 'pPr', [rPr]),
    mark: mark.id,
  };
}

test('only containers in the mark id family are removed', () => {
  const created = properties('/word/document.xml', 'mark:');
  expect(heldOnlyResolvedMarks(created.node, new Set([created.mark]))).toBe(true);
  const source = properties('/word/document.xml', '0.0.');
  expect(heldOnlyResolvedMarks(source.node, new Set([source.mark]))).toBe(false);
});

test('a part name that contains the family marker does not count', () => {
  const crafted = properties('/word/a#mark:b.xml', '0.0.');
  expect(heldOnlyResolvedMarks(crafted.node, new Set([crafted.mark]))).toBe(false);
});

test('a source container emptied by accepting an inserted mark is removed too', () => {
  const source = properties('/word/document.xml', '0.0.');
  expect(heldOnlyResolvedMarks(source.node, new Set([source.mark]), new Set([source.mark]))).toBe(
    true
  );
  expect(heldOnlyResolvedMarks(source.node, new Set([source.mark]), new Set())).toBe(false);
});
