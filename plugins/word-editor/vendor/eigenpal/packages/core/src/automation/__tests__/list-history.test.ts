import { expect, test } from 'bun:test';
import { readOoxmlPackage, writeOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { strFromU8, unzipSync } from 'fflate';
import { createAutomationList, formatAutomationListLevel } from '../list-authoring.ts';
import { docx } from './support/protocol.ts';

test('package-only list format saves, undoes and redoes while preserving later shell list allocations', () => {
  const read = readOoxmlPackage(docx('<w:p><w:r><w:t>body</w:t></w:r></w:p>'));
  if (!read.ok) throw new Error('fixture');
  const first = createAutomationList(read.package)!;
  const store = new TreePackageStore(first.pkg, first.pkg.parts.get(first.pkg.mainDocumentPart)!);
  const xml = () =>
    strFromU8(unzipSync(writeOoxmlPackage(store.currentPackage()))['word/numbering.xml']!);
  const change = store.transact({ kind: 'body' }, (ctx) => {
    ctx.applyPackage((pkg) =>
      formatAutomationListLevel(pkg, first.numId, 0, { numbering: 'Arabic', startingNumber: 6 })!
    );
  });
  expect(change.ok).toBe(true);
  expect(xml()).toContain('<w:start w:val="6"');
  const second = createAutomationList(store.currentPackage())!;
  store.replacePackageShell(second.pkg);
  expect(store.undo()).not.toBeNull();
  expect(xml()).not.toContain('<w:start w:val="6"');
  expect(xml()).toContain(`<w:num w:numId="${second.numId}">`);
  expect(store.redo()).not.toBeNull();
  expect(xml()).toContain('<w:start w:val="6"');
  expect(xml()).toContain(`<w:num w:numId="${second.numId}">`);
});
