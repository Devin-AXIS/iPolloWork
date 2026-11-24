// The contract of the two-way selection mirror: what the composition root lends it and what
// it answers. Split out of `surface-selection-sync.ts`, which re-exports both interfaces.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type {
  SemanticSelection,
  CaretGeometry,
  CaretAtOptions,
} from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import type { ComposedLaneDeps } from './surface-composition-commit.ts';

/** What the composition root lends this lane. */
export interface SurfaceSelectionSyncDeps {
  readonly session: TreeDocxSessionView;
  /** Active story for IME commits and composition — body or open furniture. */
  storyScope(): import('@docx-editor.dev/core/store').StoryScope;
  /**
   * The painted pages: the only subtree a selection endpoint may map through.
   *
   * Their `ownerDocument`, read per call, is the document whose selection this reads and
   * writes, never the ambient global: the surface can be mounted in an iframe or a pop-out
   * window, and can move between them while mounted.
   */
  readonly pagesLayer: HTMLElement;
  /** The CURRENT model selection — read per call, never captured. */
  selection(): SemanticSelection;
  /** Publish a selection: mirrors it into the DOM and reports the new state. */
  setSelection(next: SemanticSelection): void;
  /** Take a selection up WITHOUT mirroring or reporting — the caller is about to do both. */
  adoptSelection(next: SemanticSelection): void;
  commit(run: () => TreeApplyResult | boolean): void;
  /**
   * The content control that owns text typed at the caret, or `undefined` when none does. The
   * keyboard's `insertText` names it, so a text control's trailing edge counts as inside it.
   */
  insertOwner?(): string | undefined;
  compositionUsesTyping?(): boolean;
  /**
   * The caret offset after `length` characters land at `offset`. Text inserted at a prompt's
   * edge replaces the prompt, so it lands where the prompt began, not at `offset`.
   */
  promptLanding?(paragraphId: string, offset: number, length: number): number;
  /**
   * The surface's own write lane — attribution, protection and refusals included.
   *
   * The IME is the one edit that reaches the tree from here, and calling the session directly
   * meant composed text skipped every rule the other lanes go through.
   */
  applyOps(
    ops: readonly TreeDocOp[],
    mark: { paragraphId: string; start: number; end: number } | null,
    scope: import('@docx-editor.dev/core/store').StoryScope
  ): TreeApplyResult;
  render(): void;
  flushLayout(): boolean;
  /**
   * Land queued typing, any deferred layout pass and any deferred paint, so the painted
   * DOM matches the committed model. Returns whether a paint happened, so the readback
   * lane can render exactly once; without it, a layout or paint the commit deferred under
   * input pressure would leave the screen behind the composition it just landed.
   */
  flushToPaint(): boolean;
  /**
   * The text the page currently PAINTS for a paragraph, and the package revision it is from.
   * It differs from `textOf` while a paint is owed. Without it, the model's text is taken.
   */
  paintedText?(paragraphId: string): { readonly text: string; readonly revision: number };
  /**
   * Hold repaints from the input method's first write until the composition ends, so a
   * collaborator's edit does not replace the nodes it composes into; release paints again.
   */
  holdPaint?(hold: boolean): void;
  /** The engine's painted caret, repainted with every mirror. */
  updateCaret(): void;
  /** The model text of one paragraph, for diffing what an IME wrote against it. */
  textOf(paragraphId: string): string;
  /** A plain composed insertion commits on a later task: surface-composition-commit. */
  commitComposed?: ComposedLaneDeps['commitComposed'];
  modelTextOf?: ComposedLaneDeps['modelTextOf'];
  later?: ComposedLaneDeps['later'];
  /**
   * The ops that apply the surface's armed caret formatting (stored marks) to text the
   * readback is about to insert at `offset`, or `[]` when nothing is armed there. Word
   * applies the typing format to composed text exactly like typed text, and this is the
   * only insertion lane that does not go through `type()`.
   *
   * `replacing` is the range the insert stands in for, when the diff found one. The armed
   * anchor relocates through the same landing rule as `replacementOffset`, so a
   * composition that replaces the author's own pending text keeps the armed format
   * instead of silently dropping it.
   */
  pendingFormatOps?(
    paragraphId: string,
    offset: number,
    length: number,
    replacing?: { readonly start: number; readonly end: number }
  ): TreeDocOp[];
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  /** The surface's clock, so every phase timer reads the same one. */
  now(): number;
  /** Book the cost of one mirror into the surface's perf slot. */
  recordSelectionMs(ms: number): void;
  /**
   * Whether a pointer gesture currently owns the selection.
   *
   * A drag publishes its own selection on every move, and the browser reports its own idea of
   * what is selected alongside it. Adopting one of those mid-gesture snaps the caret back to
   * whatever the DOM guessed, halfway through the drag.
   */
  isGesturing?(): boolean;
  /**
   * What to write into the browser's own selection, when that is not the model selection.
   *
   * A rectangle of table cells has no native equivalent: writing the text range it stands in
   * for would draw a band running through every cell in between — the very thing the
   * rectangle exists to avoid — and leaving the DOM with no selection at all stops a
   * contenteditable firing `beforeinput`. So it writes a collapsed selection instead.
   */
  domSelection?(): SemanticSelection;
  /**
   * Whether a rectangle of table cells is currently selected.
   *
   * Distinct from a gesture: a rectangle OUTLIVES the drag that made it, and the DOM holds a
   * collapsed selection for the whole time it is live. Adopting that disagreement would clear
   * the rectangle on the first report after release. Only an explicit gesture replaces one,
   * and every explicit gesture goes through `setSelection`, which clears it.
   */
  holdsCellSelection?(): boolean;
  /**
   * Whether typed characters are buffered and have not reached the tree yet.
   *
   * A burst is held on a zero-delay task, and the position a gesture maps to is read from a
   * DOM those characters are not in — so adopting it would land the burst wherever the
   * gesture went. The buffer cannot be flushed from here: this runs as the first statement of
   * a render, and a flush commits, which renders. The gesture is not lost by waiting; the
   * flush is the very next task, and its own render adopts it with the flag still armed.
   */
  hasPendingInput?(): boolean;
  /**
   * Where text replacing `[from, to)` of one paragraph belongs.
   *
   * In suggesting mode a deletion keeps the characters it strikes, so the replacement goes
   * AFTER them; the diff this lane computes is against the painted text and knows nothing of
   * that. Composed text landed in front of the word it replaced until it asked.
   */
  replacementOffset?(paragraphId: string, from: number, to: number): number;
  /**
   * Replace the current selection with text, exactly as typing it would — one transaction,
   * attribution and refusals included. Used for a composition that began over a range
   * spanning two paragraphs, which the painted DOM cannot be asked about.
   */
  replaceSelectionWith?(text: string): void;
  /**
   * Forget what the pages currently show, so the next render rebuilds them from records.
   *
   * The one caller is a composition that changed nothing: the browser's characters are on
   * the page and an unchanged layout would keep them there.
   */
  discardPaint?(): void;
}

export interface SurfaceSelectionSync {
  /**
   * The pending-gesture adoption a render performs BEFORE it repaints, and the point at
   * which the model-moved flag is spent. Returns whether a gesture was taken up, which is
   * the one thing that makes an otherwise silent repaint worth reporting.
   */
  adoptBeforePaint(): boolean;
  /** Record that the MODEL now holds the newer selection: a commit, an undo, a navigation. */
  noteModelMoved(): void;
  /** Record that the two agree again, because the model's selection is being written out. */
  noteSelectionSettled(): void;
  /**
   * Write the model selection into the browser's own.
   *
   * `claim` is for a DELIBERATE programmatic move — a host calling `setSelection`, a review
   * card being opened — where the point of the call is to show the reader this range. The
   * ordinary write refuses whenever the DOM selection lives outside these pages, which is
   * the normal state when the request came from the host's own chrome: the caret moved and
   * the model held a range that nothing on screen highlighted. Claiming writes the range
   * anyway; in Chromium this can also focus the contenteditable. Passive restoration
   * must use an unclaimed write.
   */
  mirrorToDom(claim?: boolean): void;
  /**
   * Take up the browser's newest selection immediately before a keyboard/input command.
   *
   * `selectionchange` is queued. A native caret can therefore already be visible at the
   * clicked point while the model still holds the previous range; commands must close that
   * window synchronously or they edit the stale range.
   */
  adoptBeforeInput(): void;
  /** Whether an IME is composing, which suspends repainting. */
  isComposing(): boolean;
  /** Whether a composition at the caret would start over text the last one left unpainted. */
  continuesComposition(): boolean;
  /** Commit queued composed text: every flush point calls this before anything else. */
  landComposed(): void;
  /**
   * Record that the browser may park its own selection as the FIX-UP of a prevented input.
   *
   * A smart substitution (`insertReplacementText`: macOS double-space period, autocorrect)
   * moves the native selection over the text the browser wanted to replace, even though the
   * surface prevented the default and applied the edit in the model. That write has no
   * gesture behind it and can land before or after the event dispatch, over a paint that is
   * a commit behind — adopting it highlighted a stale range and moved the caret there. The
   * next in-pages `selectionchange` without gesture provenance re-asserts the model
   * selection instead of adopting.
   */
  noteBrowserSelectionFixup(): void;
  /**
   * Record that an input method just edited outside a composition: a deletion that came as
   * `beforeinput`, or a browser change to the painted text the surface had to undo.
   *
   * Such a keyboard keeps its own copy of the caret and corrects the browser's selection on
   * its own schedule, after the edit; Chromium also parks the caret where ITS deletion would
   * have left it. Neither is the user's selection. For a short window after the edit, an
   * in-pages `selectionchange` with no pointer or `selectstart` behind it re-asserts the model
   * selection instead of being adopted. A real gesture still wins.
   */
  noteInputMethodEdit(): void;
  /**
   * A key the keymap or the browser acts on itself ends that window: a caret key, or an
   * editing chord, moves the selection on purpose. An input method's own `keydown` (`key`
   * `Unidentified`, `keyCode` 229) does not.
   */
  noteKeyDown(event: KeyboardEvent): void;
  /** Whether the browser's selection is the user's, not an input method's correction. */
  browserSelectionTrusted(): boolean;
  readonly onSelectionChange: () => void;
  readonly onCompositionStart: () => void;
  readonly onCompositionEnd: (event?: CompositionEvent) => void;
  /** Drop capture listeners. Safe to call once from surface destroy/detach. */
  destroy(): void;
  /**
   * The sheet the last mapped gesture sat on.
   *
   * A repeating `w:tblHeader` row shares one paragraph id on every page. Caret paint and
   * scroll-follow need this page or they jump to the authored copy on page 0.
   */
  selectionPageIndex(): number | undefined;
  selectionLineId(): string | undefined;
  caretPreference(preferredPageIndex?: number): CaretAtOptions;
  /** Keep pointer geometry local; model positions and collaboration selections stay unchanged. */
  notePointerCaret(caret?: CaretGeometry): void;
}
