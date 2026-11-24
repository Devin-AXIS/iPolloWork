// Write chart edits into the package: a chart part's new `c:chartSpace`, an embedded
// workbook's new bytes, and a new chart with its part, workbook, relationships, and drawing.
// Each write goes through the package primitives that collaboration records, so a peer
// receives the same parts. DOM-free.

import type { OoxmlPackage } from '../ooxml-package.ts';
import { withPart } from '../ooxml-package.ts';
import type { OoxmlDrawingNode, OoxmlElement, OoxmlNode } from '../ooxml-tree.ts';
import { readOoxmlPart } from '../ooxml-tree.ts';
import { createNodeIdAllocator, replaceNode } from '../ooxml-edit.ts';
import { withNewPart, withRelationship, withRelationshipsPartFor } from '../package-edit.ts';
import { withBinaryPart } from '../drawing-package-edit.ts';
import { normalizePartName, partNameKey } from '../opc-names.ts';
import { partNumberCandidates } from '../actor-scoped-ids.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
} from '../ooxml-shared.ts';
import { CHART_GRAPHIC_DATA_URI } from '../chart-parts.ts';
import { CHART_RELATIONSHIP_TYPE } from './data.ts';
import {
  CHART_CONTENT_TYPE,
  PACKAGE_RELATIONSHIP_TYPE,
  XLSX_CONTENT_TYPE,
  checkNewChartData,
  newChartSpaceXml,
  newChartWorkbook,
  sampleChartData,
} from './insert.ts';
import { axisKindOf, isChartType } from './type.ts';
import { ChartRefusal, escapeXmlAttribute, type Element } from './tree.ts';
import type { ChartType, NewChartData } from './types.ts';

/**
 * `root` with a node id on every node: an edited node keeps the id of the node it continues,
 * the first time it appears; a new node, a parsed fragment, and a second copy get new ids
 * from the part's allocator.
 */
function withAssignedIds(
  root: Element,
  previous: OoxmlElement,
  nextId: () => string
): OoxmlElement {
  const known = new Set<string>();
  const walk = (node: OoxmlNode): void => {
    known.add(node.id);
    if (node.kind !== 'textValue') for (const kid of node.children) walk(kid);
  };
  walk(previous);
  const used = new Set<string>();
  const assign = (node: OoxmlNode, fresh: boolean): OoxmlNode => {
    const keep = !fresh && node.id !== '' && known.has(node.id) && !used.has(node.id);
    const id = keep ? node.id : nextId();
    used.add(id);
    if (node.kind === 'textValue') return id === node.id ? node : { ...node, id };
    const kids = node.children.map((kid) => assign(kid, !keep));
    const same = id === node.id && kids.every((kid, i) => kid === node.children[i]);
    return same ? node : ({ ...node, id, children: kids } as OoxmlElement);
  };
  // The root keeps its id, so the write is one edit of the part, not a new part.
  const kids = root.children.map((kid) => assign(kid, false));
  return { ...(root as unknown as OoxmlElement), id: previous.id, children: kids } as OoxmlElement;
}

/** The package with the chart part `part` holding `chartSpace`. Throws `ChartRefusal`. */
export function withChartSpace(pkg: OoxmlPackage, part: string, chartSpace: Element): OoxmlPackage {
  const current = pkg.parts.get(part);
  if (!current) throw new ChartRefusal('chart.errors.noChart');
  const root = withAssignedIds(chartSpace, current.root, createNodeIdAllocator(current));
  const replaced = replaceNode(current, current.root.id, root);
  if (!replaced.ok) throw new ChartRefusal('chart.errors.invalidText');
  return withPart(pkg, replaced.part);
}

/** The package with new bytes for the embedded workbook `part`. */
export const withChartWorkbook = (
  pkg: OoxmlPackage,
  part: string,
  bytes: Uint8Array
): OoxmlPackage => withBinaryPart(pkg, part, bytes, XLSX_CONTENT_TYPE);

/** The OPC-equivalent keys of every part name in the package, built once per name search. */
function presentPartKeys(pkg: OoxmlPackage): Set<string> {
  const keys = new Set<string>();
  for (const map of [pkg.parts, pkg.partBytes]) {
    for (const stored of map.keys()) {
      const normalized = normalizePartName(stored.startsWith('/') ? stored : `/${stored}`);
      if (normalized.ok) keys.add(partNameKey(normalized.partName));
    }
  }
  return keys;
}

/**
 * The first free part name `${stem}N${ext}`, in the actor's stripe under collaboration. A name
 * in `reserved` counts as taken, for parts that a write names before it adds them.
 */
export function freePartName(
  pkg: OoxmlPackage,
  stem: string,
  ext: string,
  actorId?: string,
  reserved?: ReadonlySet<string>
): string {
  const present = presentPartKeys(pkg);
  for (const n of partNumberCandidates(Number.MAX_SAFE_INTEGER, actorId)) {
    const name = `${stem}${n}${ext}`;
    const key = partNameKey(name);
    if (!reserved?.has(key) && !present.has(key)) return name;
  }
  throw new ChartRefusal('chart.errors.unsupported', 'partName');
}

/** The target of `part` relative to the folder of `owner`. */
export function relativeTarget(owner: string, part: string): string {
  const from = owner.split('/').slice(1, -1);
  const to = part.split('/').slice(1);
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/');
}

/** A new chart in the package, before its drawing goes into the story. */
export interface NewChart {
  readonly pkg: OoxmlPackage;
  /** The new chart part. */
  readonly chartPart: string;
  /** The new embedded workbook part. */
  readonly workbookPart: string;
  /** The relationship id of the chart part on the story part. */
  readonly relationshipId: string;
}

/**
 * The package with a new chart of `type` that the story part `owner` names: the chart part,
 * its embedded workbook, and both relationships. Without `data`, the chart gets sample data.
 * Throws `ChartRefusal`.
 */
export function withNewChart(
  pkg: OoxmlPackage,
  owner: string,
  type: ChartType,
  data: NewChartData | undefined,
  actorId?: string
): NewChart {
  if (!isChartType(type)) throw new ChartRefusal('chart.errors.unsupported', 'chartType');
  const xy = axisKindOf(type) === 'xy';
  const checked = checkNewChartData(data ?? sampleChartData(type), xy);
  const chartPart = freePartName(pkg, '/word/charts/chart', '.xml', actorId);
  const workbookPart = freePartName(pkg, '/word/embeddings/Workbook', '.xlsx', actorId);
  let next = withBinaryPart(pkg, workbookPart, newChartWorkbook(checked, xy), XLSX_CONTENT_TYPE);
  const book = withRelationship(
    withRelationshipsPartFor(next, chartPart),
    chartPart,
    PACKAGE_RELATIONSHIP_TYPE,
    relativeTarget(chartPart, workbookPart)
  );
  if (!book.ok) throw new ChartRefusal('chart.errors.unsupported', 'relationship');
  next = book.pkg;
  const read = readOoxmlPart(newChartSpaceXml(type, checked, book.relationshipId), {
    name: chartPart,
    contentType: CHART_CONTENT_TYPE,
  });
  if (!read.ok) throw new ChartRefusal('chart.errors.unsupported', 'template');
  const added = withNewPart(next, chartPart, read.part.root, CHART_CONTENT_TYPE);
  if (added === next) throw new ChartRefusal('chart.errors.unsupported', 'partName');
  const chart = withRelationship(
    withRelationshipsPartFor(added, owner),
    owner,
    CHART_RELATIONSHIP_TYPE,
    relativeTarget(owner, chartPart)
  );
  if (!chart.ok) throw new ChartRefusal('chart.errors.unsupported', 'relationship');
  return { pkg: chart.pkg, chartPart, workbookPart, relationshipId: chart.relationshipId };
}

/** One English point, in EMU. */
const EMU_PER_POINT = 12_700;

/** The inline `w:drawing` that shows a chart part, `cx` by `cy` points. */
export function buildInlineChartDrawing(input: {
  readonly docPrId: number;
  readonly relationshipId: string;
  readonly name: string;
  readonly widthPoints: number;
  readonly heightPoints: number;
}): OoxmlDrawingNode {
  const cx = Math.max(1, Math.round(input.widthPoints * EMU_PER_POINT));
  const cy = Math.max(1, Math.round(input.heightPoints * EMU_PER_POINT));
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP_NAMESPACE_URI}"` +
    ` xmlns:a="${DRAWINGML_MAIN_NAMESPACE_URI}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="${input.docPrId}" name="${escapeXmlAttribute(input.name)}"/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${CHART_GRAPHIC_DATA_URI}">` +
    `<c:chart xmlns:c="${CHART_GRAPHIC_DATA_URI}" xmlns:r="${RELATIONSHIPS_NAMESPACE_URI}"` +
    ` r:id="${escapeXmlAttribute(input.relationshipId)}"/>` +
    '</a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new ChartRefusal('chart.errors.unsupported', 'drawing');
  const find = (node: OoxmlNode): OoxmlDrawingNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'drawing') return node as OoxmlDrawingNode;
    for (const kid of node.children) {
      const found = find(kid);
      if (found) return found;
    }
    return null;
  };
  const drawing = find(parsed.part.root);
  if (!drawing) throw new ChartRefusal('chart.errors.unsupported', 'drawing');
  return drawing;
}
