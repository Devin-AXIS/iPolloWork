// The two-way selection mirror and the IME lane (paginated-surface seam).
//
// The painted pages hold the browser's own selection, so there are two copies of one fact:
// the model's and the DOM's. This module owns the traffic between them in both directions —
// reading a gesture back into the model, writing the model back out, and deciding WHICH of
// the two is the newer whenever a repaint finds them disagreeing — plus the one lane where
// the DOM legitimately gets ahead of the model and cannot be stopped: an IME composition.
//
// SELECTION GESTURES ARE THE BROWSER'S. Drag, double-click for a word, triple-click for a
// paragraph, shift-click to extend, and selecting across a page boundary all come free
// because the painted spans are real text. Re-implementing them from records is how a
// surface ends up feeling worse than a textarea. Layout still owns geometry: what comes back
// from the DOM is which CHARACTERS were gestured over, never where they are.

import type { SemanticSelection, CaretGeometry } from '@docx-editor.dev/core/layout';
import {
  applySelectionToDom,
  domSelectionTouchesPages,
  pageIndexOfNode,
  selectionsEqual,
  semanticSelectionFromDom,
} from './dom-selection.ts';
import {
  compositionSpanChanges,
  type CompositionSpanChanges,
  snapshotPaintedSpans,
  type PaintedSpanSnapshot,
} from './surface-composition-readback.ts';
import { createCompositionPreview } from './surface-composition-preview.ts';
import { composedEdit, rebaseComposedText, rebaseOffset } from './surface-composition-rebase.ts';
import {
  composingBaseOf,
  createComposedLane,
  landedBase,
  type ComposingBase,
} from './surface-composition-commit.ts';
import { paintedTextOf, paragraphReplacePlan } from './surface-input.ts';
import { collapsedAt } from './surface-selection-ops.ts';
import { pagesOwnSelection } from './surface-selection-owner.ts';
import type {
  SurfaceSelectionSync,
  SurfaceSelectionSyncDeps,
} from './surface-selection-sync-types.ts';

export type {
  SurfaceSelectionSync,
  SurfaceSelectionSyncDeps,
} from './surface-selection-sync-types.ts';

/**
 * How long after an input method's edit a gesture-less selection change is taken for its
 * correction. Long enough to cover a keyboard that answers on a later frame, between the
 * presses of a held Backspace; each further edit extends it. Short enough that a caret the
 * keyboard moves on purpose (a cursor swipe) is taken up once the user pauses.
 */
const INPUT_METHOD_ECHO_MS = 250;

export function createSurfaceSelectionSync(deps: SurfaceSelectionSyncDeps): SurfaceSelectionSync {
  const { pagesLayer, session } = deps;
  /** The selection's document is the pages' own, wherever they are now. */
  const hostDocument = (): Document => pagesLayer.ownerDocument;

  let applyingSelection = false;
  let lastMirroredSelection: SemanticSelection | null = null;
  /**
   * The sheet the last mapped gesture sat on.
   *
   * A `w:tblHeader` row paints the same paragraph id on every page it repeats. The model
   * position cannot name a copy, so a later remirror must prefer this sheet or it writes
   * the first built one — usually page 0.
   */
  let lastSelectionPageIndex: number | undefined;
  let pointerCaret: CaretGeometry | undefined;

  /**
   * The line the HEAD shows on, when a pointer gesture or a keyboard motion chose one for a
   * position that also starts the next line. It belongs to the head, so an extending motion
   * keeps it; only a collapsed selection paints it as the caret.
   */
  function selectionLineId(): string | undefined {
    const { head } = deps.selection();
    return pointerCaret &&
      pointerCaret.position.paragraphId === head.paragraphId &&
      pointerCaret.position.offset === head.offset
      ? pointerCaret.lineId
      : undefined;
  }

  function rememberSelectionPage(domSelection: Selection | null): void {
    const page =
      pageIndexOfNode(domSelection?.anchorNode, pagesLayer) ??
      pageIndexOfNode(domSelection?.focusNode, pagesLayer);
    if (page !== undefined) lastSelectionPageIndex = page;
  }

  function preferredSelectionPage(domSelection: Selection | null): number | undefined {
    return (
      lastSelectionPageIndex ??
      pageIndexOfNode(domSelection?.anchorNode, pagesLayer) ??
      pageIndexOfNode(domSelection?.focusNode, pagesLayer)
    );
  }
  /**
   * Whether a user selection gesture has an unused adoption opportunity.
   *
   * A deferred paint leaves the DOM caret at `lastMirroredSelection`. Equality with that
   * range is therefore not proof of a stale echo: a native/touch caret can land on exactly
   * the same offset. Pointerdown/selectstart arm provenance for the next adoption check
   * (`adoptBeforeInput` / `onSelectionChange`). The flag is one-shot: it cannot survive
   * into a later, unrelated input. `mirrorToDom` also clears it because that write is a
   * new baseline.
   */
  let userSelectionGesture = false;
  /**
   * Whether the MODEL holds the newer of the two selections.
   *
   * Set by a deliberate move — a commit's post-edit caret, a navigation, undo — and cleared
   * both by the render that pushes it out and by a selection written straight to the DOM.
   * Every other render repaints a selection nobody moved, which is exactly when whatever the
   * user has gestured since is the newer of the two.
   */
  let modelMoved = false;
  /**
   * Whether an IME is composing.
   *
   * `beforeinput` for `insertCompositionText` is NOT cancelable — `preventDefault` is a
   * no-op — so composed text unavoidably lands in the painted DOM. The surface therefore
   * stops repainting for the duration (a repaint mid-composition destroys the IME's own
   * anchor and aborts or duplicates the session) and reconciles once when it ends.
   */
  let composing = false;
  /** The paragraph the composition started in, so the right one is reconciled. */
  let composingParagraph: string | null = null;
  /**
   * Whether this composition began over a range spanning more than one paragraph.
   *
   * The browser replaces such a range with a JOIN, and the readback describes ONE paragraph,
   * so reconciling committed half the edit and dropped the other half — a document matching
   * neither what the user had nor what they saw (#383). These compositions take the lane
   * below instead, which never reads the painted DOM at all.
   */
  let composingAcrossParagraphs = false;
  /**
   * The caret a collapsed composition began at, and the control a keystroke there would type
   * into. The readback places composed text at that caret when the page allows it, and names
   * that control, as typing does.
   */
  let composingOwner: { readonly offset: number; readonly controlId: string } | null = null;
  /** The composing paragraph's text spans at the start, to tell which the browser removed. */
  let composingSpans: readonly PaintedSpanSnapshot[] = [];
  /** What the page showed at the start: text, collapsed caret, revision. The page is not
   * repainted until the end, so a collaborator's edit in between is not on the page. */
  let composingBase: ComposingBase | null = null;
  /** Whether the input method has written yet: the page is held from that write on. */
  let composingWritten = false;
  const packageRevision = () => session.packageRevision();
  /** Composed insertions read back and not committed yet: surface-composition-commit. */
  const composed = createComposedLane(deps, () => landComposed(), pagesLayer);
  const baseOf = (paragraphId: string): ComposingBase =>
    composingBaseOf({ ...deps, packageRevision }, paragraphId, composed.unpainted());
  /** Commit queued composed text. False when it did not land as the page shows it. */
  function landComposed(): boolean {
    const clean = composed.land(composing && composingWritten);
    if (composingBase) composingBase = landedBase(composingBase, clean, packageRevision());
    return clean;
  }

  /**
   * Take up a selection the user has made but the queued `selectionchange` has not delivered.
   *
   * Assigns rather than going through `setSelection`: the render this runs inside is about to
   * mirror the selection into the DOM and report the new state anyway.
   */
  function adoptPendingDomSelection(): boolean {
    const domSelection = hostDocument().getSelection();
    const next = composed.read(domSelection);
    if (!next) return false;
    rememberSelectionPage(domSelection);
    if (selectionsEqual(next, deps.selection())) return false;
    deps.adoptSelection(next);
    return true;
  }

  const ownsSelection = (): boolean => pagesOwnSelection(pagesLayer);

  /** Mirror the native selection into the model. Ignores selections outside painted text. */
  const adoptDomSelection = (): void => {
    const domSelection = hostDocument().getSelection();
    const next = composed.read(domSelection);
    if (!next) {
      // NOT MAPPING IS NOT NOTHING HAPPENING.
      //
      // A gesture that landed inside these pages and resolved to no model position — header
      // furniture, which names paragraphs of another part — used to return here silently,
      // leaving the model on the range it held BEFORE. The browser then showed one selection
      // and the model held another, so the next toolbar command formatted text the user was
      // no longer looking at. Collapsing costs a range the model could not address anyway;
      // keeping one costs an edit in the wrong place.
      if (!domSelectionTouchesPages(pagesLayer, domSelection)) return;
      userSelectionGesture = false;
      const collapsed = collapsedAt(deps.selection().head);
      if (selectionsEqual(collapsed, deps.selection())) return;
      deps.setSelection(collapsed);
      return;
    }
    // A mapped caret is the adoption opportunity the gesture armed. Consume it here so an
    // empty selectionchange (removeAllRanges mid-gesture) cannot spend it, and so a click
    // on the already-current caret cannot authorize a later stale echo.
    userSelectionGesture = false;
    rememberSelectionPage(domSelection);
    if (selectionsEqual(next, deps.selection())) return;
    deps.setSelection(next);
  };

  /**
   * Commit whatever the browser wrote into a paragraph that the surface could not intercept.
   *
   * The diff itself lives in surface-input.ts; this applies it and lands the caret.
   */
  function reconcileParagraphFromDom(
    paragraphId: string,
    owner: { readonly offset: number; readonly controlId: string } | null,
    changes: CompositionSpanChanges,
    base: ComposingBase | null
  ): boolean {
    // Read against the text the page shows, which is the text the composition began over.
    const baseText = base?.text ?? deps.textOf(paragraphId);
    // The browser's own selection says WHICH painted copy was composed into, for a paragraph
    // the page repeats: a shared header, a `w:tblHeader` row, a twice-referenced note. The IME
    // leaves the caret in the text it just committed, so this is that copy.
    const read = paintedTextOf(
      pagesLayer,
      paragraphId,
      base?.read ?? baseText,
      hostDocument().getSelection()?.anchorNode ?? null,
      changes
    );
    if (read === null) return false;
    // A plain insertion queues as typing does; until it lands, a caret echo is not the user's.
    if (composed.queue(paragraphId, base, owner !== null, read)) return (modelMoved = true);
    // Anything else edits the text the queued insertions complete: they land first.
    if (composed.pending() && base) base = landedBase(base, landComposed(), packageRevision());
    // A collaborator's edit landed while composing: in the model, held off the page. Land the
    // layout (the page has been read) and carry the composed edit onto the current text.
    let modelText = baseText;
    if (base && packageRevision() !== base.revision) {
      deps.flushToPaint();
      modelText = deps.textOf(paragraphId);
      if (owner) owner = { ...owner, offset: rebaseOffset(baseText, modelText, owner.offset) };
      // A remote split or join took the caret into another paragraph: the composed text goes
      // where the caret went, as typing would.
      const edit = composedEdit(baseText, read, base.caret);
      const head = deps.selection().head;
      if (base.caret !== null && edit.start === edit.end && head.paragraphId !== paragraphId) {
        session.beginComposition(deps.storyScope());
        if (edit.text.length > 0) deps.replaceSelectionWith?.(edit.text);
        return false;
      }
    }
    const painted = rebaseComposedText(baseText, read, modelText, base?.caret ?? null);
    const plan = paragraphReplacePlan(paragraphId, modelText, painted);
    if (!plan) return false;
    // Composed text takes the armed caret format like typed text would — same transaction,
    // one undo step. Asked BEFORE the commit (which retires the armed state), and only for
    // an insert landing exactly on the armed anchor; a diff that resolved elsewhere simply
    // forgets the format. Story scope routes IME commits into an open HF/note part.
    const remove = plan.ops.find(
      (op): op is Extract<(typeof plan.ops)[number], { op: 'deleteText' }> => op.op === 'deleteText'
    );
    const insert = plan.ops.find(
      (op): op is Extract<(typeof plan.ops)[number], { op: 'insertText' }> => op.op === 'insertText'
    );
    // The diff's offset is the pre-delete one. Suggesting keeps the struck characters, so
    // that offset now points in FRONT of them.
    const landing =
      insert && remove
        ? deps.replacementOffset?.(paragraphId, remove.start, remove.end)
        : undefined;
    // Text composed at a text control's trailing edge belongs to the control, as typed text
    // does. An offset alone gives that boundary to the run after the control, which forms
    // protection refuses. The diff takes the longest common prefix, so composed text that
    // repeats the text after the caret (`에` before `에서`) resolves to a later offset, past
    // the control's end. The composition began at the caret, so the insert is placed there
    // whenever that gives the same paragraph text, and then names the control.
    const anchored =
      insert && !remove && owner !== null && insert.offset >= owner.offset
        ? painted.slice(owner.offset, owner.offset + insert.text.length)
        : null;
    const named =
      insert &&
      owner !== null &&
      anchored !== null &&
      modelText.slice(0, owner.offset) + anchored + modelText.slice(owner.offset) === painted
        ? { ...insert, offset: owner.offset, text: anchored, inside: owner.controlId }
        : null;
    const ops =
      insert && landing !== undefined && landing !== insert.offset
        ? plan.ops.map((op) => (op === insert ? { ...insert, offset: landing } : op))
        : named
          ? plan.ops.map((op) => (op === insert ? named : op))
          : plan.ops;
    const formatOps = insert
      ? (deps.pendingFormatOps?.(
          paragraphId,
          named?.offset ?? landing ?? insert.offset,
          insert.text.length,
          remove ? { start: remove.start, end: remove.end } : undefined
        ) ?? [])
      : [];
    // Read before the write: the store clears the prompt flag that the landing rule reads.
    const namedCaret = named
      ? (deps.promptLanding?.(paragraphId, named.offset, named.text.length) ??
        named.offset + named.text.length)
      : undefined;
    const scope = deps.storyScope();
    // Opened here, after any queued text landed: each composition is its own history entry.
    session.beginComposition(scope);
    deps.commit(() => {
      const result = deps.applyOps([...ops, ...formatOps], deps.selectionMark(), scope);
      // The composed text is not the armed format's hostage: a refused format op must not
      // take the IME's own edit down with it (the same rule `type()` follows).
      if (formatOps.length === 0 || !result.rejected) return result;
      return deps.applyOps(ops, deps.selectionMark(), scope);
    });
    deps.setSelection(
      collapsedAt({
        paragraphId,
        offset:
          namedCaret !== undefined
            ? namedCaret
            : insert && landing !== undefined
              ? landing + insert.text.length
              : plan.caret,
      })
    );
    return false;
  }

  /**
   * Take up a selection the user made whose `selectionchange` has not been delivered yet.
   *
   * Shared by `adoptBeforeInput` and `onCompositionStart`, which need the same thing for the
   * same reason: both are about to decide what a command edits, and `selectionchange` is
   * queued, so the model can still hold the range from before a click or a drag.
   */
  function adoptPendingUserSelection(): void {
    // Engine-owned pointer drags and cell rectangles deliberately outrank the browser's
    // native selection. A composition already in flight has its own DOM readback.
    if (applyingSelection || composing) return;
    if (deps.isGesturing?.()) return;
    if (deps.holdsCellSelection?.()) return;
    // Same window `onSelectionChange` guards: a deferred paint leaves the DOM caret at
    // the last mirrored (pre-edit) offset. Adopting it here — so a click that has not
    // yet produced `selectionchange` still edits the clicked point — would otherwise
    // insert the next character at that stale offset and reorder a typing burst.
    // A genuine pointer/touch/selectstart gesture still wins, even if it lands on that
    // same pre-edit offset; a queued echo has no such provenance and is skipped.
    // `adoptDomSelection` spends the one-shot once it sees a mapped caret, so a click on
    // the already-current caret cannot authorize a later stale echo.
    if (isStaleMirroredCaret()) return;
    // A KEYSTROKE IS NOT A SELECTION GESTURE. This reader exists for one case — a click or
    // a drag whose `selectionchange` is still queued when the next key arrives — and that
    // case always arms the flag first. Without the check, every keystroke re-read a browser
    // selection nobody had moved, so a caret the DOM had resolved onto a container after a
    // repaint pulled the model to the paragraph start on key after key.
    if (!userSelectionGesture) return;
    adoptDomSelection();
  }

  /**
   * Whether the DOM caret is still the last value this surface wrote, while the model has
   * already moved on, AND no unused user-selection gesture is authorizing this check.
   *
   * Deferred paint is the usual case: `commit` raises `modelMoved` and skips `mirrorToDom`
   * until the input queue drains, so the browser keeps showing the PRE-edit caret. That
   * leftover is not a user gesture. Equality with `lastMirroredSelection` is not enough on
   * its own: a native or touch caret can return to that exact offset on purpose. A still-
   * armed pointerdown/selectstart is that gesture; a queued selectionchange echo has none.
   */
  function isStaleMirroredCaret(): boolean {
    if (!modelMoved || userSelectionGesture) return false;
    // NO BASELINE AT ALL means the last mirror was REFUSED — the position had no painted
    // place to land, or this surface did not own the selection. The browser is then still
    // showing something older than the model by construction, and nobody has gestured since.
    // Reading it back is how a caret the DOM could not express became a caret at the
    // paragraph start.
    if (!lastMirroredSelection) return true;
    const reported = semanticSelectionFromDom(pagesLayer, hostDocument().getSelection());
    return reported !== null && selectionsEqual(reported, lastMirroredSelection);
  }

  /** Arm one adoption opportunity. Secondary buttons are not a caret gesture. */
  function noteUserSelectionGesture(event: Event): void {
    if (event.type.startsWith('pointer') && (event as PointerEvent).button !== 0) return;
    userSelectionGesture = true;
    gestureSinceInputMethodEdit = true;
  }

  /**
   * Whether the next in-pages `selectionchange` may be the browser's own fix-up of a
   * prevented replacement rather than a user selection. One-shot: spent by the first
   * `selectionchange` that touches the pages. See `noteBrowserSelectionFixup`.
   */
  let browserSelectionFixup = false;
  /** Until when (on `deps.now()`) a gesture-less selection change may be an IME correction. */
  let inputMethodEchoUntil = Number.NEGATIVE_INFINITY;
  /**
   * Whether a pointer or `selectstart` gesture began since the last input method edit. Kept
   * apart from `userSelectionGesture`, which every mirror spends: a tap whose `selectionchange`
   * arrives after a repaint is still the user's.
   */
  let gestureSinceInputMethodEdit = false;
  const inputMethodEchoing = (): boolean => deps.now() < inputMethodEchoUntil;

  function mirrorToDom(claim = false): void {
    // Ahead of the ownership guard: the caret is this engine's own, painted whether or not
    // the browser's selection lives here.
    deps.updateCaret();
    // Only when this surface owns the selection. A render runs on mount and on every commit
    // — including one from another editor sharing the store — and writing unconditionally
    // yanked the caret out of whatever the user was actually typing in. A CLAIMED write is
    // the exception: someone asked for this range on purpose.
    if (!claim && !ownsSelection()) return;
    applyingSelection = true;
    const began = deps.now();
    const next = deps.domSelection?.() ?? deps.selection();
    // This write is the new baseline. Matching DOM carets after it are echoes until the
    // user starts another selection gesture.
    userSelectionGesture = false;
    const native = hostDocument().getSelection();
    const preferredPageIndex = preferredSelectionPage(native);
    const preferredLineId = selectionLineId();
    const wrote = applySelectionToDom(pagesLayer, next, native, {
      ...(preferredPageIndex !== undefined ? { preferredPageIndex } : {}),
      ...(preferredLineId !== undefined ? { preferredLineId } : {}),
    });
    if (wrote) rememberSelectionPage(native);
    // A REFUSED write is not a baseline. `applySelectionToDom` answers false when either
    // endpoint has no painted place to land — a caret in a paragraph that painted no spans,
    // an offset no span covers, a page that is not built — and the browser then keeps
    // showing the PREVIOUS selection. Recording it anyway told `isStaleMirroredCaret` that
    // the DOM had been given this value, so the disagreement it exists to catch read as a
    // fresh gesture, and the stale caret won the next echo. The model is still the newer of
    // the two here, which is exactly what `modelMoved` says.
    lastMirroredSelection = wrote ? next : null;
    if (!wrote) modelMoved = true;
    deps.recordSelectionMs(deps.now() - began);
    // Cleared on a LATER task, because `selectionchange` is queued rather than dispatched
    // synchronously. Clearing it here would defeat the guard in every real browser while
    // still appearing to work under a synchronous test DOM.
    queueMicrotask(() => {
      applyingSelection = false;
    });
  }

  // Native pointer mode binds no engine handlers; touch bypasses them even in engine mode.
  // Capture here so a caret that lands on the last mirrored offset is still a gesture.
  pagesLayer.addEventListener('pointerdown', noteUserSelectionGesture, true);
  pagesLayer.addEventListener('selectstart', noteUserSelectionGesture, true);
  // The composing text stays visible in a run painted to a clipped advance.
  const preview = createCompositionPreview(pagesLayer);
  const trackComposition = (): void => {
    if (!composing) return;
    preview.track();
    if (composingWritten) return;
    // The first write: from here the page is the input method's. A paint that landed since
    // `compositionstart` (a collaborator's edit) is what the input method wrote over. Queued
    // text holds the paint, so while it waits, no paint landed and the carried base stands.
    composingWritten = true;
    deps.holdPaint?.(true);
    if (composingParagraph !== null && composingBase !== null && !composed.pending()) {
      composingBase = baseOf(composingParagraph);
    }
  };
  pagesLayer.addEventListener('input', trackComposition);

  return {
    adoptBeforePaint() {
      // ADOPT BEFORE PAINTING.
      //
      // `selectionchange` is QUEUED, never dispatched from the gesture that caused it, so
      // between the browser making a selection and this surface hearing about it there is a
      // window on every browser. A repaint landing inside that window used to replace the
      // nodes the selection lives in and then write the MODEL's older selection into the new
      // ones — so a double-click was made correctly and did not survive the next scroll, and
      // the model never learned the word had been selected at all. Reading the DOM first
      // makes the repaint carry the gesture rather than erase it.
      //
      // A deliberate model move is the exception, and the reason this cannot simply refuse to
      // write: a commit installs its own post-edit caret, and the DOM selection left over
      // from before the edit addresses offsets that no longer mean the same thing.
      // The SAME two reasons `onSelectionChange` refuses apply here, and this is the reader
      // that runs on every repaint. A rectangle of cells keeps the DOM deliberately collapsed,
      // so a scroll or an undo would "adopt" that collapse, leave the overlay painting four
      // cells, and turn the next Delete into a one-character edit inside one of them.
      //
      // A REPAINT MAY CARRY A GESTURE; IT MAY NEVER INVENT ONE. `modelMoved` is spent by the
      // first repaint after a commit, and an edit can produce more than one — a settled image
      // resource, a deferred publish, a scroll all repaint again while the caret this edit
      // installed is still the newest thing anybody moved. Those later repaints used to read
      // the browser's selection and take it, and the browser's answer after a page's DOM has
      // been rebuilt under it is the paragraph start. So the first character typed at the end
      // of a paragraph landed, the caret went home to offset 0, and every character after it
      // was inserted in front of the one before: "Hello" arrived as "elloH".
      //
      // The provenance is the whole test. A gesture arms `userSelectionGesture` on
      // pointerdown/selectstart before `selectionchange` is queued, which is exactly the
      // window this reader exists to close; a browser fix-up after a repaint arms nothing.
      const holdOff =
        deps.holdsCellSelection?.() === true ||
        deps.isGesturing?.() === true ||
        deps.hasPendingInput?.() === true;
      const adopted =
        modelMoved || holdOff || !userSelectionGesture ? false : adoptPendingDomSelection();
      // Before the paint, so a run it keeps is clipped as painted. Not at `compositionend`:
      // composed text stays visible where it was written until this paint replaces it.
      if (!composing) {
        preview.restore();
        composed.painted();
      }
      // Spent only when the buffer is not holding the answer back: a repaint that deferred to
      // the flush has not made the decision this flag records, and clearing it would let the
      // NEXT repaint adopt a DOM the commit is about to move.
      if (deps.hasPendingInput?.() !== true) modelMoved = false;
      return adopted;
    },

    noteModelMoved() {
      modelMoved = true;
      pointerCaret = undefined;
    },

    noteSelectionSettled() {
      // SEPARATE from `mirrorToDom`, which is where this obviously belongs and where it
      // would be wrong: the mirror refuses to write when this surface does not own the
      // selection, and in that case the model IS still the newer of the two. The flag is
      // spent by the decision to publish a selection, not by the write succeeding.
      modelMoved = false;
    },

    mirrorToDom,

    adoptBeforeInput: adoptPendingUserSelection,

    isComposing: () => composing,

    continuesComposition: () => composed.carried(baseOf) !== null,

    landComposed: () => void landComposed(),

    noteBrowserSelectionFixup() {
      browserSelectionFixup = true;
    },

    noteInputMethodEdit() {
      inputMethodEchoUntil = deps.now() + INPUT_METHOD_ECHO_MS;
      gestureSinceInputMethodEdit = false;
    },

    noteKeyDown(event) {
      if (event.key !== 'Unidentified' && event.keyCode !== 229 && !event.isComposing)
        inputMethodEchoUntil = Number.NEGATIVE_INFINITY;
    },

    browserSelectionTrusted: () => !inputMethodEchoing() || gestureSinceInputMethodEdit,

    onSelectionChange: (): void => {
      // Ignore the echo of our own write, and anything happening outside the pages. The flag
      // is cleared on a later task rather than synchronously: browsers QUEUE `selectionchange`
      // rather than firing it from `setBaseAndExtent`, so clearing it in a `finally` would
      // leave it false by the time the echo arrives — and every programmatic selection would
      // be read straight back, fighting the user mid-drag.
      if (applyingSelection) return;
      if (composing) return;
      // Focus in other chrome (an open context menu, a popover field): a change here is a
      // repaint replacing the nodes the selection sat in, never a gesture. Adopting that
      // collapsed selection moved the caret to the document start, and the claimed write
      // then took focus back from that chrome.
      if (!ownsSelection()) return;
      if (deps.isGesturing?.()) return;
      if (deps.holdsCellSelection?.()) return;
      // A prevented `insertReplacementText` leaves the browser's own selection parked over
      // the text IT wanted to replace — a fix-up with no gesture behind it, written over a
      // paint that can be a commit behind the model. Adopting it highlighted a stale range
      // and every keystroke after typed there. Re-assert the model's selection instead; a
      // real gesture spends the flag too but keeps its provenance and wins. An echo that
      // already MATCHES the model does not spend the one-shot: it is this surface's own
      // mirror reporting back, and spending on it would leave a park that lands on a later
      // task unguarded.
      if (
        browserSelectionFixup &&
        domSelectionTouchesPages(pagesLayer, hostDocument().getSelection())
      ) {
        const reported = semanticSelectionFromDom(pagesLayer, hostDocument().getSelection());
        if (reported === null || !selectionsEqual(reported, deps.selection())) {
          browserSelectionFixup = false;
          if (!userSelectionGesture) {
            mirrorToDom();
            return;
          }
        }
      }
      // A deferred paint leaves the DOM caret at its PRE-edit offset while the model already
      // holds the post-edit one. A late echo from an earlier mirror must not make that stale
      // DOM caret authoritative again; the pending paint will mirror the newer model value.
      if (isStaleMirroredCaret()) return;
      // An input method correcting the caret after its own edit, or the caret Chromium left
      // after a deletion it applied itself. Adopting either moved the model caret, and every
      // later deletion landed mid-word or in another paragraph. A gesture has provenance.
      if (
        inputMethodEchoing() &&
        !userSelectionGesture &&
        !gestureSinceInputMethodEdit &&
        domSelectionTouchesPages(pagesLayer, hostDocument().getSelection())
      ) {
        // With a paint still owed, the model's offsets do not address these spans yet; that
        // paint writes the model selection back itself.
        if (modelMoved) return;
        const reported = semanticSelectionFromDom(pagesLayer, hostDocument().getSelection());
        if (reported === null || !selectionsEqual(reported, deps.selection())) mirrorToDom();
        return;
      }
      // The browser's own caret just past unpainted composed text (`ComposedLane.echo`).
      if (!userSelectionGesture && composed.echo(hostDocument().getSelection())) return;
      adoptDomSelection();
    },

    onCompositionStart: (): void => {
      // NOTHING IS TOUCHED HERE. Not the model, not the DOM, not the selection.
      //
      // The tempting fix for #383 is to delete the range now, so the composition starts
      // collapsed inside one paragraph. It does not hold: `commit` may DEFER its paint
      // (`isInputPending`, Chromium only), so the browser's own selection is still the
      // two-paragraph range when this handler returns and the deferred paint then lands
      // mid-composition — replacing the nodes the IME is composing into and rewriting the
      // selection under it. That is the "repaint mid-composition destroys the IME's anchor"
      // hazard this flag exists to prevent, and it would fire on every such composition.
      // WHICH LANE this composition takes is decided from the selection, so it has to be the
      // selection the USER has — not the one the model held before their click or drag, whose
      // `selectionchange` may still be queued. Reading the model alone chose the readback lane
      // for a range the browser had already extended across two paragraphs, and #383 came
      // straight back. A keydown ahead of `compositionstart` happens to close that window on
      // desktop; a touch drag on Android produces no keydown at all.
      //
      // NOT COVERED BY THE SUITE, deliberately noted rather than quietly assumed: happy-dom
      // dispatches `selectionchange` synchronously, so the model is never stale there and a
      // test of this would pass with the call removed.
      adoptPendingUserSelection();
      composing = true;
      const selection = deps.selection();
      // Over the last composition's unpainted commit the layout is a pass behind; the caret is
      // just past text that commit placed, so neither a prompt nor a control can claim it.
      const carried = composed.carried(baseOf) !== null;
      composingAcrossParagraphs =
        selection.anchor.paragraphId !== selection.head.paragraphId ||
        (!carried && deps.compositionUsesTyping?.() === true);
      composingParagraph = selection.head.paragraphId;
      const collapsed =
        !composingAcrossParagraphs && selection.anchor.offset === selection.head.offset;
      const controlId = collapsed && !carried ? deps.insertOwner?.() : undefined;
      composingOwner =
        controlId === undefined ? null : { offset: selection.head.offset, controlId };
      composingSpans = composingAcrossParagraphs
        ? []
        : snapshotPaintedSpans(pagesLayer, composingParagraph);
      composingBase = composingAcrossParagraphs ? null : baseOf(composingParagraph);
      composingWritten = false;
      preview.track();
    },

    onCompositionEnd: (event?: CompositionEvent): void => {
      composing = false;
      composingWritten = false;
      deps.holdPaint?.(false);
      const paragraphId = composingParagraph ?? deps.selection().head.paragraphId;
      composingParagraph = null;
      const owner = composingOwner;
      composingOwner = null;
      const acrossParagraphs = composingAcrossParagraphs;
      composingAcrossParagraphs = false;
      const changes = compositionSpanChanges(composingSpans);
      const base = composingBase;
      composingBase = null;
      composingSpans = [];
      // ONE scope, sampled once. `type()` can move the active story (a note released by the
      // post-edit caret), and two reads either side would then compare two different stores'
      // clocks — a number that means nothing, and a rebuild that does not happen.
      const scope = deps.storyScope();
      const before = session.revisionFor(scope);
      let queued = false;

      if (acrossParagraphs) {
        // THE EVENT CARRIES THE ANSWER, so the painted DOM never has to be asked. `data` on
        // `compositionend` is the finished composed string, which is the one thing a
        // two-paragraph readback would have had to recover from a page the browser rewrote
        // in a shape this engine did not choose.
        //
        // Replacing the still-untouched selection with it is what typing over a selection
        // means, and it goes through the very same call — one transaction inside the
        // composition's own history entry, so it is ONE undo step, with attribution,
        // protection and refusals all applying as they do to typed text.
        const text = event?.data ?? '';
        landComposed();
        session.beginComposition(scope);
        if (text.length > 0) deps.replaceSelectionWith?.(text);
      } else {
        // The composed text is in the DOM and nowhere else. Read it back, diff it against
        // what the model holds for that paragraph, and commit the difference — the only
        // route by which an IME edit can reach the tree, since it could not be intercepted.
        queued = reconcileParagraphFromDom(paragraphId, owner, changes, base);
      }

      session.endComposition();
      // Queued: the page shows it, and it commits on a later task.
      if (queued) return;
      // THE BROWSER WROTE ON THE PAGE WHATEVER THE MODEL DID. When the model did not move —
      // the composition was cancelled, or its edit was refused — an unchanged layout repaints
      // nothing by design, so those characters would simply stay on screen, and in a document
      // nobody can edit nothing would ever remove them. Forget the retained paint so the
      // render below rebuilds from records.
      if (session.revisionFor(scope) === before) deps.discardPaint?.();
      // The readback's own commit may have deferred its layout or paint under input
      // pressure; land both, and render exactly ONCE — either the flush's own catch-up
      // paint, or the explicit rebuild the discarded-paint case needs.
      if (!deps.flushToPaint()) deps.render();
    },

    selectionPageIndex: () => lastSelectionPageIndex,
    selectionLineId,
    caretPreference(preferredPageIndex = lastSelectionPageIndex) {
      const preferredLineId = selectionLineId();
      return {
        ...(preferredPageIndex !== undefined ? { preferredPageIndex } : {}),
        ...(preferredLineId !== undefined ? { preferredLineId } : {}),
      };
    },
    notePointerCaret(caret) {
      pointerCaret = caret;
      if (caret) lastSelectionPageIndex = caret.pageIndex;
    },
    destroy() {
      pagesLayer.removeEventListener('pointerdown', noteUserSelectionGesture, true);
      pagesLayer.removeEventListener('selectstart', noteUserSelectionGesture, true);
      pagesLayer.removeEventListener('input', trackComposition);
      preview.restore();
      userSelectionGesture = false;
    },
  };
}
