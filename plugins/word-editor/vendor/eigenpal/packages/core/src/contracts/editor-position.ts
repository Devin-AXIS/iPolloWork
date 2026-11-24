import type { DocAnchor } from './types.ts';
import type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';
import type { TextPosition } from './editor-selection-range.ts';

/**
 * A selection endpoint, in either vocabulary the engine resolves.
 *
 * {@link DocAnchor} addresses a paragraph by its `w14:paraId`, which is what an LLM or an
 * automation script can name in a payload. {@link SemanticPosition} addresses it by the
 * paragraph id the painted surface and the ops already use, with a UTF-16 offset inside it.
 *
 * Neither subsumes the other. A paraId survives being written to a file and read back, so it
 * is the one an out-of-process caller can hold; but it is OPTIONAL in the document, and
 * `ParagraphSummary.paraId` says so — a paragraph the file gave no `w14:paraId` cannot be
 * reached by a `DocAnchor` at all. The paragraph id reaches every paragraph.
 */
export type EditorPosition = DocAnchor | SemanticPosition;

/**
 * A selection, in one endpoint vocabulary or the other.
 *
 * The vocabularies do NOT mix: a range is a pair of paraId anchors, or an anchor/head pair
 * of text positions, and `can()` refuses anything else with the engine's own reason. Spelled
 * as separate arms rather than `{ from: EditorPosition; to: EditorPosition }` for exactly
 * that reason: the looser shape would type a mixed pair the engine rejects at runtime.
 *
 * A text position names its paragraph with `blockId`, as {@link TextPosition} and
 * `getSelectionRange()` do. `paragraphId` is the older name for the same id and stays
 * accepted. A position with neither, or with both set to different ids, is refused with
 * `invalidArgs`.
 */
export type EditorSelection =
  | { anchor: TextPosition; head: TextPosition }
  | SemanticSelection
  | { from: DocAnchor; to: DocAnchor };
