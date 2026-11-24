// `setSelection` text positions, normalized to the surface's selection form.

import type { SemanticSelection as SurfaceSelection } from '@docx-editor.dev/core/layout';

/** What a `setSelection` range with anchor/head endpoints resolves to. */
export type TextSelectionInput =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly selection: SurfaceSelection }
  | { readonly kind: 'invalid'; readonly reason: string };

export const NOT_A_TEXT_SELECTION: TextSelectionInput = { kind: 'none' };

/** One endpoint: `blockId`, or its older name `paragraphId`, plus an offset. */
function textPositionOf(
  value: unknown,
  name: 'anchor' | 'head'
): SurfaceSelection['anchor'] | string {
  if (typeof value !== 'object' || value === null) return `${name} must be a text position`;
  const { blockId, paragraphId, offset } = value as {
    blockId?: unknown;
    paragraphId?: unknown;
    offset?: unknown;
  };
  if (typeof offset !== 'number') return `${name}.offset must be a number`;
  if (blockId !== undefined && typeof blockId !== 'string')
    return `${name}.blockId must be a string`;
  if (paragraphId !== undefined && typeof paragraphId !== 'string') {
    return `${name}.paragraphId must be a string`;
  }
  if (blockId === undefined && paragraphId === undefined) return `${name} needs a blockId`;
  if (blockId !== undefined && paragraphId !== undefined && blockId !== paragraphId) {
    return `${name}.blockId and ${name}.paragraphId name different paragraphs`;
  }
  return { paragraphId: (blockId ?? paragraphId) as string, offset };
}

/**
 * A `setSelection` range of text positions, normalized to the surface's form.
 *
 * `none` for a range with no anchor/head pair, which the paraId forms handle. `invalid` for
 * an anchor/head pair whose positions name no paragraph, or two different ones.
 */
export function textSelectionOf(range: unknown): TextSelectionInput {
  if (typeof range !== 'object' || range === null) return NOT_A_TEXT_SELECTION;
  if (!('anchor' in range) || !('head' in range)) return NOT_A_TEXT_SELECTION;
  const anchor = textPositionOf((range as { anchor: unknown }).anchor, 'anchor');
  if (typeof anchor === 'string') return { kind: 'invalid', reason: anchor };
  const head = textPositionOf((range as { head: unknown }).head, 'head');
  if (typeof head === 'string') return { kind: 'invalid', reason: head };
  return { kind: 'ok', selection: { anchor, head } };
}
