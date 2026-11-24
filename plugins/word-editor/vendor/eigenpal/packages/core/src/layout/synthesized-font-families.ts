import { createFontFamilyTreeCache, fontScanChildren } from './font-family-tree-cache.ts';
// Font needs synthesized by layout, shared by editor and export resolution.
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
  WML_NAMESPACE_URI,
} from '../store/package/ooxml-shared.ts';
import { validFontFamily } from '../store/package/run-defaults.ts';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import { buildNumberingIndex } from './numbering-index.ts';
import { buildStyleCascadeTable } from './style-cascade.ts';
import { resolveStoryListItems } from './list-resolve.ts';
import { hostedTextboxContents, textboxStoryListItems } from './textbox-story-layout.ts';
import { parseSymbolInstruction } from './field-symbol.ts';
import {
  createFieldParseState,
  effectiveFieldInstruction,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  onInstrText,
  resetFieldParseState,
} from './field-instruction.ts';

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

const scanSymbolFields = createFontFamilyTreeCache((node, context: { key: string }) => {
  const families: string[] = [];
  if (node.namespaceUri === WML_NAMESPACE_URI) {
    if (node.localName === 'fldSimple') {
      const font = parseSymbolInstruction(attributeValue(node, 'instr') ?? '')?.font;
      if (font) families.push(font);
    }
    if (node.localName === 'p')
      for (const font of complexSymbolFieldFonts(node)) families.push(font);
  }
  return { families, children: fontScanChildren(node, context) };
});

/** Valid SYMBOL field faces over body, furniture, notes, tables, and text boxes. */
export function symbolFieldFontFamilies(roots: readonly OoxmlElement[]): readonly string[] {
  const families = new Map<string, string>();
  for (const candidate of scanSymbolFields(roots, { key: '' })) {
    const family = validFontFamily(candidate);
    if (family !== null && !families.has(family.toLowerCase()))
      families.set(family.toLowerCase(), family);
  }
  return [...families.values()];
}

export function complexSymbolFieldFonts(paragraph: OoxmlElement): readonly string[] {
  const families: string[] = [];
  const state = createFieldParseState();
  const stack: Array<{ node: OoxmlElement; containerDepth: number }> = [];
  for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
    const child = paragraph.children[index]!;
    if (child.kind !== 'textValue') stack.push({ node: child as OoxmlElement, containerDepth: 0 });
  }
  while (stack.length > 0) {
    const { node, containerDepth } = stack.pop()!;
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldChar') {
      const kind = attributeValue(node, 'fldCharType');
      if (kind === 'begin') onFldCharBegin(state);
      else if (kind === 'separate') {
        if (state.nesting === 1) noteEffectiveSymbolFont(state, families);
        onFldCharSeparate(state);
      } else if (kind === 'end') {
        if (state.nesting === 1) noteEffectiveSymbolFont(state, families);
        onFldCharEnd(state);
      }
      continue;
    }
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (node.localName === 'instrText' || node.localName === 'delInstrText')
    ) {
      onInstrText(state, boundedTextContent(node), node.localName === 'delInstrText');
      continue;
    }
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldSimple') {
      const spec = parseSymbolInstruction(attributeValue(node, 'instr') ?? '');
      if (spec?.font) families.push(spec.font);
    }
    const depth = nextInlineContainerDepth(node, containerDepth);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue')
        stack.push({ node: child as OoxmlElement, containerDepth: depth });
    }
  }
  resetFieldParseState(state);
  return families;
}

function noteEffectiveSymbolFont(
  state: ReturnType<typeof createFieldParseState>,
  families: string[]
): void {
  const effective = effectiveFieldInstruction(state);
  if (effective.overflow) return;
  const spec = parseSymbolInstruction(effective.instruction);
  if (spec?.font) families.push(spec.font);
}

function boundedTextContent(root: OoxmlElement): string {
  let text = '';
  const stack = [...root.children].reverse();
  while (stack.length > 0 && text.length <= 256) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') text += node.value;
    else {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  return text;
}

/**
 * A marker's AUTHORED face is what a resolver must be asked for, whether or not it turns
 * out to be available — asking is how availability becomes known. Resolving with this
 * oracle keeps `w:rFonts w:ascii="Symbol"` on the marker style instead of translating the
 * bullet to Unicode and dropping the face, which would make the one family a private-use
 * glyph needs the one family nobody ever requests.
 *
 * It answers the enumeration only. Layout resolves the same markers against what was really
 * admitted (`markerSymbolFontAvailability`), so a face the resolver could not supply still
 * falls back to the Unicode twin in both measurement and paint.
 */
const ASSUME_AVAILABLE = (): boolean => true;

/** East Asian blocks a list marker can draw in the East Asian face. */
const EAST_ASIAN_MARKER_TEXT = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-￯]/u;

export function usedNumberingFontFamilies(
  storyRoots: readonly OoxmlElement[],
  numberingRoot: OoxmlElement | null,
  stylesRoot: OoxmlElement | null,
  theme: {
    readonly major: string | null;
    readonly minor: string | null;
    readonly majorEastAsia: string | null;
    readonly minorEastAsia: string | null;
  }
): readonly string[] {
  if (!numberingRoot) return [];
  const numbering = buildNumberingIndex(numberingRoot);
  const styles = buildStyleCascadeTable(stylesRoot, theme);
  const byFold = new Map<string, string>();
  for (const root of storyRoots) {
    for (const container of storyFlowContainers(root)) {
      const blocks = collectFlowBlocks(container.children);
      const noteItems = (
        items:
          | ReadonlyMap<
              string,
              {
                readonly markerText?: string;
                readonly markerStyle: {
                  readonly fontFamily?: string | null;
                  readonly fontFamilyEastAsia?: string | null;
                };
              }
            >
          | undefined
      ): void => {
        if (!items) return;
        for (const item of items.values()) {
          // The East Asian face draws only East Asian marker text; every run carries a default
          // East Asian face, so asking for it on a Latin marker loads a face nothing uses.
          const eastAsianMarker =
            item.markerText === undefined || EAST_ASIAN_MARKER_TEXT.test(item.markerText);
          for (const candidate of [
            item.markerStyle.fontFamily,
            eastAsianMarker ? item.markerStyle.fontFamilyEastAsia : null,
          ]) {
            const family = validFontFamily(candidate ?? undefined);
            if (family === null) continue;
            const fold = family.toLowerCase();
            if (!byFold.has(fold)) byFold.set(fold, family);
          }
        }
      };
      noteItems(resolveStoryListItems(blocks, numbering, styles, ASSUME_AVAILABLE));
      for (const block of blocks) {
        const hosted = hostedTextboxContents(block);
        for (const content of hosted.contents) {
          noteItems(textboxStoryListItems(content, numbering, styles));
        }
      }
    }
  }
  return [...byFold.values()].sort((left, right) => left.localeCompare(right));
}

function storyFlowContainers(root: OoxmlElement): readonly OoxmlElement[] {
  if (root.localName === 'document') {
    for (const candidate of root.children) {
      if (candidate.kind !== 'textValue' && candidate.localName === 'body') {
        return [candidate as OoxmlElement];
      }
    }
    return [];
  }
  if (root.localName === 'footnotes' || root.localName === 'endnotes') {
    const notes: OoxmlElement[] = [];
    for (const candidate of root.children) {
      if (
        candidate.kind !== 'textValue' &&
        (candidate.localName === 'footnote' || candidate.localName === 'endnote')
      ) {
        notes.push(candidate as OoxmlElement);
      }
    }
    return notes;
  }
  return [root];
}
