import { canRemoveContentTypeOverrides, isXmlWhitespace } from './content-type-removal.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { relsPartNameFor, resolveContentTypeOf, withoutPart } from './package-edit.ts';
import { partNameKey, resolveInternalTarget } from './opc-names.ts';
import { runWithoutJournalCapture } from './canonical-primitive-capture.ts';
import { createCommentScanBudget, chargePart, walkCharged } from './comment-lifecycle-scan.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const EXTENDED = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const IDS = 'http://schemas.microsoft.com/office/2016/relationships/commentsIds';
const TYPES = new Map([
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
    { namespace: W, root: 'comments', relationship: COMMENTS },
  ],
  ...[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
    'application/vnd.ms-word.commentsExtended+xml',
  ].map(
    (type) =>
      [
        type,
        {
          namespace: 'http://schemas.microsoft.com/office/word/2012/wordml',
          root: 'commentsEx',
          relationship: EXTENDED,
        },
      ] as const
  ),
  ...[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml',
    'application/vnd.ms-word.commentsIds+xml',
  ].map(
    (type) =>
      [
        type,
        {
          namespace: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
          root: 'commentsIds',
          relationship: IDS,
        },
      ] as const
  ),
]);

function emptyCommentPart(pkg: OoxmlPackage, part: OoxmlPart): boolean {
  const root = part.root;
  const expected = TYPES.get(resolveContentTypeOf(pkg, part.name) ?? '');
  return (
    expected !== undefined &&
    root.namespaceUri === expected.namespace &&
    root.localName === expected.root &&
    root.attributes.every((a) => a.namespaceUri === MC && a.localName === 'Ignorable') &&
    root.children.every((child) => child.kind === 'textValue' && isXmlWhitespace(child.value))
  );
}

function plainRelationship(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === REL &&
    node.localName === 'Relationship' &&
    node.attributes.every(
      (a) => a.namespaceUri === '' && ['Id', 'Type', 'Target', 'TargetMode'].includes(a.localName)
    ) &&
    node.children.every((child) => child.kind === 'textValue' && isXmlWhitespace(child.value))
  );
}

// Removing a part also removes its relationship part. Unknown records and extensions must survive.
function plainRelationships(pkg: OoxmlPackage, owner: string): boolean {
  const name = relsPartNameFor(owner);
  const part = pkg.parts.get(name);
  if (!part) return !pkg.partBytes.has(name);
  const elements = part.root.children.filter((node) => node.kind !== 'textValue');
  if (elements.length !== (pkg.relationships.get(owner)?.length ?? 0)) return false;
  return (
    part.root.namespaceUri === REL &&
    part.root.localName === 'Relationships' &&
    part.root.attributes.length === 0 &&
    part.root.children.every((node) =>
      node.kind === 'textValue' ? isXmlWhitespace(node.value) : plainRelationship(node)
    )
  );
}

function removableRelationships(pkg: OoxmlPackage, candidates: readonly OoxmlPart[]): boolean {
  const selected = new Map(candidates.map((part) => [partNameKey(part.name), part]));
  for (const part of candidates) {
    // withoutPart removes companion relationships but only the primary declaration.
    // Preserve explicit companion declarations and any extension data they carry.
    if (pkg.contentTypes.overrides.has(partNameKey(relsPartNameFor(part.name)))) return false;
    if (!plainRelationships(pkg, part.name)) return false;
  }
  for (const [owner, records] of pkg.relationships) {
    const ownerSelected = selected.has(partNameKey(owner));
    for (const record of records) {
      const target =
        record.targetMode !== 'External' && resolveInternalTarget(owner, record.rawTarget);
      const candidate =
        target && target.ok ? selected.get(partNameKey(target.partName)) : undefined;
      if (ownerSelected && !candidate) return false;
      if (!candidate) continue;
      if (record.type !== TYPES.get(resolveContentTypeOf(pkg, candidate.name) ?? '')!.relationship)
        return false;
      if (!plainRelationships(pkg, owner)) return false;
    }
  }
  return true;
}

/**
 * Normalize recognized empty comment parts in an export snapshot only.
 * Live parts retain stable addresses for undo and concurrent comment insertions.
 * Eligibility uses canonical content, never peer-local source bytes. Unknown content remains unchanged.
 */
export function commentExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  const candidates = [...pkg.parts.values()].filter((part) => emptyCommentPart(pkg, part));
  if (candidates.length === 0 || !removableRelationships(pkg, candidates)) return pkg;

  if (
    !canRemoveContentTypeOverrides(pkg, new Set(candidates.map((part) => partNameKey(part.name))))
  )
    return pkg;

  // Preserve all parts if any marker remains, including malformed generic markers.
  // A bounded scan that cannot prove absence must not remove package structure.
  const budget = createCommentScanBudget();
  let marked = false;
  for (const part of pkg.parts.values()) {
    if (!chargePart(budget)) return pkg;
    walkCharged(part.root, budget, (node) => {
      if (
        node.namespaceUri === W &&
        ['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(node.localName)
      )
        marked = true;
      return marked;
    });
    if (marked || budget.truncated) return pkg;
  }

  return runWithoutJournalCapture(() => {
    let next = pkg;
    for (const part of candidates) {
      const removed = withoutPart(next, part.name);
      if (!removed.ok) return pkg;
      next = removed.pkg;
    }
    return next;
  });
}
