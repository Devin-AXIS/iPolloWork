// The chart part behind one chartex drawing: waterfall, funnel, histogram, Pareto,
// box-and-whisker, treemap, sunburst and region map charts.
//
// A chartex `a:graphicData` holds `cx:chart`, whose `r:id` names the chartex part
// (`cx:chartSpace`) on the story part that holds the `w:drawing`. The chartex part names its
// chart style (`cs:chartStyle`) and colour style (`cs:colorStyle`) parts; a chartex part saves
// no formatting of its own for most elements, so these parts carry the default fills, lines
// and text. Like a classic chart, a chartex chart renders from the values cached in its own
// XML (`cx:lvl`); its embedded workbook and external data are never read.
//
// Office wraps a chartex drawing in `mc:AlternateContent` whose Choice requires one of the
// chartex namespaces below. The engine understands that Choice: the chart renders when an
// installed renderer supports it. Otherwise its fallback picture shows when it has one that
// paints, and otherwise its labelled `chart` placeholder (`mc-fallback-projection.ts`), so
// the drawing never disappears.

import type { ChartThemeFaces } from './chart-parts.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import { internalPartRoot, relationshipAttribute } from './package-part-links.ts';
import { resolveRelationship } from './relationships.ts';
import { collectThemeSchemeFaces } from './theme-font-scheme.ts';
import { packageThemeRoot } from './theme-color-resolution.ts';

/** @internal */
export const CHARTEX_GRAPHIC_DATA_URI = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
/** @internal */
export const CHARTEX_NAMESPACE_URI = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
/** The namespace of chart style and colour style parts. @internal */
export const CHART_STYLE_NAMESPACE_URI =
  'http://schemas.microsoft.com/office/drawing/2012/chartStyle';

const CHARTEX_RELATIONSHIP_TYPE = 'http://schemas.microsoft.com/office/2014/relationships/chartEx';
const STYLE_RELATIONSHIP_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/chartStyle';
const COLORS_RELATIONSHIP_TYPE =
  'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle';

/**
 * The namespaces an `mc:Choice` around a chartex drawing requires (`cx1` to `cx8`). The
 * engine understands them: see the file comment.
 *
 * @internal
 */
export const CHARTEX_MC_NAMESPACES: readonly string[] = Object.freeze([
  CHARTEX_NAMESPACE_URI,
  'http://schemas.microsoft.com/office/drawing/2015/9/8/chartex',
  'http://schemas.microsoft.com/office/drawing/2015/10/21/chartex',
  'http://schemas.microsoft.com/office/drawing/2016/5/9/chartex',
  'http://schemas.microsoft.com/office/drawing/2016/5/10/chartex',
  'http://schemas.microsoft.com/office/drawing/2016/5/11/chartex',
  'http://schemas.microsoft.com/office/drawing/2016/5/12/chartex',
  'http://schemas.microsoft.com/office/drawing/2016/5/13/chartex',
  'http://schemas.microsoft.com/office/drawing/2016/5/14/chartex',
]);

/** One resolved chartex part. @internal */
export interface ChartexPart {
  /** The `cx:chartSpace` root. */
  readonly chartSpace: OoxmlElement;
  /** Canonical part name, for story ids and diagnostics. */
  readonly partName: string;
  /** The `cs:chartStyle` root the chartex part names, or null. */
  readonly style: OoxmlElement | null;
  /** The `cs:colorStyle` root the chartex part names, or null. */
  readonly colors: OoxmlElement | null;
  /** The theme's Latin heading and body faces, which chart text takes through tokens. */
  readonly themeFaces: ChartThemeFaces;
}

/** Resolves the chartex part behind one `cx:chart` element of the owner story part. @internal */
export type ChartexPartResolver = (chart: OoxmlElement) => ChartexPart | null;

/**
 * A resolver for the chartex charts of one story part, cached per `cx:chart` element: the
 * package and its parts are immutable.
 */
export function createChartexPartResolver(
  pkg: OoxmlPackage,
  ownerPartName: string
): ChartexPartResolver {
  const results = new WeakMap<OoxmlElement, ChartexPart | null>();
  let themeFaces: ChartThemeFaces | null = null;
  return (chart) => {
    if (results.has(chart)) return results.get(chart)!;
    if (!themeFaces) {
      const faces = collectThemeSchemeFaces(packageThemeRoot(pkg));
      themeFaces = Object.freeze({ major: faces.major, minor: faces.minor });
    }
    const result = resolveChartexPart(pkg, ownerPartName, chart, themeFaces);
    results.set(chart, result);
    return result;
  };
}

/** The first internal part of `type` that `ownerPartName` relates to, with root `localName`. */
function relatedPartRoot(
  pkg: OoxmlPackage,
  ownerPartName: string,
  type: string,
  localName: string
): OoxmlElement | null {
  for (const record of pkg.relationships.get(ownerPartName) ?? []) {
    if (record.type !== type || record.targetMode !== 'Internal') continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    const root = pkg.parts.get(resolved.target.partName)?.root;
    if (root && root.namespaceUri === CHART_STYLE_NAMESPACE_URI && root.localName === localName) {
      return root;
    }
  }
  return null;
}

function resolveChartexPart(
  pkg: OoxmlPackage,
  ownerPartName: string,
  chart: OoxmlElement,
  themeFaces: ChartThemeFaces
): ChartexPart | null {
  if (chart.namespaceUri !== CHARTEX_NAMESPACE_URI || chart.localName !== 'chart') return null;
  const id = relationshipAttribute(chart, 'id');
  if (!id) return null;
  const part = internalPartRoot(pkg, ownerPartName, id, CHARTEX_RELATIONSHIP_TYPE);
  if (!part || part.root.namespaceUri !== CHARTEX_NAMESPACE_URI) return null;
  if (part.root.localName !== 'chartSpace') return null;
  return {
    chartSpace: part.root,
    partName: part.partName,
    style: relatedPartRoot(pkg, part.partName, STYLE_RELATIONSHIP_TYPE, 'chartStyle'),
    colors: relatedPartRoot(pkg, part.partName, COLORS_RELATIONSHIP_TYPE, 'colorStyle'),
    themeFaces,
  };
}
