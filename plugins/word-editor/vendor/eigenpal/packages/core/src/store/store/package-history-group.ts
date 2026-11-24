// History groups across story stores and package units.
//
// A story store merges the frames of one gesture into its own top entry, which covers a
// gesture that stays inside one story. A gesture that also writes a package unit — a comment
// (body, `comments.xml` and markers), a resolution that cascades note bodies, a lifecycle op
// — or a second story cannot merge there: each of those pushes its own coordinator pointer.
//
// The coordinator therefore merges too. While the top pointer is the open group's newest
// frame, the next frame of the same group replaces it with ONE package pointer: `before` is
// the package before the group's first frame, `after` is the package now. The story entries
// the absorbed pointers stood for are discarded, because a package pointer restores every
// part itself and an orphan story entry would steal a later undo.
//
// The same boundaries as a story store apply. Undo, redo, a history split, a pointer with no
// group or another group, and anything else that reaches the top of the stack close the open
// group: identity of the top pointer is the test, so nothing has to remember to close it.

import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { reportHistoryGroup, type HistoryGroup } from './history-group.ts';
import type { HistoryPointer, PackageHistoryPointer } from './story-retention.ts';
import type { SelectionMark } from './tree-store.ts';

const NUMBERING_PART = '/word/numbering.xml';

/** The group a pointer is a frame of, and the package that frame started from. */
export interface HistoryPointerGroup {
  readonly group: HistoryGroup;
  readonly before: OoxmlPackage;
}

/** The group descriptor for a frame, or `undefined` for an ungrouped write. */
export function pointerGroup(
  group: HistoryGroup | undefined,
  before: OoxmlPackage
): HistoryPointerGroup | undefined {
  return group === undefined ? undefined : { group, before };
}

/** Mark a package pointer that changes numbering, so undo restores the numbering part too. */
export function withNumberingRestore(pointer: HistoryPointer): HistoryPointer {
  if (
    pointer.kind === 'package' &&
    pointer.before.parts.get(NUMBERING_PART) !== pointer.after.parts.get(NUMBERING_PART)
  ) {
    return { ...pointer, restoreNumbering: true };
  }
  return pointer;
}

type DiscardStoryEntry = (partName: string) => {
  readonly selectionBefore: SelectionMark | null;
  readonly selectionAfter: SelectionMark | null;
} | null;

/** The coordinator's open history group. */
export class PackageHistoryGroups {
  private open: {
    readonly group: HistoryGroup;
    readonly before: OoxmlPackage;
    readonly pointer: HistoryPointer;
  } | null = null;

  /** Forget the open group: undo, redo and a history split are boundaries. */
  close(): void {
    this.open = null;
  }

  /**
   * The pointer to push for `pointer`.
   *
   * Starts a group, merges into the open one (popping its pointer from `undoOrder`), or
   * closes it for an ungrouped pointer. `discard` removes a story's newest undo entry;
   * `current` answers the package after this frame.
   */
  admit(
    pointer: HistoryPointer,
    grouped: HistoryPointerGroup | undefined,
    undoOrder: HistoryPointer[],
    discard: DiscardStoryEntry,
    current: () => OoxmlPackage
  ): HistoryPointer {
    const open = this.open;
    if (grouped === undefined) {
      this.open = null;
      return withNumberingRestore(pointer);
    }
    if (open === null || open.group !== grouped.group || undoOrder.at(-1) !== open.pointer) {
      const started = withNumberingRestore(pointer);
      this.open = { group: grouped.group, before: grouped.before, pointer: started };
      reportHistoryGroup(grouped.group, 'started');
      return started;
    }
    undoOrder.pop();
    // The newest frame first: when both pointers name one store, its entry is on top.
    const last = pointer.kind === 'story' ? discard(pointer.partName) : null;
    const first = open.pointer.kind === 'story' ? discard(open.pointer.partName) : null;
    const previousAfter =
      open.pointer.kind === 'package' ? (open.pointer.selectionAfter ?? null) : null;
    const merged: PackageHistoryPointer = {
      kind: 'package',
      before: open.before,
      after: current(),
      selectionBefore:
        open.pointer.kind === 'package'
          ? (open.pointer.selectionBefore ?? null)
          : (first?.selectionBefore ?? null),
      selectionAfter:
        (pointer.kind === 'package' ? pointer.selectionAfter : last?.selectionAfter) ??
        previousAfter,
    };
    const pushed = withNumberingRestore(merged);
    this.open = { ...open, pointer: pushed };
    reportHistoryGroup(grouped.group, 'extended');
    return pushed;
  }
}
