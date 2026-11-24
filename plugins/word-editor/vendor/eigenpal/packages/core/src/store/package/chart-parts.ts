// The chart part behind one chart drawing.
//
// A chart `a:graphicData` holds `c:chart`, whose `r:id` names the chart part (`c:chartSpace`)
// on the story part that holds the `w:drawing`. The chart part may name an embedded workbook
// or an external data source; neither is ever read: a chart renders from the values cached in
// its own XML (`c:numCache`, `c:strCache`).

import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import { internalPartRoot, relationshipAttribute } from './package-part-links.ts';
import { collectThemeSchemeFaces } from './theme-font-scheme.ts';
import { packageThemeRoot } from './theme-color-resolution.ts';

/** @internal */
export const CHART_GRAPHIC_DATA_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
/** @internal */
export const CHART_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

const CHART_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';

/** One resolved chart part. @internal */
export interface ChartPart {
  /** The `c:chartSpace` root. */
  readonly chartSpace: OoxmlElement;
  /** Canonical part name, for story ids and diagnostics. */
  readonly partName: string;
  /** The theme's Latin heading and body faces, which chart text takes through tokens. */
  readonly themeFaces: ChartThemeFaces;
}

/** @internal */
export interface ChartThemeFaces {
  readonly major: string | null;
  readonly minor: string | null;
}

/** Resolves the chart part behind one `c:chart` element of the owner story part. @internal */
export type ChartPartResolver = (chart: OoxmlElement) => ChartPart | null;

/**
 * A resolver for the charts of one story part. Resolution only reads parsed parts, so the
 * result is cached per `c:chart` element: the package and its parts are immutable.
 */
export function createChartPartResolver(
  pkg: OoxmlPackage,
  ownerPartName: string
): ChartPartResolver {
  const results = new WeakMap<OoxmlElement, ChartPart | null>();
  let themeFaces: ChartThemeFaces | null = null;
  return (chart) => {
    if (results.has(chart)) return results.get(chart)!;
    if (!themeFaces) {
      const faces = collectThemeSchemeFaces(packageThemeRoot(pkg));
      themeFaces = Object.freeze({ major: faces.major, minor: faces.minor });
    }
    const result = resolveChartPart(pkg, ownerPartName, chart, themeFaces);
    results.set(chart, result);
    return result;
  };
}

function resolveChartPart(
  pkg: OoxmlPackage,
  ownerPartName: string,
  chart: OoxmlElement,
  themeFaces: ChartThemeFaces
): ChartPart | null {
  if (chart.namespaceUri !== CHART_NAMESPACE_URI || chart.localName !== 'chart') return null;
  const id = relationshipAttribute(chart, 'id');
  if (!id) return null;
  const part = internalPartRoot(pkg, ownerPartName, id, CHART_RELATIONSHIP_TYPE);
  if (!part || part.root.namespaceUri !== CHART_NAMESPACE_URI) return null;
  if (part.root.localName !== 'chartSpace') return null;
  return { chartSpace: part.root, partName: part.partName, themeFaces };
}
