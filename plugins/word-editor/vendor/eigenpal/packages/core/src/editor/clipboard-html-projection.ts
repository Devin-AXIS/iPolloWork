// Shared state types for the external-HTML projection walk.
import type {
  WordListLevelDefinition,
  HtmlListAllocation as ListAllocation,
} from './clipboard-html-numbering.ts';
import type { HtmlFragmentRel as RelEntry } from './clipboard-html-package.ts';
import type { ClipboardNoteKind } from './clipboard-html-notes.ts';
import type { HtmlRevision, HtmlRevisionAttribution } from './clipboard-html-revisions.ts';
import type { HtmlParagraphAlign, HtmlParaProps, HtmlRunProps } from './clipboard-html-styles.ts';

type RunProps = HtmlRunProps;
type ParaProps = HtmlParaProps;

export type ListState = { readonly numId: string; readonly level: number };

export interface FlowContext {
  readonly run: RunProps;
  readonly para: ParaProps;
  readonly paragraphMarkCovered: boolean;
  readonly pre: boolean;
  readonly list: ListState | null;
  /** Set while projecting a note definition body: the note the blocks belong to. */
  readonly noteBody?: { readonly kind: ClipboardNoteKind; readonly id: number };
  readonly rels?: RelEntry[];
  /** The `<ins>` / `<del>` revisions open around this content, outermost first. */
  readonly revisions?: readonly HtmlRevision[];
  /** The formatting revision open around this content (`mso-prop-change`). */
  readonly runChange?: HtmlRevisionAttribution;
  /** Previous run property values (`!msorm` declarations) open around this content. */
  readonly originalRunStyle?: ReadonlyMap<string, string>;
}

export interface Projection {
  nodesLeft: number;
  /** Set when a walk stopped with work remaining because the budget ran out. */
  truncated: boolean;
  readonly maxDepth: number;
  readonly maxImageBytes: number;
  readonly wordHtml: boolean;
  lastMarkCovered: boolean;
  /** Mark revisions an `<o:p>` recorded for the paragraph being walked. */
  markRevision: string | null;
  /**
   * Whether the paragraph just emitted took a mark revision. Its mark is then content the
   * paste must land, like a styled mark (`lastMarkCovered`).
   */
  markRevisionTaken: boolean;
  readonly rels: RelEntry[];
  readonly media: Map<string, Uint8Array>;
  readonly mediaExtensions: Map<string, string>;
  /** Media part per `src`, so a repeated image decodes and ships exactly once. */
  readonly mediaBySrc: Map<string, string>;
  readonly lists: Map<string, ListAllocation>;
  /** Secondary index over `lists`, so nested lists resolve without a linear scan. */
  readonly listsByNumId: Map<string, ListAllocation>;
  semanticListCount: number;
  imageCount: number;
  docPrId: number;
  nextBookmarkId: number;
  readonly classAlignments: ReadonlyMap<string, HtmlParagraphAlign>;
  /** Word's structured `@list lN:levelM` head rules, keyed `l<N>:level<M>`. */
  readonly listDefinitions: ReadonlyMap<string, WordListLevelDefinition>;
  readonly notes: Record<ClipboardNoteKind, Map<number, readonly string[]>>;
  readonly noteRels: Record<ClipboardNoteKind, RelEntry[]>;
  /** Ids with a PROJECTED definition — the only ids a live note reference may carry. */
  readonly definedNotes: Record<ClipboardNoteKind, ReadonlySet<number>>;
  /** Ids the BODY emitted a live reference for — the reachability seeds. */
  readonly bodyNoteRefs: Record<ClipboardNoteKind, Set<number>>;
  /** Cross-note reference edges, keyed by the CITING note (`kind:id`). A claimed
   *  note unreachable from the body through these edges is reconciled back into
   *  visible body text after the walk. */
  readonly noteNoteRefs: Map<string, Array<{ kind: ClipboardNoteKind; id: number }>>;
  /** Emitted mark's visible text (as a run), keyed `kind:id` — the strip fallback
   *  when a claimed note is later dropped or moved, so '[1]' stays visible. */
  readonly noteMarkFallbacks: Map<string, string>;
  /** The exact definition elements the notes pass consumed; only these skip the body
   *  walk, so a duplicate-id or unreferenced definition stays lossless in the body. */
  readonly definedNoteElements: ReadonlySet<Element>;
  /** Recovered Word equations: each source element's canonical `m:oMath` XML. */
  readonly equations: ReadonlyMap<Element, readonly string[]>;
}
