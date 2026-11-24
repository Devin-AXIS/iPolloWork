// The content-control context token: a fingerprint of every control wrapper's chrome.
//
// Extracted from `content-control-boundary-layout.ts` to keep it under the line cap. Pure
// functions over immutable parts; the memos are the point — the token is folded into the
// layout producer, so it is asked for on every pass over every fresh part revision.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import {
  MAX_CONTENT_CONTROL_NESTING as MAX_SDT_NESTING,
  contentControlContentChildren,
  isContentControl,
} from '../store/package/content-control-walk.ts';
import {
  contentControlPropertiesOf,
  mapContentControlType,
  parseContentControlLock,
  propertyChild,
  propertyVal,
} from './content-control-properties.ts';

/**
 * Fingerprint of every control wrapper's chrome metadata — not its content.
 *
 * Changing alias/tag/lock/type/placeholder/binding without touching nested paragraphs still
 * changes this token, which is folded into the layout producer.
 */
export function contentControlContextToken(part: OoxmlPart): string {
  // Parts are immutable (edits publish a new part object), so the token is a pure function
  // of the part reference. Without the memo this whole-tree walk ran on EVERY layout pass —
  // including no-change passes that reuse every page.
  const cached = contentControlContextTokens.get(part);
  if (cached !== undefined) return cached;
  let token = contentControlSubtreeToken(part.root, 0);
  // Hand back the PREVIOUS string object when the content is unchanged (one compare per
  // fresh part). A control-heavy document's token runs to kilobytes, and it is embedded in
  // the layout producer — identity-stable tokens keep every downstream string comparison a
  // pointer check instead of a memcmp per section per pass.
  if (lastContextTokenObject !== null && lastContextTokenObject === token) {
    token = lastContextTokenObject;
  } else {
    lastContextTokenObject = token;
  }
  contentControlContextTokens.set(part, token);
  return token;
}

let lastContextTokenObject: string | null = null;

const contentControlContextTokens = new WeakMap<OoxmlPart, string>();
/**
 * Subtree tokens memoized per immutable node, remembering the DEPTH they were computed at:
 * the walk clips content controls at {@link MAX_SDT_NESTING}, so a subtree's token is a pure
 * function of the node only at a fixed nesting depth. Typing keeps every unchanged subtree at
 * its old depth, which is the case the memo exists for.
 */
const contentControlSubtreeTokens = new WeakMap<
  OoxmlElement,
  { readonly depth: number; readonly token: string }
>();

export function contentControlSubtreeToken(node: OoxmlNode, depth: number): string {
  if (node.kind === 'textValue') return '';
  // Paragraph, table and control wrappers are immutable and structurally shared across
  // text edits. Caching only at depth zero left every paragraph INSIDE a block control
  // (a TOC wrapped in `w:sdt` is the common shape) re-walked per part revision.
  const memoizable =
    node.kind === 'paragraph' ||
    node.kind === 'table' ||
    node.kind === 'tableRow' ||
    isContentControl(node);
  if (memoizable) {
    const cached = contentControlSubtreeTokens.get(node);
    if (cached !== undefined && cached.depth === depth) return cached.token;
  }
  let token: string;
  if (isContentControl(node)) {
    if (depth >= MAX_SDT_NESTING) return '';
    const properties = contentControlPropertiesOf(node);
    const own = [
      node.id,
      propertyVal(properties, 'alias') ?? '',
      propertyVal(properties, 'tag') ?? '',
      parseContentControlLock(propertyVal(properties, 'lock')),
      mapContentControlType(properties),
      propertyChild(properties, 'showingPlcHdr') ? '1' : '0',
      propertyChild(properties, 'dataBinding') ? '1' : '0',
    ].join(':');
    const nested = contentControlContentChildren(node)
      .map((inner) => contentControlSubtreeToken(inner, depth + 1))
      .filter((entry) => entry.length > 0);
    token = [own, ...nested].join('|');
  } else {
    token = node.children
      .map((child) => contentControlSubtreeToken(child, depth))
      .filter((entry) => entry.length > 0)
      .join('|');
  }
  if (memoizable) {
    contentControlSubtreeTokens.set(node as OoxmlElement, { depth, token });
  }
  return token;
}
