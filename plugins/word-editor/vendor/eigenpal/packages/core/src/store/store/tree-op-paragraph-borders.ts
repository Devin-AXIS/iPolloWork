// `setParagraphBorders`: replace a paragraph's own `w:pBdr`.
//
// A DEDICATED op for the same reason `setParagraphTabStops` is one: `w:pBdr` carries its meaning
// in CHILDREN (`w:top`, `w:bottom`, …), and `OoxmlProperty` is flat. A property write keeps the
// children of the node it replaces, so it can preserve a border but never author one.
//
// The op states the paragraph's WHOLE own element. Layout folds it over the style's borders edge
// by edge (see `cascadedParagraphBorders`), so an edge the op leaves out inherits. The caller
// decides which edges the paragraph states; this module validates them and writes them in
// `CT_PBdr` order.

import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  insertChildren,
  removeNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { isDangerousKey, nullRecord } from '../package/safe-record.ts';
import type {
  RevisionAttributionInput,
  TreeOpEffect,
  TreeOpRejection,
  TreeOpResult,
} from './tree-op-types.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import { ownProposedParagraph, withPropertyChangeRecord } from './tree-op-tracked-properties.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import {
  TEXT_DEPS,
  effectiveContentLockAt,
  fromEdit,
  namedChild,
  ok,
  paragraphPropertiesNodeOf,
} from './tree-op-nodes.ts';
import { CT_PPR_SEQUENCE, schemaInsertIndex } from './tree-op-properties.ts';

/** One `CT_PBdr` child. */
export type ParagraphBorderEdgeName = 'top' | 'left' | 'bottom' | 'right' | 'between' | 'bar';

/** The six `CT_PBdr` children, in schema order (ECMA-376 §17.3.1.24). */
export const PARAGRAPH_BORDER_EDGES: readonly ParagraphBorderEdgeName[] = [
  'top',
  'left',
  'bottom',
  'right',
  'between',
  'bar',
];

/**
 * One edge of a paragraph border, as `setParagraphBorders` writes it.
 *
 * `attributes` are the `CT_Border` attributes (`val`, `sz`, `space`, `color`, `themeColor`,
 * `themeTint`, `themeShade`, `shadow`, `frame`), spelled as the file spells them. `val` is
 * required.
 */
export interface ParagraphBorderEdgeWrite {
  readonly edge: ParagraphBorderEdgeName;
  readonly attributes: Readonly<Record<string, string>>;
}

/** The `setParagraphBorders` op. */
export interface SetParagraphBordersOp {
  /**
   * Replace the paragraph's own `w:pBdr` with exactly these edges, or remove it with an empty
   * list. Edges not listed are not written, so a style border they used to override returns.
   */
  readonly op: 'setParagraphBorders';
  readonly paragraphId: string;
  readonly edges: readonly ParagraphBorderEdgeWrite[];
  /** Record this as a TRACKED paragraph property change (`w:pPrChange`, §17.13.5.29). */
  readonly revision?: RevisionAttributionInput;
}

/** The `CT_Border` attributes an edge write may carry. */
const BORDER_ATTRIBUTES = [
  'val',
  'color',
  'themeColor',
  'themeTint',
  'themeShade',
  'sz',
  'space',
  'shadow',
  'frame',
] as const;

const BORDER_ATTRIBUTE_SET: ReadonlySet<string> = new Set(BORDER_ATTRIBUTES);

/**
 * `ST_Border` line values. Art values (`apples`, …) are also schema-valid and accepted, so a
 * border another producer wrote can be carried through a rewrite unchanged.
 */
export const PARAGRAPH_BORDER_LINE_VALUES = [
  'nil',
  'none',
  'single',
  'thick',
  'double',
  'dotted',
  'dashed',
  'dotDash',
  'dotDotDash',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
  'wave',
  'doubleWave',
  'dashSmallGap',
  'dashDotStroked',
  'threeDEmboss',
  'threeDEngrave',
  'outset',
  'inset',
] as const;

const LINE_VALUES: ReadonlySet<string> = new Set(PARAGRAPH_BORDER_LINE_VALUES);

/** An art value: one lower-case-initial identifier, as every `ST_Border` art name is. */
const ART_VALUE = /^[a-z][A-Za-z0-9]{1,30}$/;

const THEME_COLORS: ReadonlySet<string> = new Set([
  'dark1',
  'light1',
  'dark2',
  'light2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hyperlink',
  'followedHyperlink',
  'none',
  'background1',
  'text1',
  'background2',
  'text2',
]);

const ON_OFF: ReadonlySet<string> = new Set(['0', '1', 'true', 'false', 'on', 'off']);
const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;
const HEX_BYTE = /^[0-9A-Fa-f]{2}$/;
const UNSIGNED = /^\d{1,3}$/;

/** Widest `w:sz` a line border takes: 12 points, in eighths. Art borders go to 31 points. */
const MAX_BORDER_EIGHTHS = 255;
/** Widest `w:space` the schema's consumers honor, in points. */
const MAX_BORDER_SPACE = 31;

function validBorderAttribute(name: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  switch (name) {
    case 'val':
      return LINE_VALUES.has(value) || ART_VALUE.test(value);
    case 'color':
      return value === 'auto' || HEX_COLOR.test(value);
    case 'themeColor':
      return THEME_COLORS.has(value);
    case 'themeTint':
    case 'themeShade':
      return HEX_BYTE.test(value);
    case 'sz':
      return UNSIGNED.test(value) && Number(value) <= MAX_BORDER_EIGHTHS;
    case 'space':
      return UNSIGNED.test(value) && Number(value) <= MAX_BORDER_SPACE;
    case 'shadow':
    case 'frame':
      return ON_OFF.has(value);
    default:
      return false;
  }
}

/**
 * The attributes of a file's edge that a `setParagraphBorders` write can carry forward.
 *
 * Another producer may write a width or a gap past the schema's range, or an attribute this op
 * does not take. A write that keeps such an edge would be refused for something its caller never
 * touched, so the width and the gap clamp to their range and anything else invalid is dropped.
 */
export function admissibleBorderAttributes(
  attributes: Readonly<Record<string, string>>
): Record<string, string> {
  const kept = nullRecord<string>();
  for (const name of BORDER_ATTRIBUTES) {
    const value = attributes[name];
    if (value === undefined) continue;
    if (validBorderAttribute(name, value)) kept[name] = value;
    else if ((name === 'sz' || name === 'space') && /^\d{1,9}$/.test(value))
      kept[name] = String(
        Math.min(Number(value), name === 'sz' ? MAX_BORDER_EIGHTHS : MAX_BORDER_SPACE)
      );
  }
  return kept;
}

/**
 * Why `setParagraphBorders` cannot apply, or null.
 *
 * Refused, never thrown: the op is reachable from untyped JavaScript, and every value here ends
 * up as XML.
 */
export function validateSetParagraphBorders(
  part: OoxmlPart,
  op: SetParagraphBordersOp
): TreeOpRejection | null {
  if (!Array.isArray(op.edges) || op.edges.length > PARAGRAPH_BORDER_EDGES.length) {
    return 'invalid-range';
  }
  const seen = new Set<string>();
  for (const entry of op.edges as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'invalid-property-value';
    const { edge, attributes } = entry as Partial<ParagraphBorderEdgeWrite>;
    if (!PARAGRAPH_BORDER_EDGES.includes(edge as ParagraphBorderEdgeName)) {
      return 'invalid-property-value';
    }
    // One element per edge: a reader keeps the first, so two would leave the file and the
    // editor disagreeing about which border is there.
    if (seen.has(edge as string)) return 'invalid-property-value';
    seen.add(edge as string);
    if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
      return 'invalid-property-value';
    }
    const names = Object.keys(attributes);
    if (!names.includes('val')) return 'invalid-property-value';
    for (const name of names) {
      if (isDangerousKey(name) || !BORDER_ATTRIBUTE_SET.has(name)) return 'unsupported-property';
      if (!validBorderAttribute(name, (attributes as Record<string, unknown>)[name])) {
        return 'invalid-property-value';
      }
    }
  }
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
    return 'invalid-property-value';
  }
  // A data binding mirrors text only, so it lets paragraph properties change. A content lock
  // does not let a border change: it is not one of the lock-free paragraph properties.
  if (effectiveContentLockAt(part, op.paragraphId).content) return 'locked';
  return null;
}

function wmlElement(
  id: string,
  localName: string,
  attributes: readonly (readonly [string, string])[],
  children: readonly OoxmlNode[]
): OoxmlNode {
  return {
    id,
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: attributes.map(([name, value]) => ({
      kind: 'genericExtension' as const,
      namespaceUri: WML_NAMESPACE_URI,
      localName: name,
      prefix: 'w',
      value,
    })),
    children,
  } as unknown as OoxmlNode;
}

/** The `w:pBdr` element for these edges, in schema order, or null for none. */
function paragraphBorderElement(
  edges: readonly ParagraphBorderEdgeWrite[],
  nextId: () => string
): OoxmlNode | null {
  if (edges.length === 0) return null;
  const byEdge = new Map(edges.map((entry) => [entry.edge, entry.attributes]));
  const children: OoxmlNode[] = [];
  for (const edge of PARAGRAPH_BORDER_EDGES) {
    const attributes = byEdge.get(edge);
    if (!attributes) continue;
    const ordered = BORDER_ATTRIBUTES.flatMap((name) => {
      const value = attributes[name];
      return value === undefined ? [] : [[name, value] as const];
    });
    children.push(wmlElement(nextId(), edge, ordered, []));
  }
  return wmlElement(nextId(), 'pBdr', [], children);
}

/** Apply a validated `setParagraphBorders`. */
export function applySetParagraphBorders(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: SetParagraphBordersOp,
  options: EditOptions | undefined,
  nextId: () => string
): TreeOpResult {
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    // A border and its gap take flow height, and grouping depends on the neighbours.
    impact: 'flow-structural',
  };
  const existing = paragraphPropertiesNodeOf(paragraph);
  const prior: readonly OoxmlNode[] = existing?.children ?? [];
  const current = namedChild(existing, 'pBdr');
  const replacement = paragraphBorderElement(op.edges, nextId);
  let children: readonly OoxmlNode[];
  if (current) {
    children = replacement
      ? prior.map((child) => (child === current ? replacement : child))
      : prior.filter((child) => child !== current);
  } else if (replacement) {
    const index = schemaInsertIndex(prior, CT_PPR_SEQUENCE, 'pBdr');
    children = [...prior.slice(0, index), replacement, ...prior.slice(index)];
  } else {
    return ok(part, effect);
  }
  // The same rule `setParagraphProperties` applies: no record on a paragraph whose mark this
  // author proposed adding, because rejecting that insertion takes the properties with it.
  const markProperties = namedChild(existing, 'rPr')?.children ?? [];
  if (
    op.revision &&
    !ownProposedParagraph(part, paragraph.id, markProperties, op.revision.author)
  ) {
    children = withPropertyChangeRecord({
      container: 'paragraphProperties',
      prior,
      next: children,
      revision: op.revision,
      mint: nextId,
      nextRevisionId: () => options?.revisionIds?.() ?? nextRevisionId(part)(),
    });
  }
  if (children.length === 0) {
    return existing ? fromEdit(removeNode(part, existing.id, options), effect) : ok(part, effect);
  }
  if (existing) return fromEdit(replaceChildren(part, existing.id, children, options), effect);
  const pPr = {
    id: nextId(),
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
  // `w:pPr` must be the paragraph's FIRST child per the schema.
  return fromEdit(insertChildren(part, paragraph.id, 0, [pPr], options), effect);
}
