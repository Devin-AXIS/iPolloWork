// A copy of a chart for a paste: the chart part and the parts it reaches through internal
// relationships (the embedded workbook, the style and color parts, a drawing of shapes on the
// chart), each under a free name, and a drawing that names the copy. The copy shares nothing
// with its source, so an edit of one never changes the other. Binary parts copy byte for byte;
// XML parts are read again under their new names, with each relationship id rewritten to the
// id the copy's relationship got. Each write goes through the package primitives that
// collaboration records. DOM-free.

import type { OoxmlPackage } from '../ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from '../ooxml-tree.ts';
import { readOoxmlPart } from '../ooxml-tree.ts';
import { serializeOoxmlPart } from '../ooxml-serialize.ts';
import {
  resolveContentTypeOf,
  withNewPart,
  withRelationship,
  withRelationshipsPartFor,
} from '../package-edit.ts';
import { withBinaryPart } from '../drawing-package-edit.ts';
import { resolveRelationship } from '../relationships.ts';
import { partNameKey } from '../opc-names.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  WP_NAMESPACE_URI,
} from '../ooxml-shared.ts';
import { CHART_NAMESPACE_URI } from '../chart-parts.ts';
import { binaryPartBytes, chartElementOf, CHART_RELATIONSHIP_TYPE } from './data.ts';
import { freePartName, relativeTarget } from './package.ts';
import { ChartRefusal } from './tree.ts';

/** The most parts one chart copy writes: the chart part and what it reaches. */
export const MAX_CHART_COPY_PARTS = 16;
/** How many relationship steps from the chart part a copy follows. */
const MAX_CHART_COPY_DEPTH = 3;

/** A copied chart in the package, before its drawing goes into the story. */
export interface DuplicatedChart {
  readonly pkg: OoxmlPackage;
  /** The new chart part. */
  readonly chartPart: string;
  /** Every new part, the chart part first. */
  readonly parts: readonly string[];
  /** The relationship id of the new chart part on the story part. */
  readonly relationshipId: string;
}

/** `name` as a stem, its trailing number dropped, and its extension. */
function stemOf(name: string): { stem: string; ext: string } {
  const slash = name.lastIndexOf('/');
  const dot = name.lastIndexOf('.');
  const ext = dot > slash ? name.slice(dot) : '';
  const base = name.slice(0, name.length - ext.length).replace(/\d+$/, '');
  return { stem: base, ext };
}

/** The canonical part name a relationship of `owner` points at, or null for an external one. */
function internalTargetOf(
  pkg: OoxmlPackage,
  owner: string,
  id: string
): { type: string; partName: string } | 'external' | null {
  const record = (pkg.relationships.get(owner) ?? []).find((r) => r.id === id);
  if (!record) return null;
  if (record.targetMode === 'External') return 'external';
  const resolved = resolveRelationship(record);
  return resolved.mode === 'Internal' && resolved.target.ok
    ? { type: record.type, partName: resolved.target.partName }
    : null;
}

/** The XML part of the package named `name`, matched as OPC names match. */
function xmlPartOf(pkg: OoxmlPackage, name: string) {
  const direct = pkg.parts.get(name);
  if (direct) return direct;
  const key = partNameKey(name);
  for (const [stored, part] of pkg.parts) {
    if (partNameKey(stored.startsWith('/') ? stored : `/${stored}`) === key) return part;
  }
  return undefined;
}

/**
 * `root` with each relationship id rewritten through `ids`. A `c:externalData` that names an
 * external workbook goes: the copy keeps the cached values and links to nothing. Any other
 * reference to a relationship the copy does not carry refuses the copy.
 */
function withRelationshipIds(
  root: OoxmlElement,
  ids: ReadonlyMap<string, string>,
  dropped: ReadonlySet<string>
): OoxmlElement {
  const walk = (node: OoxmlElement): OoxmlElement | null => {
    let changed = false;
    const attributes = node.attributes.map((attribute) => {
      if (attribute.namespaceUri !== RELATIONSHIPS_NAMESPACE_URI) return attribute;
      const next = ids.get(attribute.value);
      if (next !== undefined) {
        changed = true;
        return { ...attribute, value: next };
      }
      return attribute;
    });
    const unresolved = node.attributes.some(
      (a) => a.namespaceUri === RELATIONSHIPS_NAMESPACE_URI && dropped.has(a.value)
    );
    if (unresolved) {
      if (node.namespaceUri === CHART_NAMESPACE_URI && node.localName === 'externalData')
        return null;
      throw new ChartRefusal('chart.errors.unsupported', 'externalRelationship');
    }
    const children: OoxmlNode[] = [];
    for (const child of node.children) {
      if (child.kind === 'textValue') {
        children.push(child);
        continue;
      }
      const next = walk(child);
      if (next !== child) changed = true;
      if (next) children.push(next);
    }
    return changed ? ({ ...node, attributes, children } as OoxmlElement) : node;
  };
  const next = walk(root);
  if (!next) throw new ChartRefusal('chart.errors.unsupported', 'externalRelationship');
  return next;
}

/**
 * The package `target` with a copy of the chart part that `sourceChartPart` of `source` names,
 * and of each part it reaches, and a relationship from the story part `owner` to the copy.
 * Throws `ChartRefusal`.
 */
export function withDuplicatedChart(
  target: OoxmlPackage,
  owner: string,
  source: OoxmlPackage,
  sourceChartPart: string,
  actorId?: string
): DuplicatedChart {
  let next = target;
  const copies = new Map<string, string>();
  const reserved = new Set<string>();
  const order: string[] = [];

  const copyPart = (name: string, depth: number): string => {
    const known = copies.get(partNameKey(name));
    if (known) return known;
    if (depth > MAX_CHART_COPY_DEPTH || copies.size >= MAX_CHART_COPY_PARTS)
      throw new ChartRefusal('chart.errors.unsupported', 'parts');
    const contentType = resolveContentTypeOf(source, name);
    if (!contentType) throw new ChartRefusal('chart.errors.unsupported', 'contentType');
    const { stem, ext } = stemOf(name);
    const copy = freePartName(next, stem, ext, actorId, reserved);
    copies.set(partNameKey(name), copy);
    reserved.add(partNameKey(copy));
    order.push(copy);
    const relationships = source.relationships.get(name) ?? [];
    const part = xmlPartOf(source, name);
    if (!part) {
      // Binary bytes cannot have their relationship ids rewritten, so they must name none.
      const bytes = binaryPartBytes(source, name);
      if (!bytes || relationships.length > 0)
        throw new ChartRefusal('chart.errors.unsupported', 'part');
      next = withBinaryPart(next, copy, bytes, contentType);
      return copy;
    }
    const ids = new Map<string, string>();
    const dropped = new Set<string>();
    for (const record of relationships) {
      const resolved = internalTargetOf(source, name, record.id);
      if (resolved === 'external' || resolved === null) {
        dropped.add(record.id);
        continue;
      }
      const child = copyPart(resolved.partName, depth + 1);
      const added = withRelationship(
        withRelationshipsPartFor(next, copy),
        copy,
        resolved.type,
        relativeTarget(copy, child)
      );
      if (!added.ok) throw new ChartRefusal('chart.errors.unsupported', 'relationship');
      next = added.pkg;
      ids.set(record.id, added.relationshipId);
    }
    // Read again under the new name, so the copy's nodes are the new part's own.
    const read = readOoxmlPart(serializeOoxmlPart(part), { name: copy, contentType });
    if (!read.ok) throw new ChartRefusal('chart.errors.unsupported', 'part');
    const root = withRelationshipIds(read.part.root, ids, dropped);
    const added = withNewPart(next, copy, root, contentType);
    if (added === next) throw new ChartRefusal('chart.errors.unsupported', 'partName');
    next = added;
    return copy;
  };

  const chartPart = copyPart(sourceChartPart, 0);
  const linked = withRelationship(
    withRelationshipsPartFor(next, owner),
    owner,
    CHART_RELATIONSHIP_TYPE,
    relativeTarget(owner, chartPart)
  );
  if (!linked.ok) throw new ChartRefusal('chart.errors.unsupported', 'relationship');
  return { pkg: linked.pkg, chartPart, parts: order, relationshipId: linked.relationshipId };
}

/**
 * A copy of the chart drawing `drawing` that names the chart relationship `relationshipId`
 * and carries the drawing property id `docPrId`. Its node ids are the source's; the store
 * gives the inserted drawing new ones. A hyperlink on the drawing goes, because its
 * relationship belongs to the source story. Throws `ChartRefusal`.
 */
export function duplicatedChartDrawing<T extends OoxmlNode>(
  drawing: T,
  relationshipId: string,
  docPrId: number
): T {
  if (!chartElementOf(drawing)) throw new ChartRefusal('chart.errors.noChart');
  let named = false;
  const walk = (node: OoxmlElement): OoxmlElement | null => {
    if (
      node.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      (node.localName === 'hlinkClick' || node.localName === 'hlinkHover')
    )
      return null;
    const chart = node.namespaceUri === CHART_NAMESPACE_URI && node.localName === 'chart';
    const docPr = node.namespaceUri === WP_NAMESPACE_URI && node.localName === 'docPr';
    const attributes = node.attributes.map((attribute) => {
      if (chart && attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI) {
        if (attribute.localName !== 'id') return attribute;
        named = true;
        return { ...attribute, value: relationshipId };
      }
      if (attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI)
        throw new ChartRefusal('chart.errors.unsupported', 'relationship');
      if (docPr && attribute.namespaceUri === '' && attribute.localName === 'id')
        return { ...attribute, value: String(docPrId) };
      return attribute;
    });
    const children: OoxmlNode[] = [];
    for (const child of node.children) {
      if (child.kind === 'textValue') children.push(child);
      else {
        const kept = walk(child);
        if (kept) children.push(kept);
      }
    }
    return { ...node, attributes, children } as OoxmlElement;
  };
  if (drawing.kind === 'textValue') throw new ChartRefusal('chart.errors.noChart');
  const copy = walk(drawing as unknown as OoxmlElement);
  if (!copy || !named) throw new ChartRefusal('chart.errors.noChart');
  return copy as unknown as T;
}
