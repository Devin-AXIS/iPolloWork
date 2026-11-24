// The base direction a paragraph inherits, without its own `w:bidi`.
//
// Internal, for automation reads and writes of paragraph direction. The cascade is the one layout
// paints with: document defaults, the table style of an enclosing cell, the paragraph style chain,
// and the paragraph's numbering level at the rank layout gives it. A direction write that knows it
// can state `w:bidi` only where the paragraph would not already read that way, which is what the
// editor's own direction command does.

import { createFormattingCellStyles } from './complex-script-table-context.ts';
import { readNumPr, withNumberingStyleLinks } from './list-resolve.ts';
import { buildNumberingIndex, resolveNumberingLevel } from './numbering-index.ts';
import { numberingParagraphProperties } from './numbering-paragraph-properties.ts';
import { propertyContainer } from '../store/store/direct-properties.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { FormattingDisplayMode } from '../store/store/formattable-runs.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeParagraphWithNumbering,
  type CascadedParagraphFormatting,
} from './style-cascade.ts';

/** The parts a paragraph's inherited direction comes from. `null` where the package has none. */
export interface DirectionSources {
  readonly styles: OoxmlElement | null;
  readonly settings: OoxmlElement | null;
  readonly numbering: OoxmlElement | null;
}

type Resolver = (
  part: OoxmlPart,
  paragraph: OoxmlNode,
  mode: FormattingDisplayMode,
  styleId: string | undefined,
  without: string | undefined
) => CascadedParagraphFormatting;

const absent = {};
const resolvers = new WeakMap<object, WeakMap<object, WeakMap<object, Resolver>>>();

/**
 * A read-only `w:pPr` view that names `styleId` as its paragraph style.
 *
 * Only the cascade reads it, and the cascade reads child names and attributes. It has no real node
 * id, so it must never reach the store, an op, or a journal. It lets a write that also changes the
 * style resolve the direction the paragraph will have, not the one it had.
 */
function withParagraphStyle(pPr: OoxmlNode | undefined, styleId: string): OoxmlNode {
  const kept =
    pPr && pPr.kind !== 'textValue'
      ? pPr.children.filter((child) => child.kind === 'textValue' || child.localName !== 'pStyle')
      : [];
  const pStyle = {
    kind: 'generic',
    id: '',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pStyle',
    prefix: 'w',
    attributes: [
      { namespaceUri: WML_NAMESPACE_URI, localName: 'val', prefix: 'w', value: styleId },
    ],
    children: [],
  };
  return {
    ...(pPr ?? { kind: 'generic', id: '', localName: 'pPr', attributes: [] }),
    children: [pStyle, ...kept],
  } as unknown as OoxmlNode;
}

/** A read-only `w:pPr` view without its `localName` children, for what the paragraph inherits. */
function withoutChild(pPr: OoxmlNode | undefined, localName: string): OoxmlNode | undefined {
  if (!pPr || pPr.kind === 'textValue') return pPr;
  return {
    ...pPr,
    children: pPr.children.filter(
      (child) => child.kind === 'textValue' || child.localName !== localName
    ),
  } as unknown as OoxmlNode;
}

function createResolver(sources: DirectionSources): Resolver {
  const table = buildStyleCascadeTable(sources.styles, undefined, sources.settings);
  const cellStyleOf = createFormattingCellStyles(table);
  const numbering = withNumberingStyleLinks(buildNumberingIndex(sources.numbering), table);
  return (part, paragraph, mode, styleId, without) => {
    const container = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
    const own = without === undefined ? container : withoutChild(container, without);
    const direct = styleId === undefined ? own : withParagraphStyle(own, styleId);
    // The list level comes from the style chain and direct properties, without the cell style,
    // as layout resolves list items.
    const numPr = readNumPr(cascadeParagraphFormatting(table, direct).paragraphPropertyNodes);
    const level = numPr ? resolveNumberingLevel(numbering, numPr.numId, numPr.ilvl) : null;
    return cascadeParagraphWithNumbering(
      table,
      direct,
      cellStyleOf(part, paragraph, mode),
      level ? numberingParagraphProperties(level.level) : undefined
    );
  };
}

function resolverFor(sources: DirectionSources): Resolver {
  let bySettings = resolvers.get(sources.styles ?? absent);
  if (!bySettings) resolvers.set(sources.styles ?? absent, (bySettings = new WeakMap()));
  let byNumbering = bySettings.get(sources.settings ?? absent);
  if (!byNumbering) bySettings.set(sources.settings ?? absent, (byNumbering = new WeakMap()));
  let resolve = byNumbering.get(sources.numbering ?? absent);
  if (!resolve) byNumbering.set(sources.numbering ?? absent, (resolve = createResolver(sources)));
  return resolve;
}

/**
 * The `w:pPr` nodes a paragraph's `without` property cascades through, in order: document
 * defaults, an enclosing cell's table style, the style chain with the numbering level at its rank,
 * then the paragraph's own `w:pPr` with its `without` child left out. The same cascade layout
 * paints with, so folding these nodes gives the value the paragraph inherits.
 */
export function inheritedParagraphPropertyNodes(
  sources: DirectionSources,
  part: OoxmlPart,
  paragraph: OoxmlNode,
  mode: FormattingDisplayMode,
  without: string,
  styleId?: string
): readonly OoxmlNode[] {
  return resolverFor(sources)(part, paragraph, mode, styleId, without).paragraphPropertyNodes;
}

/**
 * Whether `paragraph` is right to left when its own `w:bidi` is ignored.
 *
 * `styleId` resolves the paragraph as if it named that paragraph style, for a write that changes
 * the style and the direction together. One cascade per styles, settings, and numbering part.
 */
export function paragraphInheritsRtl(
  sources: DirectionSources,
  part: OoxmlPart,
  paragraph: OoxmlNode,
  mode: FormattingDisplayMode,
  styleId?: string
): boolean {
  const cascaded = resolverFor(sources)(part, paragraph, mode, styleId, undefined);
  return paragraphIsRtl(cascaded.inheritedParagraphProperties);
}
