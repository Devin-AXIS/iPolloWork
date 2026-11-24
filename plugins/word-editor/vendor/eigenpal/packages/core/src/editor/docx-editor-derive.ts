import { textboxInsertionRefusal } from './textbox-commands.ts';
import { tocAtPosition } from './surface-toc-ranges.ts';
import { replacesSelection, surfaceCrossNoteRefusal } from './surface-note-story.ts';
import { formsProtectionRefusal } from '../store/store/tree-op-content-controls.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import {
  commandProtectionRefusal,
  contentLockPolicyFor,
  FORMS_WRITE_REASON,
} from './command-protection.ts';
import { contentLockFormatRefusal } from './content-lock-format-refusal.ts';
import { paragraphFormatLockRefusal } from './paragraph-format-lock-refusal.ts';
// Snapshot derivations for `createDocxEditor` (editor seam).
//
// The reads that turn a mounted surface into contract values: run formatting, page setup,
// page counts. Pure over the surface — the composition root owns when they run and what
// caches them, these own only what the answer IS, so `snapshot().formatting` and
// `getSelectionFormatting()` cannot drift into two derivations of the same thing.

import type {
  DocRange,
  EditorCommand,
  EditorScope,
  CanResult,
  ExecResult,
  HyperlinkInfo,
  PageSetup,
  RunFormatting,
  TableContext,
} from '../contracts/editor.ts';
import type { ContainerRef } from '../contracts/types.ts';
import type { ParagraphSummary } from '../contracts/document.ts';
import { classifyCommand } from './docx-editor-support.ts';
import { NO_COPIED_FORMATTING } from './surface-format-painter-contract.ts';
import { gateImageCommand, resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { gateShapeFormatCommand } from './shape-format-commands.ts';
import { chartTargetIn } from '../store/store/tree-package-charts.ts';
import { chartCommandContentRefusal } from './chart-commands.ts';

/** Whether a command may run, and the engine's own refusal when it may not. */
export type CommandGate =
  | { ok: true; tablePlan?: import('./table-command-plan.ts').TableCommandPlan }
  | { ok: false; refusal: Exclude<ExecResult, { ok: true }> };
import { tableContextAt } from '@docx-editor.dev/core/layout';
import { tableAnchorAt } from '../layout/semantic-cell-selection.ts';
import { splitCellLimits } from '../store/store/tree-op-table-split.ts';
import { ownProposedTableIn, suggestingStructureRefusal } from './surface-suggesting-structure.ts';
import {
  isTableEditorCommand,
  planTableCommand,
  type TableCommandPlan,
  type TableCommandPlannerInput,
} from './table-command-plan.ts';
import { suggestingAuthorOf } from './table-cell-structure-plan.ts';
import { findNode, paragraphTextOf, parentNodeOf } from '@docx-editor.dev/core/store';
import { allParagraphs } from '../binding/tree-binding.ts';
import { paragraphStyleId } from '../binding/document-outline.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { bookmarkCommandRefusal } from './docx-editor-bookmarks.ts';

/**
 * THE unified formatting derivation — the one place surface formatting becomes the
 * contract's `RunFormatting`. `snapshot().formatting`, `getSelectionFormatting()`,
 * `isActive` and the `selectionFormatting` query all read this shape (via the cached
 * snapshot), so they can never disagree about what the selection carries.
 */
export function runFormattingOf(surface: PaginatedSurface | null): RunFormatting | null {
  if (!surface) return null;
  const formatting = surface.formatting();
  return {
    bold: formatting.bold,
    italic: formatting.italic,
    underline: formatting.underline,
    strike: formatting.strikethrough,
    superscript: formatting.superscript,
    subscript: formatting.subscript,
    ...(formatting.color ? { color: { kind: 'hex' as const, value: formatting.color } } : {}),
    ...(formatting.highlight ? { highlight: formatting.highlight } : {}),
    ...(formatting.fontFamily ? { fontFamily: formatting.fontFamily } : {}),
    ...(formatting.fontSizeHalfPoints !== null
      ? { fontSizePt: formatting.fontSizeHalfPoints / 2 }
      : {}),
    ...(formatting.alignment ? { alignment: formatting.alignment } : {}),
    ...(formatting.direction ? { direction: formatting.direction } : {}),
    ...(formatting.styleId ? { styleId: formatting.styleId } : {}),
    ...(formatting.lineSpacing ? { lineSpacing: formatting.lineSpacing } : {}),
    ...(formatting.spaceBeforePt !== null ? { spaceBeforePt: formatting.spaceBeforePt } : {}),
    ...(formatting.spaceAfterPt !== null ? { spaceAfterPt: formatting.spaceAfterPt } : {}),
    ...(formatting.indent !== null ? { indent: formatting.indent } : {}),
    // Always present, unlike the fields above: each flag carries its own null for "the
    // selection disagrees", so an absent object and a disagreeing one would be the same
    // value to a checkbox that has to tell them apart.
    paragraphFlags: formatting.paragraphFlags,
    disagrees: formatting.disagrees,
    ...(formatting.tabStops !== null ? { tabStops: formatting.tabStops } : {}),
  };
}

/** The last page setup each editor published, keyed by the editor's open scheduler. */
const lastPageSetups = new WeakMap<object, PageSetup>();

/**
 * {@link pageSetupOf}, but while a replacement document opens with no surface mounted, the
 * previous document's setup. The rulers and the loading page keep that page's geometry
 * until the new document mounts, instead of the ruler vanishing for the open.
 */
export function pageSetupWhileOpening(
  owner: { isScheduled(): boolean },
  surface: PaginatedSurface | null
): PageSetup | null {
  const opening = owner.isScheduled();
  const setup = pageSetupOf(surface);
  if (setup) lastPageSetups.set(owner, setup);
  else if (!opening) lastPageSetups.delete(owner);
  return setup ?? (opening ? (lastPageSetups.get(owner) ?? null) : null);
}

/**
 * THE page-setup derivation — `getPageSetup()` and `snapshot().pageSetup` both read
 * this shape, so the dialog and the rulers can never disagree about the section. In a
 * multi-section document it is the CARET's section, which is what a ruler reflects
 * when the caret crosses a section boundary — Word's behaviour.
 */
export function pageSetupOf(surface: PaginatedSurface | null): PageSetup | null {
  if (!surface) return null;
  const section = surface.sectionPropertiesAt(surface.state().selection.head.paragraphId);
  return {
    pageWidthTwips: section.pageSize.widthTwips,
    pageHeightTwips: section.pageSize.heightTwips,
    orientation: section.landscape ? ('landscape' as const) : ('portrait' as const),
    marginsTwips: {
      top: section.margins.topTwips,
      right: section.margins.rightTwips,
      bottom: section.margins.bottomTwips,
      left: section.margins.leftTwips,
    },
    gutterTwips: section.margins.gutterTwips,
  };
}

/**
 * THE selection derivation — the surface's (node id, offset) selection expressed in the
 * contract's vocabulary. `snapshot().selection` and the `selection` query both read this.
 *
 * Paragraph-granular by design: endpoints are bare `DocAnchor`s (`{ paraId }`), so a
 * caret and any selection inside one paragraph both read as
 * `{from: {paraId: X}, to: {paraId: X}}`. Offsets are deliberately not representable —
 * `DocAnchor` carries none (an agent cannot compute an offset it has not seen), and
 * emitting offsetful positional endpoints would reintroduce the addressing the contract
 * forbids. `from`/`to` are document-ordered regardless of drag direction. The result
 * round-trips: feeding it back to `setSelection` selects the same paragraphs.
 */
export function selectionRangeOf(surface: PaginatedSurface | null): DocRange | null {
  if (!surface) return null;
  const { anchor, head } = surface.state().selection;
  if (anchor.paragraphId === head.paragraphId) {
    const paraId = surface.session.paraIdOf(anchor.paragraphId);
    if (paraId === null) return null;
    return { from: { paraId }, to: { paraId } };
  }
  const anchors = surface.session.paragraphAnchors();
  const anchorParaId = anchors.paraIdByNode.get(anchor.paragraphId);
  const headParaId = anchors.paraIdByNode.get(head.paragraphId);
  if (anchorParaId === undefined || headParaId === undefined) return null;
  const anchorOrdinal = anchors.ordinalByNode.get(anchor.paragraphId) ?? 0;
  const headOrdinal = anchors.ordinalByNode.get(head.paragraphId) ?? 0;
  const reversed =
    headOrdinal < anchorOrdinal || (headOrdinal === anchorOrdinal && head.offset < anchor.offset);
  return reversed
    ? { from: { paraId: headParaId }, to: { paraId: anchorParaId } }
    : { from: { paraId: anchorParaId }, to: { paraId: headParaId } };
}

/**
 * The `hyperlinkAt` query: the link the caret sits in, or null.
 *
 * `href` is the SANITIZED projection, so a caller that puts it straight into a DOM
 * attribute or a `window.open` cannot be handed a scheme the engine refuses. An inert link
 * — a refused scheme, a dangling relationship — answers with an empty `href`: there IS a
 * link at that position (an editor should offer to fix or remove it) and there is nothing
 * to follow.
 */
export function hyperlinkAtOf(surface: PaginatedSurface | null): HyperlinkInfo | null {
  if (!surface) return null;
  const link = surface.hyperlinks.linkAtCaret();
  if (!link) return null;
  const paraId = surface.session.paraIdOf(link.paragraphId);
  // A `DocRange` addresses paragraphs by `w14:paraId`; without one there is no honest
  // range to report, and a fabricated one is worse than none.
  if (paraId === null) return null;
  return {
    href: link.href ?? '',
    range: { from: { paraId }, to: { paraId } },
    ...(link.tooltip !== undefined ? { tooltip: link.tooltip } : {}),
  };
}

/**
 * The `paragraphs` query: every editable paragraph in reading order, addressed the way
 * the contract addresses paragraphs. Scope is the MAIN part — a `container` naming any
 * other story answers `[]`, because queries carry no error channel and an empty list is the
 * only thing this shape can say.
 *
 * That is a scope decision, not a capability one: the paraId index spans every story now, so
 * widening this is a matter of settling what a `container` naming a header should return.
 */
export function paragraphSummaries(
  surface: PaginatedSurface | null,
  container?: ContainerRef
): readonly ParagraphSummary[] {
  if (!surface) return [];
  if (container !== undefined && container.part !== 'body') return [];
  const part = surface.session.part();
  const anchors = surface.session.paragraphAnchors();
  return allParagraphs(part).map((paragraph) => {
    const paraId = anchors.paraIdByNode.get(paragraph.id);
    const styleId = paragraph.kind === 'textValue' ? undefined : paragraphStyleId(paragraph);
    return {
      ...(paraId !== undefined ? { paraId } : {}),
      text: paragraphTextOf(part, paragraph.id) ?? '',
      ...(styleId !== undefined ? { styleId } : {}),
    };
  });
}

export function totalPages(surface: PaginatedSurface | null): number {
  return surface ? surface.state().pageCount : 0;
}

export function currentPage(
  surface: PaginatedSurface | null,
  mode: 'viewport' | 'caret' = 'caret'
): number {
  return surface ? surface.currentPage(mode) : 1;
}

export function gateTableCommand(command: EditorCommand, surface: PaginatedSurface): CommandGate {
  if (!isTableEditorCommand(command)) {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'not a table command' },
    };
  }
  const state = tableCommandState(command, surface);
  if (!state.can.ok) {
    return {
      ok: false,
      refusal: { ok: false, code: state.can.code, reason: state.can.reason },
    };
  }
  return { ok: true, tablePlan: state.plan };
}

export function buildTableCommandPlannerInput(
  command: EditorCommand,
  surface: PaginatedSurface
): TableCommandPlannerInput {
  return {
    command,
    // The part the CARET is in, which is the part `applyTableCommandPlan` commits against.
    // Planned against the body while a header was open, every op named a node the header store
    // has never heard of, so a plan that validated cleanly was then rejected on apply.
    part: surface.session.partFor(surface.storyScope()) ?? surface.session.part(),
    layout: surface.layout(),
    storeRevision: surface.session.packageRevision(),
    selection: surface.state().selection,
    cellSelection: surface.state().cellSelection,
    themeColors: surface.session.documentThemeColors(),
    editable: surface.session.editable,
    viewing: surface.editingMode() === 'view',
    ...suggestingAuthorOf(surface),
  };
}

/** Planner-backed can/plan pair — production gate for table commands. Task 9 maps chrome slots. */
export function tableCommandState(
  command: EditorCommand,
  surface: PaginatedSurface
): { readonly can: CanResult; readonly plan: TableCommandPlan } {
  const input = buildTableCommandPlannerInput(command, surface);
  let plan = planTableCommand(input);
  const settings = settingsPartOf(surface.session.currentPackage());
  if (plan.ok && plan.ops.some((op) => formsProtectionRefusal(input.part, settings, op))) {
    plan = { ok: false, code: 'locked', reason: FORMS_WRITE_REASON };
  }
  // Asked here too, so chrome greys out instead of offering a press the surface refuses.
  if (plan.ok && surface.editingMode() === 'suggest') {
    const reason = suggestingStructureRefusal(
      plan.ops,
      (id) => findNode(input.part, id)?.kind === 'table',
      ownProposedTableIn(surface.session, surface.author())
    );
    if (reason) plan = { ok: false, code: 'unsupported', reason };
  }
  return plan.ok
    ? { can: { ok: true }, plan }
    : { can: { ok: false, code: plan.code, reason: plan.reason }, plan };
}

export function gateCommand(
  command: EditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view' | 'suggesting',
  options?: { scope?: EditorScope }
): CommandGate {
  // Scope option: body and the currently open furniture story are writable; `all` and
  // unrelated scopes stay refused. When omitted, the surface's active scope is used.
  if (options?.scope) {
    if (options.scope.kind === 'all') {
      return {
        ok: false,
        refusal: { ok: false, code: 'unsupported', reason: 'the all scope is read-only' },
      };
    }
    if (options.scope.kind === 'note' || options.scope.kind === 'frame') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: `scope kind '${options.scope.kind}' is not supported`,
        },
      };
    }
    if (options.scope.kind === 'headerFooter') {
      const active = surface?.activeScope?.() ?? { kind: 'body' as const };
      if (active.kind !== 'headerFooter' || active.rId !== options.scope.rId) {
        // Explicit HF scope only when that story is the active editing surface.
        return {
          ok: false,
          refusal: {
            ok: false,
            code: 'unsupported',
            reason: 'open that header or footer before dispatching against its scope',
          },
        };
      }
    }
  }
  const support = classifyCommand(command);
  if (!support.supported) {
    return {
      ok: false,
      refusal: { ok: false, code: support.code ?? 'unsupported', reason: support.reason },
    };
  }
  if (!surface) {
    return {
      ok: false,
      refusal: { ok: false, code: 'notFound', reason: 'no document is loaded' },
    };
  }
  if (support.mutating && (mode === 'view' || !surface.session.editable)) {
    return {
      ok: false,
      refusal: { ok: false, code: 'locked', reason: 'the document is read-only' },
    };
  }
  const protection = support.mutating ? commandProtectionRefusal(command, surface) : null;
  if (protection) return { ok: false, refusal: protection };
  const chartProtection = chartCommandContentRefusal(surface, command);
  if (chartProtection) return { ok: false, refusal: chartProtection };
  const locked = contentLockFormatRefusal(command, surface, contentLockPolicyFor(surface));
  if (locked) return { ok: false, refusal: locked };
  const paragraphLocked = paragraphFormatLockRefusal(
    command,
    surface,
    contentLockPolicyFor(surface)
  );
  if (paragraphLocked) return { ok: false, refusal: paragraphLocked };
  if (command.type === 'insertTextBox') {
    const refusal = textboxInsertionRefusal(surface);
    return refusal ? { ok: false, refusal } : { ok: true };
  }
  // History commands are gated on the HISTORY, not just the mode: `can` drives the
  // toolbar's enabled state, and an undo button that stays live over an empty stack
  // silently no-ops — Word greys it out.
  // Indent is gated the same way, and for the same reason: a list item at level 0 cannot
  // outdent, and one whose definition declares no deeper level cannot indent without
  // losing its marker entirely.
  if (command.type === 'adjustIndent' && !surface.canAdjustIndent(command.direction)) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason:
          command.direction === 'decrease'
            ? 'the selection is already at the outermost level'
            : 'the selection cannot indent any further',
      },
    };
  }
  // Cut, Copy and Delete are gated on the SELECTION, for the reason directly above: a row
  // that stays live over a collapsed caret does nothing when pressed and looks broken. All
  // THREE, because they are siblings in one menu — `deleteText` is `deleteSelection()`,
  // which returns false at a caret, so leaving it out left one of three clipboard-adjacent
  // rows disagreeing with the other two about the same condition.
  //
  // The check is the collapsed comparison, NOT `selectedText() === ''`. Reading the text
  // builds the entire selected string to answer one bit, and `can` is asked from host
  // selectors that re-run on every tick — the exact cost `EditorSnapshot.selectionCollapsed`
  // exists to avoid, which it would be absurd to reintroduce here.
  if (command.type === 'deleteText' && resolveSelectedDrawingRecord(surface)) {
    const refusal = gateImageCommand({ type: 'deleteImage' }, surface);
    return refusal && !refusal.ok ? { ok: false, refusal } : { ok: true };
  }
  // One selected chart copies whole; a cut also deletes it, so it asks the delete's gate.
  if ((command.type === 'copy' || command.type === 'cut') && selectedChartOf(surface)) {
    if (command.type === 'copy') return { ok: true };
    const refusal = gateImageCommand({ type: 'deleteImage' }, surface);
    return refusal && !refusal.ok ? { ok: false, refusal } : { ok: true };
  }
  if (command.type === 'copy' || command.type === 'cut' || command.type === 'deleteText') {
    const { anchor, head } = surface.state().selection;
    if (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset) {
      return {
        ok: false,
        refusal: { ok: false, code: 'unsupported', reason: 'nothing is selected' },
      };
    }
  }
  // Over a selection across notes, a command that replaces it would merge them, so it is refused.
  // Copy and formatting still run there.
  const crossNote = replacesSelection(command.type) ? surfaceCrossNoteRefusal(surface) : null;
  if (crossNote)
    return { ok: false, refusal: { ok: false, code: 'unsupported', reason: crossNote } };
  // The style picker's probe promises "a well-formed pick would be honoured": on a
  // document that defines no paragraph styles, no pick can be — every styleId is refused
  // at exec — so the control must grey out rather than open an empty, dead listbox.
  if (
    command.type === 'setParagraphStyle' &&
    !surface.session.documentStyles().some((style) => style.type === 'paragraph')
  ) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason: 'this document defines no paragraph styles',
      },
    };
  }
  // The format painter holds its capture on the SURFACE, so "is there anything to paint
  // with" is a question only a mounted surface answers. Gated here rather than at exec,
  // because this answer is also what disables the chrome that would run it.
  if (command.type === 'pasteFormatting' && surface.formatPainter.state().level === 'none') {
    return {
      ok: false,
      refusal: { ok: false, code: 'notFound', reason: NO_COPIED_FORMATTING },
    };
  }
  if (command.type === 'undo' && !surface.state().canUndo) {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'nothing to undo' },
    };
  }
  if (command.type === 'redo' && !surface.state().canRedo) {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'nothing to redo' },
    };
  }
  if (command.type === 'insertTable' && !surface.canInsertTable(command.rows, command.cols)) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason: 'a table can only be inserted at a caret in editable body, cell, or note text',
      },
    };
  }
  const bookmarkRefusal = bookmarkCommandRefusal(surface, command);
  if (bookmarkRefusal) return { ok: false, refusal: bookmarkRefusal };
  if (command.type === 'insertToc' && !surface.canInsertToc()) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason: 'a table of contents can only be inserted in the editable document body',
      },
    };
  }
  if (command.type === 'editTextFormField' && !surface.canEditTextFormField())
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'field options are unavailable' },
    };
  if (command.type === 'refreshToc' && !surface.canRefreshToc(command.tocId)) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'notFound',
        reason: 'there is no refreshable table of contents at the selection',
      },
    };
  }
  if (command.type === 'removeToc') {
    const refusal = surface.removeTocRefusal(command.tocId);
    if (refusal) return { ok: false, refusal: { ok: false, ...refusal } };
  }
  if (command.type === 'insertPageField') {
    const active = surface.activeScope?.() ?? { kind: 'body' as const };
    if (active.kind !== 'headerFooter') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'insertPageField requires an open header or footer scope',
        },
      };
    }
  }
  if (command.type === 'insertNote') {
    const active = surface.activeScope?.() ?? { kind: 'body' as const };
    if (active.kind !== 'body') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'insertNote requires body scope',
        },
      };
    }
  }
  // A section break splits the body's `w:sectPr` chain, and `insertSectionBreak` already
  // refuses outside the body. Without this arm the refusal was never PUBLISHED: `can` saw only
  // the static break vocabulary, so the control rendered live in a header and pressing it did
  // nothing at all. A gate the toolbar cannot see is a button that lies.
  if (
    command.type === 'insertBreak' &&
    (command.kind === 'section' || command.kind === 'sectionContinuous')
  ) {
    const active = surface.activeScope?.() ?? { kind: 'body' as const };
    if (active.kind !== 'body') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'a section break can only be inserted in the editable document body',
        },
      };
    }
    // Suggesting mode: a break that RETYPES the following section cannot be proposed. `w:type`
    // lands on the section that starts at the mark, which hangs on a paragraph the break does
    // not touch, and Word's record for that — `w:sectPrChange` — is one this engine refuses in
    // accept and reject. Written untracked it would survive the reject that removes the split.
    //
    // Asked of the SURFACE rather than answered here. The two inputs are both ones only it
    // holds: the LIVE editing mode — `mode` is the constructed one, and a file that declares
    // `w:trackRevisions` opens suggesting with nobody passing it — and the paragraph the break
    // lands in, which for a range in suggesting mode is past the struck words rather than the
    // selection's head. Deriving either of them here made the control and the write disagree.
    const refusal = surface.sectionBreakRefusal(
      command.kind === 'section' ? 'nextPage' : 'continuous'
    );
    if (refusal) {
      return { ok: false, refusal: { ok: false, code: 'unsupported', reason: refusal } };
    }
  }
  // A page break is body structure for the same reason, and the sibling arm above missed it.
  // Only the body paginates: a header is laid out ONCE per variant at flow height and attached
  // to every page, and a note flows inside the note area. So `w:br w:type="page"` written into
  // `header1.xml` or `footnotes.xml` is markup nothing reads. The command reported `ok`, the
  // part changed, and the screen did not — which is the failure mode this gate exists to stop.
  // Word disables the gesture in those stories for the same reason.
  if (command.type === 'insertBreak' && command.kind === 'page') {
    const active = surface.activeScope?.() ?? { kind: 'body' as const };
    if (active.kind !== 'body') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'a page break can only be inserted in the editable document body',
        },
      };
    }
  }
  if (command.type === 'linkHeaderFooterToPrevious') {
    const state = surface.headerFooterState?.();
    const sectionIndex = command.sectionIndex ?? state?.sectionIndex ?? 0;
    if (sectionIndex === 0) {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'invalidArgs',
          reason: 'the first section cannot link to a previous header or footer',
        },
      };
    }
  }
  if (isTableEditorCommand(command)) {
    const tableGate = gateTableCommand(command, surface);
    if (!tableGate.ok) return tableGate;
    return { ok: true, tablePlan: tableGate.tablePlan };
  }
  const imageGate = gateImageCommand(command, surface);
  if (imageGate && !imageGate.ok) {
    return { ok: false, refusal: imageGate };
  }
  const shapeGate = gateShapeFormatCommand(command, surface);
  if (shapeGate) return { ok: false, refusal: shapeGate };
  return { ok: true };
}

/**
 * Whether the caret's paragraph can possibly sit in a table — answered from the tree's
 * O(1) node index, so the snapshot derive does not build the layout's whole table index
 * (a walk over every placed cell of every page) just to learn the caret is in plain body
 * text. Answers TRUE on any doubt — an unknown part, an unknown node, a demoted generic
 * cell — so the full `tableContextAt` path keeps the final word.
 */
function caretMaybeInTableCell(surface: PaginatedSurface, paragraphId: string): boolean {
  const part = surface.session.part();
  // Only the body story's ids resolve against the body part; a header, footer or note
  // paragraph falls through to the full path.
  if (!paragraphId.startsWith(`${part.name}#`)) return true;
  if (!findNode(part, paragraphId)) return true;
  let current = parentNodeOf(part, paragraphId);
  let hops = 0;
  while (current) {
    if (current.kind === 'tableCell') return true;
    // A demoted table's cell is a generic `w:tc`; the layout will not index it as a
    // table, but stay conservative and let the full path answer.
    if (current.kind === 'generic' && current.localName === 'tc') return true;
    if ((hops += 1) > 64) return true;
    current = parentNodeOf(part, current.id);
  }
  return false;
}

export function selectedTableOf(surface: PaginatedSurface | null): {
  readonly blockId: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cell: { readonly row: number; readonly column: number } | null;
} | null {
  if (!surface) return null;
  const state = surface.state();
  const cells = state.cellSelection;
  if (!cells && !caretMaybeInTableCell(surface, state.selection.head.paragraphId)) return null;
  const context = tableContextAt(surface.layout(), state.selection.head.paragraphId);
  if (!context) return null;
  return {
    blockId: context.tableId,
    rowCount: context.rows,
    columnCount: context.columns,
    cell: {
      row: cells ? cells.rows.from : context.rowIndex,
      column: cells ? cells.columns.from : context.columnIndex,
    },
  };
}

/**
 * Where the caret is in a table, if it is in one.
 *
 * Answered for a plain caret, not only for a rectangular cell selection: "am I in a table" is
 * a question about the caret, and reporting it only during a drag would leave a toolbar
 * showing its table controls disabled the whole time the user was typing in a cell.
 */
export function tableContextOf(surface: PaginatedSurface | null): TableContext | null {
  if (!surface) return null;
  const state = surface.state();
  const cells = state.cellSelection;
  // `selection` is a rectangle's own text range when one is live, so its head is inside the
  // table either way and one lookup serves both.
  if (!cells && !caretMaybeInTableCell(surface, state.selection.head.paragraphId)) return null;
  const context = tableContextAt(surface.layout(), state.selection.head.paragraphId);
  if (!context) return null;
  return {
    rows: context.rows,
    columns: context.columns,
    // A rectangle reports its top-left, which is where its commands are anchored.
    rowIndex: cells ? cells.rows.from : context.rowIndex,
    columnIndex: cells ? cells.columns.from : context.columnIndex,
  };
}

/** How far the cell at the caret splits, for a split dialog; null when it does not split. */
export function splitCellConfigOf(
  surface: PaginatedSurface | null
): { maxRows: number; maxCols: number } | null {
  if (!surface) return null;
  const input = buildTableCommandPlannerInput({ type: 'splitCell', rows: 1, cols: 2 }, surface);
  const anchor = tableAnchorAt(input.layout, input.selection.head.paragraphId, input.cellSelection);
  if (!anchor || anchor.cellIds.length > 1) return null;
  const limits = splitCellLimits(input.part, anchor.tableId, anchor.cellId);
  return limits ? { ...limits } : null;
}

/** Half-point reshape of `snapshot().formatting` for `getSelectionFormatting`. */
export function selectionFormattingHalfPoints(formatting: RunFormatting | null): {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSizeHalfPoints?: number;
  styleId?: string;
  alignment?: string;
} | null {
  if (!formatting) return null;
  return {
    ...(formatting.bold !== undefined ? { bold: formatting.bold } : {}),
    ...(formatting.italic !== undefined ? { italic: formatting.italic } : {}),
    ...(formatting.underline !== undefined ? { underline: formatting.underline } : {}),
    ...(formatting.fontFamily ? { fontFamily: formatting.fontFamily } : {}),
    ...(formatting.fontSizePt !== undefined
      ? { fontSizeHalfPoints: Math.round(formatting.fontSizePt * 2) }
      : {}),
    ...(formatting.styleId ? { styleId: formatting.styleId } : {}),
    ...(formatting.alignment ? { alignment: formatting.alignment } : {}),
  };
}

export function isInsideTocOf(surface: PaginatedSurface | null): boolean {
  return (
    !!surface && tocAtPosition(surface.session.part(), surface.state().selection.head) !== undefined
  );
}

/** Whether the selection is one chart drawing. */
function selectedChartOf(surface: PaginatedSurface): boolean {
  const record = resolveSelectedDrawingRecord(surface);
  if (!record) return false;
  const pkg = surface.session.currentPackage();
  return chartTargetIn(pkg, record.ownerPartName, record.drawingNodeId) !== null;
}
