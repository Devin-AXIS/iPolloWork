// The node lifecycle inside a store, and the sweep that is the only answer to a control
// deleted in Word.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPackage, writeOoxmlPackage } from '../ooxml-package.ts';
import { withCustomXmlDataPart } from '../custom-xml-part.ts';
import {
  customXmlLabelXPath,
  customXmlNodes,
  customXmlPrefixMappings,
  readCustomXmlNode,
  withCustomXmlNode,
  withoutCustomXmlNode,
  withoutOrphanCustomXmlNodes,
} from '../custom-xml-nodes.ts';
import type { OoxmlPackage } from '../ooxml-package.ts';

const STORY = '/word/document.xml';
const NS = 'http://docx-editor.dev/ns';

function storeFixture(): { pkg: OoxmlPackage; partName: string } {
  const path = resolve(
    import.meta.dir,
    '../../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
  );
  const read = readOoxmlPackage(new Uint8Array(readFileSync(path)));
  if (!read.ok) throw new Error(read.reason);
  const authored = withCustomXmlDataPart(read.package, STORY, NS, 'docxEditor');
  if (!authored.part) throw new Error('no store');
  return { pkg: authored.pkg, partName: authored.part.partName };
}

describe('writing nodes', () => {
  test('a node round-trips through the package as authored', () => {
    const { pkg, partName } = storeFixture();
    const next = withCustomXmlNode(pkg, partName, {
      id: 'cx1',
      label: '(Smith 2024)',
      data: '{"sourceId":"src_9f3","locator":"p.42"}',
    });
    const reopened = readOoxmlPackage(writeOoxmlPackage(next));
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(readCustomXmlNode(reopened.package, partName, 'cx1')).toEqual({
      id: 'cx1',
      label: '(Smith 2024)',
      data: '{"sourceId":"src_9f3","locator":"p.42"}',
    });
  });

  test('writing the same id twice replaces rather than appends', () => {
    // Two nodes with one id make the binding xpath ambiguous, and Word takes the first match —
    // so an append would leave the control showing its old text for good.
    const { pkg, partName } = storeFixture();
    const once = withCustomXmlNode(pkg, partName, { id: 'cx1', label: 'first', data: '1' });
    const twice = withCustomXmlNode(once, partName, { id: 'cx1', label: 'second', data: '2' });
    expect(customXmlNodes(twice, partName)).toEqual([{ id: 'cx1', label: 'second', data: '2' }]);
  });

  test('payload text that would break the XML survives it', () => {
    const { pkg, partName } = storeFixture();
    const hostile = '</data></node><node id="evil"><label>x</label><data>&<>"\'';
    const next = withCustomXmlNode(pkg, partName, { id: 'cx1', label: '<b>&', data: hostile });
    const reopened = readOoxmlPackage(writeOoxmlPackage(next));
    if (!reopened.ok) throw new Error(reopened.reason);
    // One node, not two: the payload was escaped rather than parsed as markup.
    expect(customXmlNodes(reopened.package, partName)).toEqual([
      { id: 'cx1', label: '<b>&', data: hostile },
    ]);
  });
});

describe('removing nodes', () => {
  test('by id', () => {
    const { pkg, partName } = storeFixture();
    let next = withCustomXmlNode(pkg, partName, { id: 'a', label: 'A', data: '' });
    next = withCustomXmlNode(next, partName, { id: 'b', label: 'B', data: '' });
    const remaining = customXmlNodes(withoutCustomXmlNode(next, partName, 'a'), partName);
    expect(remaining.map((node) => node.id)).toEqual(['b']);
  });

  test('removing one the store never held changes nothing', () => {
    const { pkg, partName } = storeFixture();
    const next = withCustomXmlNode(pkg, partName, { id: 'a', label: 'A', data: '' });
    expect(withoutCustomXmlNode(next, partName, 'nope')).toBe(next);
  });
});

describe('the orphan sweep', () => {
  test('collects exactly what the story no longer binds', () => {
    const { pkg, partName } = storeFixture();
    let next = withCustomXmlNode(pkg, partName, { id: 'kept', label: 'K', data: '' });
    next = withCustomXmlNode(next, partName, { id: 'gone', label: 'G', data: '' });
    const swept = withoutOrphanCustomXmlNodes(next, partName, new Set(['kept']));
    expect(swept.removed).toEqual(['gone']);
    expect(customXmlNodes(swept.pkg, partName).map((node) => node.id)).toEqual(['kept']);
  });

  test('a store where everything is still bound is left untouched', () => {
    const { pkg, partName } = storeFixture();
    const next = withCustomXmlNode(pkg, partName, { id: 'a', label: 'A', data: '' });
    const swept = withoutOrphanCustomXmlNodes(next, partName, new Set(['a']));
    expect(swept.removed).toEqual([]);
    expect(swept.pkg).toBe(next);
  });

  test('an empty reference set empties the store, which is what deleting the last chip means', () => {
    const { pkg, partName } = storeFixture();
    const next = withCustomXmlNode(pkg, partName, { id: 'a', label: 'A', data: '' });
    expect(withoutOrphanCustomXmlNodes(next, partName, new Set()).removed).toEqual(['a']);
  });
});

describe('the binding address', () => {
  test('every step is prefixed, or it matches nothing in a namespaced store', () => {
    expect(customXmlLabelXPath('ns0', 'docxEditor', 'cx1')).toBe(
      "/ns0:docxEditor/ns0:node[@id='cx1']/ns0:label"
    );
    expect(customXmlPrefixMappings('ns0', NS)).toBe(`xmlns:ns0='${NS}'`);
  });
});

describe('an id no binding could address', () => {
  test('is refused at the write, not discovered at the binding', () => {
    const { pkg, partName } = storeFixture();
    // Escaping makes this safe in the XML; it is still an id `customXmlLabelXPath` refuses,
    // so storing it would leave a payload nothing can ever reach.
    const hostile = 'x" onload="alert(1)';
    expect(withCustomXmlNode(pkg, partName, { id: hostile, label: 'x', data: '{}' })).toBe(pkg);
    expect(customXmlLabelXPath('ns0', 'nodes', hostile)).toBeNull();
  });
});
