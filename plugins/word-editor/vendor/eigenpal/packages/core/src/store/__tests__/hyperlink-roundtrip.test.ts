// Links and bookmarks survive an unedited load -> save -> reopen unchanged.
//
// Typing `w:hyperlink` and the bookmark markers changed how the reader CLASSIFIES them, and
// a classification change is exactly the kind of thing that quietly rewrites a document: an
// attribute dropped because the typed node did not model it, a marker demoted and re-emitted
// in a different shape. The D9 oracles are the guard — the canonical fingerprint for
// structural identity, the semantic digest for content — and this points them at the
// comprehensive fixture's five links and twenty-two bookmarks.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { canonicalOoxmlFingerprint } from '../package/ooxml-serialize.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

const FIXTURE = `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`;

function mainPartOf(bytes: Uint8Array): { part: OoxmlPart; externalCount: number } {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(`package read failed: ${loaded.reason}`);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!part) throw new Error('no main document part');
  return { part, externalCount: loaded.package.externalTargets.length };
}

/** Every node of a kind, in document order. */
function nodesOfKind(part: OoxmlPart, kind: string): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return found;
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

const original = readFileSync(FIXTURE);

describe('the comprehensive fixture round-trips its links and bookmarks unedited', () => {
  const first = mainPartOf(new Uint8Array(original));

  test('the premise: five typed hyperlinks and twenty-two bookmarks', () => {
    const links = nodesOfKind(first.part, 'hyperlink');
    expect(links).toHaveLength(5);
    // Two external (by relationship) and three internal (by anchor), as authored.
    const external = links.filter((link) => attributeOf(link, 'id') !== undefined);
    const internal = links.filter((link) => attributeOf(link, 'anchor') !== undefined);
    expect(external).toHaveLength(2);
    expect(internal).toHaveLength(3);
    expect(internal.map((link) => attributeOf(link, 'anchor'))).toEqual([
      'section1',
      'section6',
      'section12',
    ]);

    const starts = nodesOfKind(first.part, 'bookmarkStart');
    const ends = nodesOfKind(first.part, 'bookmarkEnd');
    expect(starts).toHaveLength(22);
    expect(ends).toHaveLength(22);
    expect(starts.map((node) => attributeOf(node, 'name'))).toContain('section12');
  });

  test('the canonical fingerprint is unchanged by a save and reopen', () => {
    const reopened = mainPartOf(writeOoxmlPackage(readPackage()));
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(first.part));
  });

  test('the semantic digest reports no difference', () => {
    const reopened = mainPartOf(writeOoxmlPackage(readPackage()));
    expect(
      diffSemanticDigests(semanticDigest([first.part]), semanticDigest([reopened.part]))
    ).toEqual([]);
  });

  test('every link keeps its authored attributes verbatim', () => {
    const reopened = mainPartOf(writeOoxmlPackage(readPackage()));
    const before = nodesOfKind(first.part, 'hyperlink').map((link) => ({
      id: attributeOf(link, 'id'),
      anchor: attributeOf(link, 'anchor'),
      history: attributeOf(link, 'history'),
      tooltip: attributeOf(link, 'tooltip'),
    }));
    const after = nodesOfKind(reopened.part, 'hyperlink').map((link) => ({
      id: attributeOf(link, 'id'),
      anchor: attributeOf(link, 'anchor'),
      history: attributeOf(link, 'history'),
      tooltip: attributeOf(link, 'tooltip'),
    }));
    expect(after).toEqual(before);
  });

  test('every bookmark keeps its authored id and name', () => {
    const reopened = mainPartOf(writeOoxmlPackage(readPackage()));
    const pairs = (part: OoxmlPart) =>
      nodesOfKind(part, 'bookmarkStart').map((node) => [
        attributeOf(node, 'id'),
        attributeOf(node, 'name'),
      ]);
    expect(pairs(reopened.part)).toEqual(pairs(first.part));
  });

  test('the external relationships survive with their targets', () => {
    const loaded = readOoxmlPackage(writeOoxmlPackage(readPackage()));
    if (!loaded.ok) throw new Error(loaded.reason);
    const hyperlinks = loaded.package.externalTargets.filter((entry) =>
      entry.type.endsWith('/hyperlink')
    );
    expect(hyperlinks.map((entry) => entry.rawTarget).sort()).toEqual([
      'https://example.com',
      'https://www.anthropic.com',
    ]);
  });
});

/** A freshly read package, so each test writes from the same starting point. */
function readPackage() {
  const loaded = readOoxmlPackage(new Uint8Array(original));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}
