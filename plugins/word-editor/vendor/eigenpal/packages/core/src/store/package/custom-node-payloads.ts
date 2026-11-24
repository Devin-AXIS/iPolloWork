// The link between a control in the body and its payload in the store, read in both directions.
//
// `custom-xml-part.ts` owns the PART, `custom-xml-nodes.ts` owns the NODES inside it. This owns
// the `w:dataBinding` that ties one to the other: what to write when a node is authored, and how
// to read a binding back to the node id it names — which is what the sweep and the export path
// both need, because neither can ask a host which controls exist.
//
// ONE PREFIX, ALWAYS THE SAME. `w:xpath` steps resolve through `w:prefixMappings`, so the prefix
// is private to the binding and nothing outside it can observe the choice. Fixing it means the
// binding a document carries is a pure function of the node it names, so re-authoring the same
// node produces the same bytes.
//
// SECURITY: a binding read back here came from a file the sender wrote. The xpath is matched
// against the ONE shape this library authors and anything else is ignored — never evaluated,
// never resolved, never used to reach a part. A sender that writes their own xpath gets a
// control this engine treats as bound and does not sweep, which is the fail-closed answer: a
// payload nothing recognizes is left alone rather than deleted.

import { contentControlPropertiesOf, contentControlsIn } from './content-control-nodes.ts';
import { isValidXmlText } from './sinks.ts';
import { customXmlLabelXPath, customXmlPrefixMappings } from './custom-xml-nodes.ts';
import type { CustomXmlDataPart } from './custom-xml-part.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { isStoryPart } from './story-blocks.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

/** The prefix every binding this library authors declares and quotes. */
export const CUSTOM_NODE_XPATH_PREFIX = 'ns0';

/**
 * The one xpath shape this library authors, so a binding can be read back to its node id.
 *
 * Anchored, with a back-reference on the prefix: a foreign xpath that merely looks similar does
 * not match, and the id it would have yielded is not one this engine acts on.
 */
const AUTHORED_XPATH =
  /^\/([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)\/\1:node\[@id='([A-Za-z_][\w.-]{0,127})'\]\/\1:label$/;

/** The three attributes a `w:dataBinding` carries. */
export interface CustomNodeBinding {
  readonly prefixMappings: string;
  readonly xpath: string;
  readonly storeItemId: string;
}

/**
 * The binding for one node in one store, or null when the id cannot be addressed by an XPath.
 *
 * Refuses rather than escapes: XPath 1.0 has no escape for a quote inside a literal, so an id
 * carrying one could close the predicate and append an expression of the sender's choosing.
 * The ids are minted by a host, so refusing is honest — see `ADDRESSABLE_ID`.
 */
export function customNodeBinding(
  part: CustomXmlDataPart,
  rootLocalName: string,
  nodeId: string
): CustomNodeBinding | null {
  const xpath = customXmlLabelXPath(CUSTOM_NODE_XPATH_PREFIX, rootLocalName, nodeId);
  const prefixMappings = customXmlPrefixMappings(CUSTOM_NODE_XPATH_PREFIX, part.namespaceUri);
  if (xpath === null || prefixMappings === null) return null;
  return { prefixMappings, xpath, storeItemId: part.itemId };
}

/**
 * Longest `w:prefixMappings`, `w:xpath` or `w:storeItemID` an op may write.
 *
 * A binding is authored by this engine, never copied out of a file, so this is a bound on a
 * caller's mistake rather than on an attacker: the three strings go straight into attributes,
 * and an unbounded one would make the control's properties larger than its document.
 */
export const MAX_DATA_BINDING_ATTRIBUTE_LENGTH = 2_048;

/**
 * Whether a `w:dataBinding` is one this engine will author.
 *
 * ALL THREE OR NONE. Word needs the store id to find the part, the xpath to find the node in
 * it, and the prefix mappings to resolve that xpath's steps; a binding missing any of them
 * resolves to nothing, and Word then paints the control's own content and quietly stops
 * mirroring the store — which is the drift the payload lane exists to make impossible.
 *
 * The control characters are refused rather than escaped, exactly as `authorableHyperlinkTarget`
 * refuses them: XML 1.0 cannot represent them in an attribute value at all, so a document
 * carrying one is one Word refuses to open.
 */
export function isAuthorableDataBinding(binding: unknown): boolean {
  if (typeof binding !== 'object' || binding === null) return false;
  const parts = binding as {
    readonly prefixMappings?: unknown;
    readonly xpath?: unknown;
    readonly storeItemId?: unknown;
  };
  for (const value of [parts.prefixMappings, parts.xpath, parts.storeItemId]) {
    if (typeof value !== 'string') return false;
    if (value.length === 0 || value.length > MAX_DATA_BINDING_ATTRIBUTE_LENGTH) return false;
    if (!isValidXmlText(value)) return false;
  }
  return true;
}

/** `{ABC-…}` and `abc-…` name one store. Word compares them the same way. */
function sameStore(left: string, right: string): boolean {
  const bare = (value: string): string => value.replace(/^\{|\}$/g, '').toUpperCase();
  return bare(left) === bare(right);
}

/**
 * Every node id the story's controls bind to in one store, in document order.
 *
 * This is the input the orphan sweep takes: a node whose id is not in here is one no control
 * names, whether it was deleted in this editor or in Word. Reading it from the STORY rather than
 * from a host's bookkeeping is what makes the two cases one mechanism.
 */
export function boundCustomXmlNodeIds(part: OoxmlPart, storeItemId: string): Set<string> {
  const found = new Set<string>();
  for (const entry of contentControlsIn(part.root)) {
    const id = boundCustomXmlNodeIdOf(entry.node, storeItemId);
    if (id !== null) found.add(id);
  }
  return found;
}

/**
 * Every node id ANY story in the package binds, in one store.
 *
 * THE WHOLE PACKAGE, not one story. A payload is reachable from a header as easily as from the
 * body — Word enumerates its data store from the main part, but nothing stops a control
 * elsewhere quoting the same `w:storeItemID` — and the two callers that decide what is an orphan
 * both destroy data when they are wrong. The sweep would collect a payload a header still paints;
 * the export would strip a store a header still names, which is a document Word offers to repair.
 *
 * Costs one walk per story per store, on open and on export. Neither is a keystroke.
 */
export function boundCustomXmlNodeIdsInPackage(
  pkg: OoxmlPackage,
  storeItemId: string
): Set<string> {
  const found = new Set<string>();
  for (const part of pkg.parts.values()) {
    if (!isStoryPart(part)) continue;
    for (const id of boundCustomXmlNodeIds(part, storeItemId)) found.add(id);
  }
  return found;
}

/** The node id one control binds to in the named store, or null when it binds to nothing there. */
export function boundCustomXmlNodeIdOf(control: OoxmlNode, storeItemId: string): string | null {
  const binding = contentControlPropertiesOf(control).dataBinding;
  if (!binding?.xpath || !binding.storeItemID) return null;
  if (!sameStore(binding.storeItemID, storeItemId)) return null;
  const match = AUTHORED_XPATH.exec(binding.xpath);
  return match?.[3] ?? null;
}
