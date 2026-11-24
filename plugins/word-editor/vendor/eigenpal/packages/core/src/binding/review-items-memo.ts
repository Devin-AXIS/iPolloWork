// The review queue of a few recent document states, so returning to one does not rebuild it.

import type { OoxmlPart, ReviewItem } from '@docx-editor.dev/core/store';
import type { CustomNodePayloadRead } from '../store/store/custom-node-writes.ts';

/** Everything the queue derivation reads, by identity. */
export interface ReviewItemsInputs {
  readonly root: object;
  readonly commentsPart: OoxmlPart | undefined;
  readonly commentsExtendedPart: OoxmlPart | undefined;
  readonly stylesPart: OoxmlPart | undefined;
  /** Read by the session's last pass over the queue, not by the derivation itself. */
  readonly numberingRoot: object | null;
  readonly furnitureParts: readonly OoxmlPart[];
  readonly customNodePayloads: ReadonlyMap<string, CustomNodePayloadRead>;
}

/**
 * States kept. Undo walks back through the states an edit just left, and each holds its
 * tree alive only while it is in this list; the history keeps those trees anyway.
 */
const CAPACITY = 8;

/** Payload reads are rebuilt per call, so their fields are compared, not the objects. */
function samePayloads(
  left: ReadonlyMap<string, CustomNodePayloadRead>,
  right: ReadonlyMap<string, CustomNodePayloadRead>
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    const other = right.get(key);
    if (
      !other ||
      other.nodeId !== value.nodeId ||
      other.label !== value.label ||
      other.data !== value.data
    )
      return false;
  }
  return true;
}

function sameInputs(left: ReviewItemsInputs, right: ReviewItemsInputs): boolean {
  return (
    left.root === right.root &&
    left.commentsPart === right.commentsPart &&
    left.commentsExtendedPart === right.commentsExtendedPart &&
    left.stylesPart === right.stylesPart &&
    left.numberingRoot === right.numberingRoot &&
    left.furnitureParts.length === right.furnitureParts.length &&
    left.furnitureParts.every((part, index) => part === right.furnitureParts[index]) &&
    samePayloads(left.customNodePayloads, right.customNodePayloads)
  );
}

/**
 * Undo restores an earlier tree by reference, but the package around it is new, so the
 * revision-keyed cache misses and the whole queue was derived again: a whole-document walk
 * per undo step on a document with thousands of changes. The derivation is a function of
 * these inputs alone, so equal inputs give back the queue derived for them before.
 */
export function createReviewItemsMemo(): {
  get(inputs: ReviewItemsInputs): readonly ReviewItem[] | undefined;
  set(inputs: ReviewItemsInputs, items: readonly ReviewItem[]): void;
} {
  const entries: { inputs: ReviewItemsInputs; items: readonly ReviewItem[] }[] = [];
  return {
    get(inputs) {
      const index = entries.findIndex((entry) => sameInputs(entry.inputs, inputs));
      if (index < 0) return undefined;
      const [entry] = entries.splice(index, 1);
      entries.unshift(entry!);
      return entry!.items;
    },
    set(inputs, items) {
      const index = entries.findIndex((entry) => entry.inputs.root === inputs.root);
      if (index >= 0) entries.splice(index, 1);
      entries.unshift({ inputs, items });
      if (entries.length > CAPACITY) entries.length = CAPACITY;
    },
  };
}
