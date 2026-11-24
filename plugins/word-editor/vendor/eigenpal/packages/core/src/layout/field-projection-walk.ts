import { unsupportedContentOf } from './unsupported-content.ts';
import {
  projectRevisionMarkup,
  markupRevisionOf,
  recordHiddenMarkup,
} from './revision-markup-projection.ts';
import { tocLinkCascader } from './toc-link-formatting.ts';
import { captureFieldResult } from './field-result-capture.ts';
import { finishParagraphPieces } from './field-projection-finish.ts';
import { breakPieceFields, hardBreakPieceFields } from './text-wrapping-break-clear.ts';
// Project allowlisted field instructions into layout; never execute authored instructions.
// Computed fields occupy one model unit. FORMTEXT preserves literal offsets; malformed fields demote.
// Header/footer page fields use their page context. Body page fields publish placeholders for pagination.
// Cached non-page fields can contain live, allowlisted page fields; other nested instructions stay inert.
// Projection happens before measurement, never as a paint-time replacement.

import {
  hasLegacyFormFieldData,
  isFldSimple,
  projectOmmlAtom,
  type DocumentProperties,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { isInlineRunContainer, MAX_INLINE_CONTAINER_DEPTH } from '../store/package/ooxml-shared.ts';
import { isOmmlDisplay, soleParagraphEquation } from '../store/package/omml-display.ts';
import {
  consumeScanNode,
  createFieldParseState,
  createScanBudget,
  effectiveFieldInstruction,
  ingestInstrTextBounded,
  isFldChar,
  isInsideFieldResult,
  isInstrText,
  MAX_STORY_FIELD_SCAN_DEPTH,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  resetFieldParseState,
} from './field-instruction.ts';
import { isInsideOpenFieldInstruction } from './field-instruction-scope.ts';
import { type BodyPageFieldContext, type FieldPageContext } from './field-page-furniture.ts';
import { projectSimpleFieldResult } from './field-simple-result.ts';
import { createNestedPageTracker } from './field-nested-page.ts';
import {
  modelTextOfRunChild,
  hyphenDisplayOf,
  runPropertiesOf,
  type RunPropertyCascader,
} from './field-run-text.ts';
import { captureInstructionSpecs, formControlMarkerOf } from './field-form.ts';
import type { RefFieldContext } from './field-ref.ts';
import { synthesizeAtomicField } from './field-synthesis.ts';
import { isSymbolRunChild, symbolGlyphOf, symbolRunStyle } from './symbol-run.ts';
import {
  appendModelRange,
  positionalTabOf,
  type FieldAwarePiece,
  type FieldLinkProjector,
  type HyperlinkProjector,
  type MutableChangeSite,
  type MutableModelRange,
  capturedResultAttribution,
  projectedPieceFields,
  removedSiteRecorder,
  withRunFormatSite,
  type PendingFieldProjection,
  type PieceEmitExtras,
} from './field-pieces.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { isRunDrawingAtom, runDrawingAtomPlan } from './field-drawing-atom.ts';
import { captureFieldResultDrawing, emitAtomicFieldResult } from './field-result-drawings.ts';
import { legacyCheckboxAccessibleName } from '../store/package/legacy-checkbox-accessibility.ts';
import { legacyFormFieldDataOf } from '../store/package/field-nodes.ts';
import { plainRefSpec } from './field-ref-parse.ts';
import { fieldProjectionSpansOf } from './field-projection-spans.ts';
import { markSavedResultPieces, savedSimpleResultLink } from './field-saved-result.ts';
import {
  emptyNamespaceScope,
  namespaceScopeForNode,
} from '../store/package/drawing-projection-walk.ts';
import { isProjectableNoteAtom, noteAtomPiece, type NoteMarkContext } from './note-projection.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  NO_REVISIONS,
  isRevisionWrapper,
  revisionAttributionOf,
  projectPieceAttribution,
  revisionsAreDeletion,
  revisionsVisible,
  withRevision,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { resolvedFormatChangeOf } from './revision-formatting-projection.ts';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';
import { equationAtom } from './equation-piece.ts';
import { createBidiDirectiveStack } from './bidi-directives.ts';
import type { SpanLinkRecord } from './semantic-records.ts';
import {
  contentControlContentChildren,
  isContentControl,
} from '../store/package/content-control-walk.ts';

/** Internal view projection; the public field-reader signature stays unchanged. @internal */
export function unmergedPiecesOfParagraphForDisplay(
  paragraph: OoxmlNode,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  pageContext?: FieldPageContext,
  cascadeRuns?: RunPropertyCascader,
  projectLink?: HyperlinkProjector,
  noteMarks?: NoteMarkContext,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  deletedRanges?: MutableModelRange[],
  inlineDrawingLayout?: InlineDrawingLayoutContext,
  themeFonts?: ThemeFonts,
  projectFieldLink?: FieldLinkProjector,
  documentProperties?: DocumentProperties,
  bodyPageFields: BodyPageFieldContext | false = false,
  refFields?: RefFieldContext,
  authorFilter?: RevisionAuthorFilter,
  showFieldCodes = false,
  fieldCodeRanges?: readonly import('./field-code-toc.ts').FieldCodeRange[],
  tocLinkStyleRanges?: readonly import('./toc-link-formatting.ts').TocLinkRange[],
  changeSites?: MutableChangeSite[]
): FieldAwarePiece[] {
  if (paragraph.kind === 'textValue') return [];
  if (paragraph.kind !== 'paragraph') return [];
  const recordRemoved = removedSiteRecorder(changeSites, displayMode, authorFilter);
  /** The formatting change the view resolved into the run being walked, if any. */
  let runFormatSite: RevisionAttribution | null = null;

  const pieces: FieldAwarePiece[] = [];
  let offset = 0;
  cascadeRuns = tocLinkCascader(cascadeRuns, showFieldCodes ? undefined : tocLinkStyleRanges, () =>
    pending?.atomic ? pending.atomStart : offset
  );
  /** The link the walk is currently inside, so every piece it emits is tagged with it. */
  let currentLink: SpanLinkRecord | undefined;
  const tags = () => ({ ...(currentLink ? { link: currentLink } : {}), ...directives.fields() });

  const spans = fieldProjectionSpansOf(paragraph);
  const { atomBeginIds, editableResultBeginIds, coveredIds } = spans;
  const soleEquation = soleParagraphEquation(paragraph); // Alone, it is a display equation.

  const field = createFieldParseState();
  const budget = createScanBudget();
  let pending: PendingFieldProjection | null = null;
  /** Outermost begin id when the open field is atomic. */
  let openAtomicBeginId: string | null = null;
  // Live-evaluated allowlisted field nested inside the open atomic result (fldSimple parity).
  const nestedPage = createNestedPageTracker();
  /**
   * The revision wrappers enclosing the run being processed, outermost first.
   *
   * Held here rather than threaded through every emitter because the walk is synchronous and
   * depth-first: it is set on the way into a wrapper and restored on the way out, so every
   * piece emitted in between sees exactly its own enclosing stack.
   */
  let revisions: readonly RevisionAttribution[] = NO_REVISIONS;
  const directives = createBidiDirectiveStack(); // `w:dir` and `w:bdo`, held like `revisions`.

  const push = (
    text: string,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle,
    projected: boolean,
    start: number,
    end: number,
    extras?: PieceEmitExtras
  ): void => {
    if (text.length === 0 && !projected && !extras?.inlineDrawing) return;
    const effectiveLink = extras?.linkOverride ?? currentLink;
    const published = projectPieceAttribution(
      extras?.revisionsOverride ?? revisions,
      props,
      displayMode,
      authorFilter
    );
    if (published === null) return;
    const markup = projectRevisionMarkup(
      text,
      style,
      projected,
      displayMode === 'all-markup' ? authorFilter?.revisionMarkup : undefined,
      markupRevisionOf(published, paragraph, authorFilter)
    );
    if (markup.hidden) return recordHiddenMarkup(changeSites, start, end, published);
    ({ text, style, projected } = markup);
    const attributed = withRunFormatSite(
      published,
      extras?.revisionsOverride ? (extras.formatSiteOverride ?? null) : runFormatSite
    );
    const link = {
      ...(effectiveLink ? { link: effectiveLink } : {}),
      ...(extras?.directivesOverride ?? directives.fields()),
    };
    if (projected) {
      pieces.push({
        text,
        ...attributed,
        style,
        start,
        end,
        projected: true,
        ...projectedPieceFields(extras),
        ...link,
      });
      return;
    }
    if (text.length === 0) return;
    pieces.push({
      text,
      ...attributed,
      style,
      start,
      end,
      ...(extras?.positionalTab ? { positionalTab: extras.positionalTab } : {}),
      ...breakPieceFields(extras),
      ...link,
    });
  };

  const commitAtomicField = (): void => {
    if (!pending || !pending.atomic) {
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    const start = pending.atomStart;
    const end = start + 1;
    if (pending.style.hidden) {
      // Vanish: no piece, atom still advances (already counted at begin).
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    // The walk has already left any wrapper around this field, so its attribution comes from
    // what was captured on the way in rather than from the live stack.
    //
    // Which is also why VISIBILITY has to be asked of the captured stack here rather than left
    // to the emitters: a field wrapped whole in `w:ins`/`w:del` used never to form an atom at
    // all, so this path could not meet one — until `atomicFieldSpansOf` learned to descend into
    // revision wrappers. Without this, an inserted page number painted its digits in the
    // ORIGINAL view, which is the one view that must show the document before that insertion.
    if (!revisionsVisible(pending.resultRevisions, displayMode, authorFilter)) {
      if (deletedRanges && revisionsAreDeletion(pending.resultRevisions)) {
        appendModelRange(deletedRanges, start, end);
      }
      recordRemoved(start, end, pending.resultRevisions);
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    // A HYPERLINK field becomes a live link only when nothing already links it: an enclosing
    // `w:hyperlink` captured into `resultLink` wins, exactly as it does for every other field.
    // Resolved LAZILY (and memoized): a field that paints nothing — empty result, no synthesized
    // glyph — must never reach `projectFieldLink`, or it mints a registry id no piece ever uses.
    const { resultLink, linkSpec, formField } = pending;
    const captured = capturedResultAttribution(pending);
    const formControl = formControlMarkerOf(pending);
    let carriedMemo: PieceEmitExtras | undefined;
    const carried = (): PieceEmitExtras => {
      if (carriedMemo) return carriedMemo;
      const fieldLink = !resultLink && linkSpec ? (projectFieldLink?.(linkSpec) ?? null) : null;
      const carriedLink = resultLink ?? fieldLink;
      // Gated on the CAPTURE, not on the stack being non-empty: an untracked first result run
      // captures an empty stack, and that empty stack is the answer — not whatever wrapper the
      // walk happens to be inside when `end` arrives.
      carriedMemo = {
        ...captured,
        ...(carriedLink ? { linkOverride: carriedLink } : {}),
        fieldAtom: {
          formField,
          ...(formControl ? { formControl } : {}),
          ...(pending?.refSpec && !pending.hasNestedField && plainRefSpec(pending.refSpec)
            ? { fixedResult: true as const }
            : {}),
        },
      };
      return carriedMemo;
    };
    // Resolve atomic field display without changing its model range.
    const synthesis = synthesizeAtomicField(pending, {
      pageContext,
      themeFonts,
      documentProperties,
      bodyPageFields,
      ...(refFields ? { refFields } : {}),
    });
    if (synthesis) {
      const extras = carried();
      // A body page-field / PAGEREF placeholder rides the same field-atom marker its finalize
      // pass reads.
      const withPageField =
        synthesis.pageField || synthesis.pageRefField
          ? {
              ...extras,
              fieldAtom: {
                formField: pending.formField,
                ...(synthesis.pageField ? { pageField: synthesis.pageField } : {}),
                ...(synthesis.pageRefField ? { pageRef: synthesis.pageRefField } : {}),
              },
            }
          : extras;
      emitAtomicFieldResult(pending, synthesis, withPageField, push);
    }
    pending = null;
    openAtomicBeginId = null;
  };

  const abandonPending = (): void => {
    if (!pending) return;
    const fieldLink =
      !pending.resultLink && pending.linkSpec
        ? (projectFieldLink?.(pending.linkSpec) ?? null)
        : null;
    const linked = (piece: FieldAwarePiece): FieldAwarePiece =>
      fieldLink && !piece.link ? { ...piece, link: fieldLink } : piece;
    if (pending.atomic) {
      offset = pending.atomStart;
      for (const piece of pending.buffered) {
        pieces.push({
          ...linked(piece),
          start: offset,
          end: offset + (piece.end - piece.start),
        });
        offset += piece.end - piece.start;
      }
      if (pending.cachedText.length > 0 && pending.buffered.length === 0) {
        // The cache was captured from the first displayed result run, so its attribution is
        // the captured one — not the live stack, which by now may be a later run's wrapper.
        push(
          pending.cachedText,
          pending.props,
          pending.style,
          false,
          offset,
          offset + pending.cachedText.length,
          {
            ...capturedResultAttribution(pending),
            ...(fieldLink ? { linkOverride: fieldLink } : {}),
          }
        );
        offset += pending.cachedText.length;
      }
    } else {
      const first = pieces.length;
      for (const piece of pending.buffered) pieces.push(linked(piece));
      if (pending.savedResult) {
        markSavedResultPieces(pieces, first, pending.atomStart, pending.bufferOffset);
      }
      offset = pending.bufferOffset;
    }
    pending = null;
    openAtomicBeginId = null;
  };

  const unitShown = (start: number, hidden = false): boolean => {
    if (revisionsAreDeletion(revisions) && deletedRanges) {
      appendModelRange(deletedRanges, start, start + 1);
    }
    if (revisionsVisible(revisions, displayMode, authorFilter)) return true;
    if (!hidden) recordRemoved(start, start + 1, revisions);
    return false;
  };

  /** Reserve a `w:sym`'s one model unit; the glyph this view paints over it, or null. */
  const symbolUnit = (grand: OoxmlNode, props: readonly OoxmlProperty[], hidden: boolean) => {
    const start = offset;
    offset += 1;
    const glyph = unitShown(start, hidden) && !hidden ? symbolGlyphOf(grand) : null;
    return glyph ? { start, text: glyph.text, ...symbolRunStyle(props, glyph, themeFonts) } : null;
  };

  const pushRunContent = (
    grand: OoxmlNode,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle
  ): void => {
    // Drawing visibility and payload selection live in field-drawing-atom.ts.
    if (isRunDrawingAtom(grand)) {
      const start = offset;
      offset += 1;
      const end = offset;
      if (!inlineDrawingLayout) return;
      const plan = runDrawingAtomPlan({
        node: grand,
        layout: inlineDrawingLayout,
        hiddenRun: style.hidden,
        revisions,
        displayMode,
        authorFilter,
      });
      if (plan.recordDeleted && deletedRanges) appendModelRange(deletedRanges, start, end);
      if (!plan.emit) recordRemoved(start, end, revisions);
      if (plan.emit) push('\uFFFC', props, style, true, start, end, plan.extras);
      return;
    }
    if (isProjectableNoteAtom(grand)) {
      const start = offset++;
      const note = style.hidden ? null : noteAtomPiece(grand, noteMarks);
      if (note) push(note.text, props, style, true, start, start + 1, note.extras);
      return;
    }
    // A `w:ptab` advances the line but occupies NO model offset, so it is pushed with a
    // zero-width range and the offset does not move.
    const positional = positionalTabOf(grand);
    if (positional) {
      if (!style.hidden)
        push('\t', props, style, false, offset, offset, { positionalTab: positional });
      return;
    }
    if (isSymbolRunChild(grand)) {
      const sym = symbolUnit(grand, props, style.hidden);
      if (sym) push(sym.text, sym.props, sym.style, true, sym.start, sym.start + 1);
      return;
    }
    const unsupported = unsupportedContentOf(grand);
    if (unsupported) {
      if (!style.hidden && revisionsVisible(revisions, displayMode, authorFilter))
        push('\uFFFC', props, style, true, offset, offset, { unsupported });
      return;
    }
    const text = modelTextOfRunChild(grand);
    if (text.length === 0) return;
    // A revision the display mode resolves away is suppressed the same way `w:vanish` is, and
    // for the same reason: the offset space belongs to the model, not to the view, so the
    // characters keep their offsets whether or not they are laid out. `w:delText` outside any
    // deletion is malformed and is suppressed unconditionally, because the one thing that must
    // never happen is deleted text flowing as ordinary text.
    const deleted = revisionsAreDeletion(revisions);
    const resolvedAway = !revisionsVisible(revisions, displayMode, authorFilter);
    const suppressed = style.hidden || resolvedAway || (grand.kind === 'deletedText' && !deleted);
    if (resolvedAway && !style.hidden) recordRemoved(offset, offset + text.length, revisions);
    // A hyphen element is one model character that paints its own glyph (`hyphenDisplayOf`).
    const hyphen = hyphenDisplayOf(grand);
    const measured = hyphen?.measureText !== undefined;
    if (!suppressed) {
      push(hyphen?.text ?? text, props, style, measured, offset, offset + text.length, {
        ...(grand.kind === 'hardBreak' ? hardBreakPieceFields(grand) : {}),
        ...(measured ? { measureText: hyphen.measureText } : {}),
      });
    }
    // Deleted characters are recorded whether or not they were laid out. They occupy model
    // offsets in every mode, and the caret must step over them in every mode — including the
    // proposed result, where they produce no span at all and an offset-by-offset walk would
    // otherwise stop at invisible positions.
    if (deleted && deletedRanges) appendModelRange(deletedRanges, offset, offset + text.length);
    offset += text.length;
  };

  const processRun = (run: OoxmlNode, runDepth: number): void => {
    if (run.kind !== 'run') return;
    const props = runPropertiesOf(run, inheritedRunProperties, cascadeRuns);
    const style = resolveRunStyle(props, themeFonts);
    runFormatSite = resolvedFormatChangeOf(
      run.children.find((child) => child.kind === 'runProperties'),
      authorFilter
    );

    const donateResultCapture = (resultText?: string): void =>
      captureFieldResult(
        pending,
        { props, style, revisions, runFormatSite, ...tags() },
        resultText
      );

    for (const grand of run.children) {
      if (!consumeScanNode(budget)) {
        abandonPending();
        resetFieldParseState(field);
        nestedPage.reset();
        if (grand.kind === 'runProperties') continue;
        if (isFldChar(grand, 'begin') || isFldChar(grand, 'separate') || isFldChar(grand, 'end')) {
          continue;
        }
        if (isInstrText(grand)) continue;
        if (coveredIds.has(grand.id) && openAtomicBeginId === null) continue;
        pushRunContent(grand, props, style);
        continue;
      }

      if (grand.kind === 'runProperties') continue;

      if (isFldChar(grand, 'begin')) {
        if (pending?.atomic) pending.hasNestedField = true;
        const atomic = atomBeginIds.has(grand.id);
        onFldCharBegin(field);
        if (field.nesting === 1) {
          abandonPending();
          nestedPage.reset();
          openAtomicBeginId = atomic ? grand.id : null;
          // Bounded ffData STATE read, macros never; `formField` stays presence-based.
          const formData = legacyFormFieldDataOf(grand);
          pending = {
            kind: null,
            pageSwitches: {},
            symbolSpec: null,
            linkSpec: null,
            formSpec: null,
            buttonSpec: null,
            docPropertySpec: null,
            refSpec: null,
            autonumSpec: null,
            formData,
            formAccessibleName: formData ? legacyCheckboxAccessibleName(grand) : undefined,
            beginId: grand.id,
            atomic,
            editableResult: editableResultBeginIds.has(grand.id),
            savedResult: spans.savedResultBeginIds.has(grand.id),
            atomStart: offset,
            props,
            style,
            capturedResultStyle: false,
            cachedText: '',
            sawResultContent: false,
            buffered: [],
            bufferOffset: offset,
            // A wrapper around the BEGIN marker wraps the whole field, and since
            // `atomicFieldSpansOf` learned to descend into revision wrappers such a field forms
            // an atom rather than demoting. Capturing here is what makes the flush able to
            // resolve visibility at all: a suppressed result run never reaches the donation
            // below — it is skipped before it gets there — so without this an inserted page
            // number painted its digits into the ORIGINAL view, with nothing recording that the
            // insertion was what put them there.
            resultRevisions: revisions,
            resultFormatSite: runFormatSite,
            capturedResultRevisions: revisions.length > 0,
            formField: hasLegacyFormFieldData(grand),
            ...(currentLink ? { resultLink: currentLink } : {}),
            resultDirectives: directives.captured(),
          };
          if (atomic) {
            // Reserve the single model unit up front so surrounding offsets stay stable.
            offset += 1;
          }
        }
        continue;
      }

      if (isInstrText(grand)) {
        ingestInstrTextBounded(field, grand, budget, runDepth + 1);
        continue;
      }

      if (isFldChar(grand, 'separate')) {
        const outermostSeparate = field.nesting === 1 && field.phase === 'instruction';
        const separateLevel = field.nesting;
        const match = onFldCharSeparate(field);
        if (outermostSeparate && pending) {
          // Capture the allowlisted kind whether or not a page context is present. With one
          // (header/footer) the flush projects the live value; without one (body) it paints a
          // placeholder the kind marks, and document finalize substitutes the page's value.
          // The `\#` picture and `\*` number format ride along: they decide how it renders.
          pending.kind = match?.kind ?? null;
          pending.pageSwitches = match ?? {};
          // Capture the SYMBOL / HYPERLINK / form-field spec while the machine still holds the
          // raw instruction (`onFldCharEnd` resets the buffer before the flush reads anything).
          // Nesting overflow refuses exactly as PAGE projection does: a >4-deep hostile field
          // must not synthesize output from whatever outer fragments the buffer kept.
          const effective = effectiveFieldInstruction(field);
          if (!pending.kind && !effective.overflow && !field.nestingOverflow) {
            captureInstructionSpecs(pending, effective.instruction);
          }
          // Prefer separate-run style until a measurable result run donates one.
          pending.props = props;
          pending.style = style;
        } else if (pending?.atomic && field.phase === 'result' && !field.nestingOverflow) {
          // Inner separate inside the outer atomic result: live-evaluate an allowlisted
          // nested field instead of concatenating its cached digits (fldSimple parity).
          // Level-aware: the tracker arms at ANY nested level 2..MAX_FIELD_NESTING when idle,
          // and while armed ignores deeper separates (part of the replaced result) and null
          // duplicates at the tracked level. Overflowed nesting never arms — projection would
          // be replacing content the atom parser already demoted. A field inside an enclosing
          // instruction never arms: its value feeds that instruction and is not displayed.
          const displayed = pageContext && !isInsideOpenFieldInstruction(field);
          nestedPage.onSeparate(displayed ? match : null, separateLevel);
        }
        continue;
      }

      if (isFldChar(grand, 'end')) {
        const outermostEnd = field.nesting === 1;
        // A SYMBOL or FORMCHECKBOX with no `separate` at all (begin/instr/end) still renders
        // in Word. The machine's buffer is reset by `onFldCharEnd`, so capture BEFORE advancing.
        if (outermostEnd && pending?.atomic && field.phase === 'instruction') {
          const effective = effectiveFieldInstruction(field);
          if (!effective.overflow && !field.nestingOverflow) {
            captureInstructionSpecs(pending, effective.instruction);
          }
        }
        // The end closing the TRACKED inner field appends its live value; an inner result that
        // existed but was entirely suppressed appends nothing (fldSimple parity). Deeper ends
        // inside the replaced result return null and leave the tracker armed, so a begin/end
        // pair nested in a tracked result cannot clear tracking mid-field.
        const appendedLive = nestedPage.onEnd(field.nesting, pageContext);
        if (appendedLive !== null && pending?.atomic) {
          pending.cachedText += appendedLive;
        }
        onFldCharEnd(field);
        if (outermostEnd) {
          if (pending?.atomic) commitAtomicField();
          else abandonPending();
        }
        continue;
      }

      if (isInsideOpenFieldInstruction(field)) {
        // Only well-formed atomic fields suppress instruction-phase run content, at any level:
        // a nested field's result inside an enclosing instruction is never displayed text.
        // Demoted / malformed opens must not make surrounding text disappear.
        //
        // An editable-result FORMTEXT field falls through ON PURPOSE: the offset authority
        // (`walkParagraph` over `atomicFieldSpansOf`) only zeroes the nodes of ATOMIC spans,
        // so ordinary `w:t` between its begin and separate keeps real model offsets — and
        // layout must paint what the store addresses, or every offset after the field lies.
        // Word would not save such content, but a file that carries it shows it.
        if (pending?.atomic) continue;
      }

      if (pending && isInsideFieldResult(field)) {
        if (isRunDrawingAtom(grand)) {
          if (pending.atomic && nestedPage.active) {
            nestedPage.noteResult(!style.hidden);
            continue;
          }
          offset = captureFieldResultDrawing(pending, {
            node: grand,
            layout: inlineDrawingLayout,
            props,
            style,
            offset,
            revisions,
            displayMode,
            authorFilter,
            tags: tags(),
            formatSite: runFormatSite,
            deletedRanges,
            removed: recordRemoved,
          });
          continue;
        }
        // A cached result is one plain string and cannot carry a per-glyph font switch, so
        // only a `w:sym` with a real Unicode equivalent joins it; the rest are skipped.
        if (isSymbolRunChild(grand)) {
          if (pending.atomic) {
            // The flag records only what THIS display mode keeps: a `w:del`-wrapped result
            // hidden by the proposed view is gone from that view, and suppressing synthesis
            // over it would paint nothing where Word (after accepting) shows the display
            // text. Vanish-hidden content still sets it — that is the case the flag exists
            // for.
            if (revisionsVisible(revisions, displayMode, authorFilter))
              pending.sawResultContent = true;
            if (nestedPage.active) {
              // A symbol inside the skipped inner cache is result content too: a visible one
              // keeps the live replacement alive, a suppressed-only cache appends nothing.
              nestedPage.noteResult(
                !style.hidden && revisionsVisible(revisions, displayMode, authorFilter)
              );
              continue;
            }
            if (!style.hidden && revisionsVisible(revisions, displayMode, authorFilter)) {
              const glyph = symbolGlyphOf(grand);
              if (glyph?.unicode) {
                donateResultCapture();
                pending.cachedText += glyph.text;
              }
            }
            continue;
          }
          // Demoted / editable-result field: the sym paints as it does in an ordinary run,
          // buffered with the result text it flushes with (the flush never runs `push`).
          const sym = symbolUnit(grand, props, style.hidden);
          pending.bufferOffset = offset;
          const symAttribution =
            sym && projectPieceAttribution(revisions, sym.props, displayMode, authorFilter);
          if (!sym || !symAttribution) continue;
          pending.buffered.push({
            text: sym.text,
            style: sym.style,
            start: sym.start,
            end: sym.start + 1,
            projected: true,
            ...symAttribution,
            ...tags(),
            fieldAtom: { formField: pending.formField },
          });
          continue;
        }
        // Editable field results can carry positional tabs. Preserve their layout
        // metadata while keeping their zero-width canonical model range.
        const positional = pending.atomic ? null : positionalTabOf(grand);
        const hyphen = hyphenDisplayOf(grand);
        const text = positional ? '\t' : (hyphen?.text ?? modelTextOfRunChild(grand));
        const modelWidth = positional ? 0 : text.length;
        if (text.length === 0) continue;

        // A field can be tracked as a whole — Word writes a deleted hyperlink as `w:del`
        // around the begin/instr/separate/result/end run — and its result text is BUFFERED
        // here and flushed when the field closes, by which time the walk has already left the
        // wrapper and `revisions` is empty again. Apply the suppression at buffer time or a
        // deleted field's result survives the proposed result the deletion was accepted into.
        const fieldDeleted = revisionsAreDeletion(revisions);
        // `null` is this view removing the content — the same verdict `push` returns on.
        const attribution = projectPieceAttribution(revisions, props, displayMode, authorFilter);
        const fieldSuppressed =
          attribution === null || (grand.kind === 'deletedText' && !fieldDeleted);

        // The result EXISTS in this display mode, whatever hides it below (vanish included) —
        // the flush needs the distinction to keep synthesis from painting over a result the
        // file hid on purpose. Revision-suppressed content does NOT count: the mode resolved
        // it away, and Word (after accepting the deletion) synthesizes over the gap.
        if (pending.atomic && !fieldSuppressed) pending.sawResultContent = true;

        // Deleted characters are recorded whether or not they were laid out, exactly as they
        // are for ordinary runs: they occupy model offsets in every display mode, and the caret
        // has to step over them in every mode. Recording this only on the suppressed branch
        // left an all-markup deletion — the mode where it is VISIBLE — absent from the ranges.
        //
        // The atomic path reserved ONE unit at `begin` and never advanced by the text length,
        // so the range is that reserved unit. Deriving it from the running offset produced
        // `start` values before the paragraph began (a measured `{start: -16, end: 1}`).
        if (attribution === null) {
          if (pending.atomic) recordRemoved(pending.atomStart, pending.atomStart + 1, revisions);
          else recordRemoved(offset, offset + modelWidth, revisions);
        }
        if (fieldDeleted && deletedRanges) {
          if (pending.atomic) {
            appendModelRange(deletedRanges, pending.atomStart, pending.atomStart + 1);
          } else {
            // Unconditional on this branch too. Gating it on suppression left an all-markup
            // deletion inside a DEMOTED field out of the ranges — visible, and so the one case
            // where the caret could walk into deleted content it is meant to step over.
            appendModelRange(deletedRanges, offset, offset + modelWidth);
          }
        }

        if (fieldSuppressed) {
          if (pending.atomic && nestedPage.active) nestedPage.noteResult(false);
          if (!pending.atomic) {
            offset += modelWidth;
            pending.bufferOffset = offset;
          }
          continue;
        }

        if (pending.atomic) {
          // Atomic unit: cache donates display text/style only — offset already reserved.
          if (nestedPage.active) {
            // Skipped inner cached digits: the live value replaces them at the inner end.
            // Donation is the FULL result capture — style, revision attribution and enclosing
            // link — exactly like the ordinary result branch: when the atom's first visible
            // result content is the nested digits wrapped in `w:ins` or `w:hyperlink`, the
            // live value that replaces them must paint attributed and linked the same way.
            nestedPage.noteResult(!style.hidden);
            if (style.hidden) continue;
            donateResultCapture(text);
            continue;
          }
          if (style.hidden || pending.hidesResult) continue;
          donateResultCapture(text);
          pending.cachedText += hyphen?.measureText ?? text;
          continue;
        }

        // Demoted field: result text is ordinary addressable content.
        if (style.hidden || pending.hidesResult) {
          offset += modelWidth;
          pending.bufferOffset = offset;
          continue;
        }
        if (!pending.capturedResultStyle) {
          pending.props = props;
          pending.style = style;
          pending.capturedResultStyle = true;
        }
        // Buffered rather than pushed, so it does not pass through `push` and carries its own
        // attribution — PROJECTED through the reviewer view as `push` would, never the raw
        // stack. The walk is STILL inside the wrapper here, so the live stack is the right one,
        // unlike the atomic flush, which runs after the walk has left it. The link matters for
        // the same reason: a demoted field inside a `w:hyperlink` lost its href here once.
        pending.buffered.push({
          text,
          style,
          start: offset,
          end: offset + modelWidth,
          ...(positional ? { positionalTab: positional } : {}),
          ...(hyphen?.measureText === undefined ? {} : { projected: true, measureText: '' }),
          ...attribution,
          ...tags(),
          // EVERY buffered result piece is a field's displayed result — a demoted
          // (unterminated) field's cache shades exactly like a FORMTEXT's editable one.
          fieldAtom: { formField: pending.formField },
        });
        offset += modelWidth;
        pending.bufferOffset = offset;
        continue;
      }

      // Covered by a closed atomic field we already committed — should not reach here
      // because those nodes are skipped via the begin→end control flow. Still guard.
      if (coveredIds.has(grand.id) && openAtomicBeginId === null && atomBeginIds.size > 0) {
        // Node belongs to a later/earlier atom; if we're between fields, skip chrome only.
      }

      pushRunContent(grand, props, style);
    }
  };

  // Inline containers share one field machine across runs, hyperlinks, revisions, and SDTs.
  // Descending must not reset the instruction/result phase or the model offset.
  // Container depth matches paragraph offsets; field-scan depth has its own bound.
  const finishOptions = {
    showFieldCodes,
    inheritedRunProperties,
    cascadeRuns,
    themeFonts,
    displayMode,
    authorFilter,
    fieldCodeRanges,
    changeSites,
  };
  // Out of scan budget before the walk: nothing was buffered, so no markup to project.
  if (!consumeScanNode(budget))
    return finishParagraphPieces(paragraph, pieces, { ...finishOptions, projectMarkup: false });
  const paragraphScope = emptyNamespaceScope();

  /**
   * Paint a `w:fldSimple` (§17.16.19) as one projected model unit.
   *
   * The instruction lives in `@w:instr` and the last-computed result as child runs — there is
   * no `separate` marker on the outer field itself. What the unit paints is decided by
   * {@link projectSimpleFieldResult}; this owns the model offset and OUTER visibility.
   *
   * Attribution comes from `push` reading the live stack — a `w:fldSimple` inside `w:ins` is
   * still inside it here, unlike a complex field's deferred flush.
   */
  const projectSimpleField = (simple: OoxmlNode, depth: number): void => {
    if (pending?.atomic) pending.hasNestedField = true;
    const start = offset;
    offset += 1;
    if (simple.kind === 'textValue') return;

    // The atom is one model offset whatever it paints, so a revision enclosing the WHOLE field
    // is answered here, once, before result collection — including the live page-field branch,
    // which would otherwise paint a deleted footer number straight into the accepted view.
    //
    // The deleted range is recorded whether or not it was laid out, exactly as the complex path
    // and inline drawings do: the offset exists in every display mode and the caret has to step
    // over it in every mode.
    if (!unitShown(start)) return;
    // Inside an atomic field's instruction the result is input to that field, as nested run
    // content is. It keeps its model unit and paints nothing; the outer saved result shows.
    if (pending?.atomic && isInsideOpenFieldInstruction(field)) return;

    const projected = projectSimpleFieldResult({
      simple,
      depth,
      pageContext,
      budget,
      revisions,
      displayMode,
      authorFilter,
      inheritedRunProperties,
      cascadeRuns,
      themeFonts,
      currentLink,
      projectFieldLink,
      documentProperties,
      bodyPageFields,
      ...(refFields ? { refFields } : {}),
    });
    if (!projected) return;
    // `w:ffData` is a `w:fldChar` payload, so a simple field is never a legacy form field. A body
    // page field carries its kind so document finalize substitutes the page's value.
    push(projected.text, projected.props, projected.style, true, start, start + 1, {
      fieldAtom: {
        formField: false,
        ...(projected.pageField ? { pageField: projected.pageField } : {}),
        ...(projected.pageRef ? { pageRef: projected.pageRef } : {}),
      },
      ...(projected.link ? { linkOverride: projected.link } : {}),
    });
  };

  /**
   * Lay out a `w:fldSimple` whose saved result is editable text (`fieldResults: 'editable'`).
   *
   * The element takes no offset of its own; its result runs are walked as ordinary content, as
   * the store's offset authority walks them. Each piece is marked as the field's result, and a
   * HYPERLINK instruction links it unless an enclosing typed link already does.
   */
  const projectSavedSimpleResult = (
    simple: OoxmlElement,
    depth: number,
    scope: ReadonlyMap<string, string>,
    containerDepth: number
  ): void => {
    const [first, resultStart, previousLink] = [pieces.length, offset, currentLink];
    currentLink = savedSimpleResultLink(simple, previousLink, projectFieldLink);
    for (const inner of simple.children) processInline(inner, depth + 1, scope, containerDepth + 1);
    currentLink = previousLink;
    markSavedResultPieces(pieces, first, resultStart, offset);
  };

  const processInline = (
    child: OoxmlNode,
    depth: number,
    namespaceScope: ReadonlyMap<string, string>,
    containerDepth: number
  ): void => {
    // Match `segmentsOf`: every transparent container consumes one level, and a child reached
    // at the cap is opaque. Check before runs and atoms so hidden content cannot reach layout.
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return;
    const unsupported = unsupportedContentOf(child);
    if (unsupported) {
      const style = resolveRunStyle(inheritedRunProperties, themeFonts);
      if (!style.hidden && revisionsVisible(revisions, displayMode, authorFilter))
        push('\uFFFC', inheritedRunProperties, style, true, offset, offset, { unsupported });
      return;
    }
    const equation = projectOmmlAtom(child);
    if (equation) {
      const start = offset++;
      if (revisionsAreDeletion(revisions) && deletedRanges)
        appendModelRange(deletedRanges, start, offset);
      const text = resolveRunStyle(inheritedRunProperties, themeFonts);
      const display = isOmmlDisplay(child) || soleEquation;
      const { style, extras: atom } = equationAtom(equation, text, display);
      if (!style.hidden && !revisionsVisible(revisions, displayMode, authorFilter))
        recordRemoved(start, offset, revisions);
      if (style.hidden || !revisionsVisible(revisions, displayMode, authorFilter)) return;
      return push('\uFFFC', inheritedRunProperties, style, true, start, offset, atom);
    }
    if (isFldSimple(child)) {
      // A saved result laid out as text: its runs are ordinary content at their own offsets.
      if (spans.savedResultSimpleIds.has(child.id) && !pending?.atomic) {
        projectSavedSimpleResult(child as OoxmlElement, depth, namespaceScope, containerDepth);
      } else projectSimpleField(child, depth);
      return;
    }
    if (child.kind === 'run') {
      processRun(child, depth);
      runFormatSite = null; // The site belongs to that run alone.
      return;
    }
    if (isContentControl(child)) {
      if (depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
      for (const inner of contentControlContentChildren(child)) {
        processInline(inner, depth + 1, namespaceScope, containerDepth + 1);
      }
      return;
    }
    if (depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    const childScope =
      child.kind !== 'textValue' && 'localName' in child
        ? namespaceScopeForNode(namespaceScope, child)
        : namespaceScope;
    if (child.kind === 'hyperlink') {
      // The link is projected ONCE per element, not per run: sanitization is not free, and a
      // link's runs must all carry the same record so paint can group them by identity.
      const previous = currentLink;
      currentLink = projectLink?.(child) ?? undefined;
      for (const inner of child.children)
        processInline(inner, depth + 1, childScope, containerDepth + 1);
      currentLink = previous;
      return;
    }
    if (isRevisionWrapper(child)) {
      const attribution = revisionAttributionOf(child);
      if (!attribution) return;
      if (!consumeScanNode(budget)) return;
      const enclosing = revisions;
      revisions = withRevision(enclosing, attribution);
      for (const inner of child.children)
        processInline(inner, depth + 1, childScope, containerDepth + 1);
      revisions = enclosing;
      return;
    }
    if (!isInlineRunContainer(child)) return;
    const leave = directives.enter(child as OoxmlElement); // Only w:dir and w:bdo add a level.
    for (const inner of (child as OoxmlElement).children)
      processInline(inner, depth + 1, childScope, containerDepth + 1);
    leave();
  };
  // Paragraph root counts as depth 0; run children sit at depth 1.
  for (const child of paragraph.children) processInline(child, 1, paragraphScope, 0);
  // Malformed field missing end: demote — surface cached/buffered text, no live projection.
  abandonPending();

  return finishParagraphPieces(paragraph, pieces, finishOptions);
}

export { piecesOfParagraphForDisplay } from './field-projection-display.ts';
