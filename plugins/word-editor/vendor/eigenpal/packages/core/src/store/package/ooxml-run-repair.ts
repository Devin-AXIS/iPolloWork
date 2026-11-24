/**
 * A run the read could not type, rebuilt as the runs it shows.
 *
 * `CT_R` holds one `w:rPr`, first, then run content. Files break that shape in ways that
 * still show text: the properties after a saved `w:lastRenderedPageBreak` or after text, a
 * second `w:rPr`, a `w:t` with an element inside it, a `w:ins` or a `w:r` inside the run. Read as written,
 * the run was a generic node, and its text left the page.
 *
 * Run properties take effect where they stand and add to the ones before them in the same
 * run: content before the first `w:rPr` has none, and content after a later `w:rPr` has both,
 * the later winning where they set the same attribute. So the run splits at each `w:rPr`, and
 * each part carries the properties in effect for its content. Empty markers (a saved page
 * break, a bookmark) join the part after them. A `w:br` inside a `w:t` breaks the line, and
 * other elements inside it show nothing and stay inside a `w:t`. A `w:ins` inside the run becomes a tracked insertion
 * of its own beside the parts.
 *
 * A run that still fails its shape after this stays generic, as written.
 */
import { mergedPropertyList } from './ooxml-property-merge.ts';
import { CT_RPR_SEQUENCE } from './ooxml-property-order.ts';
import { WML_NAMESPACE_URI, isRangeMarkerKind, validKnownKind } from './ooxml-shared.ts';
import { knownKindAllowsWmlVal } from './ooxml-sdt.ts';
import { displayedText, ownXmlSpace } from './ooxml-text-space.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** Runs nested deeper than this inside one run stay as written. */
const MAX_NESTED_RUNS = 8;

/**
 * A run with more `w:rPr` elements than this, or whose parts would copy more property nodes
 * than `MAX_COPIED_NODES`, stays as written: each part carries every property in effect, so
 * the copies would grow with the square of the file.
 */
const MAX_RUN_PROPERTIES = 32;
const MAX_COPIED_NODES = 2048;

/** Nodes in `node`'s subtree, attributes included, counting no further than `limit`. */
function sizeOf(node: OoxmlNode, limit: number): number {
  if (node.kind === 'textValue') return 1;
  let size = 1 + node.attributes.length;
  for (const child of node.children) {
    if (size > limit) break;
    size += sizeOf(child, limit - size);
  }
  return size;
}

/** Childless WML markers that take no width and no properties. */
const EMPTY_MARKERS: ReadonlySet<string> = new Set([
  'lastRenderedPageBreak',
  'proofErr',
  'permStart',
  'permEnd',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd',
]);

/** Whether a child takes no width and no properties, so it may move past a properties element. */
export function isEmptyMarker(child: OoxmlNode): boolean {
  if (child.kind === 'textValue') return child.value.trim() === '';
  if (child.kind === 'bookmarkStart' || child.kind === 'bookmarkEnd') return true;
  if (isRangeMarkerKind(child.kind)) return true;
  return (
    child.kind === 'generic' &&
    child.namespaceUri === WML_NAMESPACE_URI &&
    EMPTY_MARKERS.has(child.localName) &&
    child.children.length === 0
  );
}

const isWml = (node: OoxmlNode, localName: string): boolean =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/** Whether the attributes a generic element carries would let it type as `kind`. */
export function attributesFitKind(kind: string, attributes: readonly OoxmlAttribute[]): boolean {
  return attributes.every((attribute) =>
    attribute.kind === 'wmlVal'
      ? knownKindAllowsWmlVal(kind)
      : !(
          attribute.namespaceUri === 'http://www.w3.org/XML/1998/namespace' &&
          attribute.localName === 'space' &&
          attribute.kind !== 'xmlSpace'
        )
  );
}

/** The node and everything under it as generic, so nothing in it shows or counts. */
function genericSubtree(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  return { ...node, kind: 'generic', children: node.children.map(genericSubtree) } as OoxmlNode;
}

/** A copy of `node` and its subtree with every id suffixed, so a copy never shares an id. */
function withSuffixedIds(node: OoxmlNode, suffix: string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: `${node.id}${suffix}` };
  return {
    ...node,
    id: `${node.id}${suffix}`,
    children: node.children.map((child) => withSuffixedIds(child, suffix)),
  } as OoxmlNode;
}

/**
 * A generic `w:t` or `w:delText` that holds elements, as typed text pieces between them. A
 * `w:br` among them is a break; any other element stays generic and shows nothing.
 */
function splitTextElement(node: OoxmlElement, rootPreserve: boolean): OoxmlNode[] | null {
  const kind = node.localName === 't' ? 'text' : 'deletedText';
  if (!attributesFitKind(kind, node.attributes)) return null;
  // Each piece reads back as a text element of its own, so each shows its white space alone.
  const preserve = ownXmlSpace(node.attributes) ?? rootPreserve;
  const pieces: OoxmlNode[] = [];
  let values: OoxmlNode[] = [];
  const flush = () => {
    if (values.length === 0) return;
    const id = pieces.length === 0 ? node.id : `${node.id}~${pieces.length}`;
    pieces.push({ ...node, id, kind, children: displayedText(values, preserve) } as OoxmlNode);
    values = [];
  };
  for (const child of node.children) {
    if (child.kind === 'textValue') {
      values.push(child);
      continue;
    }
    flush();
    if (
      isWml(child, 'br') &&
      child.children.length === 0 &&
      attributesFitKind('hardBreak', child.attributes)
    ) {
      pieces.push({ ...child, kind: 'hardBreak' } as OoxmlNode);
      continue;
    }
    // Any other element stays inside a text element of its own, where it shows nothing and a
    // save writes it back inside one. Beside the text, a `w:tab` would become a tab.
    pieces.push({
      ...node,
      id: pieces.length === 0 ? node.id : `${node.id}~${pieces.length}`,
      kind: 'generic',
      children: [genericSubtree(child)],
    } as OoxmlNode);
  }
  flush();
  return pieces;
}

interface Part {
  /** The `w:rPr` children in effect, or null before the run's first `w:rPr`. */
  readonly properties: readonly OoxmlNode[] | null;
  /** The single authored `w:rPr` those properties are, when no merge made them. */
  readonly source: OoxmlElement | null;
  readonly content: OoxmlNode[];
  /** A `w:ins` that wraps this part's run. */
  readonly insertion?: OoxmlElement;
}

/**
 * The runs a generic `w:r` shows, or null when it cannot type that way. `rootPreserve` is the
 * `xml:space` of the part's root.
 */
export function repairedRun(run: OoxmlElement, rootPreserve: boolean): OoxmlNode[] | null {
  if (!attributesFitKind('run', run.attributes)) return null;
  const parts: Part[] = [];
  let properties: readonly OoxmlNode[] | null = null;
  let source: OoxmlElement | null = null;
  let content: OoxmlNode[] = [];
  const close = (insertion?: OoxmlElement, inserted?: OoxmlNode[]) => {
    if (content.length > 0) parts.push({ properties, source, content });
    content = [];
    if (insertion && inserted) parts.push({ properties, source, content: inserted, insertion });
  };
  // Whether a `w:rPr` came after the last content, so it applies to nothing that follows.
  let trailing = false;
  // A run written inside the run shows as part of it: its properties add to the ones in effect
  // until it ends.
  const read = (nodes: readonly OoxmlNode[], depth: number): boolean => {
    // Counted per run: a nested run's properties end with it.
    let propertyCount = 0;
    for (const child of nodes) {
      if (depth < MAX_NESTED_RUNS && child.kind !== 'textValue' && isWml(child, 'r')) {
        const outer = { properties, source };
        if (!read(child.children, depth + 1)) return false;
        close();
        ({ properties, source } = outer);
        trailing = false;
        continue;
      }
      if (child.kind === 'runProperties') {
        if (++propertyCount > MAX_RUN_PROPERTIES) return false;
        close();
        source = properties === null ? child : null;
        properties = mergedPropertyList(properties ?? [], child.children, CT_RPR_SEQUENCE);
        trailing = true;
        continue;
      }
      if (child.kind === 'generic' && (isWml(child, 't') || isWml(child, 'delText'))) {
        const pieces = splitTextElement(child as OoxmlElement, rootPreserve);
        if (!pieces) return false;
        content.push(...pieces);
        trailing = false;
        continue;
      }
      if (
        child.kind === 'generic' &&
        isWml(child, 'ins') &&
        attributesFitKind('revisionInsert', child.attributes) &&
        (child as OoxmlElement).children.every((grand: OoxmlNode) => grand.kind !== 'run')
      ) {
        close(child as OoxmlElement, [...(child as OoxmlElement).children]);
        trailing = false;
        continue;
      }
      content.push(child);
      if (!isEmptyMarker(child)) trailing = false;
    }
    return true;
  };
  if (!read(run.children, 0)) return null;
  close();
  // Properties after the last content apply to nothing, but they are kept on an empty run.
  if (properties !== null && trailing) parts.push({ properties, source, content: [] });

  // Empty markers join the part after them, or the last part when nothing follows.
  const joined: Part[] = [];
  let held: OoxmlNode[] = [];
  for (const part of parts) {
    if (!part.insertion && part.content.length > 0 && part.content.every(isEmptyMarker)) {
      held.push(...part.content);
      continue;
    }
    joined.push(held.length > 0 ? { ...part, content: [...held, ...part.content] } : part);
    held = [];
  }
  if (held.length > 0) {
    const last = joined.pop();
    joined.push(
      last
        ? { ...last, content: [...last.content, ...held] }
        : { properties: null, source: null, content: held }
    );
  }

  // Count the property copies before making any.
  const sources = new Set<OoxmlElement>();
  let copied = 0;
  for (const part of joined) {
    if (part.properties === null) continue;
    if (part.source && !sources.has(part.source)) {
      sources.add(part.source);
      continue;
    }
    for (const child of part.properties) copied += sizeOf(child, MAX_COPIED_NODES);
    if (copied > MAX_COPIED_NODES) return null;
  }

  const used = new Set<OoxmlElement>();
  const runs = joined.map((part, index) => {
    const id = index === 0 ? run.id : `${run.id}~${index}`;
    let rPr: OoxmlNode | null = null;
    if (part.properties !== null) {
      if (part.source && !used.has(part.source)) {
        used.add(part.source);
        rPr = part.source;
      } else {
        rPr = {
          id: `${id}~rPr`,
          kind: 'runProperties',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'rPr',
          prefix: run.prefix,
          namespaceBindings: [],
          attributes: [],
          children: part.properties.map((child) => withSuffixedIds(child, `~${index}`)),
        } as unknown as OoxmlNode;
      }
    }
    const children = rPr ? [rPr, ...part.content] : part.content;
    const piece = { ...run, id, kind: 'run', children } as OoxmlElement;
    if (!part.insertion) return piece;
    return {
      ...part.insertion,
      kind: 'revisionInsert',
      children: [{ ...piece, id: `${part.insertion.id}~r` }],
    } as OoxmlElement;
  });
  const valid = runs.every((node) =>
    node.kind === 'revisionInsert'
      ? validKnownKind('revisionInsert', node.children) &&
        validKnownKind('run', (node.children[0] as OoxmlElement).children)
      : validKnownKind('run', node.children)
  );
  return valid && runs.length > 0 ? runs : null;
}
