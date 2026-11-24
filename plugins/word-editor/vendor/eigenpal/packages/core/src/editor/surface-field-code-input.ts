import { parsedFieldSpansOf } from '../store/package/field-nodes.ts';
import { findNode, paragraphOffsetIndex, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '../layout/semantic-interaction.ts';

export const FIELD_CODE_INPUT_REFUSAL = 'switch to field results before editing a form value';
/** A form's literal offsets must not accept invisible value edits while its code is displayed. */
export function selectionTouchesFieldCodeInput(
  partOf: (id: string) => OoxmlPart | null | undefined,
  selection: SemanticSelection
): boolean {
  const { anchor, head } = selection;
  const sameParagraph = anchor.paragraphId === head.paragraphId;
  for (const position of [anchor, head]) {
    const part = partOf(position.paragraphId);
    const paragraph = part && findNode(part, position.paragraphId);
    if (paragraph?.kind !== 'paragraph') continue;
    const start = sameParagraph ? Math.min(anchor.offset, head.offset) : position.offset;
    const end = sameParagraph ? Math.max(anchor.offset, head.offset) : position.offset;
    const offsets = paragraphOffsetIndex(paragraph);
    const fields = parsedFieldSpansOf(paragraph)
      .filter((field) => field.addressing === 'editable-result')
      .map((field) => {
        const start = offsets.spanOf(field.node)?.start ?? 0;
        let end = start;
        for (const id of field.removeNodeIds) end = Math.max(end, offsets.spanOf(id)?.end ?? end);
        return { start, end };
      });
    if (
      fields.some((field) =>
        start === end
          ? start >= field.start && (start < field.end || field.start === field.end)
          : start < field.end && end > field.start
      )
    )
      return true;
  }
  return false;
}
