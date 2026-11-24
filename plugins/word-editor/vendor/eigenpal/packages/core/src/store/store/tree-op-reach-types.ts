import type { OffsetSpan } from './tree-op-segments.ts';
import type { RevisionOpAction } from './tree-op-revisions.ts';
import type { RevisionAddress } from './tree-op-types.ts';

/**
 * Where an op's effect lands, in terms a control can be asked about.
 *
 * `part` is the fail-closed answer: an op whose reach nobody has narrowed is treated as reaching
 * everything, so a lock or a binding anywhere refuses it. That is the wrong side to be wrong on
 * by design — an over-refused op is a bug report, an under-refused one is a document whose
 * protection was decoration.
 */
export type TreeOpReach =
  /** Changes no content a control could be holding (part lifecycle, furniture wiring). */
  | { readonly kind: 'none' }
  /** Could change anything in the part. */
  | { readonly kind: 'part' }
  /**
   * Changes the DOCUMENT's own properties and no content: page setup, section furniture options,
   * note numbering.
   *
   * Its own kind because the two protections answer it differently, and answering both from
   * `part` was wrong in one of them. A `w:lock` protects a control and the characters it holds;
   * margins are neither, so one locked field must not freeze a template's page setup. Forms
   * protection is the opposite question — the document is read-only except for filling in fields,
   * and page setup is not filling in a field — so it still refuses.
   */
  | { readonly kind: 'documentProperties' }
  /** Addressed AT a control; the control ops resolve their own halves of `ST_Lock`. */
  | {
      readonly kind: 'control';
      readonly controlId: string;
      /** `value` is what forms protection exists to allow; the others dismantle the form. */
      readonly intent: 'value' | 'metadata' | 'removal';
      /**
       * The op REPLACES the control's whole content rather than editing part of it.
       *
       * A value write rebuilds `w:sdtContent` from nothing, and a removal that does not keep the
       * content deletes it outright. Either way every control nested in there goes — its lock,
       * its `w:dataBinding` and its text — so the reach has to include them. Resolving this op
       * from the named control alone asked permission of the one control the caller had already
       * decided about, and none of the ones it was about to destroy.
       */
      readonly replacesContent?: boolean;
      /**
       * Where in the story the write actually lands, when the caller addressed a position.
       *
       * NAMING A CONTROL SAYS WHOSE VALUE THIS IS. It does not say what the characters end up
       * inside: an offset at a control's own edge can be the edge of a control NESTED in it, and
       * resolving the refusal from the named control and its ancestors alone asked everything
       * except the control the text would land in.
       */
      readonly at?: { readonly paragraphId: string; readonly offset: number };
    }
  /** Addressed at named nodes, optionally at a range of characters inside one. */
  | { readonly kind: 'nodes'; readonly targets: readonly TreeOpTarget[] }
  /** Addressed at tracked changes, resolved to the nodes carrying them. */
  | {
      readonly kind: 'revisions';
      readonly action: RevisionOpAction;
      readonly revision?: RevisionAddress;
      readonly localName?: string;
      readonly siteNodeIds?: readonly string[];
      readonly scopeRootId?: string;
    };

export interface TreeOpTarget {
  readonly nodeId: string;
  /** UTF-16 offsets inside the node this op addresses. Absent means the node itself. */
  readonly range?: OffsetSpan;
  /** The applier's point-placement rule, when this target inserts content. */
  readonly point?:
    'run-content' | 'paragraph-sibling' | 'inline-control-split' | 'container-marker';
  /** Boundary affinity for run-content insertion. */
  readonly bias?: 'left' | 'right';
  /**
   * The range is a point at which content is WRITTEN, so the leading edge is inside.
   *
   * The applier gives a boundary offset to the run that starts there, which at a control's start
   * is the control's own first run and at its end is the run after it. A point op that writes
   * content therefore lands inside a control it is placed at the front of, and validation has to
   * agree or a locked field can be typed into from the front.
   */
  readonly writes?: boolean;
  /** The node's children are restructured, so a control inside it is affected. */
  readonly structural?: boolean;
  /** The node and everything under it goes away, so removal locks apply. */
  readonly removes?: boolean;
  /**
   * A tracked deletion: a `contentLocked` control the range wholly covers is proposed for
   * removal as a whole, so it is asked the removal question, not the edit one.
   */
  readonly strikesCovered?: boolean;
}
