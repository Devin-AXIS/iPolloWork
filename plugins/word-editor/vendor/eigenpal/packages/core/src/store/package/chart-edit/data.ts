// Read and replace the data, type, and elements of the chart behind a chart drawing. A chart
// `w:drawing` holds `c:chart` in its `a:graphicData`; its `r:id` names the chart part on the
// story part that holds the drawing (ECMA-376 Part 1, 21.2.2.27). An edit gives the new
// `c:chartSpace`, and the new bytes of an embedded workbook when its structure allows it; the
// package commit (`chart-package.ts`) writes both in one transaction. DOM-free.

import type { OoxmlPackage } from '../ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from '../ooxml-tree.ts';
import { internalPartRoot, relationshipAttribute } from '../package-part-links.ts';
import { resolveRelationship } from '../relationships.ts';
import { resolveContentTypeOf } from '../package-edit.ts';
import { CHART_NAMESPACE_URI } from '../chart-parts.ts';
import { readChartModel, type ChartModel } from './data-model.ts';
import { planChartEdit, rewriteChartSpace } from './data-write.ts';
import { readChartFormat } from './format.ts';
import { asChartElement, ChartRefusal, child, NS, plainAttr, type Element } from './tree.ts';
import type { ChartData, ChartDataRead, ChartFormatRead, ChartWorkbookState } from './types.ts';
import { chartWorkbook, updatedWorkbook, type ChartPackageView } from './workbook.ts';

/** The relationship type of a chart part. */
export const CHART_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';

/** The chart part behind one chart drawing. */
export interface ChartTarget {
  /** The story part that holds the drawing. */
  readonly ownerPart: string;
  /** The chart part. */
  readonly part: string;
  readonly chartSpace: Element;
}

/** How deep under a `w:drawing` the `c:chart` element is looked for. */
const MAX_CHART_DEPTH = 12;

/** The `c:chart` element under a drawing, or null. */
export function chartElementOf(drawing: OoxmlNode): OoxmlElement | null {
  const walk = (node: OoxmlNode, depth: number): OoxmlElement | null => {
    if (node.kind === 'textValue' || depth > MAX_CHART_DEPTH) return null;
    if (node.namespaceUri === CHART_NAMESPACE_URI && node.localName === 'chart') return node;
    for (const kid of node.children) {
      const found = walk(kid, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(drawing, 0);
}

/** The chart part that a chart drawing of `ownerPart` shows, or null. */
export function chartTargetOf(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawing: OoxmlNode
): ChartTarget | null {
  const chart = chartElementOf(drawing);
  const id = chart ? relationshipAttribute(chart, 'id') : undefined;
  if (!id) return null;
  const part = internalPartRoot(pkg, ownerPart, id, CHART_RELATIONSHIP_TYPE);
  if (!part || part.root.namespaceUri !== NS.c || part.root.localName !== 'chartSpace') return null;
  return { ownerPart, part: part.partName, chartSpace: asChartElement(part.root) };
}

/** The bytes of a binary part, stored with or without its leading slash. */
export function binaryPartBytes(pkg: OoxmlPackage, part: string): Uint8Array | undefined {
  const lower = part.toLowerCase();
  for (const [name, bytes] of pkg.partBytes) {
    const canonical = (name.startsWith('/') ? name : `/${name}`).toLowerCase();
    if (canonical === lower) return bytes;
  }
  return undefined;
}

/** What the workbook code reads from the package around the chart part `part`. */
export function chartPackageView(pkg: OoxmlPackage, part: string): ChartPackageView {
  return {
    relationship(id) {
      const record = (pkg.relationships.get(part) ?? []).find((r) => r.id === id);
      if (!record) return undefined;
      if (record.targetMode === 'External') return { type: record.type, external: true };
      const resolved = resolveRelationship(record);
      const target =
        resolved.mode === 'Internal' && resolved.target.ok ? resolved.target.partName : undefined;
      return { type: record.type, external: false, ...(target ? { target } : {}) };
    },
    contentType: (name) => resolveContentTypeOf(pkg, name) ?? undefined,
    bytes: (name) => binaryPartBytes(pkg, name),
  };
}

/** The data of a read chart, in plot order, with each item's position as its source. */
function dataOf(model: ChartModel): Omit<ChartData, 'workbook'> {
  return {
    kind: model.kind,
    categories: model.categories.map((label, source) => ({ label, source })),
    series: model.series.map((s, source) => ({
      name: s.name,
      values: model.categories.map((_, i) => {
        const v = s.val?.values[i];
        const n = v === undefined || v.trim() === '' ? NaN : Number(v);
        return Number.isFinite(n) ? n : null;
      }),
      source,
    })),
  };
}

/** Where the chart's workbook is, and whether an edit can write it: a dry run of the edit. */
function workbookState(view: ChartPackageView, target: ChartTarget, model: ChartModel) {
  const book = chartWorkbook(view, target.chartSpace);
  if (book.state !== 'embedded') return book.state;
  const bytes = book.part ? view.bytes(book.part) : undefined;
  if (!bytes || !model.layout) return 'kept' satisfies ChartWorkbookState;
  try {
    const plan = planChartEdit(model, dataOf(model));
    return updatedWorkbook(bytes, plan, model.layout) ? 'embedded' : 'kept';
  } catch {
    return 'kept';
  }
}

/** The data of a chart, or why it cannot be edited. */
export function readChartData(pkg: OoxmlPackage, target: ChartTarget): ChartDataRead {
  const read = readChartModel(target.chartSpace);
  if (!read.ok) return read;
  const view = chartPackageView(pkg, target.part);
  return {
    ok: true,
    data: { ...dataOf(read.model), workbook: workbookState(view, target, read.model) },
  };
}

/** The type and elements of a chart, or why the editor does not edit them. */
export const readChartFormatOf = (target: ChartTarget): ChartFormatRead =>
  readChartFormat(target.chartSpace);

/** Whether the chart's data can be edited, and why not. Reads no workbook. */
export function chartEditable(target: ChartTarget): {
  readonly editable: boolean;
  readonly reason?: string;
} {
  const read = readChartModel(target.chartSpace);
  return read.ok ? { editable: true } : { editable: false, reason: read.reason };
}

/** `c:externalData` with its automatic update turned off (`c:autoUpdate val="0"`). */
function withoutAutoUpdate(chartSpace: Element): Element {
  const ext = child(chartSpace, 'c:externalData');
  if (!ext) return chartSpace;
  const off: Element = {
    id: '',
    kind: 'generic',
    namespaceUri: NS.c,
    localName: 'autoUpdate',
    prefix: 'c',
    namespaceBindings: [],
    attributes: [plainAttr('val', '0')],
    children: [],
  };
  const has = ext.children.some((k) => k.kind !== 'textValue' && k.localName === 'autoUpdate');
  const next: Element = {
    ...ext,
    children: has
      ? ext.children.map((k) => (k.kind !== 'textValue' && k.localName === 'autoUpdate' ? off : k))
      : [off, ...ext.children],
  };
  return { ...chartSpace, children: chartSpace.children.map((k) => (k === ext ? next : k)) };
}

/** A chart edit: the new chart part, and the new bytes of its embedded workbook. */
export interface ChartEdit {
  readonly chartSpace: Element;
  readonly workbook?: { readonly part: string; readonly bytes: Uint8Array };
}

/**
 * The chart part and workbook after a data edit (`setChartData`). Throws `ChartRefusal` when
 * the chart's data cannot be edited or the new data is not valid.
 */
export function chartDataEdit(
  pkg: OoxmlPackage,
  target: ChartTarget,
  data: Omit<ChartData, 'workbook'>
): ChartEdit {
  const read = readChartModel(target.chartSpace);
  if (!read.ok) throw new ChartRefusal(read.reason);
  const plan = planChartEdit(read.model, data);
  let chartSpace = rewriteChartSpace(target.chartSpace, plan);
  const view = chartPackageView(pkg, target.part);
  const book = chartWorkbook(view, target.chartSpace);
  // A linked workbook is never opened: its automatic update would bring the old values back.
  if (book.state === 'external') chartSpace = withoutAutoUpdate(chartSpace);
  if (book.state === 'embedded' && book.part && read.model.layout) {
    const bytes = view.bytes(book.part);
    const next = bytes ? updatedWorkbook(bytes, plan, read.model.layout) : undefined;
    if (next) return { chartSpace, workbook: { part: book.part, bytes: next } };
    // The workbook took the chart's data before this edit: refuse an edit it cannot take, so
    // the chart and its workbook never part in silence.
    if (workbookState(view, target, read.model) === 'embedded')
      throw new ChartRefusal('chart.errors.workbook');
  }
  return { chartSpace };
}
