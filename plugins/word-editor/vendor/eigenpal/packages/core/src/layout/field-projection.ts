// Field projection entry point. The bounded tree walk lives in field-projection-walk.ts.
import type { DocumentProperties, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { BodyPageFieldContext, FieldPageContext } from './field-page-furniture.ts';
import type {
  FieldAwarePiece,
  FieldLinkProjector,
  HyperlinkProjector,
  MutableModelRange,
} from './field-pieces.ts';
import type { RunPropertyCascader } from './field-run-text.ts';
import type { NoteMarkContext } from './note-projection.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { ThemeFonts } from './run-style.ts';
import type { RefFieldContext } from './field-ref.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  type RevisionDisplayMode,
  type RevisionAuthorFilter,
} from './revision-projection.ts';
import { piecesOfParagraphForDisplay } from './field-projection-walk.ts';

// Re-exports so existing layout-local imports stay stable: instruction recognition and
// detection, whole-document page-field finalization (pagination-time values, own module),
// the piece vocabulary, and the shared run-child text/property vocabulary.
export {
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_STORY_FIELD_SCAN_DEPTH,
  MAX_STORY_FIELD_SCAN_NODES,
  allowlistedPageField,
  detectStoryPageFields,
  normalizeFieldInstruction,
  type StoryPageFieldNeeds,
} from './field-instruction.ts';
export {
  carryStrippedPageFieldProjection,
  fieldPageContextToken,
  finalizePageFieldProjection,
  formatPageNumber,
  projectPageFieldValue,
  storyNeedsPageFields,
  summarizeFlushedPage,
  withPageFieldSources,
  type FieldPageContext,
} from './field-page-furniture.ts';
export {
  type FieldAwarePiece,
  type FieldLinkProjector,
  type HyperlinkProjector,
  type ModelRange,
  type PositionalTab,
} from './field-pieces.ts';
export { propertiesOfRunContainer, type RunPropertyCascader } from './field-run-text.ts';

/**
 * Flatten a paragraph into measurable pieces, projecting allowlisted page fields when a
 * page context is supplied (furniture finalize / `withPageContext`).
 *
 * Well-formed computed fields (`begin`→`end`) and typed/generic `w:fldSimple` each contribute
 * one UTF-16 model unit so offsets stay aligned with `paragraphTextOf`. FORMTEXT results remain
 * editable at their natural length. Malformed fields demote the same way: markers contribute
 * nothing and interior result text stays visible.
 *
 * `w:fldSimple` advances the model offset by one and paints its result as a single projected
 * piece (live page value when allowlisted and a page context is supplied; otherwise cached
 * text, with nested allowlisted page fields evaluated live under that same context).
 *
 * Hidden runs (`w:vanish`) emit no piece while still advancing offsets.
 */
export function piecesOfParagraph(
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
  authorFilter?: RevisionAuthorFilter
): FieldAwarePiece[] {
  return piecesOfParagraphForDisplay(
    paragraph,
    inheritedRunProperties,
    pageContext,
    cascadeRuns,
    projectLink,
    noteMarks,
    displayMode,
    deletedRanges,
    inlineDrawingLayout,
    themeFonts,
    projectFieldLink,
    documentProperties,
    bodyPageFields,
    refFields,
    authorFilter
  );
}
