import { createContextualRunFormatting } from '../layout/complex-script-formatting.ts';
import { paragraphMarkFace } from '../layout/paragraph-mark-face.ts';
import { caretWordAt as layoutCaretWordAt, hiddenRevisionRanges } from '../layout/caret-word.ts';

// Run and paragraph property edits at the selection (paginated-surface seam).
//
// The formatting lane: toggling a run property, setting one outright, and setting a
// paragraph property. They share one rule the structural edits do not — a change that
// covers a WHOLE paragraph also writes its mark, because that is what a list marker
// inherits its face from.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { StoryScope } from '@docx-editor.dev/core/store';
import {
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import {
  directParagraphMarkProperties,
  directParagraphProperties,
  formattingAt,
  hasAuthoredRunProperties,
  isAuthorableRunProperty,
  isRunPropertyActive,
  mergedProperties,
  paragraphMarkOps,
  paragraphPropertiesOf,
  paragraphsInRange,
  pendingPropertyState,
  withPendingFormatting,
  type SurfaceProperty,
} from './surface-formatting.ts';
import { formattableRanges } from '@docx-editor.dev/core/store';
import { findNode } from '../store/package/ooxml-edit.ts';
import { isEastAsianFontFamily } from '../store/package/default-font-faces.ts';
import { formattingRangeBesideRestrictedControl } from '../store/store/direct-properties.ts';
import {
  noteReferenceEndingAt,
  noteTypingSourceRange,
} from '../store/store/note-typing-boundary.ts';
import type {
  FormattingDisplayMode,
  FormattingRevisionAuthorFilter,
  TreeDocOp,
} from '@docx-editor.dev/core/store';
import { paragraphsInCells } from '@docx-editor.dev/core/layout';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { directionalParagraphEntry } from './paragraph-direction-writes.ts';

/** What the composition root lends this lane. */
export interface SurfaceFormatDeps {
  runFormatRefusal?(): string | null;
  readonly session: TreeDocxSessionView;
  /**
   * Applies formatting ops outside every generated table of contents: ops that reach one are
   * dropped, and the rest apply even though the selection covers the table. When every op
   * reaches one, the write keeps the read-only refusal.
   */
  applyOutsideToc?(
    ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0],
    apply: (ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0]) => TreeApplyResult
  ): TreeApplyResult;
  /** Active story for mutations — body or `{ kind: 'headerFooter', rId }`. */
  storyScope(): StoryScope;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  /**
   * Which revision halves the reader is LOOKING at.
   *
   * The formatting walks take it because a write must not restyle text the view hides: in the
   * resolved result a tracked deletion paints nothing and still owns its offsets, so a
   * selection across visible words sweeps it (#497). In All Markup that text is on the page
   * and the write reaches it. Read per call — the surface's own mode is a mount option today,
   * and a future `setRevisionDisplayMode` must move this with it.
   */
  displayMode(): FormattingDisplayMode;
  /** Reviewer visibility projected into the formatting walk. */
  authorFilter(): FormattingRevisionAuthorFilter | undefined;
  /** False when this paragraph's pilcrow is absorbed by the active revision projection. */
  paragraphMarkVisible(paragraphId: string): boolean;
  commit(
    run: () => TreeApplyResult | boolean,
    nextSelection?: () => SemanticSelection | null,
    options?: { readonly keepCellSelection?: boolean }
  ): string | null;
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  textOf(paragraphId: string): string;
  /** Paragraph ids in reading order for the active scope (body or open furniture story). */
  paragraphOrder(): readonly string[];
  /**
   * The cells a rectangular table selection covers, when one is live.
   *
   * A rectangle is NOT the text range it stands in for: rows one and two of column one, read
   * as a range, sweep through every cell between them — so a toolbar reading the range
   * reports formatting from cells the user never selected.
   */
  selectedCells?(): readonly string[] | undefined;
  /**
   * The stored-marks lane: run properties armed at a collapsed caret, applied to the next
   * characters typed there. Owned by the composition root because IT knows when the caret
   * moves (which discards them) and when `type()` consumes them.
   */
  pendingFormats(): readonly SurfaceProperty[] | null;
  setPendingFormats(next: readonly SurfaceProperty[] | null): void;
  /**
   * The document's default paragraph style, so a paragraph that names none reports the
   * style it is actually written in rather than nothing.
   */
  defaultParagraphStyleId?(): string | null;
  /**
   * The face a run with no authored font is measured in, so `formatting()` reports it
   * instead of null (the run-defaults twin of `defaultParagraphStyleId`).
   */
  defaultFontFamily?(): string | null;
}

type FormatMethods = Pick<
  PaginatedSurface,
  | 'setRunProperty'
  | 'setRunProperties'
  | 'setParagraphProperty'
  | 'setParagraphProperties'
  | 'toggleRunProperty'
  | 'formatting'
  | 'clearFormatting'
>;

export function createSurfaceFormat(deps: SurfaceFormatDeps): FormatMethods {
  const { runPropertyEdits, mergedParagraphMarkProperties } = createContextualRunFormatting(
    () => deps.session.stylesRoot(),
    () => deps.session.settingsRoot(),
    () => deps.displayMode(),
    () => deps.authorFilter()
  );

  const { session, commit, orderedRange, selectionMark, textOf } = deps;
  const displayMode = (): FormattingDisplayMode => deps.displayMode();
  const authorFilter = (): FormattingRevisionAuthorFilter | undefined => deps.authorFilter();
  const storyPart = () => session.partFor(deps.storyScope()) ?? session.part();
  // A caret beside a control that typing cannot enter reads the run that typing will copy,
  // outside the control, rather than the control's own run; or no run, when typing copies none.
  // After a note reference it reads the run whose face typing takes, never the reference run.
  // With no such run, typing takes the paragraph mark's face, which `markFace` carries
  // resolved through the styles; after a reference that ends a link, it takes no face.
  const formattingSelection = (
    selection: SemanticSelection
  ): {
    readonly selection: SemanticSelection;
    readonly caretSpan: boolean;
    readonly markFace?: readonly SurfaceProperty[];
  } => {
    const { anchor, head } = selection;
    if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) {
      return { selection, caretSpan: true };
    }
    const paragraph = findNode(storyPart(), head.paragraphId);
    if (paragraph?.kind !== 'paragraph') return { selection, caretSpan: true };
    const afterNote = noteReferenceEndingAt(paragraph, head.offset) !== undefined;
    const run = afterNote
      ? noteTypingSourceRange(paragraph, head.offset)
      : formattingRangeBesideRestrictedControl(paragraph, head.offset);
    if (run === undefined) return { selection, caretSpan: !afterNote };
    if (run === null && afterNote) {
      const markFace = paragraphMarkFace(paragraph, session.stylesRoot(), session.settingsRoot());
      return { selection, caretSpan: false, markFace };
    }
    if (run === null) return { selection, caretSpan: false };
    const start = run.end <= head.offset ? run.end - 1 : run.start;
    return {
      selection: {
        anchor: { paragraphId: head.paragraphId, offset: start },
        head: { paragraphId: head.paragraphId, offset: start + 1 },
      },
      caretSpan: true,
    };
  };
  // A font pick (`w:ascii` and `w:hAnsi` set to one family, nothing else) of an EAST ASIAN
  // font also sets `w:eastAsia`, so the pick reaches Chinese, Japanese, and Korean text. A
  // Latin font leaves `w:eastAsia` alone: it has no CJK glyphs, and writing it there would
  // repaint the ideographs in a fallback face. The font is East Asian by its name only.
  const withEastAsianSlot = (
    attributes: Record<string, string> | undefined
  ): Record<string, string> | undefined => {
    const family = attributes?.ascii;
    if (!family || attributes.hAnsi !== family || Object.keys(attributes).length !== 2) {
      return attributes;
    }
    return isEastAsianFontFamily(family) ? { ...attributes, eastAsia: family } : attributes;
  };
  const applyOps = (
    ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0],
    before?: Parameters<TreeDocxSessionView['applyTreeOps']>[1],
    after?: Parameters<TreeDocxSessionView['applyTreeOps']>[2]
  ) => {
    const apply = (kept: typeof ops) =>
      session.applyTreeOps(kept, before, after, deps.storyScope());
    return deps.applyOutsideToc ? deps.applyOutsideToc(ops, apply) : apply(ops);
  };
  /** The refusal of any run format here, reported, or null when formatting may go ahead. */
  const refuseRunFormat = (): string | null => {
    const reason = deps.runFormatRefusal?.();
    if (!reason) return null;
    return deps.commit(() => ({ committed: false, rejected: true, opCount: 0, reason })) ?? reason;
  };
  const currentLayout = {
    get value(): SemanticLayout {
      return deps.layout();
    },
  };
  const selectionNow = {
    get value(): SemanticSelection {
      return deps.selection();
    },
  };

  /**
   * Write one run property across the selected range — however many paragraphs it spans.
   *
   * One op per run the range covers, each stating that run's own properties plus the
   * incoming one, and — for every paragraph the range covers WHOLE — the same change to that
   * paragraph's mark over the mark's own properties.
   *
   * The range is walked the same way `planRangeDeletion` walks it: the tail of the first
   * paragraph, every paragraph in between entire, then the head of the last. Formatting used
   * to stop at the first pilcrow, which left the whole run-formatting half of the toolbar
   * disabled on a cross-paragraph selection while the READS (already range-wide) reported
   * state no control could change.
   *
   * Every base comes from the canonical tree rather than the layout, because the layout
   * publishes the cascade and an op that restates the cascade is either refused outright or
   * silently freezes inherited formatting as direct — see `runPropertyEdits`.
   */
  const writeRunProperty = (
    from: SemanticPosition,
    to: SemanticPosition,
    incoming: SurfaceProperty | readonly SurfaceProperty[]
  ): string | null => {
    const part = storyPart();
    if (from.paragraphId === to.paragraphId) {
      const edits = runPropertyEdits(
        part,
        from.paragraphId,
        from.offset,
        to.offset,
        incoming,
        displayMode(),
        authorFilter()
      );
      // No run in range means nothing was formatted, so the mark must not move either.
      if (edits.length === 0) return null;
      const markProperties = mergedParagraphMarkProperties(part, from.paragraphId, incoming);
      return commit(() =>
        applyOps(
          [
            ...edits.map((edit) => ({
              op: 'setRunProperties' as const,
              paragraphId: from.paragraphId,
              start: edit.start,
              end: edit.end,
              properties: edit.properties,
              ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
            })),
            ...(deps.paragraphMarkVisible(from.paragraphId)
              ? paragraphMarkOps(textOf(from.paragraphId), from, to, markProperties)
              : []),
          ],
          selectionMark()
        )
      );
    }
    const order = deps.paragraphOrder();
    const firstIndex = order.indexOf(from.paragraphId);
    const lastIndex = order.indexOf(to.paragraphId);
    // An endpoint the published order does not know is a layout that has not caught up;
    // writing a partial range would be worse than writing none.
    if (firstIndex === -1 || lastIndex === -1) return null;
    const ops: TreeDocOp[] = [];
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const paragraphId = order[index]!;
      const text = textOf(paragraphId);
      const start = index === firstIndex ? from.offset : 0;
      const end = index === lastIndex ? to.offset : text.length;
      const edits =
        start < end
          ? runPropertyEdits(part, paragraphId, start, end, incoming, displayMode(), authorFilter())
          : [];
      for (const edit of edits) {
        ops.push({
          op: 'setRunProperties',
          paragraphId,
          start: edit.start,
          end: edit.end,
          properties: edit.properties,
          ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
        });
      }
      // The mark follows a paragraph whose PILCROW the selection contains, which is what a
      // list marker inherits its face from.
      //
      // In Word the pilcrow is a character in the stream, so a selection cannot reach the
      // next paragraph without passing through this one's: every paragraph before the last
      // has its mark inside the range no matter where the range started. Requiring whole
      // coverage instead missed the FIRST paragraph of a drag that began mid-text — bolding
      // from the middle of a bulleted item through the next one left that item's bullet
      // unbolded while the one below it grew.
      //
      // The last paragraph is the one whose pilcrow is genuinely outside the range, so it
      // keeps the conservative whole-text rule `paragraphMarkOps` applies to a
      // single-paragraph edit: formatting part of a paragraph must not restyle its mark.
      //
      // A paragraph before the last takes its mark whether or not any TEXT of it was
      // covered, and that is not a detail: dragging from the very end of one paragraph to
      // the very start of the next selects nothing but the pilcrow between them, and
      // requiring an edit first left that press with no ops at all — `can` said yes, `exec`
      // reported `changed: false`, and the document did not move. Same reasoning for an
      // empty paragraph inside the range, which has no run to carry the change at all.
      const covered = index < lastIndex || (start === 0 && end === text.length && text.length > 0);
      if (covered && deps.paragraphMarkVisible(paragraphId)) {
        ops.push({
          op: 'setParagraphMarkProperties',
          paragraphId,
          properties: mergedParagraphMarkProperties(part, paragraphId, incoming),
        });
      }
    }
    if (ops.length === 0) return null;
    return commit(() => applyOps(ops, selectionMark()));
  };

  /**
   * Write one run property over every paragraph of a rectangular cell selection.
   *
   * The read side already reports the CELLS rather than the range they stand in for, so the
   * write has to match or the toolbar shows a state its own button cannot change — pressing
   * Bold over selected cells was a silent no-op, because a rectangle spans several paragraphs
   * and the single-paragraph guard refused every one of them.
   */
  const writeRunPropertyOverCells = (
    cells: readonly string[],
    incoming: SurfaceProperty | readonly SurfaceProperty[]
  ): string | null => {
    const part = storyPart();
    const ops: TreeDocOp[] = [];
    for (const paragraphId of paragraphsInCells(currentLayout.value, cells)) {
      const text = textOf(paragraphId);
      // An EMPTY paragraph in a selected cell is still selected: it has no run to carry the
      // change, so its mark below is the only place the format can live, and skipping it
      // outright left typing into that line unformatted. Same rule the range walk applies to
      // an empty paragraph inside its endpoints.
      for (const edit of runPropertyEdits(
        part,
        paragraphId,
        0,
        text.length,
        incoming,
        displayMode(),
        authorFilter()
      )) {
        ops.push({
          op: 'setRunProperties' as const,
          paragraphId,
          start: edit.start,
          end: edit.end,
          properties: edit.properties,
          ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
        });
      }
      if (deps.paragraphMarkVisible(paragraphId)) {
        ops.push({
          op: 'setParagraphMarkProperties' as const,
          paragraphId,
          properties: mergedParagraphMarkProperties(part, paragraphId, incoming),
        });
      }
    }
    if (ops.length === 0) return null;
    // Word leaves the cells selected after formatting them, so the rectangle survives.
    return commit(() => applyOps(ops, selectionMark()), undefined, {
      keepCellSelection: true,
    });
  };

  /**
   * Arm one property for the next characters typed at the caret.
   *
   * REFUSED HERE if the store could not author it. An armed property is applied inside the
   * KEYSTROKE's transaction, so a name outside the D8 run vocabulary would not fail at the
   * press — it would reject the insert too, and go on rejecting every keystroke at that
   * caret in silence. Every other write reaches the store in the same turn as the press and
   * surfaces its own refusal; this one has to be checked before it can be stored.
   */
  const armPending = (incoming: SurfaceProperty): void => {
    if (!isAuthorableRunProperty(incoming.localName)) return;
    deps.setPendingFormats(mergedProperties(deps.pendingFormats() ?? [], incoming));
  };

  /**
   * The empty paragraph a collapsed caret formats through its mark, or null.
   *
   * An empty paragraph has no run for an armed format to wait on: its mark is the only
   * character there, and the next text typed takes the mark's face. So a format picked there
   * goes onto the mark as one undoable change, the line shows it at once, and it is saved
   * even if nothing is typed. An armed format already waiting at the caret keeps the
   * stored-marks lane, so the press flips what the toolbar shows.
   */
  const emptyParagraphAtCaret = (from: SemanticPosition, to: SemanticPosition): string | null =>
    from.paragraphId === to.paragraphId &&
    from.offset === to.offset &&
    textOf(from.paragraphId).length === 0 &&
    deps.paragraphMarkVisible(from.paragraphId) &&
    !deps.pendingFormats()?.length
      ? from.paragraphId
      : null;

  const writeEmptyParagraphMark = (
    paragraphId: string,
    incoming: SurfaceProperty | readonly SurfaceProperty[]
  ) => {
    const part = storyPart();
    const properties = mergedParagraphMarkProperties(part, paragraphId, incoming);
    // A pick the mark already states changes nothing, so it is not an undo step either.
    if (
      JSON.stringify(properties) ===
      JSON.stringify(directParagraphMarkProperties(part, paragraphId))
    )
      return null;
    return commit(() =>
      applyOps(
        [{ op: 'setParagraphMarkProperties' as const, paragraphId, properties }],
        selectionMark()
      )
    );
  };

  /**
   * The word a collapsed caret strictly inside it formats, as a range, or null.
   *
   * A format picked inside a word formats the whole word as one undoable change, and the caret
   * stays where it is. At a word's edge there is no word to format, so the format is armed for
   * the next typed text instead. An armed format already waiting at the caret keeps the
   * stored-marks lane, as at an empty paragraph.
   */
  const caretWordAt = (
    from: SemanticPosition,
    to: SemanticPosition
  ): { from: SemanticPosition; to: SemanticPosition } | null => {
    if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return null;
    if (deps.pendingFormats()?.length) return null;
    const hidden = hiddenRevisionRanges(
      storyPart(),
      from.paragraphId,
      textOf(from.paragraphId).length,
      displayMode(),
      authorFilter()
    );
    const word = layoutCaretWordAt(currentLayout.value, from.paragraphId, from.offset, hidden);
    if (!word) return null;
    return {
      from: { paragraphId: from.paragraphId, offset: word.start },
      to: { paragraphId: from.paragraphId, offset: word.end },
    };
  };

  /**
   * Set run properties over the selection in ONE commit, so the store accepts or refuses
   * them together and they undo as one step. `setRunProperty` is this with one entry.
   */
  const writeRunProperties = (entries: readonly SurfaceProperty[]): string | null => {
    if (entries.length === 0) return null;
    const refused = refuseRunFormat();
    if (refused) return refused;
    const incoming = entries.map((entry) => {
      const widened =
        entry.localName === 'rFonts' ? withEastAsianSlot(entry.attributes) : entry.attributes;
      return { localName: entry.localName, ...(widened ? { attributes: widened } : {}) };
    });
    const cells = deps.selectedCells?.();
    if (cells && cells.length > 0) return writeRunPropertyOverCells(cells, incoming);
    const { from, to } = orderedRange();
    const empty = emptyParagraphAtCaret(from, to);
    if (empty) return writeEmptyParagraphMark(empty, incoming);
    // A highlight is a pen, not a word format: with nothing selected it marks what is typed
    // next and leaves the word under the caret alone.
    const pens = incoming.filter((entry) => entry.localName === 'highlight');
    const formats = incoming.filter((entry) => entry.localName !== 'highlight');
    const word = formats.length > 0 ? caretWordAt(from, to) : null;
    if (word) {
      pens.forEach(armPending);
      return writeRunProperty(word.from, word.to, formats);
    }
    if (from.paragraphId === to.paragraphId && from.offset === to.offset) {
      // A collapsed caret arms the value for the NEXT characters typed — picking a font
      // with nothing selected is how Word starts typing in that font.
      incoming.forEach(armPending);
      return null;
    }
    return writeRunProperty(from, to, incoming);
  };

  /**
   * Write paragraph properties over every paragraph the selection touches, in ONE commit.
   *
   * Shared by `setParagraphProperty` (one entry) and `setParagraphProperties` (a dialog's
   * worth), so both answer the same questions about rectangles, story scope and what a
   * write merges against.
   */
  const writeParagraphProperties = (
    entries: readonly import('./paginated-surface-contract.ts').ParagraphPropertyEdit[]
  ): void => {
    if (entries.length === 0) return;
    // A RECTANGLE IS NOT THE RANGE IT STANDS IN FOR. Read as a range, a selected column
    // runs through every cell between its corners in document order, so centring the left
    // column of a 2x2 table also centred the cell beside it — content the user did not
    // select. Every run-property write already asks this question; this one did not.
    const cells = deps.selectedCells?.();
    const rectangle =
      cells && cells.length > 0 ? [...paragraphsInCells(currentLayout.value, cells)] : null;
    const { from, to } = orderedRange();
    const order = rectangle ?? deps.paragraphOrder();
    const firstIndex = rectangle ? 0 : order.indexOf(from.paragraphId);
    const lastIndex = rectangle ? order.length - 1 : order.indexOf(to.paragraphId);
    if (firstIndex === -1 || lastIndex === -1) return;
    // EVERY paragraph the selection touches, not just the one the caret is in: selecting
    // three paragraphs and pressing centre must centre three paragraphs.
    //
    // Merged against what each paragraph ITSELF authors, never the cascade the layout
    // publishes: the op replaces the properties it names and drops the ones it does not,
    // so its base has to be the paragraph's own `w:pPr` — see `directParagraphProperties`.
    const part = storyPart();
    const ops = order
      .slice(firstIndex, lastIndex + 1)
      .filter((paragraphId) => deps.paragraphMarkVisible(paragraphId))
      .flatMap((paragraphId) => {
        // Folded in order over the paragraph's OWN properties, so a batch that names the
        // same element twice ends with the last word and every entry sees the ones before it.
        const original = directParagraphProperties(part, paragraphId);
        let properties = original;
        const cascaded = paragraphPropertiesOf(currentLayout.value, paragraphId);
        // A paragraph every entry leaves as it is gets no op, so a direction press over
        // text already in that direction is not an undo step.
        let wrote = false;
        for (const rawEntry of entries) {
          const entry = directionalParagraphEntry(rawEntry, cascaded, properties, original);
          if (!entry) continue;
          wrote = true;
          if (entry.remove) {
            properties = properties.filter((property) => property.localName !== entry.localName);
            continue;
          }
          // `mergeAttributes` is for the properties that carry SEVERAL independent settings
          // in one element. `w:spacing` holds the line rule, the space before and the space
          // after; replacing it wholesale meant picking a line spacing deleted the
          // paragraph's space-before, and adding space after deleted the line spacing. A
          // null-valued attribute REMOVES that one, which is how Word's "Remove space before
          // paragraph" differs from setting it to zero.
          const merged = entry.mergeAttributes
            ? {
                ...(properties.find((property) => property.localName === entry.localName)
                  ?.attributes ?? {}),
                ...entry.attributes,
              }
            : (entry.attributes ?? {});
          const kept = Object.fromEntries(
            Object.entries(merged).filter(([, value]) => value !== null && value !== undefined)
          ) as Record<string, string>;
          properties = mergedProperties(properties, {
            localName: entry.localName,
            ...(Object.keys(kept).length > 0 ? { attributes: kept } : {}),
          });
        }
        return wrote ? [{ op: 'setParagraphProperties' as const, paragraphId, properties }] : [];
      });
    if (ops.length === 0) return;
    // Word leaves the cells selected after a paragraph command, exactly as it does after
    // Bold — the run-property writes above already say so.
    commit(() => applyOps(ops, selectionMark()), undefined, {
      keepCellSelection: rectangle !== null,
    });
  };

  return {
    setRunProperty(localName, attributes) {
      return writeRunProperties([{ localName, ...(attributes ? { attributes } : {}) }]);
    },

    setRunProperties: writeRunProperties,

    setParagraphProperty(localName, attributes, options) {
      writeParagraphProperties([
        { localName, ...(attributes ? { attributes } : {}), ...(options ?? {}) },
      ]);
    },

    setParagraphProperties: writeParagraphProperties,

    formatting: () => {
      const read = formattingSelection(selectionNow.value);
      // Pending caret formatting overlays the document's answer, so the toolbar shows what
      // the next character typed will look like while a stored format is armed.
      return withPendingFormatting(
        formattingAt(
          currentLayout.value,
          read.selection,
          (paragraphId: string, runProperties) => {
            const resolved = session.effectiveRunDefaults(paragraphId, runProperties);
            // A run whose chain authored NOTHING is still measured in the surface's
            // default face; report that face rather than null, per span — so a blank
            // document reads "Calibri" while a genuinely mixed selection still
            // disagrees its way to null.
            if (resolved.fontFamily !== null) return resolved;
            const fallback = deps.defaultFontFamily?.() ?? null;
            return fallback === null ? resolved : { ...resolved, fontFamily: fallback };
          },
          deps.selectedCells?.(),
          deps.defaultParagraphStyleId?.() ?? null,
          selectionNow.value.anchor.paragraphId === selectionNow.value.head.paragraphId
            ? [selectionNow.value.head.paragraphId]
            : deps.paragraphOrder(),
          deps.defaultFontFamily?.() ?? null,
          read.caretSpan
        ),
        // The mark's face first, so an armed format still answers over it.
        mergedProperties(read.markFace ?? [], deps.pendingFormats() ?? [])
      );
    },

    toggleRunProperty(localName, attributes) {
      const refused = refuseRunFormat();
      if (refused) return refused;
      const cells = deps.selectedCells?.();
      // The VALUE this press means, for a property whose on-state is one member of an
      // enumeration rather than a boolean: `w:vertAlign` carries superscript AND subscript,
      // so "is it on" is only answerable against the value being toggled.
      const value = attributes?.val;
      // The document answers from the same selection the toolbar reads, so a press after a
      // note reference toggles the face typing takes there, not the reference's face.
      const read = formattingSelection(selectionNow.value);
      const { from, to } = orderedRange();
      // Inside a word the press formats the whole word, but the caret answers for its state,
      // as the toolbar shows it: in a partly bold word, a press after a bold letter turns bold
      // off for the whole word, and a press after a plain letter turns it on.
      const word = cells && cells.length > 0 ? null : caretWordAt(from, to);
      const documentActive = read.caretSpan
        ? isRunPropertyActive(
            currentLayout.value,
            read.selection,
            localName,
            cells,
            value,
            deps.paragraphOrder()
          )
        : pendingPropertyState(read.markFace ?? null, localName, value) === true;
      // A pending entry answers for the toggle state ahead of the document — pressing Bold
      // twice at a caret must cancel, not double-arm.
      const active =
        pendingPropertyState(deps.pendingFormats(), localName, value) ?? documentActive;
      // Toggling OFF sends an explicit off value rather than dropping the element: the
      // property may be inherited from a style, and removing the local override would let the
      // inherited value come back. Two of these are closed enumerations, not booleans, and
      // `val="0"` is a value Word rejects in both: `w:u` turns off as `none`, `w:vertAlign`
      // as `baseline`.
      const incoming = active
        ? { localName, attributes: { val: OFF_VALUES[localName] ?? '0' } }
        : { localName, ...(attributes ? { attributes } : {}) };
      if (cells && cells.length > 0) return writeRunPropertyOverCells(cells, incoming);
      const empty = emptyParagraphAtCaret(from, to);
      if (empty) return writeEmptyParagraphMark(empty, incoming);
      if (word) return writeRunProperty(word.from, word.to, incoming);
      if (from.paragraphId === to.paragraphId && from.offset === to.offset) {
        // The stored-marks lane: a collapsed caret has no range to format, so the toggle is
        // remembered and applied to the next characters typed at this position (Word's
        // behavior). Moving the caret discards it — the composition root owns that rule.
        //
        // A toggle that lands BACK on what the document already gives disarms the entry
        // rather than arming an explicit override: Bold pressed twice must leave nothing
        // pending, or typing would split the run to write a redundant `b val="0"`.
        const pending = deps.pendingFormats() ?? [];
        if (!active === documentActive) {
          const kept = pending.filter((property) => property.localName !== localName);
          deps.setPendingFormats(kept.length > 0 ? kept : null);
        } else {
          armPending(incoming);
        }
        return null;
      }
      return writeRunProperty(from, to, incoming);
    },

    clearFormatting() {
      if (refuseRunFormat()) return;
      // Word's eraser, and Word's split: character formatting is a RANGE, paragraph
      // formatting is not. The selected text loses its direct `w:rPr`; every paragraph the
      // selection touches loses its direct `w:pPr` — which includes `w:pStyle`, so the
      // paragraph falls back to the document's default style — and its mark.
      //
      // Every op states an EMPTY property list, which is how the applier is told to drop
      // what it can name and keep what it cannot: `w:rStyle`, `w:lang`, `w:sectPr`, `w:pBdr`
      // and the rest survive, because an op that cannot say a thing cannot mean to delete it
      // (see `mergedPropertyChildren`).
      //
      // The armed typing format goes FIRST, and unconditionally: at a caret outside a word
      // the existing text keeps what it has, so the pending entry is the only formatting the
      // press can clear there; inside a word the word clears below as well. Retiring it after the early return
      // below meant an eraser pressed on a paragraph the layout had not published yet left
      // the armed format standing, and the next characters typed came out in exactly the
      // formatting the user had just asked to be rid of.
      deps.setPendingFormats(null);
      const layout = currentLayout.value;
      const order = deps.paragraphOrder();
      const cells = deps.selectedCells?.();
      const paragraphIds =
        cells && cells.length > 0
          ? [...paragraphsInCells(layout, cells)]
          : paragraphsInRange(order, orderedRange());
      if (paragraphIds.length === 0) return;
      const rectangular = cells !== undefined && cells.length > 0;
      // A caret inside a word clears the word's character formatting, as a format there
      // formats the whole word.
      const range = orderedRange();
      const { from, to } = (!rectangular && caretWordAt(range.from, range.to)) || range;
      const part = storyPart();
      const ops: TreeDocOp[] = [];
      for (const paragraphId of paragraphIds) {
        const text = textOf(paragraphId);
        // A rectangle stands for whole cells, so every paragraph in it clears entirely.
        const start = rectangular || paragraphId !== from.paragraphId ? 0 : from.offset;
        const end = rectangular || paragraphId !== to.paragraphId ? text.length : to.offset;
        // ONE op per SLICE rather than one per run: the other writes split per run so each
        // keeps its own bag, and here there is no bag to keep — clearing is the one change
        // that legitimately homogenises what it covers. A slice, though, and not the whole
        // range: the applier derives its run set from `segmentsOf`, which knows nothing about
        // display modes, so one op end to end reached the hidden revision halves sitting at
        // the same offsets. `formattableRanges` leaves a gap where one of those sits.
        //
        // Each op is emitted only where there is something to drop. An op that names nothing
        // still counts as APPLIED — the store publishes a revision and pushes an undo entry
        // for it even though the tree comes back identical — so an unconditional three ops
        // per paragraph made the eraser report `changed: true` over clean text and cost an
        // undo press that undid nothing.
        for (const slice of formattableRanges(
          part,
          paragraphId,
          start,
          end,
          displayMode(),
          authorFilter()
        )) {
          if (
            !hasAuthoredRunProperties(
              part,
              paragraphId,
              slice.start,
              slice.end,
              displayMode(),
              authorFilter()
            )
          ) {
            continue;
          }
          ops.push({
            op: 'setRunProperties',
            paragraphId,
            start: slice.start,
            end: slice.end,
            properties: [],
          });
        }
        // The MARK first: `setParagraphProperties` cannot name `w:rPr`, so it preserves the
        // mark and leaves the container non-empty, and the applier drops a `w:pPr` only once
        // it has no children left. Clearing the paragraph first therefore left an empty
        // `<w:pPr/>` behind, which is not what a paragraph that never had properties
        // serialises as.
        if (
          deps.paragraphMarkVisible(paragraphId) &&
          directParagraphMarkProperties(part, paragraphId).length > 0
        ) {
          ops.push({ op: 'setParagraphMarkProperties', paragraphId, properties: [] });
        }
        // Direction is not formatting to erase: the paragraph keeps its `w:bidi`, the way
        // it kept it before the property was nameable, so Arabic stays right-to-left.
        const direct = directParagraphProperties(part, paragraphId);
        const kept = direct.filter((property) => property.localName === 'bidi');
        if (deps.paragraphMarkVisible(paragraphId) && direct.length > kept.length) {
          ops.push({ op: 'setParagraphProperties', paragraphId, properties: kept });
        }
      }
      if (ops.length === 0) return;
      commit(() => applyOps(ops, selectionMark()), undefined, {
        keepCellSelection: rectangular,
      });
    },
  };
}

/** The off value for a property whose on-state is one member of a closed enumeration. */
const OFF_VALUES: Readonly<Record<string, string>> = {
  u: 'none',
  vertAlign: 'baseline',
};
