import { insertTextbox } from './textbox-commands.ts';
import { execChartCommand } from './chart-commands.ts';
import { execSetWatermark } from './docx-editor-watermark.ts';
import { execBookmarkCommand } from './docx-editor-bookmarks.ts';
import { CHART_CLIPBOARD_REASON, fragmentRefusalOf } from './clipboard-object-selection.ts';
import { fragmentFromHtml } from './clipboard-fragment-codec.ts';
import { FIELD_CODE_INPUT_REFUSAL } from './surface-field-code-input.ts';
import { execReplaceMatch } from './docx-editor-replace-match.ts';
import { execReplaceAcceptedText } from './docx-editor-replace-accepted-text.ts';
import { execReplaceAllMatches } from './docx-editor-replace-all.ts';
import { execSelectionEdit, runFormatRefusal } from './docx-editor-selection-edits.ts';
// Command dispatch for `createDocxEditor` (editor seam).
//
// One switch, one vocabulary: every `EditorCommand` the gate admitted lands here and is
// expressed as surface calls. Pure over the mounted surface — no editor state, no
// snapshot, no events — so the composition root keeps the lifecycle and this keeps the
// verbs. `classifyCommand` has already refused anything not listed, which is why the
// default branch is unreachable rather than defensive.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { writeClipboardRich } from './clipboard-write.ts';
import { hostElementOfEditor, hostWindowOf } from './host-realm.ts';
import { MARKS, resolveMarkAttr, textSelectionOf } from './docx-editor-support.ts';
import { NOTHING_TO_COPY_FORMATTING, NOTHING_TO_PAINT } from './surface-format-painter-contract.ts';
import { isDocAnchor, isDocAnchorRange, resolveAnchorSelection } from './anchor-resolution.ts';
import { resolveDocTargetSelection } from './doc-target-resolution.ts';
import { storyScopeOfNodeId } from './surface-scope.ts';
import { sameNoteStory } from './surface-note-story.ts';
import { noteScopeIndexOf } from './layout-paragraph-indexes.ts';
import { openTextboxForSelection, textboxSelectionRefusal } from './review-story-entry.ts';
import type { StoryScope } from '@docx-editor.dev/core/store';
import { paragraphFragmentsOfBlocks } from '@docx-editor.dev/core/layout';
import {
  execEditHeaderFooter,
  execInsertPageField,
  execLinkHeaderFooter,
  execRemoveHeaderFooter,
  execSetHeaderFooterOptions,
  execUnlinkHeaderFooter,
} from './docx-editor-hf.ts';
import {
  execConvertAllNotes,
  execConvertNote,
  execDeleteNote,
  execInsertNote,
  execSetNoteProperties,
} from './docx-editor-notes.ts';
import { isTableEditorCommand, planTableCommand } from './table-command-plan.ts';
import { suggestingAuthorOf } from './table-cell-structure-plan.ts';
import {
  execImageCommand,
  isImageCommand,
  resolveSelectedDrawingRecord,
} from './docx-editor-images.ts';
import { lineSpacingAttributes, spacingSideAttributes } from './paragraph-format-write.ts';
import { execShapeFormatCommand, isShapeFormatCommand } from './shape-format-commands.ts';

/**
 * Run one admitted command against the surface.
 *
 * Returns an `ExecResult` when the command answers for itself (a refusal, or a read-only
 * verb that changed nothing), and `null` when it completed normally — the caller then
 * derives `changed` from the model revision rather than trusting the verb.
 */
export function execEditorCommand(
  mounted: PaginatedSurface,
  command: EditorCommand,
  options?: {
    readonly admittedTablePlan?: import('./table-command-plan.ts').TableCommandPlan;
    readonly translate?: (key: string, params?: Record<string, string | number>) => string;
    readonly editor?: Pick<
      import('./docx-editor-types.ts').DocxEditorInstance,
      'surface' | 'mountGeneration' | 'getParagraphText'
    >;
  }
): ExecResult | null {
  switch (command.type) {
    case 'toggleMark': {
      const mark = MARKS.get(command.mark)!;
      // The document's refusal, in its own words: the reason names the cause.
      const refused = mounted.toggleRunProperty(mark.localName, mark.attributes);
      if (refused) return runFormatRefusal(refused);
      break;
    }
    case 'setMarkAttr': {
      // The gate already ran `resolveMarkAttr` through `classifyCommand`; resolving
      // again here keeps exec's write derived from the command, not from trust.
      const resolved = resolveMarkAttr(command);
      if (!resolved.ok) return { ok: false, code: resolved.code, reason: resolved.reason };
      const refused = mounted.setRunProperty(resolved.localName, resolved.attributes);
      if (refused) return runFormatRefusal(refused);
      break;
    }
    case 'clearFormatting':
      mounted.clearFormatting();
      break;
    case 'copyFormatting':
      // Reports for itself: nothing about the DOCUMENT moved, so the revision comparison the
      // caller falls back to would answer `changed: false` for a capture that succeeded and
      // for one that found no span alike.
      return mounted.formatPainter.capture()
        ? { ok: true, changed: false }
        : { ok: false, code: 'notFound', reason: NOTHING_TO_COPY_FORMATTING };
    case 'pasteFormatting': {
      // An empty capture is refused by `gateCommand`, which both `can` and `exec` go
      // through — one authority, so the button's reason and the refusal are one sentence.
      // What `can` cannot answer is whether THIS selection holds anything the capture can
      // reach, so a paint that landed nowhere reports for itself rather than falling through
      // to a revision comparison that cannot tell it from a no-op change.
      const painted = mounted.formatPainter.apply();
      if (painted === 'nothingToPaint') {
        return { ok: false, code: 'notFound', reason: NOTHING_TO_PAINT };
      }
      // The ops existed and the document turned them down, so the DOCUMENT's own words are
      // the right ones — a locked content control and a read-only file are not the same
      // refusal, and neither is "select some text".
      if (painted === 'refused') {
        return {
          ok: false,
          code: 'locked',
          reason: mounted.state().lastRejection ?? NOTHING_TO_PAINT,
        };
      }
      break;
    }
    case 'setLineSpacing':
      // `w:line` is 240ths of a line under `auto` and twentieths of a point otherwise —
      // one attribute, two units, which is exactly why the command takes the rule's own.
      mounted.setParagraphProperty(
        'spacing',
        lineSpacingAttributes({ rule: command.rule, value: command.value }),
        { mergeAttributes: true }
      );
      break;
    case 'setParagraphSpacing':
      mounted.setParagraphProperty(
        'spacing',
        {
          // `null` REMOVES the attribute, which is not the same as writing a zero: a removed
          // value inherits from the style again, while a zero blocks the cascade. Word's
          // "Remove space before paragraph" is the ZERO — the toolbar sends 0, not null.
          //
          // The autospacing flag on the same side goes with the measurement, because it
          // REPLACES it: `w:beforeAutospacing="1"` is worth 14pt whatever `w:before` says, so
          // a paragraph inheriting the flag — which is what Word writes for HTML-shaped
          // content, as `w:before="100" w:beforeAutospacing="1"` — swallowed this write
          // whole and the page did not move. Word clears the flag the same way when a value
          // is typed. An explicit `0` is written rather than the attribute dropped: dropping
          // it would let the inherited flag come back and win again.
          ...spacingSideAttributes('before', command.beforePt),
          ...spacingSideAttributes('after', command.afterPt),
        },
        { mergeAttributes: true }
      );
      break;
    case 'setAlignment':
      // The contract says `justify`; `w:jc` spells it `both`.
      // A physical edge, as the button shows it; the writer spells it per paragraph direction.
      mounted.setParagraphProperties([
        {
          localName: 'jc',
          attributes: { val: command.align === 'justify' ? 'both' : command.align },
          physicalAlignment: true,
        },
      ]);
      break;
    case 'setParagraphDirection':
      mounted.setParagraphProperties([
        { localName: 'bidi', paragraphDirection: command.direction },
      ]);
      break;
    case 'setParagraphStyle': {
      // The styleId must name a paragraph style the DOCUMENT defines: writing a dangling
      // `w:pStyle` would render as Normal here and as a missing style everywhere else.
      // Checked at exec rather than `can` because `can` also answers the toolbar's probe,
      // which must mean "would a well-formed pick be honoured" on any document.
      const known = mounted.session
        .documentStyles()
        .some((style) => style.type === 'paragraph' && style.styleId === command.styleId);
      if (!known) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `style '${command.styleId}' is not a paragraph style of this document`,
        };
      }
      mounted.setParagraphProperty('pStyle', { val: command.styleId });
      break;
    }
    case 'setIndent': {
      // Not `setParagraphProperty`: the write needs the paragraph's AUTHORED attributes to
      // pick between the `w:left`/`w:start` spellings and to keep the first-line pair
      // consistent, so it lives beside `adjustIndent` on the surface.
      mounted.setIndent({
        ...(command.left !== undefined ? { left: command.left } : {}),
        ...(command.right !== undefined ? { right: command.right } : {}),
        ...(command.firstLine !== undefined ? { firstLine: command.firstLine } : {}),
      });
      break;
    }
    case 'setParagraphFormat': {
      // The contract says `justify`; `w:jc` spells it `both` — the same translation
      // `setAlignment` makes.
      const written = mounted.setParagraphFormat({
        ...(command.alignment !== undefined
          ? { alignment: command.alignment === 'justify' ? ('both' as const) : command.alignment }
          : {}),
        ...(command.direction !== undefined ? { direction: command.direction } : {}),
        ...(command.spaceBeforePt !== undefined ? { spaceBeforePt: command.spaceBeforePt } : {}),
        ...(command.spaceAfterPt !== undefined ? { spaceAfterPt: command.spaceAfterPt } : {}),
        ...(command.lineSpacing !== undefined ? { lineSpacing: command.lineSpacing } : {}),
        ...(command.indentLeftTwips !== undefined
          ? { indentLeftTwips: command.indentLeftTwips }
          : {}),
        ...(command.indentRightTwips !== undefined
          ? { indentRightTwips: command.indentRightTwips }
          : {}),
        ...(command.indentFirstLineTwips !== undefined
          ? { indentFirstLineTwips: command.indentFirstLineTwips }
          : {}),
        ...(command.contextualSpacing !== undefined
          ? { contextualSpacing: command.contextualSpacing }
          : {}),
        ...(command.keepNext !== undefined ? { keepNext: command.keepNext } : {}),
        ...(command.keepLines !== undefined ? { keepLines: command.keepLines } : {}),
        ...(command.widowControl !== undefined ? { widowControl: command.widowControl } : {}),
        ...(command.pageBreakBefore !== undefined
          ? { pageBreakBefore: command.pageBreakBefore }
          : {}),
        ...(command.tabStops !== undefined ? { tabStops: command.tabStops } : {}),
      });
      if (!written) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the paragraph format could not be written here',
        };
      }
      break;
    }
    case 'setPageSetup': {
      // The anchor must name BODY content: `w:sectPr` lives on the body story, so the op
      // resolves its target section by walking the body tree. A caret in a header or a note is
      // not in that tree, so passing it straight through refused the whole write as
      // `unknown-paragraph` — Page Setup's Apply and a ruler margin drag both did nothing from
      // any furniture caret, with the dialog still reading the correct section beside them.
      let anchor: string | undefined;
      if (command.scope === 'section') {
        const target = mounted.sectionAnchorParagraphAt(mounted.state().selection.head.paragraphId);
        if (target.kind === 'unaddressable') {
          // Writing every section instead is what `scope: 'document'` means, and doing it to a
          // `scope: 'section'` request changes pages nobody asked about — quietly, because
          // page geometry does not announce itself. A refusal is recoverable; that is not.
          return {
            ok: false,
            code: 'unsupported',
            reason: 'this section holds no paragraph to address it by',
          };
        }
        anchor = target.kind === 'anchor' ? target.paragraphId : undefined;
      }
      // When orientation arrives WITH explicit dimensions, the dimensions are
      // oriented here — Word stores landscape as swapped dimensions plus the
      // attribute. Orientation ALONE stays alone: the op swaps each written
      // section's own dimensions, so distinct paper sizes survive the flip.
      let width = command.pageWidth;
      let height = command.pageHeight;
      if (command.orientation !== undefined && (width !== undefined || height !== undefined)) {
        // No anchor here means `scope: 'document'`, or a single-section document — in both,
        // the body-level properties ARE the caret's section. A `scope: 'section'` request
        // that could not name its section was refused above rather than arriving with no
        // anchor, which is what kept those two apart.
        const section = anchor ? mounted.sectionPropertiesAt(anchor) : mounted.sectionProperties();
        const w = width ?? section.pageSize.widthTwips;
        const h = height ?? section.pageSize.heightTwips;
        width = command.orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h);
        height = command.orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h);
      }
      const committed = mounted.setSectionProperties({
        ...(width !== undefined ? { pageWidthTwips: width } : {}),
        ...(height !== undefined ? { pageHeightTwips: height } : {}),
        ...(command.orientation !== undefined ? { orientation: command.orientation } : {}),
        ...(command.marginTop !== undefined ? { marginTopTwips: command.marginTop } : {}),
        ...(command.marginRight !== undefined ? { marginRightTwips: command.marginRight } : {}),
        ...(command.marginBottom !== undefined ? { marginBottomTwips: command.marginBottom } : {}),
        ...(command.marginLeft !== undefined ? { marginLeftTwips: command.marginLeft } : {}),
        ...(anchor !== undefined ? { anchorParagraphId: anchor } : {}),
      });
      // The op layer can refuse what per-field bounds cannot see — margins that
      // together swallow a page. A refusal must surface as one, not close a dialog
      // claiming success.
      if (!committed) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: mounted.state().lastRejection ?? 'the page setup change was refused',
        };
      }
      break;
    }
    case 'toggleList':
      if (!mounted.toggleList(command.kind)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: mounted.state().lastRejection ?? 'the list change was refused',
        };
      }
      break;
    case 'adjustIndent':
      if (!mounted.adjustIndent(command.direction)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: mounted.state().lastRejection ?? 'the selection is already at that indent level',
        };
      }
      break;
    case 'insertBreak':
      if (command.kind === 'section' || command.kind === 'sectionContinuous') {
        const breakType = command.kind === 'section' ? 'nextPage' : 'continuous';
        if (!mounted.insertSectionBreak(breakType)) {
          // The lane's OWN reason first. `lastRejection` here is the store's rejection enum
          // (`invalid-property-value` for a mark in a table cell), which is a diagnostic, not
          // chrome: it names no cause a reader can act on and no locale can translate it.
          return {
            ok: false,
            code: 'invalidArgs',
            reason:
              mounted.sectionBreakRefusal(breakType) ??
              mounted.state().lastRejection ??
              'the section break was refused',
          };
        }
        break;
      }
      // `page` has its own tree op and its own `w:br w:type="page"`. Falling through
      // to a line break here made Ctrl+Enter silently insert the wrong element.
      if (command.kind === 'page') {
        mounted.insertPageBreak();
        break;
      }
      mounted.insertLineBreak();
      break;
    case 'insertHyperlink': {
      // `#name` is a bookmark in this document; anything else is an external target and
      // goes through the package's URL allowlist on the way to a relationship. A refusal
      // there surfaces as one rather than committing a link with nowhere to go.
      const internal = command.href.startsWith('#');
      const applied = mounted.hyperlinks.applyHyperlink({
        ...(internal ? { anchor: command.href.slice(1) } : { url: command.href }),
        ...(command.text !== undefined ? { text: command.text } : {}),
      });
      if (!applied) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason:
            mounted.state().lastRejection ??
            'the link was refused: the target is not an allowed scheme, or there is no text to link',
        };
      }
      break;
    }
    case 'removeHyperlink':
      if (!mounted.hyperlinks.removeHyperlink()) {
        return {
          ok: false,
          code: 'notFound',
          reason: 'there is no hyperlink at the selection',
        };
      }
      break;
    case 'insertTextBox':
      return insertTextbox(mounted);
    case 'insertChart':
    case 'setChartData':
    case 'setChartType':
    case 'setChartFormat':
    case 'setChartColor':
      return execChartCommand(mounted, command, options?.translate);
    case 'replaceText':
    case 'applyFormatting':
    case 'splitParagraph':
    case 'mergeParagraphs':
    case 'removeTabMark':
      return execSelectionEdit(mounted, command);
    case 'insertText':
      mounted.type(command.text);
      if (
        mounted.state().lastRejection === 'the table of contents is generated and read-only' ||
        mounted.state().lastRejection === FIELD_CODE_INPUT_REFUSAL
      ) {
        return { ok: false, code: 'invalidArgs', reason: mounted.state().lastRejection! };
      }
      break;
    case 'deleteText':
      if (resolveSelectedDrawingRecord(mounted)) {
        return execImageCommand(mounted, { type: 'deleteImage' }, options?.editor);
      }
      mounted.deleteSelection();
      break;
    case 'proposeInsertion':
    case 'proposeDeletion':
    case 'proposeReplacement': {
      if (command.target !== undefined) {
        const resolved = resolveDocTargetSelection(mounted, command.target);
        if (!resolved.ok) {
          return { ok: false, code: resolved.code, reason: resolved.reason };
        }
        mounted.setSelection(resolved.selection);
      }
      const kind =
        command.type === 'proposeInsertion'
          ? 'insertion'
          : command.type === 'proposeDeletion'
            ? 'deletion'
            : 'replacement';
      const text =
        command.type === 'proposeInsertion'
          ? command.text
          : command.type === 'proposeReplacement'
            ? command.replaceWith
            : '';
      if (!mounted.proposeTextChange(kind, text, command.author)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: mounted.state().lastRejection ?? `${command.type} was refused`,
        };
      }
      break;
    }
    case 'replaceMatch':
      return execReplaceMatch(mounted, command);
    case 'replaceAcceptedText':
      return execReplaceAcceptedText(
        mounted,
        (blockId) => options?.editor?.getParagraphText(blockId) ?? null,
        command
      );
    case 'replaceAllMatches':
      return execReplaceAllMatches(mounted, command);
    case 'undo':
      mounted.undo();
      break;
    case 'redo':
      mounted.redo();
      break;
    case 'insertTable':
      if (!mounted.insertTable(command.rows, command.cols)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the table could not be inserted here',
        };
      }
      break;
    case 'insertToc':
      if (!mounted.insertToc()) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the table of contents could not be inserted',
        };
      }
      break;
    case 'editTextFormField':
      return mounted.editTextFormField()
        ? { ok: true, changed: false }
        : { ok: false, code: 'unsupported', reason: 'field options are unavailable' };
    case 'refreshToc':
      if (!mounted.refreshToc(command.tocId, command.mode)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the table of contents could not be refreshed',
        };
      }
      break;
    case 'removeToc':
      if (!mounted.removeToc(command.tocId)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the table of contents could not be removed',
        };
      }
      break;
    case 'editHeaderFooter':
      return execEditHeaderFooter(mounted, command);
    case 'exitHeaderFooter': {
      if (typeof mounted.exitHeaderFooter === 'function') mounted.exitHeaderFooter();
      return { ok: true, changed: false };
    }
    case 'removeHeaderFooter':
      return execRemoveHeaderFooter(mounted, command);
    case 'linkHeaderFooterToPrevious':
      return execLinkHeaderFooter(mounted, command);
    case 'unlinkHeaderFooterFromPrevious':
      return execUnlinkHeaderFooter(mounted, command);
    case 'setHeaderFooterOptions':
      return execSetHeaderFooterOptions(mounted, command);
    case 'setWatermark':
      return execSetWatermark(mounted, command.watermark);
    case 'insertBookmark':
    case 'deleteBookmark':
    case 'keepFirstBookmark':
    case 'goToBookmark':
      return execBookmarkCommand(mounted, command);
    case 'insertPageField':
      return execInsertPageField(mounted, command);
    case 'insertNote':
      return execInsertNote(mounted, command);
    case 'deleteNote':
      return execDeleteNote(mounted, command);
    case 'convertNote':
      return execConvertNote(mounted, command);
    case 'convertAllNotes':
      return execConvertAllNotes(mounted, command);
    case 'setNoteProperties':
      return execSetNoteProperties(mounted, command);
    case 'insertRow':
    case 'deleteRow':
    case 'insertColumn':
    case 'deleteColumn':
    case 'deleteTable':
    case 'setCellFill':
    case 'setTableCellVerticalAlignment':
    case 'setTableBorders':
    case 'commitTableColumnDividerResize':
    case 'commitTableRightEdgeResize':
    case 'mergeCells':
    case 'splitCell':
    case 'toggleHeaderRow':
    case 'selectTableRegion':
    case 'setTableProperties': {
      if (!isTableEditorCommand(command)) {
        return { ok: false, code: 'unsupported', reason: 'unsupported command' };
      }
      const plan =
        options?.admittedTablePlan ??
        planTableCommand({
          command,
          part: mounted.session.part(),
          layout: mounted.layout(),
          storeRevision: mounted.session.packageRevision(),
          selection: mounted.state().selection,
          cellSelection: mounted.state().cellSelection,
          themeColors: mounted.session.documentThemeColors(),
          editable: mounted.session.editable,
          viewing: mounted.editingMode() === 'view',
          ...suggestingAuthorOf(mounted),
        });
      return mounted.applyTableCommandPlan(plan);
    }
    case 'selectAll':
      mounted.selectAll();
      // Selection is not document state: nothing to save changed.
      return { ok: true, changed: false };
    case 'copy': {
      // The gate already refused a collapsed selection that holds no chart.
      const flavours = mounted.copyFlavours();
      if (flavours.reason) return clipboardRefusal(flavours.reason);
      writeClipboardRich(flavours.text, flavours.html, clipboardWindow(options?.editor));
      return { ok: true, changed: false };
    }
    case 'cut': {
      // Read BEFORE the delete: `copyFlavours` answers from the selection, and the delete
      // is what removes it.
      const flavours = mounted.copyFlavours();
      if (flavours.reason) return clipboardRefusal(flavours.reason);
      writeClipboardRich(flavours.text, flavours.html, clipboardWindow(options?.editor));
      // One selected chart: the cut deletes that chart, as Delete does.
      if (flavours.chartDrawingNodeId) {
        const removed = mounted.deleteImage(flavours.chartDrawingNodeId);
        if (!removed.ok)
          return {
            ok: false,
            code: 'unsupported',
            reason: removed.detail ?? removed.reason ?? 'the chart was not deleted',
          };
      } else mounted.deleteSelection();
      break;
    }
    case 'paste': {
      // Same fidelity routing as the paste event; a text-only call is the plain lane.
      // A payload that lands on no lane (empty text, unusable HTML) changed nothing.
      const fragment = command.html ? fragmentFromHtml(command.html) : null;
      const refusal = fragment ? fragmentRefusalOf(fragment.bytes) : null;
      if (refusal) {
        return clipboardRefusal(refusal === 'chart' ? 'chart-content' : 'unsupported-content');
      }
      const result = mounted.pasteRich(command.text, command.html ?? null);
      if (!result) {
        return { ok: true, changed: false };
      }
      break;
    }
    case 'pasteWithoutFormatting':
      mounted.insertPlainText(command.text);
      break;
    case 'setSelection': {
      // Every successful branch REVEALS its head. This command is host/automation-facing
      // — "select this paragraph" means "show it to me" — and the caret-follow scroll
      // inside `setSelection` cannot serve it: it sits out for range selections and for
      // callers whose focus is outside the pages layer, which is the normal state for a
      // host driving the editor from its own chrome. `'centerIfNeeded'` keeps an
      // already-visible target still and centres one it has to travel to, rather than
      // stopping the moment it clears the bottom edge.
      const text = 'range' in command ? textSelectionOf(command.range) : null;
      if (text?.kind === 'invalid') return { ok: false, code: 'invalidArgs', reason: text.reason };
      if (text?.kind === 'ok') {
        const range = text.selection;
        // Open the story the range is in first, as the anchor form below does: a header,
        // footer or note range selected from the body would otherwise strand the caret.
        const boxRefusal = textboxSelectionRefusal(mounted, range);
        if (boxRefusal) return { ok: false, code: 'unsupported', reason: boxRefusal };
        const entered = enterStoryForSelection(mounted, range);
        if (!entered.ok) return entered;
        openTextboxForSelection(mounted, range);
        mounted.setSelection(range);
        mounted.revealPosition(range.head, { block: 'centerIfNeeded' });
        // Selection is not document state: nothing to save changed.
        return { ok: true, changed: false };
      }
      // DocAnchor forms resolve through the session's paraId index. The gate admitted
      // only anchor-shaped payloads past the surface form, so a fall-through here is a
      // range with anchor endpoints or an `{ anchor }` position.
      const payload =
        'anchor' in command && isDocAnchor(command.anchor)
          ? { anchor: command.anchor }
          : 'range' in command && isDocAnchorRange(command.range)
            ? { range: command.range }
            : null;
      if (payload === null) {
        return { ok: false, code: 'unsupported', reason: 'unsupported selection form' };
      }
      const resolved = resolveAnchorSelection(
        mounted.session.part(),
        mounted.session.paragraphAnchors(),
        payload
      );
      if (!resolved.ok) return resolved;
      // OPEN the story the anchor names before selecting into it.
      //
      // The paraId index spans every story, so an anchor can name a header paragraph — and
      // `snapshot().selection` hands one out whenever the caret is in one, which the contract
      // says round-trips through here. Selecting it without entering left the caret on a
      // paragraph the active scope had never heard of, and every keystroke after it was
      // dropped with no refusal: the editor simply stopped accepting text.
      const entered = enterStoryForSelection(mounted, resolved.selection);
      if (!entered.ok) return entered;
      mounted.setSelection(resolved.selection);
      mounted.revealPosition(resolved.selection.head, { block: 'centerIfNeeded' });
      return { ok: true, changed: false };
    }
    default:
      if (isImageCommand(command)) {
        return execImageCommand(mounted, command, options?.editor);
      }
      if (isShapeFormatCommand(command)) return execShapeFormatCommand(mounted, command);
      // Unreachable: `classifyCommand` refused everything else. Typed for the compiler.
      return { ok: false, code: 'unsupported', reason: 'unsupported command' };
  }
  return null;
}

/** The scope id of the note whose painted fragments hold `paragraphId`, or null. */
/** The window whose clipboard a copy writes to: the editor's, a pop-out's when it is there. */
/** A refused copy, cut or paste. A chart refuses with its own reason, which adapters translate. */
function clipboardRefusal(reason: 'unsupported-content' | 'chart-content'): ExecResult {
  return {
    ok: false,
    code: 'unsupported',
    reason: reason === 'chart-content' ? CHART_CLIPBOARD_REASON : reason,
  };
}

function clipboardWindow(editor: object | undefined): Window | undefined {
  return editor ? hostWindowOf(hostElementOfEditor(editor)) : undefined;
}

function noteScopeHolding(mounted: PaginatedSurface, paragraphId: string): string | null {
  return noteScopeIndexOf(mounted.layout()).get(paragraphId) ?? null;
}

/**
 * The page a furniture paragraph is painted on, with that page's section.
 *
 * A header opened WITHOUT a page is opened without a section, and the section is what the
 * ruler clamps to and what `insertTableOp` divides into columns. One part can be the default
 * header of several sections, so "the first section that names this rId" is a different page's
 * geometry — a table sized for the wrong paper. The painted page settles it, exactly as the
 * pointer seam already does when the reader clicks the same header.
 */
function headerFooterPageHolding(
  mounted: PaginatedSurface,
  paragraphId: string
): { readonly pageIndex: number; readonly sectionIndex: number } | null {
  const pages = mounted.layout().pages;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      for (const fragment of paragraphFragmentsOfBlocks(story.fragments)) {
        if (fragment.paragraphId !== paragraphId) continue;
        return { pageIndex, sectionIndex: mounted.sectionAtPage(pageIndex).sectionIndex };
      }
    }
  }
  return null;
}

/**
 * Whether two scopes name the same story.
 *
 * Structural, not `JSON.stringify`: stringify is key-order dependent and happens to work only
 * because both values come from the same constructor. It also cannot separate two notes in one
 * notes part, which the caller handles by note id.
 */
function sameStory(a: StoryScope, b: StoryScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'headerFooter' && b.kind === 'headerFooter') return a.rId === b.rId;
  if (a.kind === 'notesPart' && b.kind === 'notesPart') return a.noteKind === b.noteKind;
  return true;
}

/**
 * Put the surface in the story a selection addresses, so the caret and the scope agree.
 *
 * A selection whose endpoints are in different stories is refused rather than half-applied:
 * there is no scope in which both are addressable, and a caret split across two stores is the
 * state that silently swallows input.
 */
function enterStoryForSelection(
  mounted: PaginatedSurface,
  selection: { readonly anchor: { paragraphId: string }; readonly head: { paragraphId: string } }
): ExecResult {
  const scope = storyScopeOfNodeId(mounted.session, selection.head.paragraphId, {
    kind: 'body',
  });
  const anchorScope = storyScopeOfNodeId(mounted.session, selection.anchor.paragraphId, {
    kind: 'body',
  });
  if (!sameStory(scope, anchorScope)) {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'a selection cannot span two stories',
    };
  }
  const active = mounted.activeScope();
  if (scope.kind === 'body') {
    if (active.kind !== 'body') {
      mounted.exitNote?.();
      mounted.exitHeaderFooter?.();
    }
    return { ok: true, changed: false };
  }
  if (scope.kind === 'headerFooter') {
    if (active.kind === 'headerFooter' && active.rId === scope.rId) {
      return { ok: true, changed: false };
    }
    mounted.exitNote?.();
    // WITH the page, so the story opens against the section it is painted in.
    const at = headerFooterPageHolding(mounted, selection.head.paragraphId);
    const opened = mounted.enterHeaderFooter?.({
      rId: scope.rId,
      ...(at ? { pageIndex: at.pageIndex, sectionIndex: at.sectionIndex } : {}),
    });
    return opened
      ? { ok: true, changed: false }
      : { ok: false, code: 'unsupported', reason: 'that header or footer could not be opened' };
  }
  // A notes PART holds every note, so the scope has to name the NOTE the paragraph is in. The
  // painted layout is what knows which one that is.
  //
  // BOTH endpoints, because `StoryScope` cannot tell two footnotes apart: every footnote in a
  // document answers `{ kind: 'notesPart', noteKind: 'footnote' }`. The anchor must be in a
  // note of the head's kind. A range across notes is then the selection a drag makes; the
  // surface refuses typing and deletion over it (`crossNoteWriteRefusal`), never half-applies.
  const scopeId = noteScopeHolding(mounted, selection.head.paragraphId);
  if (!scopeId) {
    return { ok: false, code: 'notFound', reason: 'that note is not laid out' };
  }
  const anchorScopeId =
    selection.anchor.paragraphId === selection.head.paragraphId
      ? scopeId
      : noteScopeHolding(mounted, selection.anchor.paragraphId);
  // Notes of one kind are one story (ECMA-376 Part 1 §17.11): a range from footnote 1 into footnote 3 opens
  // the head's note, the way a drag across them leaves it. Edits over it are refused later.
  if (!anchorScopeId || !sameNoteStory(anchorScopeId, scopeId)) {
    return { ok: false, code: 'unsupported', reason: 'a selection cannot span two stories' };
  }
  // Already in that story: the open note follows the head when the selection lands.
  if (active.kind === 'note' && sameNoteStory(active.id, scopeId)) {
    return { ok: true, changed: false };
  }
  mounted.exitHeaderFooter?.();
  const opened = mounted.enterNote?.(scopeId);
  return opened
    ? { ok: true, changed: false }
    : { ok: false, code: 'unsupported', reason: 'that note could not be opened' };
}
