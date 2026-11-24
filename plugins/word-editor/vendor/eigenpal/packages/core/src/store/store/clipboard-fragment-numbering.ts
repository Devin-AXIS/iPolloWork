// Clipboard fragment numbering: which list definitions a paste imports, and under what ids.
//
// Numbering ids always remap. A fragment `w:num` whose definition (abstract plus level
// overrides) the target already holds reuses the target's `numId`; anything else imports
// under a fresh `numId`, with its `w:abstractNum` under a fresh `abstractNumId`.
//
// Fresh ids follow the rule list creation uses (`numbering-part.ts`): one past the highest
// without an actor, the actor's stripe with one. "One past the highest" is the same number
// on every replica that pastes from one snapshot, so two concurrent pastes appended two
// different definitions under one `numId` and the replicas could not agree on either.

import {
  MAX_RELATIONSHIP_NUMBER,
  resolveAllocationActor,
  stripedDecimalIdSequence,
} from '../package/actor-scoped-ids.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import { attributeValueOf } from './tree-op-nodes.ts';
import {
  isElementNode,
  isWml,
  nodeSignature,
  styleSignature,
} from './clipboard-fragment-defaults.ts';
import { withRewrittenAttribute } from './clipboard-fragment-identifiers.ts';

export interface NumberingImportPlan {
  /** Fragment `numId` → target `numId`, for `rewriteIdentifiers`. */
  readonly numIdMap: Map<string, string>;
  /** Renumbered `w:num` instances to append. */
  readonly numsToImport: OoxmlElement[];
  /** Renumbered `w:abstractNum` definitions to insert before the first `w:num`. */
  readonly abstractsToImport: OoxmlElement[];
}

/** A definition's identity: its abstract's fingerprint plus the instance's level overrides. */
function numSignature(num: OoxmlElement, abstract: OoxmlElement | undefined): string {
  return `${abstract ? styleSignature(abstract) : 'none'}::${num.children
    .filter((inner) => isWml(inner, 'lvlOverride'))
    .map(nodeSignature)
    .join('')}`;
}

function abstractIdOf(num: OoxmlElement): string | undefined {
  const abstractRef = num.children.find((inner) => isWml(inner, 'abstractNumId'));
  return abstractRef ? attributeValueOf(abstractRef as OoxmlElement, 'val') : undefined;
}

/**
 * Fresh ids for one numbering namespace. `null` once an actor's stripe is full: handing back
 * an id another definition holds would merge two lists, so the caller refuses the paste.
 */
function freshIds(
  target: OoxmlPart | null,
  localName: 'abstractNum' | 'num',
  attributeName: 'abstractNumId' | 'numId'
): () => string | null {
  // `0` is Word's "no numbering" sentinel; a stripe that lands on it moves to the next slot.
  const used = new Set<string>(['0']);
  let highest = 0;
  for (const child of target?.root.children ?? []) {
    if (!isElementNode(child) || !isWml(child, localName)) continue;
    const raw = attributeValueOf(child, attributeName);
    if (raw === undefined) continue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) continue;
    used.add(String(parsed));
    if (parsed > highest) highest = parsed;
  }
  const actor = resolveAllocationActor();
  if (actor) return stripedDecimalIdSequence(used, actor, MAX_RELATIONSHIP_NUMBER);
  let next = highest + 1;
  return () => String(next++);
}

/**
 * Plan the numbering a fragment brings into `target`. `null` when no fresh id is left;
 * an empty plan when the fragment carries no numbering part.
 */
export function planNumberingImport(
  fragmentNumbering: OoxmlPart | null,
  targetNumbering: OoxmlPart | null
): NumberingImportPlan | null {
  const plan: NumberingImportPlan = {
    numIdMap: new Map(),
    numsToImport: [],
    abstractsToImport: [],
  };
  if (!fragmentNumbering || !isElementNode(fragmentNumbering.root)) return plan;

  const fragmentAbstracts = new Map<string, OoxmlElement>();
  const fragmentNums: OoxmlElement[] = [];
  for (const child of fragmentNumbering.root.children) {
    if (!isElementNode(child)) continue;
    if (isWml(child, 'abstractNum')) {
      const id = attributeValueOf(child, 'abstractNumId');
      if (id) fragmentAbstracts.set(id, child);
    } else if (isWml(child, 'num')) {
      fragmentNums.push(child);
    }
  }

  const targetNumSignatures = new Map<string, string>();
  if (targetNumbering && isElementNode(targetNumbering.root)) {
    const targetAbstractById = new Map<string, OoxmlElement>();
    for (const child of targetNumbering.root.children) {
      if (!isElementNode(child) || !isWml(child, 'abstractNum')) continue;
      const id = attributeValueOf(child, 'abstractNumId');
      if (id) targetAbstractById.set(id, child);
    }
    for (const child of targetNumbering.root.children) {
      if (!isElementNode(child) || !isWml(child, 'num')) continue;
      const numId = attributeValueOf(child, 'numId');
      if (!numId) continue;
      const abstractId = abstractIdOf(child);
      const abstract = abstractId ? targetAbstractById.get(abstractId) : undefined;
      targetNumSignatures.set(numSignature(child, abstract), numId);
    }
  }

  const nextAbstractId = freshIds(targetNumbering, 'abstractNum', 'abstractNumId');
  const nextNumId = freshIds(targetNumbering, 'num', 'numId');
  const abstractIdMap = new Map<string, string>();
  for (const num of fragmentNums) {
    const numId = attributeValueOf(num, 'numId');
    if (!numId) continue;
    const abstractId = abstractIdOf(num);
    const abstract = abstractId ? fragmentAbstracts.get(abstractId) : undefined;
    const signature = numSignature(num, abstract);
    const reusable = targetNumSignatures.get(signature);
    if (reusable !== undefined) {
      plan.numIdMap.set(numId, reusable);
      continue;
    }
    let mappedAbstract = abstractId ? abstractIdMap.get(abstractId) : undefined;
    if (mappedAbstract === undefined && abstract && abstractId) {
      const fresh = nextAbstractId();
      if (fresh === null) return null;
      mappedAbstract = fresh;
      abstractIdMap.set(abstractId, mappedAbstract);
      plan.abstractsToImport.push(
        withRewrittenAttribute(abstract, WML_NAMESPACE_URI, 'abstractNumId', mappedAbstract)
      );
    }
    const freshNumId = nextNumId();
    if (freshNumId === null) return null;
    plan.numIdMap.set(numId, freshNumId);
    let imported = withRewrittenAttribute(num, WML_NAMESPACE_URI, 'numId', freshNumId);
    if (mappedAbstract !== undefined) {
      const children = imported.children.map((inner) =>
        isWml(inner, 'abstractNumId')
          ? withRewrittenAttribute(inner as OoxmlElement, WML_NAMESPACE_URI, 'val', mappedAbstract!)
          : inner
      );
      imported = { ...imported, children } as OoxmlElement;
    }
    plan.numsToImport.push(imported);
    targetNumSignatures.set(signature, freshNumId);
  }
  return plan;
}
