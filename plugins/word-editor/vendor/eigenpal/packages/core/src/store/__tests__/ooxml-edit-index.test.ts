// The node index survives edits exactly (incremental patch differential).
//
// Edit primitives keep a per-tree node/parent index and PATCH it across a rebuild instead
// of re-walking the document. The patch is only worth having if it is indistinguishable
// from a fresh walk — a stale entry surfaces as a caret landing in a paragraph that no
// longer exists, arbitrarily far from the edit that corrupted it. So this drives long
// randomized op sequences through the real op layer and, after every single op, compares
// the index-backed reads against a hand-walk of the tree.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import {
  carryIndexToRebuiltRoot,
  carryIndexToHistoryRoot,
  collectNodeIds,
  createNodeIdAllocator,
  findNode,
  nodeIndexSteps,
  nodeIndexTestRecorder,
  parentNodeOf,
} from '../package/ooxml-edit.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { applyTreeOp, paragraphTextOf, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** With `formatted`, every paragraph and run carries property leaves the index reads through. */
function load(paragraphs: readonly string[], formatted = false): OoxmlPart {
  const pPr = formatted ? '<w:pPr><w:jc w:val="left"/><w:spacing w:after="0"/></w:pPr>' : '';
  const rPr = formatted ? '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>' : '';
  const body = paragraphs
    .map((text) => `<w:p>${pPr}<w:r>${rPr}<w:t>${text}</w:t></w:r></w:p>`)
    .join('');
  const xml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`read failed: ${result.reason}`);
  return result.part;
}

/** Ground truth, computed the slow way every time: a full walk of the actual tree. */
function walk(part: OoxmlPart): { nodes: Map<string, OoxmlNode>; parents: Map<string, OoxmlNode> } {
  const nodes = new Map<string, OoxmlNode>();
  const parents = new Map<string, OoxmlNode>();
  const visit = (node: OoxmlNode, parent: OoxmlNode | null): void => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
      if (parent) parents.set(node.id, parent);
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child, node);
  };
  visit(part.root, null);
  return { nodes, parents };
}

function expectIndexMatchesTree(part: OoxmlPart, context: string): void {
  const truth = walk(part);
  // Membership: the index must hold exactly the ids the tree holds.
  const indexed = collectNodeIds(part);
  expect([...indexed].sort()).toEqual([...truth.nodes.keys()].sort());
  // Identity and parentage: every id resolves to the very object the tree holds.
  for (const [id, node] of truth.nodes) {
    if (findNode(part, id) !== node) {
      throw new Error(`${context}: findNode(${id}) returned a stale object`);
    }
    const parent = truth.parents.get(id) ?? null;
    const viaIndex = parentNodeOf(part, id);
    if ((viaIndex ?? null) !== (parent && parent.kind !== 'textValue' ? parent : null)) {
      throw new Error(`${context}: parentNodeOf(${id}) disagrees with the tree`);
    }
  }
}

/** Deterministic PRNG, so a failure names a reproducible seed. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paragraphIdsOf(part: OoxmlPart): string[] {
  const body = (part.root.children as readonly OoxmlNode[]).find(
    (child) => child.kind !== 'textValue' && child.localName === 'body'
  );
  if (!body || body.kind === 'textValue') return [];
  return body.children.filter((child) => child.kind === 'paragraph').map((child) => child.id);
}

/** A random op that is VALID for the current tree, so the sequence keeps running. */
function randomOp(part: OoxmlPart, random: () => number): TreeDocOp | null {
  const ids = paragraphIdsOf(part);
  if (ids.length === 0) return null;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const paragraphId = pick(ids);
  const length = (paragraphTextOf(part, paragraphId) ?? '').length;
  const offset = Math.floor(random() * (length + 1));
  const roll = random();
  if (roll < 0.3) {
    return { op: 'insertText', paragraphId, offset, text: `x${Math.floor(random() * 10)}` };
  }
  if (roll < 0.45) {
    if (length === 0) return null;
    const start = Math.floor(random() * length);
    return {
      op: 'deleteText',
      paragraphId,
      start,
      end: Math.min(length, start + 1 + Math.floor(random() * 3)),
    };
  }
  if (roll < 0.55) return { op: 'splitParagraph', paragraphId, offset };
  if (roll < 0.6) {
    if (length < 3) return null;
    const first = 1 + Math.floor(random() * (length - 2));
    const second = first + 1 + Math.floor(random() * (length - first - 1));
    return { op: 'splitParagraphMany', paragraphId, offsets: [first, second] };
  }
  if (roll < 0.7) {
    const index = ids.indexOf(paragraphId);
    const second = ids[index + 1];
    if (!second) return null;
    return { op: 'joinParagraphs', firstId: paragraphId, secondId: second };
  }
  if (roll < 0.8) return { op: 'insertTab', paragraphId, offset };
  if (roll < 0.85) return { op: 'insertHardBreak', paragraphId, offset };
  if (roll < 0.95) {
    if (length < 2) return null;
    return {
      op: 'setRunProperties',
      paragraphId,
      start: 0,
      end: 1 + Math.floor(random() * (length - 1)),
      properties: random() < 0.5 ? [{ localName: 'b' }] : [],
    };
  }
  return {
    op: 'setParagraphProperties',
    paragraphId,
    properties: random() < 0.5 ? [{ localName: 'jc', attributes: { val: 'center' } }] : [],
  };
}

describe('the patched node index is indistinguishable from a fresh walk', () => {
  for (const [seed, formatted] of [
    [1, false],
    [42, false],
    [20260730, false],
    [7, true],
    [99, true],
  ] as const) {
    test(`400 random ops, seed ${seed}${formatted ? ', property leaves' : ''}`, () => {
      const random = mulberry32(seed);
      let part = load(
        ['alpha bravo charlie', 'delta echo', 'foxtrot golf hotel india', ''],
        formatted
      );
      // Prime the index through the public reads, so every later op patches rather than
      // rebuilding — the case under test.
      expectIndexMatchesTree(part, 'initial');
      let applied = 0;
      for (let step = 0; step < 400; step += 1) {
        const op = randomOp(part, random);
        if (!op) continue;
        const result = applyTreeOp(part, op, { deferValidation: true });
        if (!result.ok) continue;
        part = result.part;
        applied += 1;
        expectIndexMatchesTree(part, `seed ${seed} step ${step} op ${op.op}`);
      }
      // The sequence must have actually exercised the patch, not skipped everything.
      expect(applied).toBeGreaterThan(200);
    });
  }
});

test('preview and restored roots never reuse reserved node IDs', () => {
  const original = load(['Draft']);
  const mintOriginal = createNodeIdAllocator(original);
  const reserved = mintOriginal();
  const result = applyTreeOp(original, {
    op: 'splitParagraph',
    paragraphId: paragraphIdsOf(original)[0]!,
    offset: 5,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const mintPreview = createNodeIdAllocator(result.part);
  const preview = mintPreview();
  // Rebuilding the old root index must retain reservations from the preview.
  const mintRestored = createNodeIdAllocator(original);
  const restored = mintRestored();
  const lateOriginal = mintOriginal();
  expect(new Set([reserved, preview, restored, lateOriginal]).size).toBe(4);
  expect(collectNodeIds(result.part).has(restored)).toBe(false);
  expect(collectNodeIds(result.part).has(lateOriginal)).toBe(false);
});

test('external root rebuilds retain allocations after a preview steals the index', () => {
  const original = load(['Draft']);
  const allocate = createNodeIdAllocator(original);
  const reserved = allocate();
  const preview = applyTreeOp(original, {
    op: 'splitParagraph',
    paragraphId: paragraphIdsOf(original)[0]!,
    offset: 2,
  });
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;
  const previewId = createNodeIdAllocator(preview.part)();
  const rebuilt = { ...original, root: { ...original.root } };
  carryIndexToRebuiltRoot(original.root, rebuilt.root);
  const next = createNodeIdAllocator(rebuilt)();
  expect(new Set([reserved, previewId, next]).size).toBe(3);
  expect(collectNodeIds(preview.part).has(next)).toBe(false);
});

test('history reuses node indexes while restoring exact nodes and parents', () => {
  const store = new TreeDocumentStore(
    load(Array.from({ length: 256 }, (_, i) => `Paragraph ${i}`))
  );
  const random = mulberry32(73);
  const roots: OoxmlPart[] = [store.part];
  for (let step = 0; step < 60; step += 1) {
    const op = randomOp(store.part, random);
    if (!op) continue;
    const result = store.transact((transaction) => transaction.apply(op));
    if (result.ok && result.change) roots.push(store.part);
  }
  expect(roots.length).toBeGreaterThan(30);
  expectIndexMatchesTree(store.part, 'before undo');
  const recorder = nodeIndexTestRecorder();
  recorder.reset();
  for (let index = roots.length - 2; index >= 0; index -= 1) {
    expect(store.undo()).not.toBeNull();
    expect(store.part).toBe(roots[index]!);
    expectIndexMatchesTree(store.part, `undo ${index}`);
  }
  for (let index = 1; index < roots.length; index += 1) {
    expect(store.redo()).not.toBeNull();
    expect(store.part).toBe(roots[index]!);
    expectIndexMatchesTree(store.part, `redo ${index}`);
  }
  expect(recorder.completeBuilds).toBe(0);
  expect(recorder.completeVisits).toBe(0);
});

test('undo branches preserve allocator reservations and detached snapshot reads', () => {
  const store = new TreeDocumentStore(load(['Draft', 'Tail']));
  const original = store.part;
  const reserved = createNodeIdAllocator(original)();
  const paragraphId = paragraphIdsOf(original)[0]!;
  expect(
    store.transact((transaction) =>
      transaction.apply({
        op: 'splitParagraph',
        paragraphId,
        offset: 2,
      })
    ).ok
  ).toBe(true);
  const split = store.part;
  const splitReservation = createNodeIdAllocator(split)();
  store.undo();
  const undoReservation = createNodeIdAllocator(store.part)();
  expectIndexMatchesTree(split, 'detached split');
  expectIndexMatchesTree(original, 'restored original');
  expect(
    store.transact((transaction) =>
      transaction.apply({
        op: 'splitParagraph',
        paragraphId,
        offset: 1,
      })
    ).ok
  ).toBe(true);
  const branchReservation = createNodeIdAllocator(store.part)();
  expect(new Set([reserved, splitReservation, undoReservation, branchReservation]).size).toBe(4);
  expect(store.canRedo).toBe(false);
  expectIndexMatchesTree(store.part, 'new branch');
  expectIndexMatchesTree(split, 'detached split after branching');
  expectIndexMatchesTree(original, 'original after branching');
});

test('history does not transfer indexes between independently parsed roots', () => {
  const first = load(['First']);
  const second = load(['Second']);
  expect(first.root.id).toBe(second.root.id);
  const firstMint = createNodeIdAllocator(first);
  const secondMint = createNodeIdAllocator(second);
  firstMint();
  for (let index = 0; index < 20; index += 1) secondMint();
  carryIndexToHistoryRoot(first.root, second.root);
  const recorder = nodeIndexTestRecorder();
  recorder.reset();
  expectIndexMatchesTree(first, 'independent first');
  expectIndexMatchesTree(second, 'independent second');
  expect(recorder.completeBuilds).toBe(0);
  expect(createNodeIdAllocator(second)()).toBe(`${second.name}#new:20`);
  expect(createNodeIdAllocator(first)()).toBe(`${first.name}#new:1`);
});

describe('node index built in steps', () => {
  test('equals the index one walk builds, in the same order', () => {
    const texts = Array.from({ length: 2_000 }, (_, index) => `p${index}`);
    const stepped = load(texts);
    const step = nodeIndexSteps(stepped.root);
    let steps = 0;
    while (!step(() => true)) steps += 1;
    // Stopping at every check builds a thousand nodes per step, so the build took many steps.
    expect(steps).toBeGreaterThan(1);
    const truth = walk(stepped);
    expect([...collectNodeIds(stepped)]).toEqual([...truth.nodes.keys()]);
    for (const [id, node] of truth.nodes) {
      expect(findNode(stepped, id)).toBe(node);
      expect(parentNodeOf(stepped, id)).toBe(truth.parents.get(id) ?? null);
    }
  });

  test('a read in between builds the index at once and ends the steps', () => {
    const part = load(Array.from({ length: 2_000 }, (_, index) => `p${index}`));
    const step = nodeIndexSteps(part.root);
    expect(step(() => true)).toBe(false);
    const recorder = nodeIndexTestRecorder();
    recorder.reset();
    const paragraph = walk(part).nodes.values().next().value!;
    expect(findNode(part, paragraph.id)).toBe(paragraph);
    expect(recorder.completeBuilds).toBe(1);
    expect(step(() => true)).toBe(true);
    expect(recorder.completeBuilds).toBe(1);
  });
});
