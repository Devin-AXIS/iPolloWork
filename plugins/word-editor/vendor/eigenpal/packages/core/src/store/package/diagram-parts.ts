// The package parts behind one SmartArt drawing.
//
// A diagram `a:graphicData` holds `dgm:relIds`, whose `r:dm` names the data model part. The
// data model carries a Microsoft extension, `dsp:dataModelExt/@relId`, that names the saved
// drawing part: the shapes Office last laid out. Office writes that relationship on the STORY
// part (the part holding the `w:drawing`), not on the data part, so it resolves there first.
// Only parsed internal parts resolve; external targets never load.
//
// `r:lo`, `r:qs` and `r:cs` name the layout, quick style and colour parts. They matter only
// when the saved drawing is missing: the layout engine then draws the diagram from them.

import {
  CHART_NAMESPACE_URI,
  createChartPartResolver,
  type ChartPartResolver,
} from './chart-parts.ts';
import {
  CHART_STYLE_NAMESPACE_URI,
  CHARTEX_NAMESPACE_URI,
  createChartexPartResolver,
  type ChartexPartResolver,
} from './chartex-parts.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import { internalPartRoot, relationshipAttribute } from './package-part-links.ts';
import { collectThemeSchemeFaces } from './theme-font-scheme.ts';
import { packageThemeRoot } from './theme-color-resolution.ts';

export const DIAGRAM_GRAPHIC_DATA_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
/** @internal */
export const DIAGRAM_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
export const DIAGRAM_DRAWING_NAMESPACE_URI =
  'http://schemas.microsoft.com/office/drawing/2008/diagram';

const DATA_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData';
const DRAWING_RELATIONSHIP_TYPE =
  'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing';
const LAYOUT_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout';
const STYLE_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle';
const COLORS_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors';

/** The parts one diagram drawing renders from. @internal */
export interface DiagramParts {
  /** The data model root (`dgm:dataModel`): background and outline of the whole diagram. */
  readonly dataModel: OoxmlElement;
  /** The saved drawing root (`dsp:drawing`), or null when the package has none. */
  readonly drawing: OoxmlElement | null;
  /** Canonical name of the saved drawing part, for diagnostics and cache keys. */
  readonly drawingPartName: string | null;
  /** Canonical name of the data model part. */
  readonly dataPartName: string;
  /** The layout definition root (`dgm:layoutDef`), or null. */
  readonly layoutDef: OoxmlElement | null;
  /** The quick style root (`dgm:styleDef`), or null. */
  readonly styleDef: OoxmlElement | null;
  /** The colours root (`dgm:colorsDef`), or null. */
  readonly colorsDef: OoxmlElement | null;
  /** The theme's body (minor) Latin font, which diagram text uses unless it names one. */
  readonly fontFamily: string;
}

/**
 * Resolves the parts behind one `dgm:relIds` element of the owner story part. The same
 * resolver answers the chart part behind a `c:chart` element through `chart`, so the drawing
 * projection threads one resolver for every part-backed graphic.
 *
 * @internal
 */
export interface DiagramPartResolver {
  /** The diagram parts behind one `dgm:relIds` element, or null when they do not resolve. */
  (relIds: OoxmlElement): DiagramParts | null;
  /** The chart part behind one `c:chart` element of the same story part. */
  readonly chart?: ChartPartResolver;
  /** The chartex part behind one `cx:chart` element of the same story part. */
  readonly chartex?: ChartexPartResolver;
}

/** `dsp:dataModelExt/@relId` under the data model's `dgm:extLst/a:ext`. */
function drawingRelationshipId(dataModel: OoxmlElement): string | null {
  const extLst = findDirectChild(dataModel.children, {
    namespaceUri: DIAGRAM_NAMESPACE_URI,
    localName: 'extLst',
  });
  if (!extLst) return null;
  for (const ext of extLst.children) {
    if (!isElement(ext)) continue;
    const modelExt = findDirectChild(ext.children, {
      namespaceUri: DIAGRAM_DRAWING_NAMESPACE_URI,
      localName: 'dataModelExt',
    });
    const relId = modelExt ? schemaAttributeValue(modelExt.attributes, 'relId') : undefined;
    if (relId) return relId;
  }
  return null;
}

const RESOLVERS = new WeakMap<OoxmlPackage, Map<string, DiagramPartResolver>>();

/**
 * A resolver for the diagrams of one story part. Resolution only reads parsed parts, so the
 * result is cached per `dgm:relIds` element: the package and its diagram parts are immutable.
 */
export function createDiagramPartResolver(
  pkg: OoxmlPackage,
  ownerPartName: string
): DiagramPartResolver {
  let byOwner = RESOLVERS.get(pkg);
  if (!byOwner) {
    byOwner = new Map();
    RESOLVERS.set(pkg, byOwner);
  }
  const cached = byOwner.get(ownerPartName);
  if (cached) return cached;
  const results = new WeakMap<OoxmlElement, DiagramParts | null>();
  const resolveDiagram = (relIds: OoxmlElement): DiagramParts | null => {
    if (results.has(relIds)) return results.get(relIds)!;
    const result = resolveDiagramParts(pkg, ownerPartName, relIds);
    results.set(relIds, result);
    return result;
  };
  const resolver: DiagramPartResolver = Object.assign(resolveDiagram, {
    chart: createChartPartResolver(pkg, ownerPartName),
    chartex: createChartexPartResolver(pkg, ownerPartName),
  });
  byOwner.set(ownerPartName, resolver);
  return resolver;
}

function resolveDiagramParts(
  pkg: OoxmlPackage,
  ownerPartName: string,
  relIds: OoxmlElement
): DiagramParts | null {
  if (relIds.namespaceUri !== DIAGRAM_NAMESPACE_URI || relIds.localName !== 'relIds') return null;
  const dataId = relationshipAttribute(relIds, 'dm');
  if (!dataId) return null;
  const data = internalPartRoot(pkg, ownerPartName, dataId, DATA_RELATIONSHIP_TYPE);
  if (!data || data.root.namespaceUri !== DIAGRAM_NAMESPACE_URI) return null;
  if (data.root.localName !== 'dataModel') return null;
  const drawingId = drawingRelationshipId(data.root);
  const drawing = drawingId
    ? (internalPartRoot(pkg, ownerPartName, drawingId, DRAWING_RELATIONSHIP_TYPE) ??
      internalPartRoot(pkg, data.partName, drawingId, DRAWING_RELATIONSHIP_TYPE))
    : null;
  const valid =
    drawing !== null &&
    drawing.root.namespaceUri === DIAGRAM_DRAWING_NAMESPACE_URI &&
    drawing.root.localName === 'drawing';
  const definition = (name: string, type: string, localName: string) => {
    const id = relationshipAttribute(relIds, name);
    const part = id ? internalPartRoot(pkg, ownerPartName, id, type) : null;
    const root = part?.root;
    return root && root.namespaceUri === DIAGRAM_NAMESPACE_URI && root.localName === localName
      ? root
      : null;
  };
  return {
    dataModel: data.root,
    drawing: valid ? drawing.root : null,
    drawingPartName: valid ? drawing.partName : null,
    dataPartName: data.partName,
    layoutDef: definition('lo', LAYOUT_RELATIONSHIP_TYPE, 'layoutDef'),
    styleDef: definition('qs', STYLE_RELATIONSHIP_TYPE, 'styleDef'),
    colorsDef: definition('cs', COLORS_RELATIONSHIP_TYPE, 'colorsDef'),
    fontFamily: collectThemeSchemeFaces(packageThemeRoot(pkg)).minor ?? 'Calibri',
  };
}

const partIds = new WeakMap<OoxmlElement, number>();
let nextPartId = 1;

/**
 * The identity of every diagram part (data model, layout, style, colors, saved drawing),
 * chart part, chartex part and chart style part in a package. Layout reuses drawing projections while the story part is
 * unchanged; a changed diagram or chart part must invalidate them too.
 */
export function diagramPartsToken(pkg: OoxmlPackage): string {
  const ids: number[] = [];
  // These parts are recognised by their root, wherever a relationship places them.
  for (const part of pkg.parts.values()) {
    const root = part.root;
    if (
      root.namespaceUri !== DIAGRAM_NAMESPACE_URI &&
      root.namespaceUri !== DIAGRAM_DRAWING_NAMESPACE_URI &&
      root.namespaceUri !== CHART_NAMESPACE_URI &&
      root.namespaceUri !== CHARTEX_NAMESPACE_URI &&
      root.namespaceUri !== CHART_STYLE_NAMESPACE_URI
    )
      continue;
    let id = partIds.get(part.root);
    if (id === undefined) {
      id = nextPartId++;
      partIds.set(part.root, id);
    }
    ids.push(id);
  }
  return ids.join(',');
}
