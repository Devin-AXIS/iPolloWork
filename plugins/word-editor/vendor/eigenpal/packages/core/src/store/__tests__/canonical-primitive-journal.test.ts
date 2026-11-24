// Canonical primitive journal capture (full-document-yjs-collaboration tasks 3.5 and 3.9).

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createCollaborationDocumentPort } from '../../collaboration/document-port.ts';
import { observeCanonicalPrimitiveJournal } from '../../collaboration/primitive-journal.ts';
import {
  canonicalPrimitiveJournalAllocationCount,
  flushPendingCanonicalJournals,
  observeCanonicalPrimitiveJournal as observeAnyStore,
  packageTransactionPublished,
  recordMoveNode,
  runObservedStoreTransaction,
  storeHasPendingCanonicalJournals,
} from '../package/canonical-primitive-capture.ts';
import type {
  CanonicalAttributeName,
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
} from '../package/canonical-primitive-journal.ts';
import { withBinaryPart } from '../package/drawing-package-edit.ts';
import { insertChildren, removeNode, replaceChildren, replaceNode } from '../package/ooxml-edit.ts';
import { readOoxmlPackage, withPart, writeOoxmlPackage } from '../package/ooxml-package.ts';
import {
  withoutPart,
  withContentTypeOverride,
  withNewPart,
  withRelationship,
  withRelationshipsPartFor,
} from '../package/package-edit.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  XML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

function documentBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

function openStore(): TreePackageStore {
  const loaded = readOoxmlPackage(documentBytes());
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  return new TreePackageStore(loaded.package, main);
}

function paragraphIdOf(part: OoxmlPart): string {
  const found: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') found.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  if (!found[0]) throw new Error('missing paragraph');
  return found[0];
}

function findNode(part: OoxmlPart, predicate: (node: OoxmlNode) => boolean): OoxmlNode {
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (predicate(node)) return node;
    if (node.kind !== 'textValue') stack.push(...node.children);
  }
  throw new Error('node not found');
}

function commentsPartXml(body: string): string {
  return `<w:comments xmlns:w="${W}">${body}</w:comments>`;
}

function readCommentsPart(body: string): OoxmlPart {
  const comments = readOoxmlPart(commentsPartXml(body), {
    name: '/word/comments.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  });
  if (!comments.ok) throw new Error(comments.reason);
  return comments.part;
}

function replayInsertedRoot(effects: readonly CanonicalPrimitiveEffect[]): OoxmlNode {
  type Recorded = {
    readonly kind: string;
    readonly qname?: CanonicalAttributeName;
    value: string;
    attributes: OoxmlAttribute[];
    bindings: { prefix: string; namespaceUri: string }[];
    children: string[];
  };
  const nodes = new Map<string, Recorded>();
  let rootId: string | null = null;
  for (const effect of effects) {
    if (effect.kind === 'putNode') {
      nodes.set(effect.descriptor.logicalId, {
        kind: effect.descriptor.kind,
        qname: effect.descriptor.kind === 'textValue' ? undefined : effect.descriptor.qname,
        value: '',
        attributes: [],
        bindings: [],
        children: [],
      });
      continue;
    }
    if (effect.kind === 'spliceText') {
      const recorded = nodes.get(effect.logicalId);
      if (!recorded) throw new Error('missing text node');
      recorded.value =
        recorded.value.slice(0, effect.utf16Start) +
        effect.insert +
        recorded.value.slice(effect.utf16Start + effect.deleteCount);
      continue;
    }
    if (effect.kind === 'setAttribute') {
      const recorded = nodes.get(effect.logicalId);
      if (!recorded) throw new Error('missing attributed node');
      recorded.attributes = recorded.attributes.filter(
        (attribute) =>
          attribute.namespaceUri !== effect.qname.namespaceUri ||
          attribute.localName !== effect.qname.localName
      );
      if (effect.value !== null) {
        recorded.attributes.push({
          kind: 'genericExtension',
          namespaceUri: effect.qname.namespaceUri,
          localName: effect.qname.localName,
          ...(effect.qname.prefix === undefined ? {} : { prefix: effect.qname.prefix }),
          value: effect.value,
        });
      }
      continue;
    }
    if (effect.kind === 'setNamespaceBinding') {
      const recorded = nodes.get(effect.logicalId);
      if (!recorded) throw new Error('missing bound node');
      recorded.bindings = recorded.bindings.filter((binding) => binding.prefix !== effect.prefix);
      if (effect.uri !== null) {
        recorded.bindings.push({ prefix: effect.prefix, namespaceUri: effect.uri });
      }
      continue;
    }
    if (effect.kind === 'spliceChildren') {
      const recorded = nodes.get(effect.parentLogicalId);
      if (!recorded) throw new Error('missing parent');
      recorded.children.splice(effect.start, effect.deleteCount, ...effect.childLogicalIds);
      continue;
    }
    if (effect.kind === 'putXmlPart') rootId = effect.rootLogicalId;
  }
  if (rootId === null) throw new Error('missing putXmlPart');
  const materialize = (id: string): OoxmlNode => {
    const recorded = nodes.get(id);
    if (!recorded) throw new Error(`missing record ${id}`);
    if (recorded.kind === 'textValue') {
      return { id, kind: 'textValue', value: recorded.value };
    }
    if (!recorded.qname) throw new Error(`missing qname ${id}`);
    return {
      id,
      kind: recorded.kind,
      namespaceUri: recorded.qname.namespaceUri,
      localName: recorded.qname.localName,
      ...(recorded.qname.prefix === undefined ? {} : { prefix: recorded.qname.prefix }),
      attributes: recorded.attributes,
      namespaceBindings: recorded.bindings,
      children: recorded.children.map(materialize),
    } as OoxmlNode;
  };
  return materialize(rootId);
}

function insertHello(store: TreePackageStore): void {
  const id = paragraphIdOf(store.bodyStore().part);
  const result = store.transact({ kind: 'body' }, (context) => {
    context.apply({ op: 'insertText', paragraphId: id, offset: 5, text: ' there' });
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}

function captureJournal<T>(run: () => T): {
  readonly result: T;
  readonly journal: CanonicalPrimitiveJournal | null;
} {
  const host = {};
  let journal: CanonicalPrimitiveJournal | null = null;
  const stop = observeAnyStore(host, (next) => {
    journal = next;
  });
  try {
    const result = runObservedStoreTransaction(host, run, packageTransactionPublished);
    flushPendingCanonicalJournals(host);
    return { result, journal };
  } finally {
    stop();
  }
}

describe('canonical primitive journal (task 3.5)', () => {
  test('one committed store transaction emits one frozen journal', () => {
    const store = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    const stop = observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    insertHello(store);
    insertHello(store);
    flushPendingCanonicalJournals(store);
    stop();
    expect(journals).toHaveLength(2);
    expect(Object.isFrozen(journals[0])).toBe(true);
    expect(Object.isFrozen(journals[0]!.effects)).toBe(true);
    expect(journals[0]!.effects.length).toBeGreaterThan(0);
    expect(journals[0]).not.toBe(journals[1]);
  });

  test('typing beside an equal letter names the offset it typed at', () => {
    const store = openStore();
    const id = paragraphIdOf(store.bodyStore().part);
    const journals: CanonicalPrimitiveJournal[] = [];
    const stop = observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    for (const offset of [3, 2]) {
      const result = store.transact({ kind: 'body' }, (context) => {
        context.apply({ op: 'insertText', paragraphId: id, offset, text: 'l' });
      });
      if (!result.ok) throw new Error(result.detail ?? result.reason);
    }
    flushPendingCanonicalJournals(store);
    stop();
    // Read as text alone, each new letter goes after the equal letters beside it.
    const starts = journals.map(
      (journal) =>
        journal.effects.find(
          (effect): effect is Extract<CanonicalPrimitiveEffect, { kind: 'spliceText' }> =>
            effect.kind === 'spliceText'
        )?.utf16Start
    );
    expect(starts).toEqual([3, 2]);
  });

  test('a committed journal is frozen and delivered before transact returns', () => {
    // Positions in a journal are absolute against the tree this transaction just committed,
    // so delivery cannot wait for a later task: anything that moves the tree first invalidates
    // them, in bounds and without an error.
    const store = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    insertHello(store);
    expect(journals).toHaveLength(1);
    expect(Object.isFrozen(journals[0])).toBe(true);
    expect(storeHasPendingCanonicalJournals(store)).toBe(false);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(1);
  });

  test('a rejected transaction emits no journal and does not move revision or history', () => {
    const store = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const beforeRevision = store.packageRevision;
    const result = store.transact({ kind: 'body' }, (context) => {
      context.apply({
        op: 'insertText',
        paragraphId: 'missing-paragraph',
        offset: 0,
        text: 'x',
      });
    });
    expect(result.ok).toBe(false);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(0);
    expect(store.packageRevision).toBe(beforeRevision);
    expect(store.canUndo).toBe(false);
  });

  test('the same local edit produces a deterministic journal', () => {
    const first = openStore();
    const second = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(first, (journal) => journals.push(journal));
    observeCanonicalPrimitiveJournal(second, (journal) => journals.push(journal));
    insertHello(first);
    insertHello(second);
    flushPendingCanonicalJournals();
    expect(JSON.stringify(journals[0])).toBe(JSON.stringify(journals[1]));
  });

  test('replaceChildren, insertChildren and removeNode lower to spliceChildren', () => {
    const part = openStore().bodyStore().part;
    const run = findNode(part, (node) => node.kind === 'run') as OoxmlElement;
    const extra = {
      id: `${part.name}#journal-extra`,
      kind: 'textValue',
      value: 'x',
    } as const;
    const inserted = captureJournal(() => {
      const result = insertChildren(part, run.id, run.children.length, [extra], {
        deferValidation: true,
      });
      return { ok: result.ok, change: result.ok ? result.part : null };
    });
    expect(inserted.journal?.effects.some((effect) => effect.kind === 'spliceChildren')).toBe(true);

    const text = findNode(part, (node) => node.kind === 'text') as OoxmlElement;
    const replaced = captureJournal(() => {
      const result = replaceChildren(part, text.id, [{ ...extra, id: `${text.id}/next` }], {
        deferValidation: true,
      });
      return { ok: result.ok, change: result.ok ? result.part : null };
    });
    expect(replaced.journal?.effects.some((effect) => effect.kind === 'spliceChildren')).toBe(true);

    const removed = captureJournal(() => {
      const result = removeNode(part, text.id, { deferValidation: true });
      return { ok: result.ok, change: result.ok ? result.part : null };
    });
    expect(
      removed.journal?.effects.some(
        (effect) => effect.kind === 'spliceChildren' && effect.deleteCount === 1
      )
    ).toBe(true);
  });

  test('replaceChildren keeps a child that stays between new children in place', () => {
    // Wrapping a kept run with new children must not delete and reinsert it: two peers that
    // each wrap the same run would otherwise merge two copies of the list side by side.
    const part = openStore().bodyStore().part;
    const paragraph = findNode(part, (node) => node.kind === 'paragraph') as OoxmlElement;
    const run = paragraph.children[0]!;
    const newRun = (suffix: string) =>
      ({
        id: `${part.name}#journal-${suffix}`,
        kind: 'run',
        namespaceUri: W,
        localName: 'r',
        prefix: 'w',
        attributes: [],
        namespaceBindings: [],
        children: [],
      }) as unknown as OoxmlNode;
    const before = newRun('before');
    const after = newRun('after');
    const wrapped = captureJournal(() => {
      const result = replaceChildren(part, paragraph.id, [before, run, after], {
        deferValidation: true,
      });
      return { ok: result.ok, change: result.ok ? result.part : null };
    });
    const splices = wrapped.journal!.effects.filter((effect) => effect.kind === 'spliceChildren');
    expect(splices).toEqual([
      {
        kind: 'spliceChildren',
        parentLogicalId: paragraph.id,
        start: 0,
        deleteCount: 0,
        childLogicalIds: [before.id],
      },
      {
        kind: 'spliceChildren',
        parentLogicalId: paragraph.id,
        start: 2,
        deleteCount: 0,
        childLogicalIds: [after.id],
      },
    ]);
  });

  test('child splices replay to the new order for reorders and wide lists', () => {
    // The kept-middle search must stay correct when kept children move, and above its size
    // cap, where the middle is lowered as one splice.
    const part = openStore().bodyStore().part;
    const paragraph = findNode(part, (node) => node.kind === 'paragraph') as OoxmlElement;
    const run = (suffix: string) =>
      ({
        id: `${part.name}#order-${suffix}`,
        kind: 'run',
        namespaceUri: W,
        localName: 'r',
        prefix: 'w',
        attributes: [],
        namespaceBindings: [],
        children: [],
      }) as unknown as OoxmlNode;
    const replay = (before: readonly OoxmlNode[], after: readonly OoxmlNode[]): string[] => {
      const seeded = replaceChildren(part, paragraph.id, before, { deferValidation: true });
      if (!seeded.ok) throw new Error('seed failed');
      const parent = findNode(seeded.part, (node) => node.id === paragraph.id) as OoxmlElement;
      const lowered = captureJournal(() => {
        const result = replaceChildren(seeded.part, parent.id, after, { deferValidation: true });
        return { ok: result.ok, change: result.ok ? result.part : null };
      });
      const ids = before.map((child) => child.id);
      for (const effect of lowered.journal!.effects) {
        if (effect.kind !== 'spliceChildren' || effect.parentLogicalId !== parent.id) continue;
        ids.splice(effect.start, effect.deleteCount, ...effect.childLogicalIds);
        // A moved child leaves its old slot first: an apply that shows one copy of a repeated
        // child would otherwise read a later index as the next sibling (#1572).
        expect(new Set(ids).size).toBe(ids.length);
      }
      return ids;
    };
    const [a, b, x] = [run('a'), run('b'), run('x')];
    expect(replay([a, b, x], [x, a, b])).toEqual([x.id, a.id, b.id]);
    expect(replay([a, b, x], [b, x, a])).toEqual([b.id, x.id, a.id]);
    const [c, d, e] = [run('c'), run('d'), run('e')];
    // Up by two and three, down by two, to both ends, and two moves at once.
    expect(replay([a, b, x, c, d], [x, a, b, c, d])).toEqual([x.id, a.id, b.id, c.id, d.id]);
    expect(replay([a, b, c, x, d], [x, a, b, c, d])).toEqual([x.id, a.id, b.id, c.id, d.id]);
    expect(replay([x, a, b, c, d], [a, b, x, c, d])).toEqual([a.id, b.id, x.id, c.id, d.id]);
    expect(replay([a, b, x, c, d], [a, b, c, d, x])).toEqual([a.id, b.id, c.id, d.id, x.id]);
    expect(replay([a, b, x, c, d, e], [x, e, a, b, c, d])).toEqual(
      [x, e, a, b, c, d].map((child) => child.id)
    );
    const wide = Array.from({ length: 80 }, (_, index) => run(`w${index}`));
    const shuffled = [...wide.slice(40), run('new'), ...wide.slice(0, 40)].reverse();
    expect(replay(wide, shuffled)).toEqual(shuffled.map((child) => child.id));
  });

  test('same-id replaceNode lowers to text, attribute and namespace effects', () => {
    const part = openStore().bodyStore().part;
    const value = findNode(part, (node) => node.kind === 'textValue' && node.value === 'Hello');
    const text = captureJournal(() => {
      const result = replaceNode(
        part,
        value.id,
        { ...value, value: 'Help' },
        { deferValidation: true }
      );
      return { ok: result.ok, change: result.ok ? result.part : null };
    });
    expect(text.journal?.effects).toEqual([
      {
        kind: 'spliceText',
        logicalId: value.id,
        utf16Start: 3,
        deleteCount: 2,
        insert: 'p',
      },
    ]);

    const element = findNode(part, (node) => node.kind === 'text') as OoxmlElement;
    const attributed = captureJournal(() => {
      const result = replaceNode(
        part,
        element.id,
        {
          ...element,
          attributes: [
            {
              kind: 'xmlSpace',
              namespaceUri: XML_NAMESPACE_URI,
              localName: 'space',
              prefix: 'xml',
              value: 'preserve',
            },
          ],
        },
        { deferValidation: true }
      );
      return { ok: result.ok, change: result.ok ? result.part : null };
    });
    expect(attributed.journal?.effects.some((effect) => effect.kind === 'setAttribute')).toBe(true);

    const bound = captureJournal(() => {
      const result = replaceNode(
        part,
        element.id,
        {
          ...element,
          namespaceBindings: [{ prefix: 'r', namespaceUri: 'http://example.test/r' }],
        },
        { deferValidation: true }
      );
      return { ok: result.ok, change: result.ok ? result.part : null };
    });
    expect(bound.journal?.effects.some((effect) => effect.kind === 'setNamespaceBinding')).toBe(
      true
    );
  });

  test('package hooks emit part, relationship, content-type and binary effects', () => {
    const store = openStore();
    const pkg = store.currentPackage();
    const comments = readCommentsPart('');
    const created = captureJournal(() => {
      const next = withNewPart(
        withRelationshipsPartFor(pkg, pkg.mainDocumentPart),
        '/word/comments.xml',
        comments.root,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
      );
      return { ok: true, change: next };
    });
    const kinds = created.journal?.effects.map((effect) => effect.kind) ?? [];
    expect(kinds).toContain('putXmlPart');
    expect(kinds).toContain('putContentTypeOverride');

    const related = captureJournal(() => {
      const withRels = withRelationshipsPartFor(pkg, pkg.mainDocumentPart);
      const result = withRelationship(
        withRels,
        pkg.mainDocumentPart,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
        'comments.xml'
      );
      return { ok: result.ok, change: result.ok ? result.pkg : null };
    });
    expect(related.journal?.effects.some((effect) => effect.kind === 'putRelationship')).toBe(true);
    expect(related.journal?.effects.some((effect) => effect.kind === 'spliceChildren')).toBe(false);

    const typed = captureJournal(() => {
      const next = withContentTypeOverride(
        pkg,
        '/word/comments.xml',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
      );
      return { ok: true, change: next === pkg ? null : next };
    });
    expect(typed.journal?.effects.every((effect) => effect.kind === 'putContentTypeOverride')).toBe(
      true
    );

    const binary = captureJournal(() => {
      const next = withBinaryPart(pkg, '/word/media/image1.png', PNG, 'image/png');
      return { ok: true, change: next };
    });
    expect(binary.journal?.effects.some((effect) => effect.kind === 'putBinary')).toBe(true);

    const removed = captureJournal(() => {
      const next = withoutPart(withPart(pkg, comments), '/word/document.xml');
      return { ok: next.ok, change: next.ok && next.pkg !== pkg ? next.pkg : null };
    });
    expect(removed.journal?.effects.some((effect) => effect.kind === 'deleteXmlPart')).toBe(true);
  });

  test('putNode reconstructs a new comments part fingerprint', () => {
    const comments = readCommentsPart(
      '<w:comment w:id="0" w:author="Ada" w:date="2020-01-01T00:00:00Z" w:initials="A">' +
        '<w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:comment>'
    );
    const created = captureJournal(() => {
      const next = withPart(openStore().currentPackage(), comments);
      return { ok: true, change: next };
    });
    const effects = created.journal?.effects ?? [];
    const putNodeAt = effects.findIndex((effect) => effect.kind === 'putNode');
    const putPartAt = effects.findIndex((effect) => effect.kind === 'putXmlPart');
    expect(putNodeAt).toBeGreaterThanOrEqual(0);
    expect(putPartAt).toBeGreaterThan(putNodeAt);
    expect(
      effects.slice(putNodeAt, putPartAt).every((effect) => effect.kind !== 'putXmlPart')
    ).toBe(true);
    expect(canonicalOoxmlFingerprint(replayInsertedRoot(effects))).toBe(
      canonicalOoxmlFingerprint(comments)
    );

    const parsedReplacement = readCommentsPart(
      '<w:comment w:id="1" w:author="Bo"><w:p/></w:comment>'
    );
    const replaced = {
      ...parsedReplacement,
      root: { ...parsedReplacement.root, id: `${parsedReplacement.root.id}#replaced` },
    };
    const afterCreate = withPart(openStore().currentPackage(), comments);
    const swapped = captureJournal(() => {
      const next = withPart(afterCreate, replaced);
      return { ok: true, change: next };
    });
    expect(swapped.journal?.effects.some((effect) => effect.kind === 'putNode')).toBe(true);
    expect(swapped.journal?.effects.some((effect) => effect.kind === 'putXmlPart')).toBe(true);
    expect(canonicalOoxmlFingerprint(replayInsertedRoot(swapped.journal?.effects ?? []))).toBe(
      canonicalOoxmlFingerprint(replaced)
    );

    const sameRoot = captureJournal(() => {
      const next = withPart(afterCreate, comments);
      return { ok: true, change: next === afterCreate ? null : next };
    });
    expect(sameRoot.journal?.effects.some((effect) => effect.kind === 'putNode')).toBe(false);
    expect(sameRoot.journal?.effects.some((effect) => effect.kind === 'putXmlPart')).toBe(false);
  });

  test('moveNode is a first-class journal effect', () => {
    const captured = captureJournal(() => {
      recordMoveNode('node-a', 'parent-b', 2);
      return { ok: true, change: true };
    });
    expect(captured.journal?.effects).toEqual([
      {
        kind: 'moveNode',
        logicalId: 'node-a',
        destinationParentLogicalId: 'parent-b',
        destinationIndex: 2,
      },
    ]);
  });
});

function insertMarker(store: TreePackageStore, text: string): void {
  const result = store.transact({ kind: 'body' }, (context) => {
    context.apply({
      op: 'insertText',
      paragraphId: paragraphIdOf(store.bodyStore().part),
      offset: 5,
      text,
    });
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}

function storyText(store: TreePackageStore): string {
  const chunks: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      chunks.push(node.value);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(store.bodyStore().part.root);
  return chunks.join('');
}

function spliceInserts(journal: CanonicalPrimitiveJournal | null): string[] {
  return (
    journal?.effects
      .filter(
        (effect): effect is Extract<CanonicalPrimitiveEffect, { kind: 'spliceText' }> =>
          effect.kind === 'spliceText'
      )
      .map((effect) => effect.insert) ?? []
  );
}

describe('journal capture isolates nested store frames (task 3.5)', () => {
  test('observed then observed nesting emits one journal per store', () => {
    const outerHost = {};
    const innerHost = {};
    const outerJournals: CanonicalPrimitiveJournal[] = [];
    const innerJournals: CanonicalPrimitiveJournal[] = [];
    const stopOuter = observeAnyStore(outerHost, (journal) => outerJournals.push(journal));
    const stopInner = observeAnyStore(innerHost, (journal) => innerJournals.push(journal));
    runObservedStoreTransaction(
      outerHost,
      () => {
        recordMoveNode('outer-a', 'parent', 0);
        runObservedStoreTransaction(
          innerHost,
          () => {
            recordMoveNode('inner-b', 'parent', 1);
            return { ok: true, change: true };
          },
          packageTransactionPublished
        );
        recordMoveNode('outer-c', 'parent', 2);
        return { ok: true, change: true };
      },
      packageTransactionPublished
    );
    flushPendingCanonicalJournals();
    stopOuter();
    stopInner();
    expect(outerJournals).toHaveLength(1);
    expect(innerJournals).toHaveLength(1);
    expect(Object.isFrozen(outerJournals[0])).toBe(true);
    expect(Object.isFrozen(innerJournals[0])).toBe(true);
    expect(outerJournals[0]).not.toBe(innerJournals[0]);
    expect(outerJournals[0]!.effects).toEqual([
      {
        kind: 'moveNode',
        logicalId: 'outer-a',
        destinationParentLogicalId: 'parent',
        destinationIndex: 0,
      },
      {
        kind: 'moveNode',
        logicalId: 'outer-c',
        destinationParentLogicalId: 'parent',
        destinationIndex: 2,
      },
    ]);
    expect(innerJournals[0]!.effects).toEqual([
      {
        kind: 'moveNode',
        logicalId: 'inner-b',
        destinationParentLogicalId: 'parent',
        destinationIndex: 1,
      },
    ]);

    const outer = openStore();
    const inner = openStore();
    const storeOuter: CanonicalPrimitiveJournal[] = [];
    const storeInner: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(outer, (journal) => storeOuter.push(journal));
    observeCanonicalPrimitiveJournal(inner, (journal) => storeInner.push(journal));
    const result = outer.transact({ kind: 'body' }, (context) => {
      insertMarker(inner, ' INNER');
      context.apply({
        op: 'insertText',
        paragraphId: paragraphIdOf(outer.bodyStore().part),
        offset: 5,
        text: ' OUTER',
      });
    });
    expect(result.ok).toBe(true);
    flushPendingCanonicalJournals();
    expect(storeOuter).toHaveLength(1);
    expect(storeInner).toHaveLength(1);
    expect(spliceInserts(storeOuter[0]!)).toEqual([' OUTER']);
    expect(spliceInserts(storeInner[0]!)).toEqual([' INNER']);
    expect(storyText(outer)).toBe('Hello OUTER');
    expect(storyText(inner)).toBe('Hello INNER');
  });

  test('observed then unobserved nesting records only the outer journal', () => {
    const outerHost = {};
    const innerHost = {};
    const outerJournals: CanonicalPrimitiveJournal[] = [];
    const stopOuter = observeAnyStore(outerHost, (journal) => outerJournals.push(journal));
    const beforeHostAllocations = canonicalPrimitiveJournalAllocationCount();
    runObservedStoreTransaction(
      outerHost,
      () => {
        runObservedStoreTransaction(
          innerHost,
          () => {
            recordMoveNode('inner-x', 'parent', 0);
            return { ok: true, change: true };
          },
          packageTransactionPublished
        );
        recordMoveNode('outer-y', 'parent', 0);
        return { ok: true, change: true };
      },
      packageTransactionPublished
    );
    flushPendingCanonicalJournals();
    stopOuter();
    expect(canonicalPrimitiveJournalAllocationCount()).toBe(beforeHostAllocations + 1);
    expect(outerJournals).toHaveLength(1);
    expect(outerJournals[0]!.effects).toEqual([
      {
        kind: 'moveNode',
        logicalId: 'outer-y',
        destinationParentLogicalId: 'parent',
        destinationIndex: 0,
      },
    ]);

    const outer = openStore();
    const inner = openStore();
    const storeOuter: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(outer, (journal) => storeOuter.push(journal));
    const beforeStoreAllocations = canonicalPrimitiveJournalAllocationCount();
    const result = outer.transact({ kind: 'body' }, (context) => {
      insertMarker(inner, ' INNER');
      context.apply({
        op: 'insertText',
        paragraphId: paragraphIdOf(outer.bodyStore().part),
        offset: 5,
        text: ' OUTER',
      });
    });
    expect(result.ok).toBe(true);
    flushPendingCanonicalJournals();
    expect(canonicalPrimitiveJournalAllocationCount()).toBe(beforeStoreAllocations + 1);
    expect(storeOuter).toHaveLength(1);
    expect(spliceInserts(storeOuter[0]!)).toEqual([' OUTER']);
    expect(storyText(inner)).toBe('Hello INNER');
    expect(storyText(outer)).toBe('Hello OUTER');
  });
});

describe('journal capture is silent without observers (task 3.9)', () => {
  test('disabled observation allocates no journal and does not change output', () => {
    const observed = openStore();
    const quiet = openStore();
    observeCanonicalPrimitiveJournal(observed, () => undefined);
    const beforeAllocations = canonicalPrimitiveJournalAllocationCount();
    insertHello(quiet);
    expect(canonicalPrimitiveJournalAllocationCount()).toBe(beforeAllocations);
    insertHello(observed);
    expect(canonicalPrimitiveJournalAllocationCount()).toBe(beforeAllocations + 1);

    expect(quiet.packageRevision).toBe(observed.packageRevision);
    expect(quiet.canUndo).toBe(true);
    expect(observed.canUndo).toBe(true);
    expect(quiet.canRedo).toBe(false);
    expect(canonicalOoxmlFingerprint(quiet.bodyStore().part)).toBe(
      canonicalOoxmlFingerprint(observed.bodyStore().part)
    );
    expect(writeOoxmlPackage(quiet.currentPackage())).toEqual(
      writeOoxmlPackage(observed.currentPackage())
    );
    expect(paragraphIdOf(quiet.bodyStore().part)).toBe(paragraphIdOf(observed.bodyStore().part));
  });

  test('the collaboration port exposes the same observation contract', () => {
    const store = openStore();
    const port = createCollaborationDocumentPort(store, { documentId: 'journal-port' });
    const journals: CanonicalPrimitiveJournal[] = [];
    port.observePrimitiveJournal((journal) => journals.push(journal));
    insertHello(store);
    port.flushPendingJournals();
    expect(journals).toHaveLength(1);
    expect(journals[0]!.effects.length).toBeGreaterThan(0);
  });

  test('an edit rejected by validation leaves no effects behind it', () => {
    // Lowering reads the pre-edit id index, which `rebuild` mutates, so capture runs BEFORE
    // the edit is known to be valid and is truncated when it is not. A transaction that
    // commits DESPITE a failed primitive is the only place that difference is observable:
    // a throw and an uncommitted result both discard the frame wholesale.
    const part = openStore().bodyStore().part;
    const paragraph = findNode(part, (node) => node.kind === 'paragraph') as OoxmlElement;
    const run = findNode(part, (node) => node.kind === 'run') as OoxmlElement;
    const value = findNode(part, (node) => node.kind === 'textValue' && node.value === 'Hello');

    const captured = captureJournal(() => {
      // A second copy of a live run: every id already exists, so validation reports
      // `duplicate-id` and the edit yields no part.
      const rejected = insertChildren(part, paragraph.id, 0, [run]);
      expect(rejected.ok).toBe(false);
      const accepted = replaceNode(
        part,
        value.id,
        { ...value, value: 'Help' },
        { deferValidation: true }
      );
      return { ok: accepted.ok, change: accepted.ok ? accepted.part : null };
    });

    // Only the accepted edit is described. Had the rejected insert stayed, a replica would
    // splice in children whose ids the sender never committed.
    expect(captured.journal?.effects).toEqual([
      { kind: 'spliceText', logicalId: value.id, utf16Start: 3, deleteCount: 2, insert: 'p' },
    ]);
  });
});
