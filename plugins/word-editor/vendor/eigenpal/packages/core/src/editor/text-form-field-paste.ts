import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import {
  findNode,
  formsProtectionEnabled,
  paragraphTextOf,
  sectionProtectsForms,
  textFormFieldsOf,
} from '@docx-editor.dev/core/store';
import {
  supportsTextFormField,
  textFormInputLength,
} from '../store/store/text-form-field-options.ts';
import { partOfNodeId } from './surface-scope.ts';

/** A protected paste fills only the remaining field capacity, as typed input does. */
export function clampTextFormPaste(
  session: TreeDocxSessionView,
  from: SemanticPosition,
  to: SemanticPosition,
  text: string,
  fieldNodeId: string | null
): string {
  if (!fieldNodeId) return text;
  if (from.paragraphId !== to.paragraphId || /[\r\n\t]/.test(text)) return text;
  if (!formsProtectionEnabled(session.settingsRoot())) return text;
  const part = partOfNodeId(session, from.paragraphId) ?? session.part();
  if (!sectionProtectsForms(part, from.paragraphId)) return text;
  const paragraph = findNode(part, from.paragraphId);
  if (paragraph?.kind !== 'paragraph') return text;
  const field = textFormFieldsOf(paragraph).find(
    (candidate) =>
      candidate.fieldNodeId === fieldNodeId &&
      candidate.start <= from.offset &&
      candidate.end >= to.offset
  );
  if (!field?.enabled || !supportsTextFormField(field) || field.maxLength <= 0) return text;
  const value = (paragraphTextOf(part, from.paragraphId) ?? '').slice(field.start, field.end);
  const before = value.slice(0, from.offset - field.start);
  const after = value.slice(to.offset - field.start);
  const retained = before + after;
  const fits = (inserted: string): boolean =>
    textFormInputLength(before + inserted + after, field, retained) <= field.maxLength;
  if (fits(text)) return text;
  const characters = [...text];
  let capacity = field.maxLength - [...retained].length;
  if (field.type === 'number' && field.format) {
    for (const character of retained) {
      if (
        (character === ',' && field.format.includes(',')) ||
        (character === '%' && field.format.endsWith('%'))
      )
        capacity++;
    }
  }
  // Formatting can make a longer prefix fit after a shorter prefix fails.
  // Numeric padding removes at most a decimal point and two zeros.
  const candidates = new Set<number>();
  if (field.type === 'date') {
    // A supported date has at most 18 non-whitespace characters. Include the
    // ends of whitespace runs because the date parser trims surrounding space.
    let visible = 0;
    for (let index = 0; index < characters.length; index++) {
      if (/\S/.test(characters[index]!)) {
        if (++visible > 18) break;
        candidates.add(index + 1);
      } else if (index + 1 === characters.length || /\S/.test(characters[index + 1]!)) {
        candidates.add(index + 1);
      }
    }
  } else if (field.type === 'number' && field.format) {
    for (let extra = 1; extra <= 3; extra++) candidates.add(capacity + extra);
  }
  for (const length of [...candidates].sort((a, b) => b - a)) {
    if (length <= Math.max(0, capacity) || length > characters.length) continue;
    const prefix = characters.slice(0, length).join('');
    if (fits(prefix)) return prefix;
  }
  return characters.slice(0, Math.max(0, capacity)).join('');
}
