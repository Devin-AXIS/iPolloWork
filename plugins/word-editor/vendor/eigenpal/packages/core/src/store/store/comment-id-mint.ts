// Minting `w:comment/@w:id`. Split from `comment-writes.ts` so that file stays under the
// line cap. The scan and the actor stripe live here; the write that consumes the id stays
// in the writes module.

import {
  MAX_DECIMAL_ID,
  nextStripedDecimalId,
  resolveAllocationActor,
} from '../package/actor-scoped-ids.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === namespaceUri) return entry.value;
  }
  return undefined;
}

/**
 * Highest `w:comment/@w:id` in the part, so the next is seeded from the document.
 *
 * No actor keeps Word's dense "one past highest" sequence. An attached collaboration
 * actor takes the next unused id in its stripe, so two peers cannot mint the same
 * `@w:id` and then cross-link their anchors after sync.
 */
export function nextCommentId(part: OoxmlPart | undefined, actorId?: string): string {
  if (!part) {
    const actor = resolveAllocationActor(actorId);
    return actor ? nextStripedDecimalId(new Set(), actor, MAX_DECIMAL_ID) : '0';
  }
  let highest = -1;
  const used = new Set<string>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'comment') {
      const raw = attribute(node, WML_NAMESPACE_URI, 'id');
      // `ST_DecimalNumber` is unbounded in the schema and signed 32-bit in Word, so a value
      // outside that range is ignored for seeding rather than used and overflowed.
      if (raw !== undefined && /^\d{1,10}$/.test(raw)) {
        const value = Number(raw);
        if (Number.isSafeInteger(value) && value <= MAX_DECIMAL_ID) {
          used.add(String(value));
          if (value > highest) highest = value;
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  const actor = resolveAllocationActor(actorId);
  if (actor) return nextStripedDecimalId(used, actor, MAX_DECIMAL_ID);
  return String(highest + 1);
}
