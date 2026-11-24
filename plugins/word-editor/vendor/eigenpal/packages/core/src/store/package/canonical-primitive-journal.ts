// Yjs-free canonical mutation journal (full-document-yjs-collaboration task 3.5).
//
// These effects are the compositional package mutation language from design D3. TreeDocOp
// remains the intent API. Collaboration later applies one settled journal as one Yjs
// transaction. Core never imports a CRDT.

import type { OoxmlElement } from './ooxml-tree.ts';
import type { HistoryGroup } from '../store/history-group.ts';

/** Attribute name as the journal addresses it. Prefix is authored fidelity, not identity. @public */
export interface CanonicalAttributeName {
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
}

/** Content-addressed binary part reference. Bytes stay out of the journal. @public */
export interface CanonicalBinaryDescriptor {
  readonly storageKey: string;
  readonly digest: string;
  readonly size: number;
  readonly mediaType: string;
}

/** Text node shell. Value arrives later through `spliceText`. @public */
export interface CanonicalTextNodeDescriptor {
  readonly logicalId: string;
  readonly kind: 'textValue';
}

/** OOXML element shell. Attributes, bindings, and children arrive as later effects. @public */
export interface CanonicalElementNodeDescriptor {
  readonly logicalId: string;
  readonly kind: OoxmlElement['kind'];
  readonly qname: CanonicalAttributeName;
}

/** Immutable node record required to create a registry entry. @public */
export type CanonicalNodeDescriptor = CanonicalTextNodeDescriptor | CanonicalElementNodeDescriptor;

/** One relationship as the journal records it. @public */
export interface CanonicalRelationshipRecord {
  readonly ownerPart: string;
  readonly id: string;
  readonly type: string;
  readonly rawTarget: string;
  readonly targetMode: 'Internal' | 'External';
  readonly order: number;
}

/** One compositional tree or package effect captured from a canonical write. @public */
export type CanonicalPrimitiveEffect =
  | {
      readonly kind: 'putNode';
      readonly descriptor: CanonicalNodeDescriptor;
    }
  | {
      readonly kind: 'spliceText';
      readonly logicalId: string;
      readonly utf16Start: number;
      readonly deleteCount: number;
      readonly insert: string;
    }
  | {
      readonly kind: 'setAttribute';
      readonly logicalId: string;
      readonly qname: CanonicalAttributeName;
      readonly value: string | null;
    }
  | {
      readonly kind: 'setNamespaceBinding';
      readonly logicalId: string;
      readonly prefix: string;
      readonly uri: string | null;
    }
  | {
      readonly kind: 'spliceChildren';
      readonly parentLogicalId: string;
      readonly start: number;
      readonly deleteCount: number;
      readonly childLogicalIds: readonly string[];
    }
  | {
      readonly kind: 'moveNode';
      readonly logicalId: string;
      readonly destinationParentLogicalId: string;
      readonly destinationIndex: number;
    }
  | {
      readonly kind: 'putXmlPart';
      readonly name: string;
      readonly rootLogicalId: string;
    }
  | {
      readonly kind: 'deleteXmlPart';
      readonly name: string;
    }
  | {
      readonly kind: 'putRelationship';
      readonly owner: string;
      readonly record: CanonicalRelationshipRecord;
    }
  | {
      readonly kind: 'deleteRelationship';
      readonly owner: string;
      readonly relationshipId: string;
    }
  | {
      readonly kind: 'putContentTypeOverride';
      readonly partName: string;
      readonly mediaType: string;
    }
  | {
      readonly kind: 'deleteContentTypeOverride';
      readonly partName: string;
    }
  | {
      readonly kind: 'putBinary';
      readonly descriptor: CanonicalBinaryDescriptor;
    }
  | {
      readonly kind: 'deleteBinary';
      readonly storageKey: string;
    };

/**
 * One immutable journal for one `TreePackageStore` transaction.
 *
 * Empty only when a committed write used a path the journal does not yet intercept.
 *
 * @public
 */
export interface CanonicalPrimitiveJournal {
  readonly effects: readonly CanonicalPrimitiveEffect[];
}

/**
 * The gesture each journal's transaction named, beside the journal rather than on it.
 *
 * Local history groups consecutive transactions carrying one token into one undo step, and
 * the shared undo authority groups the matching journals the same way — so it needs the
 * token. It is a symbol, and a host port may relay journals through `postMessage` or
 * `structuredClone`, which refuse symbols; a property would have broken such a port the
 * first time a gesture ran. Keyed by identity, so the entry lives exactly as long as the
 * journal does.
 */
const journalHistoryGroups = new WeakMap<CanonicalPrimitiveJournal, HistoryGroup>();

/** The history group the transaction behind `journal` named, if any. @public */
export function historyGroupOfJournal(
  journal: CanonicalPrimitiveJournal
): HistoryGroup | undefined {
  return journalHistoryGroups.get(journal);
}

/** Freeze one effect and any nested arrays it owns. */
export function freezeCanonicalPrimitiveEffect(
  effect: CanonicalPrimitiveEffect
): CanonicalPrimitiveEffect {
  if (effect.kind === 'spliceChildren') {
    return Object.freeze({
      ...effect,
      childLogicalIds: Object.freeze([...effect.childLogicalIds]),
    });
  }
  if (effect.kind === 'setAttribute') {
    return Object.freeze({ ...effect, qname: Object.freeze({ ...effect.qname }) });
  }
  if (effect.kind === 'putRelationship') {
    return Object.freeze({ ...effect, record: Object.freeze({ ...effect.record }) });
  }
  if (effect.kind === 'putBinary') {
    return Object.freeze({ ...effect, descriptor: Object.freeze({ ...effect.descriptor }) });
  }
  if (effect.kind === 'putNode') {
    return Object.freeze({
      ...effect,
      descriptor: freezeCanonicalNodeDescriptor(effect.descriptor),
    });
  }
  return Object.freeze({ ...effect });
}

function freezeCanonicalNodeDescriptor(
  descriptor: CanonicalNodeDescriptor
): CanonicalNodeDescriptor {
  if (descriptor.kind === 'textValue') {
    return Object.freeze({ logicalId: descriptor.logicalId, kind: 'textValue' });
  }
  return Object.freeze({
    logicalId: descriptor.logicalId,
    kind: descriptor.kind,
    qname: Object.freeze({ ...descriptor.qname }),
  });
}

/** Journals no user undo may take back (see `runOutsideSharedUndo`). Keyed by identity. */
const journalsOutsideUndo = new WeakSet<CanonicalPrimitiveJournal>();

/**
 * Whether the transaction behind `journal` ran outside shared undo: document setup, such as
 * a built-in style that content of every participant may come to use. A collaboration session
 * publishes it without an undo entry, so one participant's undo cannot remove what another
 * participant's content needs. @public
 */
export function isJournalOutsideUndo(journal: CanonicalPrimitiveJournal): boolean {
  return journalsOutsideUndo.has(journal);
}

/** Freeze a captured effect list into one journal object. */
export function freezeCanonicalPrimitiveJournal(
  effects: readonly CanonicalPrimitiveEffect[],
  historyGroup?: HistoryGroup,
  outsideUndo = false
): CanonicalPrimitiveJournal {
  const journal: CanonicalPrimitiveJournal = Object.freeze({
    effects: Object.freeze(effects.map(freezeCanonicalPrimitiveEffect)),
  });
  if (historyGroup !== undefined) journalHistoryGroups.set(journal, historyGroup);
  if (outsideUndo) journalsOutsideUndo.add(journal);
  return journal;
}
