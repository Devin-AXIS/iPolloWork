// Content control lookups for the batch planner: the control a handle names, and the scope a
// control query looks in. Split out of `plan.ts`, which is at its line cap.

import type { AutomationHandleTable } from './handles.ts';
import type { PlannedOperation } from './plan-types.ts';
import { refused as refuse } from './plan-results.ts';
import type { AutomationHandle } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { storyOfHandle } from './spans.ts';
import { TARGET_REMOVED } from './target-removed.ts';
import {
  contentControlNodeOf,
  contentControlReadOf,
  type AutomationContentControlRead,
} from './content-controls.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';

/** A control a handle names, with the story it lives in and its node. */
export interface FoundControl {
  readonly reads: AutomationStoryReads;
  readonly control: AutomationContentControlRead;
  readonly node: OoxmlNode;
}

export function createControlLookup(
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
) {
  /**
   * The control a handle names, re-derived from the current package.
   *
   * A handle to a control the document no longer holds is `invalid-handle` rather than a read of
   * whatever moved into its place: a script that deleted a control and then asked its old
   * reference for text must not be answered with a neighbour's.
   */
  const controlOf = (handle: unknown): FoundControl | PlannedOperation => {
    const target = handles.resolve(handle, 'contentControl');
    if (!target || target.kind !== 'contentControl') {
      return refuse(
        'invalid-handle',
        'that handle does not name a content control',
        'contentControl'
      );
    }
    const reads = packageReads.story(target.story);
    if (!reads) return refuse('invalid-handle', 'that story is not in this document');
    const control = contentControlReadOf(reads, target.nodeId);
    const node = contentControlNodeOf(reads, target.nodeId);
    if (!control || !node) {
      return refuse(
        'invalid-handle',
        'this document no longer holds that content control',
        TARGET_REMOVED
      );
    }
    return { reads, control, node };
  };

  /**
   * The scope a control query looks in: a story root, or one control's own content.
   *
   * Both answer the story their controls live in, because a nested control is in the same story
   * as the control holding it — a handle carries its story so the walk never has to guess.
   */
  const controlScope = (
    scope: unknown
  ): { reads: AutomationStoryReads; node: OoxmlNode } | PlannedOperation => {
    if (typeof scope !== 'object' || scope === null) {
      return refuse('invalid-handle', 'that is not a scope a control lives in', 'scope');
    }
    const named = scope as Record<string, AutomationHandle>;
    if ('body' in scope) {
      const story = storyOfHandle(named.body as AutomationHandle, 'body', handles, packageReads);
      if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
      return { reads: story.value, node: story.value.root };
    }
    if ('contentControl' in scope) {
      const found = controlOf(named.contentControl);
      if (!('control' in found)) return found;
      return { reads: found.reads, node: found.node };
    }
    return refuse('invalid-handle', 'that is not a scope a control lives in', 'scope');
  };

  return { controlOf, controlScope };
}
