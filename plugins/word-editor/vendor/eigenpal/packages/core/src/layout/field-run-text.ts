// Run-child model text and run-property collection, shared by the field walks.
//
// `piecesOfParagraph` and the `w:fldSimple` display collector both flatten runs and must
// agree, character for character, with `paragraphTextOf` about what a run child is worth —
// a disagreement is an offset bug. Keeping the vocabulary in one module keeps them agreeing
// by construction.

import {
  hardBreakText,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { runTextOutlineProperty } from './run-text-outline.ts';
import {
  hyphenDisplayText,
  hyphenTextOf,
  inlineCharacterTextOf,
  OPTIONAL_HYPHEN_TEXT,
} from '../store/package/hyphen-text.ts';
import { runLigaturesValue } from './run-ligatures.ts';

/** Optional per-run merge of inherited + direct `rPr` (character styles, defaults). */
export type RunPropertyCascader = (
  inherited: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[]
) => readonly OoxmlProperty[];

/** Model text contributed by one typed run child (same vocabulary as `paragraphTextOf`). */
export function modelTextOfRunChild(grand: OoxmlNode): string {
  // `w:delText` holds real characters at a real position, so it counts in the model offset
  // space exactly like `w:t`. Whether it is LAID OUT is a separate question, answered by the
  // enclosing revision and the display mode.
  if (grand.kind === 'text' || grand.kind === 'deletedText') {
    let text = '';
    for (const value of grand.children) if (value.kind === 'textValue') text += value.value;
    return text;
  }
  if (grand.kind === 'tab') return '\t';
  if (grand.kind === 'hardBreak') return hardBreakText(grand);
  return inlineCharacterTextOf(grand) ?? '';
}

/**
 * How a hyphen element paints: a non-breaking hyphen as U+2011, and an optional hyphen as
 * U+00AD, which measures nothing. Layout does not break a line at an optional hyphen. Null for
 * any other node.
 */
export function hyphenDisplayOf(
  node: OoxmlNode
): { readonly text: string; readonly measureText?: string } | null {
  const text = hyphenDisplayText(node);
  if (text === null) return null;
  return hyphenTextOf(node) === OPTIONAL_HYPHEN_TEXT ? { text, measureText: '' } : { text };
}

export function propertiesOfRunContainer(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    // `w14` children have namespace-checked readers of their own.
    if (child.localName === 'ligatures') {
      const value = runLigaturesValue(child);
      if (value !== undefined) props.push({ localName: 'ligatures', attributes: { val: value } });
      continue;
    }
    if (child.localName === 'textOutline') {
      const outline = runTextOutlineProperty(child);
      if (outline) props.push(outline);
      continue;
    }
    // Only `w:` qualified children and attributes set properties. Foreign extensions stay in
    // the canonical tree and are written back on save.
    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== 'rPrChange' && child.localName !== 'pPrChange') {
      props.push(sharedProperty(child.localName, child.attributes));
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const entry of child.attributes) {
      if (entry.namespaceUri === WML_NAMESPACE_URI) attributes[entry.localName] = entry.value;
    }
    const hasAttributes = Object.keys(attributes).length > 0;
    const revisionProperty: OoxmlProperty & { readonly revisionNodeId: string } = hasAttributes
      ? { localName: child.localName, attributes, revisionNodeId: child.id }
      : { localName: child.localName, revisionNodeId: child.id };
    props.push(revisionProperty);
  }
  return props;
}

/**
 * One frozen property per element name and attribute list. A part read shares equal
 * attribute lists, so the many equal property elements of a long document (`w:sz`, `w:b`,
 * `w:rFonts`) answer with one object instead of one each, which layout caches then kept.
 */
const sharedProperties = new WeakMap<readonly OoxmlAttributeLike[], Map<string, OoxmlProperty>>();

interface OoxmlAttributeLike {
  readonly localName: string;
  readonly namespaceUri?: string;
  readonly value: string;
}

function sharedProperty(localName: string, list: readonly OoxmlAttributeLike[]): OoxmlProperty {
  let byName = sharedProperties.get(list);
  if (!byName) sharedProperties.set(list, (byName = new Map()));
  const known = byName.get(localName);
  if (known) return known;
  const attributes: Record<string, string> = {};
  let hasAttributes = false;
  for (const entry of list) {
    if (entry.namespaceUri !== WML_NAMESPACE_URI) continue;
    attributes[entry.localName] = entry.value;
    hasAttributes = true;
  }
  const property: OoxmlProperty = Object.freeze(
    hasAttributes ? { localName, attributes: Object.freeze(attributes) } : { localName }
  );
  byName.set(localName, property);
  return property;
}

export function runPropertiesOf(
  run: OoxmlNode,
  inherited: readonly OoxmlProperty[],
  cascadeRuns?: RunPropertyCascader
): OoxmlProperty[] {
  const direct = propertiesOfRunContainer(
    run.kind === 'run' ? run.children.find((grand) => grand.kind === 'runProperties') : undefined
  );
  if (cascadeRuns) return [...cascadeRuns(inherited, direct)];
  return inherited.length === 0 ? direct : [...inherited, ...direct];
}
