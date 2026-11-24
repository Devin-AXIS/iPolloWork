// `w:pgBorders` — the frame Word draws around the SHEET (ECMA-376 §17.6.10, CT_PageBorders).
//
// Read here, beside the rest of `w:sectPr`, because a page border is section geometry and not
// decoration: where the rule lands is a function of `w:offsetFrom` AND the page margins, and
// the only layer that holds both is the one that already resolved `w:pgMar`. Paint receives
// stroke boxes (`page-border-frame.ts`) and never an offset mode.
//
// Points on the way out, like every other property this layer publishes: `w:sz` is eighths of
// a point and `w:space` is whole points, and a reader that mixes them draws an eight-times
// hairline. `borderEdgeOf` is the one parser for both, so that conversion exists once.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { isLineBorderVal } from './border-metrics.ts';
import { borderEdgeOf, type ParagraphBorderEdge } from './paragraph-style.ts';

/**
 * The four physical sides of `CT_PageBorders`.
 *
 * Four, not the six of `w:pBdr`: `w:between` and `w:bar` are paragraph-group rules and the
 * page has no analogue for either.
 */
export const PAGE_BORDER_SIDES = ['top', 'left', 'bottom', 'right'] as const;

/** Which of the four page-frame edges. */
export type PageBorderSide = (typeof PAGE_BORDER_SIDES)[number];

/**
 * `w:offsetFrom` (`ST_PgBorderOffset`) — what `w:space` on each edge is measured from.
 *
 * The schema default is `text`, NOT `page`. Word's own UI opens on "Edge of page", which is
 * why the wrong default is easy to assume and expensive to hold: at `text` the rule sits
 * `w:space` points outside the TEXT, so its distance from the sheet edge is the margin minus
 * the space — a number that moves whenever the margins do.
 */
export type PageBorderOffsetFrom = 'page' | 'text';

/** `w:display` (`ST_PgBorderDisplay`) — which pages of the section carry the frame. */
export type PageBorderDisplay = 'allPages' | 'firstPage' | 'notFirstPage';

/** `w:zOrder` (`ST_PgBorderZOrder`) — whether the frame paints over the text or under it. */
export type PageBorderZOrder = 'front' | 'back';

/**
 * One section's resolved `w:pgBorders`.
 *
 * Resolved, not raw: every attribute the file omitted is filled in with the SCHEMA default,
 * so a consumer never has to know which of the three were authored. An edge is present only
 * when it paints — `nil` / `none` and art borders are already gone (see {@link parsePageBorders}).
 */
export interface SectionPageBorders {
  /** `w:offsetFrom`; absent attribute reads as `text` (§17.6.10). */
  readonly offsetFrom: PageBorderOffsetFrom;
  /** `w:display`; absent attribute reads as `allPages`. */
  readonly display: PageBorderDisplay;
  /** `w:zOrder`; absent attribute reads as `front`. */
  readonly zOrder: PageBorderZOrder;
  readonly top?: ParagraphBorderEdge;
  readonly left?: ParagraphBorderEdge;
  readonly bottom?: ParagraphBorderEdge;
  readonly right?: ParagraphBorderEdge;
}

function attribute(node: OoxmlNode, name: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === name) return entry.value;
  }
  return undefined;
}

function childElement(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children ?? []) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === localName) {
      return child as OoxmlElement;
    }
  }
  return undefined;
}

/**
 * One page-frame edge, or undefined when nothing should be STROKED there.
 *
 * Two ways to draw nothing, and they are not the same thing. `nil` / `none` say the author
 * turned the edge off — `borderEdgeOf` already drops those. An ART border (`apples`, …) says
 * the author asked for a decorative tile this engine does not have: it is dropped rather than
 * approximated, because a plain rectangle where a ribbon of apples was authored is not a
 * degraded frame, it is a different one, and a reader cannot tell it from an authored box.
 */
function strokedEdge(node: OoxmlElement | undefined): ParagraphBorderEdge | undefined {
  const edge = borderEdgeOf(node);
  if (!edge || !isLineBorderVal(edge.val)) return undefined;
  return edge;
}

function displayOf(raw: string | undefined): PageBorderDisplay {
  if (raw === 'firstPage' || raw === 'notFirstPage') return raw;
  // Absent or unknown → allPages (§17.6.10).
  return 'allPages';
}

/**
 * Page borders are not a tracked section property. A `w:pgBorders` that only the previous
 * properties in `w:sectPrChange` hold still frames the pages, at the current page size and
 * margins. The section's own `w:pgBorders`, when present, wins.
 */
function trackedPageBorders(sectPr: OoxmlNode): OoxmlElement | undefined {
  const change = childElement(sectPr, 'sectPrChange');
  const previous = change ? childElement(change, 'sectPr') : undefined;
  return previous ? childElement(previous, 'pgBorders') : undefined;
}

/**
 * Parse `w:pgBorders` off one `w:sectPr`, or off its `w:sectPrChange` when it has none.
 *
 * Undefined when the element is absent AND when it paints nothing — every edge off, or every
 * edge an art border. Unlike `w:pgNumType`, an empty-but-present element is not distinguished:
 * these properties are a LAYOUT input, serialization re-emits the canonical tree, and a frame
 * with no edges has exactly one meaning downstream.
 */
export function parsePageBorders(sectPr: OoxmlNode): SectionPageBorders | undefined {
  const pgBorders = childElement(sectPr, 'pgBorders') ?? trackedPageBorders(sectPr);
  if (!pgBorders) return undefined;

  const top = strokedEdge(childElement(pgBorders, 'top'));
  const left = strokedEdge(childElement(pgBorders, 'left'));
  const bottom = strokedEdge(childElement(pgBorders, 'bottom'));
  const right = strokedEdge(childElement(pgBorders, 'right'));
  if (!top && !left && !bottom && !right) return undefined;

  return {
    offsetFrom: attribute(pgBorders, 'offsetFrom') === 'page' ? 'page' : 'text',
    display: displayOf(attribute(pgBorders, 'display')),
    zOrder: attribute(pgBorders, 'zOrder') === 'back' ? 'back' : 'front',
    ...(top ? { top } : {}),
    ...(left ? { left } : {}),
    ...(bottom ? { bottom } : {}),
    ...(right ? { right } : {}),
  };
}

/**
 * Identity of one section's page frame, for incremental-layout context keys.
 *
 * A `w:pgBorders` edit changes nothing the flow measures — the frame is drawn beside the text,
 * never through it — so no per-paragraph key moves and every reuse path would hand back the
 * previous sheets with the previous frame. This token goes in the pass context so it does not.
 */
export function pageBordersFingerprint(borders: SectionPageBorders | undefined): string {
  if (!borders) return '';
  const parts: string[] = [borders.offsetFrom, borders.display, borders.zOrder];
  for (const side of PAGE_BORDER_SIDES) {
    const edge = borders[side];
    if (!edge) continue;
    parts.push(`${side}:${edge.val},${edge.color ?? 'auto'},${edge.widthPt},${edge.spacePt}`);
  }
  return parts.join(',');
}
