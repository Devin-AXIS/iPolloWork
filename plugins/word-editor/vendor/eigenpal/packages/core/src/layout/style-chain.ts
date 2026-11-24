// Style references and `basedOn` chains, shared by the paragraph, run and mark cascades.

import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { isValidStyleId, type StyleDefinition } from './style-definition-reader.ts';

/** Soft ceiling on `basedOn` chain length — enough for real templates, refuses hostile graphs. */
export const MAX_STYLE_BASED_ON_DEPTH = 32;

/** The style id a property list names in `w:pStyle` / `w:rStyle`; the last one wins. */
export function styleIdFromProps(
  directProps: readonly OoxmlProperty[],
  localName: 'pStyle' | 'rStyle'
): string | null {
  let id: string | null = null;
  for (const property of directProps) {
    if (property.localName !== localName) continue;
    const value = property.attributes?.val;
    id = isValidStyleId(value) ? value : null;
  }
  return id;
}

/**
 * Resolve the `basedOn` chain base-first, stopping on missing ids, cycles, or depth.
 *
 * The tip must match `expectedType`; other types named by `w:pStyle` / `w:rStyle` contribute
 * nothing (Word ignores them for that inheritance axis).
 */
export function styleChain(
  table: { readonly styles: ReadonlyMap<string, StyleDefinition> },
  styleId: string,
  expectedType: 'paragraph' | 'character' | 'table'
): readonly StyleDefinition[] {
  const tip = table.styles.get(styleId);
  if (!tip || tip.type !== expectedType) return [];

  const tipFirst: StyleDefinition[] = [];
  const seen = new Set<string>();
  let current: string | null = styleId;
  let depth = 0;
  while (current !== null && depth < MAX_STYLE_BASED_ON_DEPTH) {
    if (seen.has(current)) break;
    if (!isValidStyleId(current)) break;
    seen.add(current);
    const definition = table.styles.get(current);
    if (!definition) break;
    tipFirst.push(definition);
    current = definition.basedOn;
    depth += 1;
  }
  return tipFirst.reverse();
}

/**
 * The paragraph style chain a paragraph inherits. A `w:pStyle` that names no style, or names a
 * style of another type, applies the default paragraph style instead, as no `w:pStyle` does.
 */
export function paragraphStyleChain(
  table: {
    readonly styles: ReadonlyMap<string, StyleDefinition>;
    readonly defaultParagraphStyleId: string | null;
  },
  styleId: string | null
): readonly StyleDefinition[] {
  const authored = styleId ? styleChain(table, styleId, 'paragraph') : [];
  if (authored.length > 0 || !table.defaultParagraphStyleId) return authored;
  return styleChain(table, table.defaultParagraphStyleId, 'paragraph');
}

/**
 * The run properties a character style chain contributes. The document's default character
 * style (`w:default="1"`, normally "Default Paragraph Font") contributes nothing: not on a run
 * without `w:rStyle`, not when a run names it, and not as the base of another character style.
 * A style based on it still applies its own properties.
 */
export function characterStyleRunProperties(
  table: {
    readonly styles: ReadonlyMap<string, StyleDefinition>;
    readonly defaultCharacterStyleId?: string | null;
  },
  styleId: string
): readonly OoxmlProperty[] {
  return styleChain(table, styleId, 'character')
    .filter((style) => style.styleId !== table.defaultCharacterStyleId)
    .flatMap((style) => style.runProperties);
}
