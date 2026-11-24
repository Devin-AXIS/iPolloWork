// The nodes inside a custom XML data part, and the sweep that keeps them honest.
//
// One node per bound control. Its shape is fixed and deliberately dull:
//
//   <docxEditor xmlns="…"><node id="cx1"><label>(Smith 2024)</label><data>{…}</data></node></docxEditor>
//
// `label` is what a `w:dataBinding` xpath points at, because a binding supplies the CONTROL'S
// TEXT and nothing else — Word regenerates the control from it on open. `data` is a JSON
// string, which is where a payload of any shape lives. Splitting the two keeps Word from ever
// rendering the payload: it is not what the binding names, so Word copies it and moves on.
//
// THE SWEEP. Word will not delete a node when a user deletes the control bound to it, and
// nothing in OOXML asks it to. So orphans are a fact of the format, not a bug to prevent, and
// `withoutOrphanCustomXmlNodes` is the answer: given the ids the story still binds, every other
// node goes. One mechanism covers deletion here and deletion in Word, the difference being only
// when it runs.
//
// SECURITY: `label` and `data` come out of a file the sender controls. This module returns them
// as strings and parses nothing; a caller that renders one, or trusts its JSON, owes it the
// validation every other file-derived value gets.

import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import { insertChildren, removeNode, replaceChildren } from './ooxml-edit.ts';
import { runWithoutJournalCapture } from './canonical-primitive-capture.ts';
import { XML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

/** The element holding the text a binding resolves to. */
/** Ids a binding can address. XPath 1.0 has no escape for a quote inside a literal, so an id
 *  carrying one could close the predicate and append an expression of the sender's choosing.
 *  Restricting the id is honest — we mint them — and refusing beats a broken binding. */
const ADDRESSABLE_ID = /^[A-Za-z_][\w.-]{0,127}$/;

const LABEL = 'label';
/** The element holding the payload, as JSON text. */
const DATA = 'data';
const NODE = 'node';

/** One node in a store: its id, the bound text, and the payload beside it. */
export interface CustomXmlNode {
  readonly id: string;
  /** Text a `w:dataBinding` resolves to. Untrusted file input. */
  readonly label: string;
  /** Payload as authored, JSON by convention and unparsed here. Untrusted file input. */
  readonly data: string;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += textOf(child);
  return text;
}

function childNamed(element: OoxmlElement, localName: string): OoxmlNode | null {
  return (
    element.children.find((child) => child.kind !== 'textValue' && child.localName === localName) ??
    null
  );
}

function idOf(element: OoxmlElement): string | null {
  const id = element.attributes.find((a) => a.localName === 'id' && a.namespaceUri === '');
  return id && id.value.length > 0 ? id.value : null;
}

function nodeElements(part: OoxmlPart): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const child of part.root.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName !== NODE) continue;
    if (child.namespaceUri !== part.root.namespaceUri) continue;
    found.push(child);
  }
  return found;
}

function element(
  id: string,
  namespaceUri: string,
  localName: string,
  attributes: Readonly<Record<string, string>>,
  children: readonly OoxmlNode[]
): OoxmlElement {
  return {
    id,
    kind: 'generic',
    namespaceUri,
    localName,
    namespaceBindings: [],
    attributes: Object.entries(attributes).map(([name, value]) => ({
      kind: 'genericExtension' as const,
      namespaceUri: '',
      localName: name,
      value,
    })),
    children,
  } as OoxmlElement;
}

function textElement(
  id: string,
  namespaceUri: string,
  localName: string,
  value: string
): OoxmlElement {
  const authored = element(id, namespaceUri, localName, {}, [
    { id: `${id}#text`, kind: 'textValue', value },
  ]);
  // `xml:space="preserve"` on an edge space, and only then. A binding supplies the control's
  // text verbatim, so `(Smith 2024) ` and `(Smith 2024)` are different labels — but the default
  // in XML is that a reader MAY normalize, and Word drops the attribute from the bound run
  // whenever the text does not need it. Re-asserting here means the store keeps saying what it
  // means whatever a round trip does to the body's copy. Written only when it is needed, so an
  // ordinary label adds no attribute the file did not want.
  if (value === value.trim()) return authored;
  return {
    ...authored,
    attributes: [
      ...authored.attributes,
      {
        kind: 'xmlSpace' as const,
        namespaceUri: XML_NAMESPACE_URI,
        localName: 'space' as const,
        prefix: 'xml' as const,
        value: 'preserve' as const,
      },
    ],
  } as OoxmlElement;
}

/** Every node a store holds, in document order. */
export function customXmlNodes(pkg: OoxmlPackage, partName: string): CustomXmlNode[] {
  const part = pkg.parts.get(partName);
  if (!part) return [];
  const found: CustomXmlNode[] = [];
  for (const node of nodeElements(part)) {
    const id = idOf(node);
    if (id === null) continue;
    const label = childNamed(node, LABEL);
    const data = childNamed(node, DATA);
    found.push({
      id,
      label: label ? textOf(label) : '',
      data: data ? textOf(data) : '',
    });
  }
  return found;
}

/** One node by id, or null. */
export function readCustomXmlNode(
  pkg: OoxmlPackage,
  partName: string,
  nodeId: string
): CustomXmlNode | null {
  return customXmlNodes(pkg, partName).find((node) => node.id === nodeId) ?? null;
}

/**
 * Write a node, replacing one that already has the id.
 *
 * Replace rather than append: a second node with the same id makes the binding xpath ambiguous,
 * and Word resolves an ambiguous xpath to the first match — so an "update" that appended would
 * leave the control showing its old text forever.
 */
export function withCustomXmlNode(
  pkg: OoxmlPackage,
  partName: string,
  node: CustomXmlNode
): OoxmlPackage {
  // An id `customXmlLabelXPath` will refuse is a payload no control can ever bind to. Writing
  // it anyway leaves the store holding something unreachable, with the refusal surfacing later
  // at the binding, where the id is no longer the obvious cause.
  if (!ADDRESSABLE_ID.test(node.id)) return pkg;
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  const ns = part.root.namespaceUri;
  const base = `${partName}#node-${node.id}`;
  const authored = element(base, ns, NODE, { id: node.id }, [
    textElement(`${base}-label`, ns, LABEL, node.label),
    textElement(`${base}-data`, ns, DATA, node.data),
  ]);

  const existing = nodeElements(part).find((candidate) => idOf(candidate) === node.id);
  if (existing) {
    const replaced = replaceChildren(part, part.root.id, [
      ...part.root.children.map((child) => (child.id === existing.id ? authored : child)),
    ]);
    return replaced.ok ? withPart(pkg, replaced.part) : pkg;
  }
  // Append would record `spliceChildren` at `children.length`. After concurrent first-create,
  // orphan adoption is a materialize projection and does not write the peer's `node` into
  // Yjs, so that index is past the shared child array and the journal refuses. Insert at 0
  // stays in bounds. Bindings address a node by `@id`, not by sibling order.
  const appended = insertChildren(part, part.root.id, 0, [authored], {
    deferValidation: true,
  });
  if (!appended.ok) return pkg;
  return withPart(pkg, withNodesSortedByPayloadId(appended.part));
}

function payloadIdOfNode(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.id;
  return node.attributes.find((attribute) => attribute.localName === 'id')?.value ?? node.id;
}

function withNodesSortedByPayloadId(part: OoxmlPart): OoxmlPart {
  const sorted = [...part.root.children].sort((left, right) =>
    payloadIdOfNode(left).localeCompare(payloadIdOfNode(right))
  );
  if (sorted.every((child, index) => child === part.root.children[index])) return part;
  // The peer sorts adopted `node` children by payload `@id`. Journaling this reorder would
  // splice by the store's child count, which is past the Yjs array after a concurrent
  // first-create, so the peer would refuse a write that only changed order.
  const replaced = runWithoutJournalCapture(() =>
    replaceChildren(part, part.root.id, sorted, { deferValidation: true })
  );
  return replaced.ok ? replaced.part : part;
}

/** Drop one node by id. A store that never held it comes back unchanged. */
export function withoutCustomXmlNode(
  pkg: OoxmlPackage,
  partName: string,
  nodeId: string
): OoxmlPackage {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  const existing = nodeElements(part).find((candidate) => idOf(candidate) === nodeId);
  if (!existing) return pkg;
  const removed = removeNode(part, existing.id);
  return removed.ok ? withPart(pkg, removed.part) : pkg;
}

/**
 * Drop every node no longer referenced, given the ids the document still binds.
 *
 * This is the whole deletion story. Deleting a control in THIS editor can remove its node
 * directly, but a control deleted in Word leaves the node behind — Word has no lifecycle link
 * between the two and no way to run our code. Reconciling against what the story actually binds
 * collects both, and is the only thing that can collect the second.
 *
 * Takes the referenced ids rather than reading the story itself: the caller already walked it,
 * and a sweep that guessed at which controls exist would delete a payload on a mistake.
 */
export function withoutOrphanCustomXmlNodes(
  pkg: OoxmlPackage,
  partName: string,
  referencedIds: ReadonlySet<string>
): { readonly pkg: OoxmlPackage; readonly removed: readonly string[] } {
  const part = pkg.parts.get(partName);
  if (!part) return { pkg, removed: [] };
  const orphans = nodeElements(part).filter((node) => {
    const id = idOf(node);
    return id !== null && !referencedIds.has(id);
  });
  if (orphans.length === 0) return { pkg, removed: [] };
  const orphanNodeIds = new Set(orphans.map((node) => node.id));
  const kept = part.root.children.filter((child) => !orphanNodeIds.has(child.id));
  const replaced = replaceChildren(part, part.root.id, kept);
  if (!replaced.ok) return { pkg, removed: [] };
  return {
    pkg: withPart(pkg, replaced.part),
    removed: orphans.map((node) => idOf(node) ?? '').filter((id) => id.length > 0),
  };
}

/**
 * The `w:xpath` a binding uses to reach a node's label, or null when the id cannot be addressed.
 *
 * Word needs a prefix for the payload namespace even when the store declares it as a default —
 * an unprefixed step in an XPath means "no namespace", so `/docxEditor/node` would match
 * nothing in a namespaced store. The prefix is declared in `w:prefixMappings` beside it.
 */
export function customXmlLabelXPath(
  prefix: string,
  rootLocalName: string,
  nodeId: string
): string | null {
  if (!ADDRESSABLE_ID.test(prefix) || !ADDRESSABLE_ID.test(rootLocalName)) return null;
  if (!ADDRESSABLE_ID.test(nodeId)) return null;
  return `/${prefix}:${rootLocalName}/${prefix}:${NODE}[@id='${nodeId}']/${prefix}:${LABEL}`;
}

/** The `w:prefixMappings` value declaring that prefix, or null when it cannot be written.
 *  The namespace sits inside single quotes inside a double-quoted attribute, so a namespace
 *  carrying either quote character has no representation here. */
export function customXmlPrefixMappings(prefix: string, namespaceUri: string): string | null {
  if (!ADDRESSABLE_ID.test(prefix)) return null;
  if (/['"<>&]/.test(namespaceUri)) return null;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(namespaceUri)) return null;
  return `xmlns:${prefix}='${namespaceUri}'`;
}
