// The fixture the tracked-edit test files share: one paragraph, applied ops, serialized XML.
//
// Asserted against serialized XML rather than tree shape, because the whole point of a
// tracked edit is what another editor reads back.

import { readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp } from '../store/tree-op-validate.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const ADA = { author: 'Ada Lovelace', date: '2026-01-02T03:04:05Z' };

export function part(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(`fixture did not parse: ${read.reason}`);
  return read.part;
}

/** The only paragraph in the fixture. */
export function paragraphId(source: OoxmlPart): string {
  const body = source.root.children.find((child) => child.kind !== 'textValue');
  const found = body && body.kind !== 'textValue' ? body.children[0] : undefined;
  if (!found) throw new Error('no paragraph');
  return found.id;
}

export function apply(source: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(source, op);
  if (!result.ok) throw new Error(`op refused: ${result.reason} ${result.detail ?? ''}`);
  return result.part;
}

/** Serialized, with the noise a diff does not care about collapsed. */
export function xml(source: OoxmlPart): string {
  return serializeOoxmlPart(source).replace(/^<\?xml[^>]*\?>/, '');
}
