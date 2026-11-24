// Which formatting commands are APPLIED at the selection — Word's agreement rule.
//
// Pulled out of the facade's `isActive` so the composition root spends its lines on
// composition. The rule is the same one `toggleRunProperty` toggles against: a mark is
// pressed when the whole selection agrees on it, and a mixed selection is not "on".

import type { EditorCommand } from '../contracts/editor.ts';
import type { RunFormatting } from '../contracts/types.ts';

/**
 * Whether a formatting command is currently applied, from the snapshot's `formatting`.
 *
 * `isListActive` answers for the list toggles, because whether the WHOLE selection is one
 * list is a question about the paragraphs, not about the run formatting the snapshot holds.
 */
export function formattingCommandActive(
  command: EditorCommand,
  formatting: RunFormatting | null,
  isListActive: (kind: 'bullet' | 'ordered') => boolean
): boolean {
  if (!formatting) return false;
  switch (command.type) {
    case 'toggleMark':
      switch (command.mark) {
        case 'bold':
          return formatting.bold === true;
        case 'italic':
          return formatting.italic === true;
        case 'underline':
          return formatting.underline === true;
        case 'strike':
          return formatting.strike === true;
        // One property, two of its values: each is pressed only for its OWN value, so
        // superscripted text shows Subscript un-pressed rather than both lit.
        case 'superscript':
          return formatting.superscript === true;
        case 'subscript':
          return formatting.subscript === true;
        default:
          return false;
      }
    case 'setParagraphDirection':
      return formatting.direction === command.direction;
    case 'setAlignment':
      // `exec` writes `justify` as `both`; compare in the same vocabulary.
      return formatting.alignment === (command.align === 'justify' ? 'both' : command.align);
    case 'toggleList':
      // Pressed only when the WHOLE selection is that list, matching the toggle's own
      // rule: a mixed selection is not "on".
      return isListActive(command.kind);
    default:
      return false;
  }
}
