// Paragraph identity is a document-wide invariant, not a load-time courtesy.
//
// Opening a document gives every paragraph a valid, part-unique `w14:paraId`
// (`normalizeParagraphIdentity`), and the public contract addresses paragraphs by it. Each op
// that creates paragraphs mints its own identities, so an op that forgets leaves paragraphs
// nothing can address. This sweep runs every authorable op kind's coverage fixture over a
// normalized document and checks the invariant still holds in every part that carries
// paragraph identity.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { isValidParaId, normalizeParagraphIdentity, paraIdOf } from '../package/para-id.ts';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { authorableCoverageFixtures } from './canonical-primitive-journal-coverage-ops.ts';

function openNormalized(bytes: Uint8Array): TreePackageStore {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  return new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
}

/** Every WML paragraph's authored `w14:paraId` (or null) in one part, document order. */
function paragraphIdsOf(root: OoxmlNode): (string | null)[] {
  const ids: (string | null)[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') ids.push(paraIdOf(node));
    for (const child of node.children) visit(child);
  };
  visit(root);
  return ids;
}

/** Identity defects per part: a missing or invalid id, or one shared by two paragraphs. */
function identityDefects(pkg: OoxmlPackage, partNames: readonly string[]): string[] {
  const defects: string[] = [];
  for (const name of partNames) {
    const part = pkg.parts.get(name);
    if (!part) continue;
    const seen = new Set<string>();
    for (const [index, id] of paragraphIdsOf(part.root).entries()) {
      if (id === null || !isValidParaId(id)) {
        defects.push(`${name} paragraph ${index}: ${id === null ? 'no paraId' : `invalid ${id}`}`);
        continue;
      }
      const canonical = id.toUpperCase();
      if (seen.has(canonical)) defects.push(`${name} paragraph ${index}: duplicate ${id}`);
      seen.add(canonical);
    }
  }
  return defects;
}

/** Parts whose every paragraph carried a valid id before the op: the ones the invariant binds. */
function identifiedParts(pkg: OoxmlPackage): string[] {
  const names: string[] = [];
  for (const [name, part] of pkg.parts) {
    const ids = paragraphIdsOf(part.root);
    if (ids.length > 0 && ids.every((id) => id !== null && isValidParaId(id))) names.push(name);
  }
  return names;
}

describe('every op keeps every paragraph addressable by paraId', () => {
  for (const fixture of authorableCoverageFixtures()) {
    test(fixture.kind, () => {
      const store = openNormalized(fixture.bytes);
      const before = store.currentPackage();
      const bound = identifiedParts(before);
      expect(identityDefects(before, bound)).toEqual([]);
      const applied = fixture.apply(store);
      expect(applied.reason ?? 'ok').toBe('ok');
      expect(identityDefects(store.currentPackage(), bound)).toEqual([]);
    });
  }
});
