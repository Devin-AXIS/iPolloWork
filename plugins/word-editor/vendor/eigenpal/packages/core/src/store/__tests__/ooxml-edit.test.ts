// Atomic tree-edit primitives (task 4.5) and generic unknown-node preservation (task 4.6).
//
// Task 4.6 is the proof that the SECOND preservation model is unnecessary. Today an edit
// keeps unknown OOXML by stashing the original bytes beside the semantic model — a run's
// `rPrCapsule`, a paragraph's source byte range — and any paragraph whose bytes are not
// "fully captured" is forced read-only, which is why one piece of clipart freezes paragraph
// editing across a whole document. In the canonical tree an unknown element is just a
// generic node in the child sequence, so it survives an edit to its neighbours by
// construction, with nothing kept verbatim and no read-only penalty.

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  validateOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  applyEdits,
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
  replaceChildren,
  replaceNode,
} from '../package/ooxml-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`read failed: ${result.reason}`);
  return result.part;
}

/** The first node satisfying a predicate, in document order. */
function find(part: OoxmlPart, predicate: (node: OoxmlNode) => boolean): OoxmlNode {
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (predicate(node)) return node;
    if (node.kind !== 'textValue') stack.unshift(...node.children);
  }
  throw new Error('node not found');
}

const generic = (node: OoxmlNode, localName: string): boolean =>
  node.kind === 'generic' && node.localName === localName;

/** The `<w:t>` ELEMENT holding `value`. Text is changed by replacing that element's
 *  children; a `textValue` is a leaf and has no children of its own to replace. */
function textElementFor(part: OoxmlPart, value: string): OoxmlNode {
  return find(
    part,
    (node) =>
      node.kind === 'text' &&
      node.children.some((child) => child.kind === 'textValue' && child.value === value)
  );
}

/** A `<w:t>` text element whose value is `text`, with freshly allocated identities.
 *  Takes the allocator rather than making one, so every node an edit introduces is minted
 *  from the SAME sequence — two allocators seeded from one part both start at `new:0`. */
function textElement(nextId: () => string, text: string): OoxmlElement {
  const valueId = nextId();
  const elementId = nextId();
  return {
    id: elementId,
    kind: 'text',
    namespaceUri: W,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as OoxmlElement;
}

describe('atomic tree-edit primitives (task 4.5)', () => {
  const part = load(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>one</w:t></w:r></w:p></w:body></w:document>`
  );

  test('an edit returns a NEW part and never mutates the input', () => {
    const target = find(part, (n) => n.kind === 'text');
    const before = serializeOoxmlPart(part);
    const result = replaceChildren(part, target.id, [{ id: 'x', kind: 'textValue', value: 'two' }]);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(serializeOoxmlPart(part)).toBe(before);
    expect(serializeOoxmlPart(result.part)).toContain('two');
  });

  test('untouched siblings keep their identity through structural sharing', () => {
    const two = load(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    );
    const body = find(two, (n) => n.kind === 'body') as OoxmlElement;
    const untouched = body.children[1]!;
    const firstText = textElementFor(two, 'first');
    const result = replaceChildren(two, firstText.id, []);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const nextBody = find(result.part, (n) => n.kind === 'body') as OoxmlElement;
    // Same object, not merely an equal one: the subtree was reused by reference.
    expect(nextBody.children[1]).toBe(untouched);
  });

  test('a rejected edit yields issues and no part', () => {
    const result = replaceChildren(part, 'no-such-node', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  test('an edit that would duplicate an id fails closed', () => {
    const paragraph = find(part, (n) => n.kind === 'paragraph');
    const run = find(part, (n) => n.kind === 'run');
    // Insert a SECOND copy of an existing run — same ids throughout.
    const result = insertChildren(part, paragraph.id, 0, [run]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'duplicate-id')).toBe(true);
  });

  test('applyEdits is atomic: a failing step leaves the original part untouched', () => {
    const text = textElementFor(part, 'one');
    const before = serializeOoxmlPart(part);
    const result = applyEdits(part, [
      (current) => replaceChildren(current, text.id, []),
      (current) => removeNode(current, 'no-such-node'),
    ]);
    expect(result.ok).toBe(false);
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('allocated ids never collide with structural-path ids', () => {
    const nextId = createNodeIdAllocator(part);
    const minted = [nextId(), nextId(), nextId()];
    expect(new Set(minted).size).toBe(3);
    for (const id of minted) expect(findNode(part, id)).toBeNull();
  });

  test('two documents opened from the same bytes mint the SAME ids', () => {
    // Deliberate, and load-bearing for collaboration: a minted id is a part-scoped counter,
    // so two replicas that started from one baseline both mint `#new:0` for the different
    // paragraphs each of them inserted. Shared identity for NEW nodes therefore cannot be a
    // canonical node id; the replication layer maps them to replica-scoped logical ids.
    const mint = (): string =>
      createNodeIdAllocator(
        load(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`)
      )();
    expect(mint()).toBe(mint());
  });
});

describe('generic unknown nodes survive supported edits (task 4.6)', () => {
  // `before [clipart] after`, plus an unknown paragraph-level element and an unknown child
  // NESTED inside a known run-properties element. All three are things the semantic model
  // has no representation for.
  const xml =
    `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body><w:p>` +
    '<w:r><w:t xml:space="preserve">before </w:t></w:r>' +
    '<w:r><w:drawing><a:graphic><a:graphicData uri="urn:clip"/></a:graphic></w:drawing></w:r>' +
    '<w:r><w:rPr><w:u w:val="double"/><a:customUnknown val="keep-me"/></w:rPr><w:t xml:space="preserve"> after</w:t></w:r>' +
    '<w:futureThing a:attr="x">tail</w:futureThing>' +
    '</w:p></w:body></w:document>';

  test('unknown elements load as generic nodes in source order, not dropped', () => {
    const part = load(xml);
    const paragraph = find(part, (n) => n.kind === 'paragraph') as OoxmlElement;
    expect(paragraph.children.map((c) => c.kind)).toEqual([
      'run',
      'run',
      'run',
      'generic', // w:futureThing
    ]);
    // The drawing is a generic node inside a typed run — present, in order, with children.
    const drawing = find(part, (n) => generic(n, 'drawing')) as OoxmlElement;
    expect(drawing.children).toHaveLength(1);
    expect(JSON.stringify(drawing)).toContain('urn:clip');
  });

  test('editing adjacent text leaves every generic subtree byte-for-byte equivalent', () => {
    const part = load(xml);
    const drawingBefore = find(part, (n) => generic(n, 'drawing'));
    const unknownBefore = find(part, (n) => generic(n, 'customUnknown'));
    const futureBefore = find(part, (n) => generic(n, 'futureThing'));

    // The supported edit: change the text of the FIRST run.
    const target = textElementFor(part, 'before ');
    const edited = replaceChildren(part, target.id, [
      { id: `${part.name}#edit:0`, kind: 'textValue', value: 'BEFORE ' },
    ]);
    if (!edited.ok) throw new Error(JSON.stringify(edited.issues));

    const drawingAfter = find(edited.part, (n) => generic(n, 'drawing'));
    const unknownAfter = find(edited.part, (n) => generic(n, 'customUnknown'));
    const futureAfter = find(edited.part, (n) => generic(n, 'futureThing'));

    // Identity preserved, and the subtrees are the SAME objects — nothing was regenerated,
    // so there is nothing to regenerate wrongly.
    expect(drawingAfter).toBe(drawingBefore);
    expect(unknownAfter).toBe(unknownBefore);
    expect(futureAfter).toBe(futureBefore);
    expect(canonicalOoxmlFingerprint(drawingAfter)).toBe(canonicalOoxmlFingerprint(drawingBefore));

    // And the edit actually happened.
    expect(serializeOoxmlPart(edited.part)).toContain('BEFORE ');
  });

  test('serialized output keeps unknown content and its relative order', () => {
    const part = load(xml);
    const target = textElementFor(part, ' after');
    const edited = replaceChildren(part, target.id, [
      { id: `${part.name}#edit:0`, kind: 'textValue', value: ' AFTER' },
    ]);
    if (!edited.ok) throw new Error(JSON.stringify(edited.issues));

    const out = serializeOoxmlPart(edited.part);
    expect(out).toContain('graphicData');
    expect(out).toContain('urn:clip');
    expect(out).toContain('customUnknown');
    expect(out).toContain('keep-me');
    expect(out).toContain('futureThing');
    // Relative order: drawing before the edited run, futureThing last.
    expect(out.indexOf('drawing')).toBeLessThan(out.indexOf(' AFTER'));
    expect(out.indexOf(' AFTER')).toBeLessThan(out.indexOf('futureThing'));

    // Reopening the produced XML yields the same tree shape — the round trip is closed
    // WITHOUT retaining any original bytes.
    const reopened = load(out);
    expect(find(reopened, (n) => generic(n, 'customUnknown'))).toBeDefined();
    expect(validateOoxmlPart(reopened).ok).toBe(true);
  });

  test('inserting a run beside unknown content does not disturb it', () => {
    const part = load(xml);
    const paragraph = find(part, (n) => n.kind === 'paragraph');
    const futureBefore = find(part, (n) => generic(n, 'futureThing'));
    const nextId = createNodeIdAllocator(part);
    const run = {
      id: nextId(),
      kind: 'run',
      namespaceUri: W,
      localName: 'r',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [textElement(nextId, 'inserted')],
    } as unknown as OoxmlNode;

    const result = insertChildren(part, paragraph.id, 1, [run]);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(find(result.part, (n) => generic(n, 'futureThing'))).toBe(futureBefore);
    expect(serializeOoxmlPart(result.part)).toContain('inserted');
    expect(serializeOoxmlPart(result.part)).toContain('keep-me');
  });

  test('replacing a run leaves a NESTED unknown sibling in the untouched run intact', () => {
    const part = load(xml);
    const unknownBefore = find(part, (n) => generic(n, 'customUnknown'));
    const firstRun = find(part, (n) => n.kind === 'run');
    const nextId = createNodeIdAllocator(part);
    const replacement = {
      id: nextId(),
      kind: 'run',
      namespaceUri: W,
      localName: 'r',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [textElement(nextId, 'replaced')],
    } as unknown as OoxmlNode;

    const result = replaceNode(part, firstRun.id, replacement);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(find(result.part, (n) => generic(n, 'customUnknown'))).toBe(unknownBefore);
    const out = serializeOoxmlPart(result.part);
    expect(out).toContain('replaced');
    expect(out).toContain('<w:u w:val="double"/>');
    expect(out).toContain('keep-me');
  });

  test('removing a run does not remove the unknown nodes around it', () => {
    const part = load(xml);
    const firstRun = find(part, (n) => n.kind === 'run');
    const result = removeNode(part, firstRun.id);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const out = serializeOoxmlPart(result.part);
    expect(out).not.toContain('before ');
    expect(out).toContain('urn:clip');
    expect(out).toContain('keep-me');
    expect(out).toContain('futureThing');
  });
});
