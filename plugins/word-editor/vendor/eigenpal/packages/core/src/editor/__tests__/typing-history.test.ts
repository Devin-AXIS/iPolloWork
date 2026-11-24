// The typing run's boundary rules, without a surface in the loop.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, describe, expect, test } from 'bun:test';
import type { OoxmlPackage, TreeModelChange } from '@docx-editor.dev/core/store';
import { ORIGIN_IDS } from '../../store/registry/frozen-ids.ts';
import { TypingHistory } from '../typing-history.ts';
import { mount, paragraph } from './paginated-surface-fixtures.ts';

// A real package and paragraph id, so node lookups resolve the way they do in a session.
const fixture = mount(paragraph('one') + paragraph('two'));
const original = fixture.surface.session.currentPackage();
const [p1, p2] = fixture.surface.session.paragraphIds() as [string, string];
afterAll(() => {
  fixture.surface.destroy();
  fixture.container.remove();
});

const caret = (paragraphId: string, offset: number) => ({
  anchor: { paragraphId, offset },
  head: { paragraphId, offset },
});

function change(overrides: Partial<TreeModelChange>): TreeModelChange {
  return {
    change: 'model-change',
    fromRevision: 1,
    toRevision: 2,
    commitId: 'c',
    origin: ORIGIN_IDS.mutationRemote,
    dirty: [],
    created: [],
    deleted: [],
    splitJoin: [],
    dependencyKeys: [],
    impact: 'global',
    ...overrides,
  };
}

/** A run with one flush landed in the first paragraph at offset 2. */
function openRun(): { history: TypingHistory; group: symbol; swap: (pkg: OoxmlPackage) => void } {
  let current = original;
  const history = new TypingHistory(() => current);
  const group = history.groupAt(caret(p1, 1));
  history.landed(caret(p1, 2));
  return { history, group, swap: (pkg) => (current = pkg) };
}

describe('TypingHistory', () => {
  test('a flush from where the last one ended continues the run', () => {
    const { history, group } = openRun();
    expect(history.groupAt(caret(p1, 2))).toBe(group);
  });

  test('a flush from anywhere else starts a new run', () => {
    const { history, group } = openRun();
    expect(history.groupAt(caret(p1, 1))).not.toBe(group);
  });

  test("a foreign edit to the run's paragraph ends the run", () => {
    const { history, group } = openRun();
    history.noteForeignChange(change({ dirty: [p1], impact: 'text-local' }));
    expect(history.groupAt(caret(p1, 2))).not.toBe(group);
  });

  test('a foreign edit to another paragraph keeps the run', () => {
    const { history, group } = openRun();
    history.noteForeignChange(change({ dirty: [p2], impact: 'text-local' }));
    expect(history.groupAt(caret(p1, 2))).toBe(group);
  });

  /** The package with the main part rebuilt as new objects, its text optionally rewritten. */
  function rebuilt(rewrite?: (value: string) => string): OoxmlPackage {
    const main = original.parts.get(original.mainDocumentPart)!;
    const root = structuredClone(main.root);
    const walk = (node: { kind: string; value?: string; children?: unknown[] }): void => {
      if (node.kind === 'textValue' && rewrite) node.value = rewrite(node.value!);
      for (const child of node.children ?? []) walk(child as typeof node);
    };
    walk(root as never);
    const parts = new Map(original.parts);
    parts.set(original.mainDocumentPart, { ...main, root });
    return { ...original, parts };
  }

  test("a change that names no paragraphs keeps the run while the run's paragraph is unchanged", () => {
    // A wholesale install after an edit in another part can rebuild untouched nodes.
    const { history, group, swap } = openRun();
    swap(rebuilt());
    history.noteForeignChange(change({}));
    expect(history.groupAt(caret(p1, 2))).toBe(group);
  });

  test("a change that names no paragraphs ends the run when the run's paragraph changed", () => {
    const { history, group, swap } = openRun();
    swap(rebuilt((value) => (value === 'one' ? 'xone' : value)));
    history.noteForeignChange(change({}));
    expect(history.groupAt(caret(p1, 2))).not.toBe(group);
  });

  test("a change that names no paragraphs ends the run when the run's paragraph is gone", () => {
    const { history, group, swap } = openRun();
    const parts = new Map(original.parts);
    parts.delete(original.mainDocumentPart);
    swap({ ...original, parts });
    history.noteForeignChange(change({}));
    expect(history.groupAt(caret(p1, 2))).not.toBe(group);
  });

  test('projection and awareness commits are not edits', () => {
    const { history, group } = openRun();
    history.noteForeignChange(change({ origin: ORIGIN_IDS.projection, dirty: [p1] }));
    history.noteForeignChange(change({ origin: ORIGIN_IDS.awareness, dirty: [p1] }));
    expect(history.groupAt(caret(p1, 2))).toBe(group);
  });

  test('a flush that leaves a range selection ends the run', () => {
    const { history, group } = openRun();
    history.landed({
      anchor: { paragraphId: p1, offset: 0 },
      head: { paragraphId: p1, offset: 2 },
    });
    expect(history.groupAt(caret(p1, 2))).not.toBe(group);
  });
});
