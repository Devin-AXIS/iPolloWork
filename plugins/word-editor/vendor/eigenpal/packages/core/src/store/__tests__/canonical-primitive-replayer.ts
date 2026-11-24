// Test-only Yjs-free replay of a CanonicalPrimitiveJournal onto an OoxmlPackage.
// Production never imports this module.

import { withoutPart, withContentTypeOverride, relsPartNameFor } from '../package/package-edit.ts';
import { partNameKey, validateExternalTarget } from '../package/opc-names.ts';
import { withoutContentTypeOverride } from '../package/hf-lifecycle-shell.ts';
import type {
  CanonicalAttributeName,
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
  CanonicalRelationshipRecord,
} from '../package/canonical-primitive-journal.ts';
import type { OoxmlExternalTarget, OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { RelationshipRecord } from '../package/relationships.ts';

const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export type JournalBlobLookup = ReadonlyMap<string, Uint8Array>;

type WorkingNode = {
  kind: string;
  qname?: CanonicalAttributeName;
  value: string;
  attributes: OoxmlAttribute[];
  bindings: { prefix: string; namespaceUri: string }[];
  children: string[];
};

function qnameOf(node: OoxmlElement): CanonicalAttributeName {
  return node.prefix === undefined
    ? { namespaceUri: node.namespaceUri, localName: node.localName }
    : {
        namespaceUri: node.namespaceUri,
        localName: node.localName,
        prefix: node.prefix,
      };
}

function recordOf(node: OoxmlNode): WorkingNode {
  if (node.kind === 'textValue') {
    return {
      kind: 'textValue',
      value: node.value,
      attributes: [],
      bindings: [],
      children: [],
    };
  }
  return {
    kind: node.kind,
    qname: qnameOf(node),
    value: '',
    attributes: [...node.attributes],
    bindings: node.namespaceBindings.map((binding) => ({ ...binding })),
    children: node.children.map((child) => child.id),
  };
}

function indexTree(
  node: OoxmlNode,
  nodes: Map<string, WorkingNode>,
  parents: Map<string, string>
): void {
  nodes.set(node.id, recordOf(node));
  if (node.kind === 'textValue') return;
  for (const child of node.children) {
    parents.set(child.id, node.id);
    indexTree(child, nodes, parents);
  }
}

function materialize(nodes: Map<string, WorkingNode>, id: string): OoxmlNode {
  const recorded = nodes.get(id);
  if (!recorded) throw new Error(`replay missing record ${id}`);
  if (recorded.kind === 'textValue') return { id, kind: 'textValue', value: recorded.value };
  if (!recorded.qname) throw new Error(`replay missing qname ${id}`);
  return {
    id,
    kind: recorded.kind,
    namespaceUri: recorded.qname.namespaceUri,
    localName: recorded.qname.localName,
    ...(recorded.qname.prefix === undefined ? {} : { prefix: recorded.qname.prefix }),
    attributes: recorded.attributes,
    namespaceBindings: recorded.bindings,
    children: recorded.children.map((childId) => materialize(nodes, childId)),
  } as OoxmlNode;
}

function snapshotParts(
  partRoots: Map<string, string>,
  partMeta: Map<string, { contentType: string }>,
  nodes: Map<string, WorkingNode>
): Map<string, OoxmlPart> {
  const parts = new Map<string, OoxmlPart>();
  for (const [name, rootId] of partRoots) {
    const root = materialize(nodes, rootId);
    if (root.kind === 'textValue') throw new Error(`replay root is text ${name}`);
    parts.set(name, {
      id: name,
      name,
      contentType: partMeta.get(name)?.contentType ?? 'application/xml',
      root,
    });
  }
  return parts;
}

function freezePackage(
  pkg: OoxmlPackage,
  parts: Map<string, OoxmlPart>,
  partBytes: Map<string, Uint8Array>,
  relationships: Map<string, readonly RelationshipRecord[]>,
  externalTargets: readonly OoxmlExternalTarget[],
  overrides: Map<string, string>
): OoxmlPackage {
  return Object.freeze({
    ...pkg,
    parts,
    partBytes,
    relationships,
    externalTargets: Object.freeze([...externalTargets]),
    contentTypes: { defaults: pkg.contentTypes.defaults, overrides },
  });
}

function attributeNameEquals(attribute: OoxmlAttribute, qname: CanonicalAttributeName): boolean {
  return attribute.namespaceUri === qname.namespaceUri && attribute.localName === qname.localName;
}

function applySetAttribute(
  recorded: WorkingNode,
  qname: CanonicalAttributeName,
  value: string | null
): void {
  recorded.attributes = recorded.attributes.filter(
    (attribute) => !attributeNameEquals(attribute, qname)
  );
  if (value === null) return;
  recorded.attributes.push({
    kind: 'genericExtension',
    namespaceUri: qname.namespaceUri,
    localName: qname.localName,
    ...(qname.prefix === undefined ? {} : { prefix: qname.prefix }),
    value,
  });
}

function applySpliceChildren(
  nodes: Map<string, WorkingNode>,
  parents: Map<string, string>,
  parentLogicalId: string,
  start: number,
  deleteCount: number,
  childLogicalIds: readonly string[]
): void {
  const parent = nodes.get(parentLogicalId);
  if (!parent) throw new Error(`replay missing parent ${parentLogicalId}`);
  parent.children.splice(start, deleteCount, ...childLogicalIds);
  for (const childId of parent.children) parents.set(childId, parentLogicalId);
}

function applyMoveNode(
  nodes: Map<string, WorkingNode>,
  parents: Map<string, string>,
  logicalId: string,
  destinationParentLogicalId: string,
  destinationIndex: number
): void {
  const previousParentId = parents.get(logicalId);
  if (previousParentId) {
    const previous = nodes.get(previousParentId);
    if (!previous) throw new Error(`replay missing parent ${previousParentId}`);
    const at = previous.children.indexOf(logicalId);
    if (at >= 0) previous.children.splice(at, 1);
  }
  const destination = nodes.get(destinationParentLogicalId);
  if (!destination) throw new Error(`replay missing parent ${destinationParentLogicalId}`);
  const index = Math.max(0, Math.min(destinationIndex, destination.children.length));
  destination.children.splice(index, 0, logicalId);
  parents.set(logicalId, destinationParentLogicalId);
}

function applyPutRelationship(
  nodes: Map<string, WorkingNode>,
  parents: Map<string, string>,
  partRoots: Map<string, string>,
  partMeta: Map<string, { contentType: string }>,
  relationships: Map<string, RelationshipRecord[]>,
  externalTargets: OoxmlExternalTarget[],
  owner: string,
  record: CanonicalRelationshipRecord
): void {
  const owned = [...(relationships.get(owner) ?? [])].filter((entry) => entry.id !== record.id);
  owned.push({ ...record });
  owned.sort((left, right) => left.order - right.order);
  relationships.set(owner, owned);

  if (record.targetMode === 'External') {
    const nextExternal = externalTargets.filter(
      (entry) => !(entry.ownerPart === owner && entry.id === record.id)
    );
    nextExternal.push({
      ownerPart: owner,
      id: record.id,
      type: record.type,
      rawTarget: record.rawTarget,
      sinkSafe: validateExternalTarget(record.rawTarget).ok,
    });
    externalTargets.splice(0, externalTargets.length, ...nextExternal);
  }

  const relsName = relsPartNameFor(owner);
  const rootId = partRoots.get(relsName);
  if (!rootId) return;
  const root = nodes.get(rootId);
  if (!root) return;
  let existingId: string | undefined;
  for (const childId of root.children) {
    const child = nodes.get(childId);
    if (!child) continue;
    const id = child.attributes.find((attribute) => attribute.localName === 'Id')?.value;
    if (id === record.id) existingId = childId;
  }
  const nodeId = existingId ?? `${relsName}#rel-${record.id}`;
  const attributes: OoxmlAttribute[] = [
    { kind: 'genericExtension', namespaceUri: '', localName: 'Id', value: record.id },
    { kind: 'genericExtension', namespaceUri: '', localName: 'Type', value: record.type },
    { kind: 'genericExtension', namespaceUri: '', localName: 'Target', value: record.rawTarget },
  ];
  if (record.targetMode === 'External') {
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: '',
      localName: 'TargetMode',
      value: 'External',
    });
  }
  nodes.set(nodeId, {
    kind: 'generic',
    qname: { namespaceUri: REL, localName: 'Relationship' },
    value: '',
    attributes,
    bindings: [],
    children: [],
  });
  if (!existingId) {
    root.children.push(nodeId);
    parents.set(nodeId, rootId);
  }
  partMeta.set(relsName, { contentType: RELS_CONTENT_TYPE });
}

function applyDeleteRelationship(
  nodes: Map<string, WorkingNode>,
  relationships: Map<string, RelationshipRecord[]>,
  externalTargets: OoxmlExternalTarget[],
  partRoots: Map<string, string>,
  owner: string,
  relationshipId: string
): void {
  relationships.set(
    owner,
    (relationships.get(owner) ?? []).filter((entry) => entry.id !== relationshipId)
  );
  const kept = externalTargets.filter(
    (entry) => !(entry.ownerPart === owner && entry.id === relationshipId)
  );
  externalTargets.splice(0, externalTargets.length, ...kept);
  const relsName = relsPartNameFor(owner);
  const rootId = partRoots.get(relsName);
  if (!rootId) return;
  const root = nodes.get(rootId);
  if (!root) return;
  root.children = root.children.filter((childId) => {
    const child = nodes.get(childId);
    const id = child?.attributes.find((attribute) => attribute.localName === 'Id')?.value;
    return id !== relationshipId;
  });
}

function rebuildSidecarFromRels(
  name: string,
  nodes: Map<string, WorkingNode>,
  partRoots: Map<string, string>,
  relationships: Map<string, RelationshipRecord[]>,
  externalTargets: OoxmlExternalTarget[]
): void {
  const match = /^(.*)\/_rels\/([^/]*)\.rels$/.exec(name);
  if (!match) return;
  const owner = match[2] === '' ? '/' : `${match[1]}/${match[2]}`;
  const rootId = partRoots.get(name);
  if (!rootId) return;
  const root = nodes.get(rootId);
  if (!root) return;
  const records: RelationshipRecord[] = [];
  const keptExternal = externalTargets.filter((entry) => entry.ownerPart !== owner);
  let order = 0;
  for (const childId of root.children) {
    const child = nodes.get(childId);
    if (!child) continue;
    const id = child.attributes.find((attribute) => attribute.localName === 'Id')?.value;
    const type = child.attributes.find((attribute) => attribute.localName === 'Type')?.value;
    const rawTarget = child.attributes.find((attribute) => attribute.localName === 'Target')?.value;
    const mode = child.attributes.find((attribute) => attribute.localName === 'TargetMode')?.value;
    if (!id || !type || !rawTarget) continue;
    if (mode === 'External') {
      keptExternal.push({
        ownerPart: owner,
        id,
        type,
        rawTarget,
        sinkSafe: validateExternalTarget(rawTarget).ok,
      });
    } else {
      records.push({
        ownerPart: owner,
        id,
        type,
        rawTarget,
        targetMode: 'Internal',
        order,
      });
    }
    order += 1;
  }
  relationships.set(owner, records);
  externalTargets.splice(0, externalTargets.length, ...keptExternal);
}

function reindexPackage(
  pkg: OoxmlPackage,
  nodes: Map<string, WorkingNode>,
  parents: Map<string, string>,
  partRoots: Map<string, string>,
  partMeta: Map<string, { contentType: string }>
): void {
  nodes.clear();
  parents.clear();
  partRoots.clear();
  partMeta.clear();
  for (const [name, part] of pkg.parts) {
    partRoots.set(name, part.root.id);
    partMeta.set(name, { contentType: part.contentType });
    indexTree(part.root, nodes, parents);
  }
}

/**
 * Apply one captured journal to a replica that started from the same package bytes.
 *
 * `blobs` supplies bytes for `putBinary` effects, keyed by storageKey (blob-store analogue).
 */
export function replayCanonicalPrimitiveJournal(
  pkg: OoxmlPackage,
  journal: CanonicalPrimitiveJournal,
  blobs: JournalBlobLookup = new Map()
): OoxmlPackage {
  const nodes = new Map<string, WorkingNode>();
  const parents = new Map<string, string>();
  const partRoots = new Map<string, string>();
  const partMeta = new Map<string, { contentType: string }>();
  reindexPackage(pkg, nodes, parents, partRoots, partMeta);

  let partBytes = new Map(pkg.partBytes);
  const relationships = new Map<string, RelationshipRecord[]>();
  for (const [owner, records] of pkg.relationships) relationships.set(owner, [...records]);
  const externalTargets: OoxmlExternalTarget[] = [...pkg.externalTargets];
  let overrides = new Map(pkg.contentTypes.overrides);
  let working = pkg;

  const refreshWorking = (): OoxmlPackage => {
    const parts = snapshotParts(partRoots, partMeta, nodes);
    working = freezePackage(pkg, parts, partBytes, relationships, externalTargets, overrides);
    return working;
  };

  const install = (next: OoxmlPackage): void => {
    working = next;
    partBytes = new Map(next.partBytes);
    const nextRelationships = [...next.relationships.entries()].map(
      ([owner, records]) => [owner, [...records]] as const
    );
    relationships.clear();
    for (const [owner, records] of nextRelationships) relationships.set(owner, records);
    externalTargets.splice(0, externalTargets.length, ...next.externalTargets);
    overrides = new Map(next.contentTypes.overrides);
    reindexPackage(next, nodes, parents, partRoots, partMeta);
  };

  const initialText = new Set<string>();
  for (const effect of journal.effects) {
    if (effect.kind === 'putNode' && effect.descriptor.kind === 'textValue') {
      initialText.add(effect.descriptor.logicalId);
    }
  }
  for (const effect of journal.effects) applyEffect(effect);

  function applyEffect(effect: CanonicalPrimitiveEffect): void {
    switch (effect.kind) {
      case 'putNode': {
        const descriptor = effect.descriptor;
        if (descriptor.kind === 'textValue') {
          const existing = nodes.get(descriptor.logicalId);
          if (existing) {
            existing.kind = 'textValue';
            existing.qname = undefined;
            existing.children = [];
            existing.attributes = [];
            existing.bindings = [];
            return;
          }
          nodes.set(descriptor.logicalId, {
            kind: 'textValue',
            value: '',
            attributes: [],
            bindings: [],
            children: [],
          });
          return;
        }
        const existing = nodes.get(descriptor.logicalId);
        if (existing) {
          existing.kind = descriptor.kind;
          existing.qname = descriptor.qname;
          return;
        }
        nodes.set(descriptor.logicalId, {
          kind: descriptor.kind,
          qname: descriptor.qname,
          value: '',
          attributes: [],
          bindings: [],
          children: [],
        });
        return;
      }
      case 'spliceText': {
        const recorded = nodes.get(effect.logicalId);
        if (!recorded) throw new Error(`replay missing text ${effect.logicalId}`);
        if (
          initialText.has(effect.logicalId) &&
          effect.utf16Start === 0 &&
          effect.deleteCount === 0
        ) {
          recorded.value = effect.insert;
          return;
        }
        recorded.value =
          recorded.value.slice(0, effect.utf16Start) +
          effect.insert +
          recorded.value.slice(effect.utf16Start + effect.deleteCount);
        return;
      }
      case 'setAttribute': {
        const recorded = nodes.get(effect.logicalId);
        if (!recorded) throw new Error(`replay missing node ${effect.logicalId}`);
        applySetAttribute(recorded, effect.qname, effect.value);
        return;
      }
      case 'setNamespaceBinding': {
        const recorded = nodes.get(effect.logicalId);
        if (!recorded) throw new Error(`replay missing node ${effect.logicalId}`);
        recorded.bindings = recorded.bindings.filter((binding) => binding.prefix !== effect.prefix);
        if (effect.uri !== null) {
          recorded.bindings.push({ prefix: effect.prefix, namespaceUri: effect.uri });
        }
        return;
      }
      case 'spliceChildren':
        applySpliceChildren(
          nodes,
          parents,
          effect.parentLogicalId,
          effect.start,
          effect.deleteCount,
          effect.childLogicalIds
        );
        return;
      case 'moveNode':
        applyMoveNode(
          nodes,
          parents,
          effect.logicalId,
          effect.destinationParentLogicalId,
          effect.destinationIndex
        );
        return;
      case 'putXmlPart': {
        partRoots.set(effect.name, effect.rootLogicalId);
        if (!partMeta.has(effect.name)) {
          const existing = pkg.parts.get(effect.name);
          partMeta.set(effect.name, {
            contentType: existing?.contentType ?? 'application/xml',
          });
        }
        rebuildSidecarFromRels(effect.name, nodes, partRoots, relationships, externalTargets);
        return;
      }
      case 'deleteXmlPart': {
        const removed = withoutPart(refreshWorking(), effect.name);
        if (!removed.ok) {
          partRoots.delete(effect.name);
          for (const name of [...partBytes.keys()]) {
            if (partNameKey(name) === partNameKey(effect.name)) partBytes.delete(name);
          }
          return;
        }
        install(removed.pkg);
        return;
      }
      case 'putRelationship':
        applyPutRelationship(
          nodes,
          parents,
          partRoots,
          partMeta,
          relationships,
          externalTargets,
          effect.owner,
          effect.record
        );
        return;
      case 'deleteRelationship':
        applyDeleteRelationship(
          nodes,
          relationships,
          externalTargets,
          partRoots,
          effect.owner,
          effect.relationshipId
        );
        return;
      case 'putContentTypeOverride': {
        const next = withContentTypeOverride(refreshWorking(), effect.partName, effect.mediaType, {
          forceOverride: true,
        });
        install(next);
        const meta = partMeta.get(effect.partName);
        if (meta) partMeta.set(effect.partName, { contentType: effect.mediaType });
        return;
      }
      case 'deleteContentTypeOverride': {
        const next = withoutContentTypeOverride(refreshWorking(), effect.partName);
        if (next) install(next);
        return;
      }
      case 'putBinary': {
        const bytes = blobs.get(effect.descriptor.storageKey);
        if (!bytes) {
          throw new Error(`replay missing blob ${effect.descriptor.storageKey}`);
        }
        partBytes.set(effect.descriptor.storageKey, bytes);
        const next = withContentTypeOverride(
          refreshWorking(),
          effect.descriptor.storageKey.startsWith('/')
            ? effect.descriptor.storageKey
            : `/${effect.descriptor.storageKey}`,
          effect.descriptor.mediaType,
          { forceOverride: true }
        );
        install(next);
        return;
      }
      case 'deleteBinary': {
        for (const name of [...partBytes.keys()]) {
          if (partNameKey(name) === partNameKey(effect.storageKey) || name === effect.storageKey) {
            partBytes.delete(name);
          }
        }
        overrides.delete(partNameKey(effect.storageKey));
        return;
      }
      default: {
        const exhaustive: never = effect;
        throw new Error(`replay unknown effect ${(exhaustive as CanonicalPrimitiveEffect).kind}`);
      }
    }
  }

  return refreshWorking();
}

/** Bytes for every `putBinary` storage key, taken from the source replica after the write. */
export function blobsForJournal(
  pkg: OoxmlPackage,
  journal: CanonicalPrimitiveJournal
): JournalBlobLookup {
  const blobs = new Map<string, Uint8Array>();
  for (const effect of journal.effects) {
    if (effect.kind !== 'putBinary') continue;
    const bytes =
      pkg.partBytes.get(effect.descriptor.storageKey) ??
      [...pkg.partBytes.entries()].find(
        ([name]) => partNameKey(name) === partNameKey(effect.descriptor.storageKey)
      )?.[1];
    if (bytes) blobs.set(effect.descriptor.storageKey, bytes);
  }
  return blobs;
}
