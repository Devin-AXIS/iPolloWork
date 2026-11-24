// Which writes a host's `ContentLockPolicy` lets past the CONTENT half of a content lock.
//
// One answer for every place that asks, so the commit, the forms-protection preflight and
// `can` cannot disagree about a keystroke. The pass is an allowlist of op kinds: an op kind
// added later meets the lock until it is named here.

import type { ContentLockPolicy } from '../package/ooxml-edit.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/**
 * Run properties that hide text. Hiding protected text removes it for every reader as surely
 * as deleting it, so they never pass, whichever value they carry. The run-property vocabulary
 * refuses them today; naming them here keeps that true if the vocabulary grows.
 */
const HIDING_RUN_PROPERTIES: ReadonlySet<string> = new Set(['vanish', 'specVanish', 'webHidden']);

/**
 * Whether `op` only restyles text and `policy` lets restyling past a content lock: an untracked
 * `setRunProperties` or `setParagraphMarkProperties` (the mark is `CT_ParaRPr`, run formatting)
 * that writes no hiding property. The removal half of a lock and `w:dataBinding` are not
 * asked here, and stay refused.
 *
 * A TRACKED restyle stays refused. It leaves a format revision inside the locked content, and
 * accepting or rejecting that revision is a write the lock refuses, so the revision could never
 * be resolved and every resolve-all over the story would fail on it.
 */
export function restylePassesContentLock(
  op: TreeDocOp,
  policy: ContentLockPolicy | undefined
): boolean {
  if (policy?.allowFormattingInLockedContent !== true) return false;
  if (op.op !== 'setRunProperties' && op.op !== 'setParagraphMarkProperties') return false;
  if (op.revision !== undefined) return false;
  return op.properties.every((property) => !HIDING_RUN_PROPERTIES.has(property.localName));
}

/**
 * Every flag of `ContentLockPolicy`. A flag added to the interface is named here too, or the
 * copy below drops it and the option silently does nothing.
 */
const CONTENT_LOCK_POLICY_FLAGS = [
  'allowFormattingInLockedContent',
] as const satisfies readonly (keyof ContentLockPolicy)[];

/**
 * The policy a store keeps: a frozen copy of the flags set to `true`, so a host that mutates the
 * object it passed cannot change what an open store admits. `undefined` when nothing is relaxed.
 */
export function contentLockPolicyOf(
  policy: ContentLockPolicy | undefined
): ContentLockPolicy | undefined {
  if (!policy) return undefined;
  const kept: Record<string, true> = {};
  for (const flag of CONTENT_LOCK_POLICY_FLAGS) if (policy[flag] === true) kept[flag] = true;
  return Object.keys(kept).length > 0 ? Object.freeze(kept as ContentLockPolicy) : undefined;
}
