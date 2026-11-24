// Authoring a custom node that carries a payload, and taking one back.
//
// ONE TRANSACTION, three writes: the customXml data part (created if the document has none for
// the namespace), the node inside it, and the `w:sdt` in the body whose `w:dataBinding` names
// that node. Partial application is the failure this must not have — a control bound to a store
// that was never written is a document Word offers to repair, and repairing it means throwing
// the control away.
//
// The order is deliberate. The store goes in first, so the id the binding quotes is one the
// package already holds by the time the body references it; the body edit is last, so a refusal
// anywhere (a locked paragraph, an offset out of range, a protected document) abandons the store
// write with it rather than leaving a payload nothing points at.
//
// WHY THE STORE IS THE SOURCE OF TRUTH. A bound control with no type child is read-only in Word:
// the text is painted from the xpath and a user cannot type into it (verified,
// `sdt-custom-node-databinding-word-roundtrip.docx`). This engine refuses content edits inside a
// bound control for its own reasons — see `contentControlBindingRefusal` — so the two agree. The
// page and the payload cannot drift, and nothing here has to reconcile them.

import {
  boundCustomXmlNodeIdOf,
  boundCustomXmlNodeIdsInPackage,
  customNodeBinding,
} from '../package/custom-node-payloads.ts';
import {
  customXmlNodes,
  type CustomXmlNode,
  readCustomXmlNode,
  withCustomXmlNode,
  withoutCustomXmlNode,
  withoutOrphanCustomXmlNodes,
} from '../package/custom-xml-nodes.ts';
import {
  customXmlDataParts,
  findCustomXmlDataPart,
  withCustomXmlDataPart,
} from '../package/custom-xml-part.ts';
import { contentControlsIn } from '../package/content-control-nodes.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import type { TreeDocumentStore, TreeModelChange } from './tree-store.ts';
import type { RevisionAttributionInput, TreeOpRejection } from './tree-op-types.ts';

/**
 * The payload half of an insert: which store, which node, and what it holds.
 *
 * `data` is opaque here. The lane that owns a schema is the one that declared it, and a store
 * that parsed payloads would be a second opinion about what a host's node means.
 */
export interface CustomNodePayloadWrite {
  /** Namespace of the store's root element — what identifies one store among several. */
  readonly namespaceUri: string;
  /** Local name of that root. An NCName; anything else refuses. */
  readonly rootLocalName: string;
  /** The node's own id, which the binding's xpath quotes. */
  readonly nodeId: string;
  /** The text the control shows. Word paints this from the store, so an empty one is an empty chip. */
  readonly label: string;
  /** The payload, serialized. JSON by convention; never parsed here. */
  readonly data: string;
}

/** Where the control goes, what it says, and the payload it carries. */
export interface InsertCustomNodeWrite {
  readonly paragraphId: string;
  readonly offset: number;
  /**
   * Wrap rather than insert: the text from `offset` to here is removed first.
   *
   * The node's label REPLACES the words it covered, because that is what turning a stretch of a
   * sentence into a citation means. Removed inside the same transaction, so a refused insert
   * leaves the text where it was.
   */
  readonly replaceUntil?: number;
  /**
   * Rewrite an existing control: it and the payload it bound go first, in this transaction.
   *
   * An UPDATE is remove-and-reinsert, because the tag codec has no in-place rewrite and
   * pretending it did would put a second write path beside this one. Doing both halves here is
   * what keeps it one undo step, and what stops an update from leaving a label and a payload
   * that disagree.
   */
  readonly replaceControlId?: string;
  readonly tag: string;
  readonly text: string;
  readonly alias?: string;
  /** Defaults to none. Callers that want Word's own "cannot type into it" pass `contentLocked`. */
  readonly lock?: 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
  /** Omitted authors an ordinary tagged control with no store — the pre-payload behaviour. */
  readonly payload?: CustomNodePayloadWrite;
  /**
   * Propose the node as a tracked insertion. A wrap (`replaceUntil`) or a rewrite
   * (`replaceControlId`) has no tracked form yet, and refuses with a revision.
   */
  readonly revision?: RevisionAttributionInput;
}

/**
 * Why a payload write was refused.
 *
 * The tree rejections pass through unchanged, so a locked paragraph refuses a bound insert for
 * the same named reason it refuses a plain one. The three added here are the payload's own.
 */
export type CustomNodeWriteRejection =
  | TreeOpRejection
  /** The id, root name or namespace cannot be spelled in an XPath, so no binding could name it. */
  | 'unaddressable-payload'
  /** The store could not be authored — see `withCustomXmlDataPart` for every way that happens. */
  | 'store-not-authored'
  /** The payload or the label is past the cap. */
  | 'payload-too-large';

export type CustomNodeWriteResult =
  | {
      readonly ok: true;
      readonly change: TreeModelChange | null;
      /**
       * The control this write authored, when it authored one. A rewrite replaces the control
       * rather than editing it, so the id the caller passed in names nothing afterwards.
       */
      readonly nodeId?: string;
    }
  | { readonly ok: false; readonly reason: CustomNodeWriteRejection; readonly detail?: string };

/**
 * The largest payload one node may carry, in UTF-16 code units.
 *
 * Same figure as the read side's (`parseCustomNodeData`) and for the same reason: far past any
 * legitimate chip, far short of anything that hurts. Checked on the WRITE too, so a document
 * cannot be authored here holding a payload the reader will later refuse to parse.
 */
export const MAX_CUSTOM_NODE_PAYLOAD_LENGTH = 256 * 1024;

/** The longest label a binding may paint. Word renders it as the control's whole content. */
export const MAX_CUSTOM_NODE_LABEL_LENGTH = 4_096;

/** Whether any wrapper between the node and its paragraph is a pending revision. */
function insidePendingRevision(store: TreeDocumentStore, nodeId: string): boolean {
  for (
    let node = parentNodeOf(store.part, nodeId);
    node;
    node = parentNodeOf(store.part, node.id)
  ) {
    if (node.kind === 'paragraph') return false;
    if (node.kind.startsWith('revision')) return true;
  }
  return false;
}

/**
 * Insert one custom node, with its payload, as a single transaction.
 *
 * Answers the store transaction's own change so the caller can publish it — a payload write is a
 * package write reaching through a story store, exactly as a comment is, and the coordinator
 * needs the change to know which paragraphs went dirty.
 */
export function insertCustomNodeWrite(
  store: TreeDocumentStore,
  write: InsertCustomNodeWrite,
  /**
   * The part the customXml store hangs off, defaulting to the story being written.
   *
   * A chip in a header is written against the HEADER store, but Word enumerates the data
   * store from the main document part — a store authored off a header is one Word never
   * sees. So the caller passes the main part while the control itself lands in the story.
   */
  dataOwnerPartName?: string
): CustomNodeWriteResult {
  const payload = write.payload;
  const storyPartName = store.part.name;
  const dataPartName = dataOwnerPartName ?? storyPartName;

  if (payload) {
    if (payload.data.length > MAX_CUSTOM_NODE_PAYLOAD_LENGTH) {
      return { ok: false, reason: 'payload-too-large', detail: 'data' };
    }
    if (payload.label.length > MAX_CUSTOM_NODE_LABEL_LENGTH) {
      return { ok: false, reason: 'payload-too-large', detail: 'label' };
    }
  }

  if (
    write.revision &&
    (write.replaceControlId !== undefined || write.replaceUntil !== undefined)
  ) {
    return { ok: false, reason: 'unsupported', detail: 'tracked custom node wrap or rewrite' };
  }
  const revision = write.revision ? { revision: write.revision } : {};
  // A rewrite of a node that is itself a pending proposal would land the new control outside
  // the proposal, untracked. Refused until a rewrite can keep the proposal around it.
  if (
    write.replaceControlId !== undefined &&
    insidePendingRevision(store, write.replaceControlId)
  ) {
    return { ok: false, reason: 'unsupported', detail: 'custom node inside a pending revision' };
  }

  // Ids, not nodes: the transaction rebuilds the tree, so nothing else carries across it.
  const controlsBefore = new Set(contentControlsIn(store.part.root).map((entry) => entry.node.id));

  // Resolved BEFORE the transaction, because afterwards the control is gone and nothing says
  // what it pointed at.
  const superseded =
    write.replaceControlId === undefined
      ? []
      : boundNodesOf(store, storyPartName, write.replaceControlId);

  // Set inside the transaction and read after it: the store's `ds:itemID` is not known until the
  // part is authored, and the binding cannot be built without it.
  let refusal: CustomNodeWriteRejection | null = null;
  let refusalDetail: string | undefined;

  const result = store.transact((ctx) => {
    // The control being rewritten goes first, at the offsets the caller measured against the
    // tree it could see. Its payload goes with it — a rewrite that kept the old node would
    // leave the store growing an entry per edit.
    if (write.replaceControlId !== undefined) {
      ctx.apply({
        op: 'removeContentControl',
        controlId: write.replaceControlId,
        keepContent: false,
      });
      for (const entry of superseded) {
        ctx.applyPackage((current) => withoutCustomXmlNode(current, entry.partName, entry.nodeId));
      }
    }
    // The replaced text goes first, so the offsets the caller supplied still describe the
    // paragraph when the deletion is planned against it.
    const replaced = write.replaceUntil;
    if (replaced !== undefined && replaced <= write.offset) {
      // A reversed or empty span is not a wrap. Silently inserting instead would put the node
      // beside the text the caller believed it was replacing.
      refusal = 'invalid-range';
      refusalDetail = 'replaceUntil must be past offset';
      return;
    }
    if (replaced !== undefined) {
      ctx.apply({
        op: 'deleteText',
        paragraphId: write.paragraphId,
        start: write.offset,
        end: replaced,
      });
    }
    if (!payload) {
      ctx.apply({
        op: 'insertInlineContentControl',
        paragraphId: write.paragraphId,
        offset: write.offset,
        tag: write.tag,
        text: write.text,
        ...(write.alias === undefined ? {} : { alias: write.alias }),
        ...(write.lock === undefined ? {} : { lock: write.lock }),
        ...revision,
      });
      return;
    }

    let binding: ReturnType<typeof customNodeBinding> = null;
    // THE STORE FIRST. Everything the binding quotes has to exist in the package before the body
    // names it, so a transaction that dies at the body edit takes an unreferenced store with it
    // rather than leaving one behind.
    ctx.applyPackage((current) => {
      const authored = withCustomXmlDataPart(
        current,
        dataPartName,
        payload.namespaceUri,
        payload.rootLocalName
      );
      if (!authored.part) {
        refusal = 'store-not-authored';
        refusalDetail =
          `no customXml store could be created for ${payload.namespaceUri}. The namespace must ` +
          `be free of control characters and quotes, the root name must be an XML name, and a ` +
          `store this document already carries for that namespace must use the same root name ` +
          `(${payload.rootLocalName})`;
        return current;
      }
      // Built from the store's OWN root, never from what the caller asked for: the two agree
      // by the check above, and deriving from the part means an xpath can never name an element
      // the file does not have.
      binding = customNodeBinding(authored.part, payload.rootLocalName, payload.nodeId);
      if (!binding) {
        refusal = 'unaddressable-payload';
        refusalDetail =
          `the node id ${JSON.stringify(payload.nodeId)} or the namespace ` +
          `${JSON.stringify(payload.namespaceUri)} cannot be written into an XPath. Ids and root ` +
          `names must match [A-Za-z_][\\w.-]{0,127}; a namespace may not contain a quote, an ` +
          `angle bracket or an ampersand`;
        return current;
      }
      const written = withCustomXmlNode(authored.pkg, authored.part.partName, {
        id: payload.nodeId,
        label: payload.label,
        data: payload.data,
      });
      // READ IT BACK, the way `withCustomXmlDataPart` reads its own part back. `applyPackage`
      // treats an unchanged package as a no-op rather than a rejection, and `withCustomXmlNode`
      // answers the package unchanged on three paths — so without this the body gets a control
      // bound to a node that was never written, and the caller is told `ok`.
      if (!readCustomXmlNode(written, authored.part.partName, payload.nodeId)) {
        refusal = 'store-not-authored';
        refusalDetail = 'the payload node could not be written into the store';
        return current;
      }
      return written;
    });
    if (refusal !== null || !binding) return;

    ctx.apply({
      op: 'insertInlineContentControl',
      paragraphId: write.paragraphId,
      offset: write.offset,
      tag: write.tag,
      text: write.text,
      ...(write.alias === undefined ? {} : { alias: write.alias }),
      ...(write.lock === undefined ? {} : { lock: write.lock }),
      dataBinding: binding,
      ...revision,
    });
  });

  // The payload's own refusal wins over the transaction's outcome: `applyPackage` returning the
  // package unchanged is not a rejection the store reports, so without this a refused store write
  // would come back as a successful no-op — a caller told its node was written when it was not.
  if (refusal !== null) {
    return {
      ok: false,
      reason: refusal,
      ...(refusalDetail === undefined ? {} : { detail: refusalDetail }),
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  }
  const nodeId = authoredControlId(store, controlsBefore);
  return { ok: true, change: result.change, ...(nodeId === undefined ? {} : { nodeId }) };
}

/**
 * The content control this transaction added. Not from `change.created`, which reports touched
 * paragraphs rather than minted nodes and is empty for an inline insert.
 */
function authoredControlId(
  store: TreeDocumentStore,
  before: ReadonlySet<string>
): string | undefined {
  for (const entry of contentControlsIn(store.part.root)) {
    if (!before.has(entry.node.id)) return entry.node.id;
  }
  return undefined;
}

/**
 * Which store node, in which part, a control binds — across every store the story carries.
 *
 * Every store, not the first: a control's binding names one `w:storeItemID`, but a document may
 * hold several stores and only the one whose id matches answers. Resolving against all of them
 * means a removal cannot miss a payload because the store it lived in was not the store this
 * definition usually writes to.
 */
function boundNodesOf(
  store: TreeDocumentStore,
  storyPartName: string,
  controlNodeId: string
): readonly { readonly partName: string; readonly nodeId: string }[] {
  const control = contentControlsIn(store.part.root).find(
    (entry) => entry.node.id === controlNodeId
  );
  if (!control) return [];
  const bound: { readonly partName: string; readonly nodeId: string }[] = [];
  for (const dataPart of customXmlDataParts(store.package, storyPartName)) {
    const nodeId = boundCustomXmlNodeIdOf(control.node, dataPart.itemId);
    if (nodeId !== null) bound.push({ partName: dataPart.partName, nodeId });
  }
  return bound;
}

/**
 * Remove a control and, in the same transaction, the payload it bound.
 *
 * The sweep would collect the node eventually — that is what makes deletion in Word survivable —
 * but "eventually" is the next open, and a document saved in between carries a payload for a
 * chip that is gone. Doing it here means the ordinary case is exact and the sweep is a backstop.
 */
export function removeCustomNodeWrite(
  store: TreeDocumentStore,
  controlNodeId: string
): CustomNodeWriteResult {
  const storyPartName = store.part.name;
  const bound = boundNodesOf(store, storyPartName, controlNodeId);

  const result = store.transact((ctx) => {
    ctx.apply({ op: 'removeContentControl', controlId: controlNodeId, keepContent: false });
    for (const entry of bound) {
      ctx.applyPackage((current) => withoutCustomXmlNode(current, entry.partName, entry.nodeId));
    }
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  }
  return { ok: true, change: result.change };
}

/**
 * What one sweep collected, or why it collected nothing.
 *
 * `ok: false` is NOT "the document was already tidy" — that is `ok: true` with an empty
 * `removed`. It means a store this sweep was asked to tidy refused the rewrite, which a caller
 * that keeps saving into the same document should know about rather than silently retry forever.
 */
export type CustomNodeSweepResult =
  | {
      readonly ok: true;
      readonly pkg: OoxmlPackage;
      /** Node ids removed, across every store swept. Empty means there were no orphans. */
      readonly removed: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Drop every payload no control binds, in the stores whose namespaces a host claims.
 *
 * ON OPEN, NOT ON SAVE. A chip cut to the clipboard is unbound for as long as it sits there, so a
 * save mid-cut would destroy the payload the user is about to paste. On open the only unbound
 * nodes are ones a control genuinely lost — deleted here, or deleted in Word, which is the case
 * nothing else can collect.
 *
 * `namespaces` is the claim, and it is what keeps this off other people's stores: Word's own Cover
 * Page Properties store rides in most templates, and a sweep that walked every customXml part
 * would be deleting from it on the strength of a name collision.
 */
export function sweepCustomNodePayloads(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaces: readonly string[]
): CustomNodeSweepResult {
  if (!pkg.parts.has(storyPartName) || namespaces.length === 0) {
    return { ok: true, pkg, removed: [] };
  }
  let next = pkg;
  const removed: string[] = [];
  for (const namespaceUri of namespaces) {
    const dataPart = findCustomXmlDataPart(next, storyPartName, namespaceUri);
    if (!dataPart) continue;
    // EVERY story in the package. A control in a header binds a payload as readily as one in
    // the body, and reading the body alone made this delete a payload a header was still
    // painting — on open, with no undo entry to bring it back.
    const referenced = boundCustomXmlNodeIdsInPackage(next, dataPart.itemId);
    const swept = withoutOrphanCustomXmlNodes(next, dataPart.partName, referenced);
    // An unchanged package means "nothing to collect" OR "the rewrite was refused", and only
    // the first is a success. Told apart by asking whether anything unbound is still in there.
    if (
      swept.pkg === next &&
      customXmlNodes(next, dataPart.partName).some((n) => !referenced.has(n.id))
    ) {
      return { ok: false, reason: `the payload store for ${namespaceUri} refused the sweep` };
    }
    next = swept.pkg;
    removed.push(...swept.removed);
  }
  return { ok: true, pkg: next, removed };
}

/** One control's payload, as the store holds it. Both strings are untrusted file input. */
export interface CustomNodePayloadRead {
  /** The store node's own id. */
  readonly nodeId: string;
  /** The text Word paints the control from. */
  readonly label: string;
  /** The payload as authored. JSON by convention, unparsed here. */
  readonly data: string;
}

/**
 * The customXml stores one part relates, with each store's nodes indexed by id.
 *
 * Memoized per package, because the owner is a constant and the readers under it are not
 * memoized themselves. {@link customNodePayloadsByControl} is called once per STORY when the
 * review queue rebuilds, and the queue rebuilds per package revision — so on a document with a
 * dozen furniture parts this parsed the same store a dozen times per keystroke.
 */
const customXmlStoreNodesByPackage = new WeakMap<
  OoxmlPackage,
  Map<string, readonly { readonly itemId: string; readonly nodes: Map<string, CustomXmlNode> }[]>
>();

function customXmlStoreNodes(
  pkg: OoxmlPackage,
  dataOwnerPartName: string
): readonly { readonly itemId: string; readonly nodes: Map<string, CustomXmlNode> }[] {
  let byOwner = customXmlStoreNodesByPackage.get(pkg);
  if (!byOwner) {
    byOwner = new Map();
    customXmlStoreNodesByPackage.set(pkg, byOwner);
  }
  const cached = byOwner.get(dataOwnerPartName);
  if (cached) return cached;
  const built = customXmlDataParts(pkg, dataOwnerPartName).map((store) => ({
    itemId: store.itemId,
    nodes: new Map(customXmlNodes(pkg, store.partName).map((node) => [node.id, node])),
  }));
  byOwner.set(dataOwnerPartName, built);
  return built;
}

/**
 * The payload every control in a story binds to, keyed by the CONTROL's canonical node id.
 *
 * Keyed by the control rather than by the store node because that is the question a reader
 * actually has — "what does this chip carry" — and because two stores may each hold a `cx1`.
 * Resolved here rather than by a capability package: the stores are package parts, and a
 * derivation that only gets story parts has no way to reach them.
 *
 * Every store the story relates to, so a document carrying two definitions' payloads answers
 * for both without anyone naming a namespace.
 */
export function customNodePayloadsByControl(
  pkg: OoxmlPackage,
  storyPartName: string,
  /**
   * The part that RELATES the customXml store, when it is not the story's own.
   *
   * Two different questions wear one name here: which part holds the CONTROLS, and which part
   * relates the STORE they bind into. Word only reads a store hung off the main document part,
   * so {@link writeCustomNode} already takes them separately — this read did not, and answered
   * with the body's controls whatever story it was asked about. A chip in a header therefore
   * read as having no payload at all, and an update that meant to keep the existing data
   * dropped it.
   */
  dataOwnerPartName: string = storyPartName
): ReadonlyMap<string, CustomNodePayloadRead> {
  const found = new Map<string, CustomNodePayloadRead>();
  const story = pkg.parts.get(storyPartName);
  if (!story) return found;
  const nodesByStore = customXmlStoreNodes(pkg, dataOwnerPartName);
  if (nodesByStore.length === 0) return found;
  for (const entry of contentControlsIn(story.root)) {
    for (const store of nodesByStore) {
      const nodeId = boundCustomXmlNodeIdOf(entry.node, store.itemId);
      if (nodeId === null) continue;
      const node = store.nodes.get(nodeId);
      // A binding naming a node the store does not hold is a control Word paints from nothing.
      // Left out rather than reported as an empty payload, so a reader can tell "no payload"
      // from "a payload that says nothing".
      if (!node) continue;
      found.set(entry.node.id, { nodeId, label: node.label, data: node.data });
      break;
    }
  }
  return found;
}

/** Every payload one store holds, for a caller resolving a control's `data`. */
export function customNodePayloadsOf(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaceUri: string
): ReadonlyMap<string, { readonly label: string; readonly data: string }> {
  const found = new Map<string, { readonly label: string; readonly data: string }>();
  const dataPart = findCustomXmlDataPart(pkg, storyPartName, namespaceUri);
  if (!dataPart) return found;
  for (const node of customXmlNodes(pkg, dataPart.partName)) {
    found.set(node.id, { label: node.label, data: node.data });
  }
  return found;
}

/**
 * What the session answers for a sweep: the ids collected, or the reason none were.
 *
 * Narrower than {@link CustomNodeSweepResult}, which also carries the rewritten package — the
 * session has already installed that, and handing it back would invite a caller to install it
 * twice.
 */
export type CustomNodeSweepOutcome =
  | { readonly ok: true; readonly removed: readonly string[] }
  | { readonly ok: false; readonly reason: string };
