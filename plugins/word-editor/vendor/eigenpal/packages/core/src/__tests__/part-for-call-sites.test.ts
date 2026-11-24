// `partFor` call sites are pinned, because a partFor read is a write in disguise.
//
// `partFor(partName)` opens a story store and PERMANENTLY retains its slot — the store
// caps editable story parts (`DEFAULT_MAX_EDITABLE_STORY_PARTS`, 64), and a slot once
// opened is never returned. `editor/surface-scope.ts` documents the failure in full:
// sixty-four such "reads" and no further header, footer or note could be opened for the
// rest of the session, silently. A pure read routes through `partOfNodeId`
// (`editor/surface-scope.ts`) or another store read API instead.
//
// So every `partFor(` in non-test source is pinned here — across every package that can
// reach a session, not just core — in the manner of `prosemirror-isolation.test.ts`. Add
// a new site only for a WRITE that needs the open store, then update this list; a removed
// site fails too, so the list ratchets down. Occurrences count comment MENTIONS as well
// as calls, deliberately: the census stays a dumb grep so it cannot be argued with.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Every published package's src root that could hold a call site. */
const SCANNED_ROOTS = ['core/src', 'pro/src', 'editor-api/src', 'react/src', 'vue/src'];

/** file (relative to packages/) → number of `partFor(` occurrences, definitions included. */
const PINNED_CALL_SITES: Readonly<Record<string, number>> = {
  'core/src/automation/server-host.ts': 2,
  'core/src/binding/tree-session.ts': 5, // the facade definition moved to tree-session-contract.ts
  'core/src/binding/tree-session-contract.ts': 1, // the session view's partFor declaration
  // Two writes: the collaboration part-name resolution, and the atomic multi-story commit
  // resolving each extra group's part BEFORE its transaction writes it — the slot is spent
  // by the write either way.
  'core/src/binding/tree-session-apply.ts': 2,
  'core/src/editor/doc-target-resolution.ts': 2,
  'core/src/editor/docx-editor-derive.ts': 1,
  'core/src/editor/docx-editor-images.ts': 1,
  // Resolving a review decision reads its exact sites inside the admitted write callback.
  // The following applyTreeOps writes this same story, so it needs the store either way.
  'core/src/editor/docx-editor-review-commands.ts': 1,
  'core/src/editor/paginated-surface.ts': 6,
  'core/src/editor/surface-range-edit.ts': 3,
  'core/src/editor/surface-review-order.ts': 1,
  'core/src/editor/surface-equations.ts': 1,
  'core/src/editor/surface-format.ts': 1,
  // Same lane, same story: the painter reads and writes the ACTIVE scope's part, which the
  // formatting lane beside it has already opened for the caret sitting in it.
  'core/src/editor/surface-format-painter.ts': 1,
  'core/src/editor/surface-hf-editing.ts': 1,
  'core/src/editor/surface-hyperlinks.ts': 1,
  'core/src/editor/surface-scope.ts': 2, // storyScopeOfNodeId — documented as a known debt in-file
  'core/src/editor/surface-structure.ts': 1,
  // A comment delete needs the story part to scope its owner, and the reader has already opened
  // that story to see the comment it is deleting, so the slot is spent either way.
  'core/src/store/store/comment-package-write.ts': 1,
  'core/src/store/store/tree-package-store.ts': 1, // the definition itself
  // Custom-node payload writes genuinely need the open store (they mutate the part).
  'pro/src/custom-nodes/insert-custom-node.ts': 1,
  'pro/src/custom-nodes/update-custom-node.ts': 3,
};

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

describe('partFor stays a write-path API', () => {
  test('the call-site census matches the pinned list exactly', () => {
    const census: Record<string, number> = {};
    for (const root of SCANNED_ROOTS) {
      const absolute = join(PACKAGES, root);
      if (!existsSync(absolute)) throw new Error(`census root missing: ${root}`);
      for (const file of sourceFiles(absolute)) {
        const count = (readFileSync(file, 'utf8').match(/\bpartFor\(/g) ?? []).length;
        if (count > 0) census[relative(PACKAGES, file).split(sep).join('/')] = count;
      }
    }
    const sorted = Object.fromEntries(Object.entries(census).sort(([a], [b]) => (a < b ? -1 : 1)));
    // A NEW site: partFor opens and permanently retains a story store (cap 64). If this
    // is a pure read, use partOfNodeId (editor/surface-scope.ts) or a store read API and
    // leave this list alone. If it is a write that needs the open store, add the entry.
    // A REMOVED site: delete its entry — the list only ratchets down.
    expect(sorted).toEqual(PINNED_CALL_SITES);
  });

  test('the census is not vacuous: it sees the definition', () => {
    expect(PINNED_CALL_SITES['core/src/store/store/tree-package-store.ts']).toBeGreaterThan(0);
  });
});
