// What keeps each field of a REUSED section prepass current.
//
// The prepass memo (`semantic-layout.ts`, `const prepassValid =`) reuses the whole record
// verbatim while every input it derives from is unchanged. The validity expression is
// hand-written: a field added to `SectionPrepass` and to `buildSectionPrepass`'s return but
// to no `prepassValid` clause typechecks — and is then served stale across every change
// that moved it. This is the widest silent-staleness surface the memo chain has, which is
// why it gets the `PAGE_REUSE_GUARDS` treatment: the set, written down and type-checked,
// with a companion test asserting the source expression agrees with the map.

import type { SectionPrepass } from './semantic-layout.ts';

/** How a prepass field stays current across a pass that reuses the record. */
export type SectionPrepassGuard =
  /** Named in the `prepassValid` expression; a change rebuilds the whole prepass. */
  | 'validity-checked'
  /**
   * Rebuilt by `buildSectionPrepass` as a pure function of the `validity-checked` inputs,
   * so it can only be stale if one of THEM escaped its clause. The same role
   * `semantic-fragment-signature.ts` calls `covered`: only a field with that proof gets
   * this, not a field whose mechanism is merely unclear.
   */
  | 'derived-covered';

export const SECTION_PREPASS_GUARDS = {
  framePolicy: 'validity-checked',
  // The block list itself — compared element-wise by identity, which is what makes a
  // typing pass in a many-section document reuse every section but the edited one.
  bodies: 'validity-checked',
  producer: 'validity-checked',
  contentWidth: 'validity-checked',
  styleCascade: 'validity-checked',
  listItems: 'validity-checked',
  // What `hostedTextboxListToken` reads. A numbering edit that only renumbers a text-box
  // hosted list leaves `listItems` (the story's own map) identity-equal; this clause sees it.
  numberingIndex: 'validity-checked',
  // Stands in for the per-block drawing tokens; a caller that threads per-paragraph
  // tokens WITHOUT an epoch keeps the recompute path (`drawingEpoch !== null`).
  drawingEpoch: 'validity-checked',
  // Outer freshness signal only; the paragraph key carries the precise projection token.
  projectionEpoch: 'validity-checked',
  tocToken: 'validity-checked',
  // The story-wide REF values token. A renumbering edit moves a REF value in a section whose
  // blocks, list map and TOC shape are all identity-unchanged; this clause is what sees it.
  refToken: 'validity-checked',
  prepared: 'derived-covered',
  positioned: 'derived-covered',
  keys: 'derived-covered',
  paragraphDocumentOrder: 'derived-covered',
  keepsNext: 'derived-covered',
  markerTexts: 'derived-covered',
  flowKeys: 'derived-covered',
  flowKeyIntern: 'derived-covered',
  terminalTextTables: 'derived-covered',
} as const satisfies Record<keyof SectionPrepass, SectionPrepassGuard>;
