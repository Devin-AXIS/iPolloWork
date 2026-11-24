import { expect, test } from 'bun:test';
import { applyTreeOp, planRevisionBatch, readOoxmlPart, revisionItemsOf } from '../index.ts';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';
import { textUnder } from '../store/review-text.ts';
import references from './fixtures/word-bulk-content-reference.json';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from './fixtures/review-table-grouping-cases.ts';

// Independent Word-saved results, captured on 2026-09-18. This projection tests
// content, nested topology, bold/italic, row height and cell shading. It does not
// establish width/grid, individual-group membership or native UI action parity.
function contentProjection(root: OoxmlNode) {
  const text: string[] = [];
  const bold: string[] = [];
  const italic: string[] = [];
  const tables: { parent: number[] | null; rowCellCounts: number[] }[] = [];
  const rowHeights: (string | null)[] = [];
  const cellShading: (string | null)[] = [];
  const isW = (node: OoxmlNode, name: string) =>
    node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
  const children = (node: OoxmlNode | undefined, name: string) =>
    node && node.kind !== 'textValue' ? node.children.filter((child) => isW(child, name)) : [];
  const child = (node: OoxmlNode | undefined, name: string) => children(node, name)[0];
  const attribute = (node: OoxmlNode | undefined, name: string): string | null =>
    node && node.kind !== 'textValue'
      ? (node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)
          ?.value ?? null)
      : null;
  const visit = (node: OoxmlNode, parent: number[] | null = null): void => {
    if (node.kind === 'textValue') return;
    if (isW(node, 't')) text.push(textUnder(node));
    if (isW(node, 'r')) {
      for (const [property, target] of [
        ['b', bold],
        ['i', italic],
      ] as const) {
        const value = child(child(node, 'rPr'), property);
        if (value && !['0', 'false', 'off'].includes(attribute(value, 'val') ?? '1'))
          target.push(textUnder(node));
      }
    }
    if (isW(node, 'tbl')) {
      const index = tables.length;
      const rows = children(node, 'tr');
      tables.push({ parent, rowCellCounts: rows.map((row) => children(row, 'tc').length) });
      rows.forEach((row, rowIndex) => {
        rowHeights.push(attribute(child(child(row, 'trPr'), 'trHeight'), 'val'));
        children(row, 'tc').forEach((cell, cellIndex) => {
          cellShading.push(attribute(child(child(cell, 'tcPr'), 'shd'), 'fill'));
          if (cell.kind !== 'textValue')
            for (const nested of cell.children) visit(nested, [index, rowIndex, cellIndex]);
        });
      });
      return;
    }
    for (const nested of node.children) visit(nested, parent);
  };
  visit(root);
  return {
    text: text.join(''),
    boldText: bold.join(''),
    italicText: italic.join(''),
    tables,
    rowHeights,
    cellShading,
  };
}

for (const reference of references) {
  const title = `Word bulk content: ${reference.action} ${reference.name}`;
  test(title, () => {
    const fixture = reviewTableGroupingCases.find((entry) => entry.name === reference.name)!;
    const parsed = readOoxmlPart(reviewTableGroupingParts(fixture)['word/document.xml']!, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    let part = parsed.part;
    const action = reference.action === 'accept' ? 'accept' : 'reject';
    const plan = planRevisionBatch(part, action);
    expect(plan.result.skipped).toHaveLength(reference.remaining ?? 0);
    expect(plan.result.remaining).toBe(reference.remaining ?? 0);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    expect(revisionItemsOf(part)).toHaveLength(reference.remaining ?? 0);
    expect(contentProjection(part.root)).toEqual(reference.expected);
  });
}
