import { expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { bindConflictingPrefixes, bindMissingPrefixes } from '../package/edit-namespace-scope.ts';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '../package/ooxml-tree.ts';
import {
  plainDoc,
  openStore,
  paragraphsOf,
  transactBody,
  captureOneJournal,
  replayAndCompare,
  W,
} from './canonical-primitive-journal-coverage-support.ts';
import { writeOoxmlPackage, readOoxmlPackage } from '../package/ooxml-package.ts';

function conflictingDocument(): Uint8Array {
  const entries = unzipSync(
    plainDoc(
      '<w:p><w:r><w:t>First Second</w:t><f:keep xmlns:f="urn:foreign" f:flag="yes"/></w:r></w:p>'
    )
  );
  entries['word/document.xml'] = strToU8(
    new TextDecoder()
      .decode(entries['word/document.xml'])
      .replaceAll('w:', 'x:')
      .replace('xmlns:w=', 'xmlns:x=')
      .replace('<x:document ', '<x:document xmlns:w="urn:foreign" w:flag="yes" ')
  );
  return zipSync(entries);
}
test('split and formatting bind generated prefixes without altering foreign QNames; journals replay', () => {
  const bytes = conflictingDocument();
  const id = paragraphsOf(openStore(bytes).bodyStore().part)[0]!.id;
  for (const op of [
    { op: 'splitParagraph', paragraphId: id, offset: 6 } as const,
    {
      op: 'setParagraphProperties',
      paragraphId: id,
      properties: [{ localName: 'spacing', attributes: { afterLines: '100' } }],
    } as const,
  ]) {
    const source = openStore(bytes);
    const replica = openStore(bytes);
    const captured = captureOneJournal(source, () => transactBody(source, op));
    expect(captured.result.ok).toBe(true);
    expect(captured.journal).not.toBeNull();
    replayAndCompare(replica, source, captured.journal!);
    const xml = serializeOoxmlPart(source.bodyStore().part);
    expect(source.bodyStore().part.root.namespaceBindings).toContainEqual({
      prefix: 'w',
      namespaceUri: 'urn:foreign',
    });
    expect(xml).toContain('flag="yes"');
    expect(xml).toContain('f:keep');
    const written = writeOoxmlPackage(source.currentPackage());
    expect(readOoxmlPackage(written).ok).toBe(true);
  }
});
test('local rebinding also preserves reused children with the old prefix meaning', () => {
  const parsed = readOoxmlPart('<w:foreign xmlns:w="urn:foreign"><w:child/></w:foreign>', {
    name: '/part.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const root = {
    ...parsed.part.root,
    namespaceUri: W,
    localName: 'p',
    kind: 'paragraph',
    namespaceBindings: [],
  } as OoxmlElement;
  const bound = bindConflictingPrefixes(root, new Map([['w', 'urn:foreign']])) as OoxmlElement;
  expect(bound.namespaceBindings).toEqual([{ prefix: 'w', namespaceUri: W }]);
  expect((bound.children[0] as OoxmlElement).namespaceBindings).toEqual([
    { prefix: 'w', namespaceUri: 'urn:foreign' },
  ]);
});
test('does not rewrite explicitly contradictory declarations', () => {
  const node = {
    id: 'bad',
    kind: 'paragraph',
    localName: 'p',
    namespaceUri: W,
    prefix: 'w',
    namespaceBindings: [{ prefix: 'w', namespaceUri: 'urn:foreign' }],
    attributes: [],
    children: [],
  } as OoxmlElement;
  expect(bindConflictingPrefixes(node, new Map([['w', W]]))).toBe(node);
});
test('hands back the same subtree when nothing in it needs a binding', () => {
  const leaf = {
    id: 'r',
    kind: 'run',
    localName: 'r',
    namespaceUri: W,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlElement;
  const paragraph = { ...leaf, id: 'p', kind: 'paragraph', localName: 'p', children: [leaf] };
  const body = { ...leaf, id: 'b', kind: 'body', localName: 'body', children: [paragraph] };
  // Identity all the way down: a structural edit hands this story-sized child lists, so an
  // unchanged subtree must cost no copy.
  expect(bindConflictingPrefixes(body as OoxmlElement, new Map([['w', W]]))).toBe(body);
  // A conflict deep inside copies exactly the path to it and keeps the untouched sibling.
  const foreign = { ...leaf, id: 'f', namespaceUri: 'urn:foreign' };
  const mixed = { ...body, children: [paragraph, { ...paragraph, id: 'q', children: [foreign] }] };
  const rebound = bindConflictingPrefixes(
    mixed as OoxmlElement,
    new Map([['w', W]])
  ) as OoxmlElement;
  expect(rebound).not.toBe(mixed);
  expect(rebound.children[0]).toBe(paragraph);
  const reboundLeaf = (rebound.children[1] as OoxmlElement).children[0] as OoxmlElement;
  expect(reboundLeaf.namespaceBindings).toEqual([{ prefix: 'w', namespaceUri: 'urn:foreign' }]);
});
test('moved content declares the prefixes its destination does not bind', () => {
  const leaf = (id: string, prefix: string, namespaceUri: string): OoxmlElement =>
    ({
      id,
      kind: 'generic',
      localName: id,
      namespaceUri,
      prefix,
      namespaceBindings: [],
      attributes: [],
      children: [],
    }) as unknown as OoxmlElement;
  const paragraph = {
    ...leaf('p', 'w', W),
    attributes: [{ namespaceUri: 'urn:identity', localName: 'paraId', prefix: 'i', value: '1' }],
  } as unknown as OoxmlElement;
  const note = { ...leaf('note', 'w', W), children: [paragraph] } as OoxmlElement;
  const scope = new Map([['w', W]]);
  const bound = bindMissingPrefixes(note, scope) as OoxmlElement;
  expect(bound.namespaceBindings).toEqual([{ prefix: 'i', namespaceUri: 'urn:identity' }]);
  // Nothing to declare: the same node comes back.
  expect(bindMissingPrefixes(note, new Map([...scope, ['i', 'urn:identity']]))).toBe(note);
  // A prefix used for two URIs gets no binding and is left to validation.
  const clash = {
    ...leaf('note', 'w', W),
    children: [leaf('a', 'i', 'urn:one'), leaf('b', 'i', 'urn:two')],
  } as OoxmlElement;
  expect((bindMissingPrefixes(clash, scope) as OoxmlElement).namespaceBindings).toEqual([]);
  // A prefix the destination binds to another URI is rebound where the moved content uses it.
  const rebound = bindMissingPrefixes(
    note,
    new Map([...scope, ['i', 'urn:other']])
  ) as OoxmlElement;
  const reboundParagraph = rebound.children[0] as OoxmlElement;
  expect(reboundParagraph.namespaceBindings).toEqual([
    { prefix: 'i', namespaceUri: 'urn:identity' },
  ]);
});
