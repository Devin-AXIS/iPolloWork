import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { legacyCheckboxAccessibleName } from '../package/legacy-checkbox-accessibility.ts';

function catalogField(): OoxmlNode {
  const loaded = readOoxmlPackage(
    new Uint8Array(
      readFileSync(
        new URL('../../../../../e2e/fixtures/form-controls-catalog.docx', import.meta.url)
      )
    )
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const root = loaded.package.parts.get(loaded.package.mainDocumentPart)!.root;
  const nodes = [root as OoxmlNode];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (legacyCheckboxAccessibleName(node) === 'legacyCbOff') return node;
    if (node.kind !== 'textValue') for (const child of node.children) nodes.push(child);
  }
  throw new Error('missing catalog checkbox');
}

test('the scrubbed catalog supplies a plain accessible name without reading macro values', () => {
  const field = catalogField();
  expect(legacyCheckboxAccessibleName(field)).toBe('legacyCbOff');
  if (field.kind === 'textValue') throw new Error('field');
  const data = field.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'ffData'
  )!;
  if (data.kind === 'textValue') throw new Error('data');
  for (const localName of ['entryMacro', 'exitMacro']) {
    const macro = {
      ...data,
      localName,
      get attributes(): never {
        throw new Error('macro attributes must not be read');
      },
      children: [],
    };
    const changed = { ...field, children: [{ ...data, children: [...data.children, macro] }] };
    expect(legacyCheckboxAccessibleName(changed)).toBeUndefined();
  }
  expect(
    legacyCheckboxAccessibleName({
      ...field,
      children: [{ ...data, children: Array(257).fill(data) }],
    })
  ).toBeUndefined();
});
