import { expect, test } from 'bun:test';
import { cachedTableStructure } from '../table-structure-cache.ts';
import { load } from './table-row-keep-fixtures.ts';
import type { OoxmlElement } from '../../store/package/ooxml-tree.ts';

function fixture() {
  const part = load('<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>');
  const body = part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  return body.children.find((node) => node.kind === 'table') as OoxmlElement;
}
const context = {
  contentWidthPt: 300,
  depth: 0,
  styleCascade: undefined,
  displayMode: 'all-markup' as const,
  authorFilter: undefined,
  compatibilityMode: 15,
  textBox: false,
};

test('table cache retains both update inputs and evicts older versions', () => {
  const first = fixture();
  // Empty answers exercise cache ownership without a structure carry hiding a read.
  const second = { ...first };
  const third = { ...first };
  let reads = 0;
  const read = () => {
    reads++;
    return null;
  };
  cachedTableStructure(first, context, read);
  cachedTableStructure(second, context, read);
  cachedTableStructure(first, context, read);
  cachedTableStructure(second, context, read);
  expect(reads).toBe(2);
  cachedTableStructure(third, context, read);
  cachedTableStructure(second, context, read);
  expect(reads).toBe(3);
  cachedTableStructure(first, context, read);
  expect(reads).toBe(4);
});

test('table cache separates measurement and revision display contexts', () => {
  const source = fixture();
  let reads = 0;
  const read = () => {
    reads++;
    return null;
  };
  cachedTableStructure(source, context, read);
  cachedTableStructure(source, { ...context, contentWidthPt: 200 }, read);
  cachedTableStructure(source, { ...context, displayMode: 'original' }, read);
  cachedTableStructure(source, context, read);
  expect(reads).toBe(3);
});

test('table cache bounds retained width contexts', () => {
  const source = fixture();
  let reads = 0;
  const read = () => {
    reads++;
    return null;
  };
  for (let width = 100; width < 110; width++)
    cachedTableStructure(source, { ...context, contentWidthPt: width }, read);
  expect(reads).toBe(10);
  cachedTableStructure(source, { ...context, contentWidthPt: 109 }, read);
  expect(reads).toBe(10);
  cachedTableStructure(source, { ...context, contentWidthPt: 100 }, read);
  expect(reads).toBe(11);
});
