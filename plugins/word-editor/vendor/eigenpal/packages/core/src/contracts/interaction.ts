/**
 * `@docx-editor.dev/core/contracts/interaction` — semantic addressing and interaction outcomes.
 *
 * Semantic identities and targets: the vocabulary a caller uses to say WHICH text it means,
 * independent of layout, DOM or any editing engine's positions. Plus the outcome type an
 * interaction attempt answers with. That is the whole module.
 *
 * It used to be 599 lines. An "interaction frame" lived here — a revision-tagged projection
 * of display, page geometry, caret and selection overlays, focus, composition and
 * accessibility, plus a typed pointer-intent dispatch protocol and a render IR of glyph
 * runs — and every one of those declarations was consumed by exactly nothing. They
 * described an architecture the engine does not use: the paginated surface owns pointer
 * interaction internally and paints through `Editor.attach`, so no frame was ever published
 * and no intent ever dispatched.
 * THREE of them (`CaretGeometry`, `HitTestOptions`, `ShapedCluster`) also collided by name
 * with the REAL, differently-shaped types in `layout/`, so the published contract carried a
 * second definition of a live concept and `import { ShapedCluster }` meant different things
 * depending on which module you reached for.
 * `InteractionFrameId` and a frame-tagged `SemanticSelection` outlived that cut. Both were
 * the same mistake: the id was a placeholder nothing ever minted (`focus` returned a literal
 * `{ value: 0 }`), and the selection could not be CONSTRUCTED without one, which made it a
 * fourth name-collision with the real `SemanticSelection` in `layout/` that a caller could
 * never actually satisfy.
 *
 * CONTRACT ONLY — declarations, not an implementation.
 *
 * @packageDocumentation
 * @public
 */

import type { ViewScope } from './editor';

// Every arm of `SemanticTarget` carries one, so a consumer reaching this entry point directly
// cannot describe a target without it. `EditorScope` comes along because `ViewScope` is defined
// as an exclusion over it.
export type { EditorScope, ViewScope } from './editor';

/** Bidi/grapheme affinity for a text caret or hit target. */
export type InteractionAffinity = 'upstream' | 'downstream';

/**
 * Model-derived stable identity within a scope. Positions resolve through this
 * index, not accumulated display-item lengths or editing-engine coordinates.
 */
export interface SemanticIdentity {
  readonly storyId: string;
  readonly blockId: string;
}

/** A PM-free semantic caret, range endpoint, or atomic selection target. */
export type SemanticTarget =
  | {
      readonly kind: 'text';
      readonly scope: ViewScope;
      readonly identity: SemanticIdentity;
      readonly graphemeOffset: number;
      readonly affinity: InteractionAffinity;
    }
  | {
      readonly kind: 'atomic';
      readonly scope: ViewScope;
      readonly objectId: string;
    };

/** Typed rejection for pending, read-only, invalid, or unsupported interaction. */
export type InteractionOutcomeCode =
  'pendingLayout' | 'pendingSelection' | 'readOnly' | 'invalidTarget' | 'unsupported';

/**
 * The result of one interaction attempt.
 *
 * A rejection carries the ENGINE's own `reason`, which is what lets a caller surface why an
 * interaction was refused instead of guessing.
 */
export type InteractionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: InteractionOutcomeCode;
      readonly reason: string;
    };
