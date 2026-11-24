// Local character-style field recognition. Unknown switches keep their cached result.
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import {
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_STORY_FIELD_SCAN_DEPTH,
  MAX_STORY_FIELD_SCAN_NODES,
} from './field-instruction.ts';
import type { FieldPageContext } from './field-page-furniture.ts';

export interface CharacterStyleField {
  readonly name: string;
  readonly last: boolean;
  readonly key: string;
}

export function parseCharacterStyleField(raw: string): CharacterStyleField | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const match =
    /^\s*STYLEREF\s+(?:"([^"\\]+)"|([^\s"\\]+))((?:\s+\\l)?(?:\s+\\\*\s+MERGEFORMAT)?)\s*$/i.exec(
      raw
    );
  if (!match) return null;
  const name = (match[1] ?? match[2]!).trim().toLowerCase();
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  const last = /\\l\b/i.test(match[3]!);
  return { name, last, key: `${last ? 'last' : 'first'}:${name}` };
}

export function characterStyleFieldValue(
  field: CharacterStyleField | null | undefined,
  context: FieldPageContext | undefined
): string | undefined {
  return field ? context?.characterStyleValues?.get(field.key) : undefined;
}

/** A bounded detector; the normal field parser still decides which fields can project. */
export function characterStyleFields(root: OoxmlNode): readonly CharacterStyleField[] {
  const found = new Map<string, CharacterStyleField>();
  let count = 0;
  let instruction = '';
  const add = (raw: string) => {
    const field = parseCharacterStyleField(raw);
    if (field && found.size < 128) found.set(field.key, field);
  };
  const visit = (node: OoxmlNode, depth: number): void => {
    if (++count > MAX_STORY_FIELD_SCAN_NODES || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'textValue') return;
    if (node.localName === 'fldSimple') {
      add(node.attributes.find((a) => a.localName === 'instr')?.value ?? '');
    }
    if (node.localName === 'fldChar') {
      const kind = node.attributes.find((a) => a.localName === 'fldCharType')?.value;
      if (kind === 'begin') instruction = '';
      else if (kind === 'separate' || kind === 'end') {
        add(instruction);
        instruction = '';
      }
    }
    if (node.localName === 'instrText') {
      for (const child of node.children) {
        if (child.kind === 'textValue' && instruction.length <= MAX_FIELD_INSTRUCTION_CHARS) {
          instruction =
            instruction.length + child.value.length <= MAX_FIELD_INSTRUCTION_CHARS
              ? instruction + child.value
              : 'x'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 1);
        }
      }
    }
    for (const child of node.children) {
      if (count >= MAX_STORY_FIELD_SCAN_NODES) break;
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return [...found.values()];
}

/** Nested result fields keep their existing projection semantics. */
export function hasNestedCharacterResult(node: OoxmlNode): boolean {
  let count = 0;
  const visit = (entry: OoxmlNode, depth: number): boolean => {
    if (++count > MAX_STORY_FIELD_SCAN_NODES || depth > MAX_STORY_FIELD_SCAN_DEPTH) return true;
    if (entry.kind === 'textValue') return false;
    if (depth > 0 && (entry.localName === 'fldSimple' || entry.localName === 'fldChar'))
      return true;
    for (const child of entry.children) if (visit(child, depth + 1)) return true;
    return false;
  };
  return visit(node, 0);
}
