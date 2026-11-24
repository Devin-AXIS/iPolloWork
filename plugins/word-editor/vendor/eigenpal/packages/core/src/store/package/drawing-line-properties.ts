// Outline attributes of a `wps:wsp`, inherited attribute by attribute.
import { findDirectChild, parseEmu } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import type { ShapeStyleMatrixResolver } from './drawing-shape-projection.ts';
import { lineDash } from './drawing-line-dash.ts';
import { lineCompound, type LineCompound } from './drawing-line-compound.ts';

const DEFAULT_LINE_WIDTH_EMU = 12_700;

/**
 * The outline width and alignment of a shape. Line properties inherit attribute by attribute:
 * a direct `a:ln` attribute wins, and otherwise the theme line that `wps:style/a:lnRef` names
 * decides, whether or not the direct line sets its own fill. The theme line is read for its
 * attributes only, so an unresolvable theme colour does not lose them.
 */
export function readLineProperties(
  wsp: OoxmlElement,
  ln: OoxmlElement | null,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  resolvedThemeLine?: OoxmlElement
): {
  readonly widthEmu: number;
  readonly alignment: string | undefined;
  readonly cap: 'butt' | 'round' | 'square' | undefined;
  /** The corner join; round when the outline names none. */
  readonly join: 'round' | 'bevel' | 'miter';
  /** The miter limit as a multiple of the line width, for a miter join. */
  readonly miterLimit: number;
  /** Dash and gap lengths in line widths; null for a solid line. */
  readonly dash: readonly number[] | null;
  /** Parallel bands the outline paints as (`@cmpd`). */
  readonly compound: LineCompound;
} {
  const directWidth = ln ? parseEmu(schemaAttributeValue(ln.attributes, 'w')) : null;
  const directAlignment = ln ? schemaAttributeValue(ln.attributes, 'algn') : undefined;
  const directCap = ln ? schemaAttributeValue(ln.attributes, 'cap') : undefined;
  const directJoin = lineJoin(ln);
  const directCompound = ln ? schemaAttributeValue(ln.attributes, 'cmpd') : undefined;
  const theme =
    directWidth === null ||
    directAlignment === undefined ||
    directCap === undefined ||
    directJoin === undefined ||
    directCompound === undefined
      ? isThemeLine(resolvedThemeLine)
        ? resolvedThemeLine
        : themeLine(wsp, resolveStyleMatrixReference)
      : null;
  return {
    widthEmu:
      directWidth ??
      (theme ? parseEmu(schemaAttributeValue(theme.attributes, 'w')) : null) ??
      DEFAULT_LINE_WIDTH_EMU,
    alignment:
      directAlignment ?? (theme ? schemaAttributeValue(theme.attributes, 'algn') : undefined),
    cap: lineCap(directCap ?? (theme ? schemaAttributeValue(theme.attributes, 'cap') : undefined)),
    ...joinOf(directJoin ?? lineJoin(theme)),
    dash: dashOf(wsp, ln, theme, resolveStyleMatrixReference, resolvedThemeLine),
    compound: lineCompound(
      directCompound ?? (theme ? schemaAttributeValue(theme.attributes, 'cmpd') : undefined)
    ),
  };
}

/** The direct line's dash, else the theme line's, else solid. */
function dashOf(
  wsp: OoxmlElement,
  ln: OoxmlElement | null,
  theme: OoxmlElement | null,
  resolveStyleMatrixReference: ShapeStyleMatrixResolver | undefined,
  resolvedThemeLine: OoxmlElement | undefined
): readonly number[] | null {
  const direct = lineDash(ln);
  if (direct !== undefined) return direct;
  const inherited =
    theme ??
    (isThemeLine(resolvedThemeLine)
      ? resolvedThemeLine
      : themeLine(wsp, resolveStyleMatrixReference));
  return lineDash(inherited) ?? null;
}

function lineCap(value: string | undefined): 'butt' | 'round' | 'square' | undefined {
  if (value === 'flat') return 'butt';
  if (value === 'rnd') return 'round';
  if (value === 'sq') return 'square';
  return undefined;
}

/** A join element's name and its `a:miter` limit attribute. */
interface LineJoin {
  readonly name: string;
  readonly limit?: string;
}

function lineJoin(line: OoxmlElement | null): LineJoin | undefined {
  if (!line) return undefined;
  const joins = line.children.filter(
    (node) =>
      isElement(node) &&
      node.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      ['round', 'bevel', 'miter'].includes(node.localName)
  );
  // An explicit unsupported or ambiguous join must not inherit a different theme join.
  if (joins.length > 1) return { name: 'unsupported' };
  const join = joins[0];
  if (joins.length !== 1 || !join || !isElement(join)) return undefined;
  return { name: join.localName, limit: schemaAttributeValue(join.attributes, 'lim') };
}

const DEFAULT_MITER_LIMIT = 8;

/**
 * The join an outline paints with. An outline without a join element, or with an ambiguous
 * one, joins round. `a:miter@lim` is a positive percentage in thousandths (800000 is 8 line
 * widths); without it the limit is 8.
 */
function joinOf(join: LineJoin | undefined): {
  readonly join: 'round' | 'bevel' | 'miter';
  readonly miterLimit: number;
} {
  if (join?.name === 'bevel') return { join: 'bevel', miterLimit: DEFAULT_MITER_LIMIT };
  if (join?.name !== 'miter') return { join: 'round', miterLimit: DEFAULT_MITER_LIMIT };
  const raw = join.limit;
  const parsed = raw !== undefined && /^\d{1,10}$/.test(raw) ? Number(raw) / 100_000 : NaN;
  // A limit below 1 has no meaning for a stroke; clamp to a bounded range.
  const miterLimit = Number.isFinite(parsed)
    ? Math.min(100, Math.max(1, parsed))
    : DEFAULT_MITER_LIMIT;
  return { join: 'miter', miterLimit };
}

/**
 * The `wps:style` reference a shape names for its fill or line (`a:fillRef`/`a:lnRef`): the
 * style-matrix index and the placeholder colour element, or null when there is none.
 */
export function readStyleReferenceIndex(
  wsp: OoxmlElement,
  referenceName: 'fillRef' | 'lnRef'
): {
  readonly index: number;
  readonly color: OoxmlElement['children'][number] | undefined;
} | null {
  // `wps:style` and the diagram drawing's `dsp:style` share one shape.
  const style = findDirectChild(wsp.children, {
    namespaceUri: wsp.namespaceUri,
    localName: 'style',
  });
  const reference = style
    ? findDirectChild(style.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: referenceName,
      })
    : null;
  const rawIndex = reference ? schemaAttributeValue(reference.attributes, 'idx') : undefined;
  if (!reference || !rawIndex || !/^\d{1,4}$/.test(rawIndex)) return null;
  return { index: Number(rawIndex), color: reference.children.find(isElement) };
}

function themeLine(
  wsp: OoxmlElement,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): OoxmlElement | null {
  if (!resolveStyleMatrixReference) return null;
  const reference = readStyleReferenceIndex(wsp, 'lnRef');
  if (!reference) return null;
  const matrix = resolveStyleMatrixReference('line', reference.index);
  return isThemeLine(matrix) ? matrix : null;
}

/** Only an `a:ln` entry of the theme's line styles carries line attributes. */
function isThemeLine(element: OoxmlElement | null | undefined): element is OoxmlElement {
  return (
    element !== null &&
    element !== undefined &&
    element.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
    element.localName === 'ln'
  );
}
