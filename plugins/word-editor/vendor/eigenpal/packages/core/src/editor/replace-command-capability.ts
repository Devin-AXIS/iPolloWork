import type { CanResult, EditorCommand, ParagraphText } from '../contracts/editor.ts';
import { replaceAcceptedTextRefusal } from './docx-editor-replace-accepted-text.ts';
import { replaceMatchTarget } from './docx-editor-replace-match.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/**
 * Why `can` refuses a `replaceMatch` or `replaceAcceptedText` that the command gate admitted,
 * from the same reads `exec` makes, or null. Other commands answer null.
 */
export function replaceCommandRefusal(
  command: EditorCommand,
  surface: PaginatedSurface,
  readParagraph: (blockId: string) => ParagraphText | null
): CanResult | null {
  if (command.type === 'replaceMatch') {
    const target = replaceMatchTarget(surface, command.match);
    return target.ok ? null : target;
  }
  if (command.type === 'replaceAcceptedText') {
    const paragraph = readParagraph(command.match.blockId);
    return replaceAcceptedTextRefusal(surface, paragraph, command);
  }
  return null;
}
