// Intent-scoped semantic history (tasks 5.4, 5.5, 5.6) and atomic publication (5.2).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreeDocumentStore, type TreeModelChange } from '../store/tree-store.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

function store(body = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'): {
  store: TreeDocumentStore;
  id: string;
} {
  const part = load(body);
  return { store: new TreeDocumentStore(part), id: paragraphIds(part)[0]! };
}

const text = (s: TreeDocumentStore, id: string): string | null => paragraphTextOf(s.part, id);

describe('atomic publication (task 5.2)', () => {
  test('a transaction publishes exactly one revision and one change', () => {
    const { store: s, id } = store();
    const changes: TreeModelChange[] = [];
    s.subscribe((change) => changes.push(change));

    const result = s.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: ' there' });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 11, text: '!' });
    });

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(s.revision).toBe(1);
    expect(text(s, id)).toBe('Hello there!');
    expect(changes[0]!.fromRevision).toBe(0);
    expect(changes[0]!.toRevision).toBe(1);
  });

  test('a rejection mid-transaction leaves revision, tree and subscribers untouched', () => {
    const { store: s, id } = store();
    const changes: TreeModelChange[] = [];
    s.subscribe((change) => changes.push(change));

    const result = s.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 0, text: 'X' });
      ctx.apply({ op: 'insertText', paragraphId: 'no-such-paragraph', offset: 0, text: 'Y' });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown-paragraph');
    expect(s.revision).toBe(0);
    expect(text(s, id)).toBe('Hello');
    expect(changes).toHaveLength(0);
    expect(s.canUndo).toBe(false);
  });

  test('an op after a failure is ignored rather than partially applied', () => {
    const { store: s, id } = store();
    let thirdApplied: boolean | null = null;
    s.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 0, text: 'A' });
      ctx.apply({ op: 'deleteText', paragraphId: id, start: 5, end: 2 }); // inverted
      thirdApplied = ctx.apply({ op: 'insertText', paragraphId: id, offset: 0, text: 'B' });
    });
    expect(thirdApplied).toBe(false);
    expect(text(s, id)).toBe('Hello');
  });

  test('the change carries merged effects and the widest impact', () => {
    const { store: s, id } = store();
    const result = s.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 0, text: 'X' });
      ctx.apply({ op: 'splitParagraph', paragraphId: id, offset: 3 });
    });
    if (!result.ok || !result.change) throw new Error('expected a change');
    // text-local + flow-structural widens to flow-structural.
    expect(result.change.impact).toBe('flow-structural');
    expect(result.change.dirty).toContain(id);
    expect(result.change.created).toHaveLength(1);
    expect(result.change.splitJoin).toHaveLength(1);
    expect(result.change.dependencyKeys.length).toBeGreaterThan(0);
  });

  test('a transaction that applies nothing publishes nothing', () => {
    const { store: s } = store();
    const result = s.transact(() => {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.change).toBeNull();
    expect(s.revision).toBe(0);
    expect(s.canUndo).toBe(false);
  });
});

describe('one history entry per intent (task 5.4)', () => {
  test('one transaction is one undo step, however many ops it carries', () => {
    const { store: s, id } = store();
    s.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: ' a' });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 7, text: ' b' });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 9, text: ' c' });
    });
    expect(s.historyDepth).toBe(1);
    expect(text(s, id)).toBe('Hello a b c');
    s.undo();
    expect(text(s, id)).toBe('Hello');
  });

  test('a command applying a property across several runs is still one entry', () => {
    const { store: s, id } = store(
      '<w:p><w:r><w:t>one </w:t></w:r><w:r><w:t>two </w:t></w:r><w:r><w:t>three</w:t></w:r></w:p>'
    );
    s.transact(
      (ctx) => {
        ctx.apply({
          op: 'setRunProperties',
          paragraphId: id,
          start: 0,
          end: 8,
          properties: [{ localName: 'b' }],
        });
        ctx.apply({
          op: 'setParagraphProperties',
          paragraphId: id,
          properties: [{ localName: 'jc', attributes: { val: 'center' } }],
        });
      },
      { scope: 'command' }
    );
    expect(s.historyDepth).toBe(1);
  });

  test('consecutive typing transactions may remain SEPARATE entries (D10)', () => {
    const { store: s, id } = store();
    for (const [index, character] of [...'abc'].entries()) {
      s.transact((ctx) =>
        ctx.apply({ op: 'insertText', paragraphId: id, offset: 5 + index, text: character })
      );
    }
    expect(text(s, id)).toBe('Helloabc');
    // Three transactions, three entries. No timer merged them, which is the behavior D10
    // permits and the browser checkpoint observed as per-character undo.
    expect(s.historyDepth).toBe(3);
    s.undo();
    expect(text(s, id)).toBe('Helloab');
  });

  test('undo and redo walk entries one at a time and restore content exactly', () => {
    const { store: s, id } = store();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: ' one' }));
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 9, text: ' two' }));
    expect(text(s, id)).toBe('Hello one two');
    s.undo();
    expect(text(s, id)).toBe('Hello one');
    s.undo();
    expect(text(s, id)).toBe('Hello');
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(text(s, id)).toBe('Hello one');
    s.redo();
    expect(text(s, id)).toBe('Hello one two');
    expect(s.canRedo).toBe(false);
  });

  test('undo reverses a structural edit, which a projection history could not', () => {
    const { store: s, id } = store();
    s.transact((ctx) => ctx.apply({ op: 'splitParagraph', paragraphId: id, offset: 2 }));
    expect(paragraphIds(s.part)).toHaveLength(2);
    s.undo();
    expect(paragraphIds(s.part)).toHaveLength(1);
    expect(text(s, id)).toBe('Hello');
  });

  test('a new edit after undo clears the redo stack', () => {
    const { store: s, id } = store();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'A' }));
    s.undo();
    expect(s.canRedo).toBe(true);
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'B' }));
    expect(s.canRedo).toBe(false);
  });

  test('an entry carries the selection to restore on each side', () => {
    const { store: s, id } = store();
    s.transact((ctx) => {
      ctx.selectionBefore({ paragraphId: id, start: 5, end: 5 });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'XY' });
      ctx.selectionAfter({ paragraphId: id, start: 7, end: 7 });
    });
    expect(s.selectionForUndo()).toEqual({ paragraphId: id, start: 5, end: 5 });
    s.undo();
    expect(s.selectionForRedo()).toEqual({ paragraphId: id, start: 7, end: 7 });
  });

  test('the history stack is bounded', () => {
    const part = load('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const s = new TreeDocumentStore(part, { historyLimit: 3 });
    const id = paragraphIds(part)[0]!;
    for (let i = 0; i < 10; i += 1) {
      s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 0, text: 'a' }));
    }
    expect(s.historyDepth).toBe(3);
  });
});

describe('IME composition is one entry (task 5.5)', () => {
  test('every transaction between start and end collapses into one entry', () => {
    const { store: s, id } = store();
    s.beginComposition({ paragraphId: id, start: 5, end: 5 });
    // An IME typically emits one transaction per intermediate candidate.
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'に' }));
    s.transact((ctx) => ctx.apply({ op: 'deleteText', paragraphId: id, start: 5, end: 6 }));
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: '日本' }));
    expect(s.compositionActive).toBe(true);
    // Nothing is recorded until the composition closes.
    expect(s.historyDepth).toBe(0);
    s.endComposition();

    expect(s.historyDepth).toBe(1);
    expect(text(s, id)).toBe('Hello日本');
    s.undo();
    expect(text(s, id)).toBe('Hello');
  });

  test('the composition entry restores the selection captured at its start', () => {
    const { store: s, id } = store();
    s.beginComposition({ paragraphId: id, start: 5, end: 5 });
    s.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: '字' });
      ctx.selectionAfter({ paragraphId: id, start: 6, end: 6 });
    });
    s.endComposition();
    expect(s.selectionForUndo()).toEqual({ paragraphId: id, start: 5, end: 5 });
  });

  test('a composition that commits nothing records no entry', () => {
    const { store: s } = store();
    s.beginComposition();
    s.endComposition();
    expect(s.historyDepth).toBe(0);
    expect(s.canUndo).toBe(false);
  });

  test('revisions still publish during a composition, so consumers can follow it', () => {
    const { store: s, id } = store();
    const changes: TreeModelChange[] = [];
    s.subscribe((change) => changes.push(change));
    s.beginComposition();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'あ' }));
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 6, text: 'い' }));
    s.endComposition();
    // Two revisions were published so layout could follow the composition live, but they
    // are ONE undo step.
    expect(changes).toHaveLength(2);
    expect(s.revision).toBe(2);
    expect(s.historyDepth).toBe(1);
  });

  test('cancelling leaves committed content in place and records no entry', () => {
    const { store: s, id } = store();
    s.beginComposition();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'x' }));
    s.cancelComposition();
    expect(s.historyDepth).toBe(0);
    expect(text(s, id)).toBe('Hellox');
  });

  test('grouping does not depend on elapsed time', async () => {
    const { store: s, id } = store();
    s.beginComposition();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'a' }));
    // A wall-clock coalescing window would have closed by now and split this into two
    // entries. Scope-based grouping does not care how long the composition took.
    await new Promise((resolve) => setTimeout(resolve, 30));
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 6, text: 'b' }));
    s.endComposition();
    expect(s.historyDepth).toBe(1);
    s.undo();
    expect(text(s, id)).toBe('Hello');
  });
});

describe('projection reconciliation creates no history entry (task 5.6)', () => {
  test('a projection-origin commit publishes a revision but no undo step', () => {
    const { store: s, id } = store();
    const changes: TreeModelChange[] = [];
    s.subscribe((change) => changes.push(change));

    const result = s.transact(
      (ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: '!' }),
      { origin: ORIGIN_IDS.projection }
    );

    expect(result.ok).toBe(true);
    expect(s.revision).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.origin).toBe(ORIGIN_IDS.projection);
    // The point of the task: reconciliation is not a user intent.
    expect(s.historyDepth).toBe(0);
    expect(s.canUndo).toBe(false);
  });

  test('a reconciliation between two edits does not become an undo step', () => {
    const { store: s, id } = store();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'A' }));
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 6, text: 'r' }), {
      origin: ORIGIN_IDS.projection,
    });
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 7, text: 'B' }));
    expect(s.historyDepth).toBe(2);
  });

  test('a projection commit inside a composition does not open one either', () => {
    const { store: s, id } = store();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'x' }), {
      origin: ORIGIN_IDS.projection,
    });
    expect(s.historyDepth).toBe(0);
    expect(s.compositionActive).toBe(false);
  });

  test('undo and redo are tagged with their own origins', () => {
    const { store: s, id } = store();
    s.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'A' }));
    expect(s.undo()?.origin).toBe(ORIGIN_IDS.mutationUndo);
    expect(s.redo()?.origin).toBe(ORIGIN_IDS.mutationRedo);
  });
});

describe('w14 paragraph identity through history', () => {
  const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const IDENTIFIED =
    '<w:p w14:paraId="4C000001" w14:textId="4C000001"><w:r><w:t>Hello</w:t></w:r></w:p>';

  function identifiedStore(): { store: TreeDocumentStore; id: string } {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${IDENTIFIED}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    return { store: new TreeDocumentStore(result.part), id: paragraphIds(result.part)[0]! };
  }

  function paraIdAt(s: TreeDocumentStore, paragraphId: string): string | undefined {
    let found: string | undefined;
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.id === paragraphId) {
        found = node.attributes.find(
          (attribute) => attribute.namespaceUri === W14 && attribute.localName === 'paraId'
        )?.value;
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(s.part.root);
    return found;
  }

  test('undo removes a split-minted paraId; redo restores the identical value', () => {
    const { store: s, id } = identifiedStore();
    const body = s.part.root.children[0]! as Extract<OoxmlNode, { children: unknown }>;
    const originalHead = body.children[0]!;
    s.transact((ctx) => ctx.apply({ op: 'splitParagraph', paragraphId: id, offset: 2 }));
    const [head, tail] = paragraphIds(s.part);
    expect(paraIdAt(s, head!)).toBe('4C000001');
    const minted = paraIdAt(s, tail!);
    expect(minted).toMatch(/^[0-9A-F]{8}$/);

    expect(s.undo()).not.toBeNull();
    // History is whole-part snapshots: the original head OBJECT is back, attributes intact.
    const bodyAfterUndo = s.part.root.children[0]! as Extract<OoxmlNode, { children: unknown }>;
    expect(bodyAfterUndo.children[0]).toBe(originalHead);
    expect(paragraphIds(s.part)).toHaveLength(1);

    expect(s.redo()).not.toBeNull();
    const [, redoneTail] = paragraphIds(s.part);
    // Redo replays the post-edit snapshot — the SAME minted id, never a second mint.
    expect(paraIdAt(s, redoneTail!)).toBe(minted);
  });
});
