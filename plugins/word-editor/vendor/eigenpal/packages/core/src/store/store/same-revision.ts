// Adjacent revision wrappers that are one change.
//
// Split out of `tree-op-segments.ts` and `tree-op-tracked.ts`, which are at their line caps.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';

/** Two wrappers are the same revision when their `CT_TrackChange` triple agrees. */
export function sameRevision(a: OoxmlElement, b: OoxmlElement): boolean {
  const read = (node: OoxmlElement, localName: string): string | undefined =>
    node.attributes.find(
      (attribute) =>
        attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
    )?.value;
  return (
    read(a, 'id') !== undefined &&
    read(a, 'id') === read(b, 'id') &&
    read(a, 'author') === read(b, 'author') &&
    read(a, 'date') === read(b, 'date')
  );
}

/**
 * The run of the wrapper just before `wrapper` in `holder`, when that wrapper is the same change
 * and holds the run `runId`; otherwise null.
 *
 * One change can sit in two adjacent wrappers, split where another edit once fell, while a peer
 * holds it in one. A caret between the two is inside the change, at the end of the earlier
 * run, as it is between two runs of one wrapper: typing there takes that run's format.
 */
export function continuedRevisionRun(
  holder: OoxmlElement,
  wrapper: OoxmlElement,
  runId: string
): OoxmlElement | null {
  if (!isContentRevisionKind(wrapper.kind)) return null;
  const index = holder.children.findIndex((child) => child.id === wrapper.id);
  const previous = index > 0 ? holder.children[index - 1] : undefined;
  if (
    previous === undefined ||
    previous.kind !== wrapper.kind ||
    !sameRevision(previous as OoxmlElement, wrapper)
  ) {
    return null;
  }
  const run = find(previous, runId);
  return run?.kind === 'run' ? (run as OoxmlElement) : null;
}

/**
 * Whether `right` is the wrapper just after `left`, under one parent inside `root`, and the
 * same change. Text at the boundary between them is inside the change, as inside one wrapper.
 */
export function sameChangeAcross(
  root: { readonly children: readonly OoxmlNode[] },
  left: OoxmlNode,
  right: OoxmlNode
): boolean {
  if (left.kind === 'textValue' || right.kind === 'textValue') return false;
  if (!isContentRevisionKind(left.kind) || left.kind !== right.kind) return false;
  if (!sameRevision(left, right)) return false;
  const holder = parentIn(root, left.id);
  if (!holder) return false;
  const index = holder.children.findIndex((child) => child.id === left.id);
  return holder.children[index + 1]?.id === right.id;
}

type Holder = { readonly children: readonly OoxmlNode[] };

function parentIn(node: Holder, id: string): Holder | null {
  for (const child of node.children) {
    if (child.id === id) return node;
    if (child.kind === 'textValue') continue;
    const found = parentIn(child, id);
    if (found) return found;
  }
  return null;
}

function find(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.id === id) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
