import {
  isInlineRunContainer,
  isRangeMarkerKind,
  WML_NAMESPACE_URI,
} from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { mintCheckboxRun } from './content-control-run.ts';
import { isRunPropertiesNode, parentOf, runPropertiesNodeOf } from './tree-op-nodes.ts';

/** The symbol a checkbox state writes, plus every glyph the control's two states declare. */
export interface CheckboxSymbol {
  readonly hex: string;
  readonly font: string;
  /** Hex code points of both states, so the display run is found by what it shows. */
  readonly states: readonly string[];
}

/** Both state glyphs a checkbox declares, with Word's defaults for the ones it leaves out. */
export function checkboxStateHexes(checkbox: {
  readonly checkedState?: { readonly value?: string };
  readonly uncheckedState?: { readonly value?: string };
}): readonly string[] {
  return [checkbox.checkedState?.value ?? '2612', checkbox.uncheckedState?.value ?? '2610'];
}

/**
 * The character a `w14:checkedState`/`w14:uncheckedState` code names, or null when the file's
 * value is not a code point. Bounded before `fromCodePoint`, which throws past the Unicode range.
 */
export function decodeCheckboxGlyph(hex: string | undefined): string | null {
  const normalized = normalizedHex(hex);
  return normalized === null ? null : glyphOf(normalized);
}

/**
 * Whether a control sits in run content. Its parent may be a paragraph, a hyperlink, a tracked
 * insertion or an enclosing inline control's content; the paragraph above decides, not the
 * immediate parent. A control with no paragraph above it is block-level.
 */
export function isInlineControl(part: OoxmlPart, controlId: string): boolean {
  let node = parentOf(part, controlId);
  for (let depth = 0; node && depth < 64; depth++) {
    if (node.kind === 'paragraph' || isWml(node, 'p')) return true;
    if (BLOCK_KINDS.has(node.kind)) return false;
    node = parentOf(part, node.id);
  }
  return false;
}

const BLOCK_KINDS: ReadonlySet<OoxmlNode['kind']> = new Set([
  'paragraph',
  'table',
  'tableRow',
  'tableCell',
]);

/**
 * Zero-length closers a new run must precede, or the range covering the paragraph loses it.
 * By local name: `w:permEnd` and the customXml range ends parse as generic. Mirrors the
 * range-end set the text applier pairs by `w:id`.
 */
const RANGE_END_NAMES: ReadonlySet<string> = new Set([
  'bookmarkEnd',
  'commentRangeEnd',
  'moveFromRangeEnd',
  'moveToRangeEnd',
  'permEnd',
  'customXmlInsRangeEnd',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeEnd',
]);

/** Zero-length openers and other inert siblings that never carry the checkbox's display. */
const INERT_INLINE_NAMES: ReadonlySet<string> = new Set([
  'bookmarkStart',
  'commentRangeStart',
  'moveFromRangeStart',
  'moveToRangeStart',
  'permStart',
  'customXmlInsRangeStart',
  'customXmlDelRangeStart',
  'customXmlMoveFromRangeStart',
  'customXmlMoveToRangeStart',
  'proofErr',
]);

/** Paragraph-mark run properties that describe a revision, not formatting a new run inherits. */
const MARK_REVISION_NAMES: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
]);

export function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

export function isWhitespaceText(node: OoxmlNode): boolean {
  return node.kind === 'textValue' && node.value.trim().length === 0;
}

export function isRangeEnd(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && RANGE_END_NAMES.has(node.localName);
}

/** Content that can sit beside a display run without being one: history and zero-length marks. */
export function isInertInline(node: OoxmlNode): boolean {
  if (isWhitespaceText(node)) return true;
  if (node.kind === 'textValue') return false;
  if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return true;
  if (isRangeMarkerKind(node.kind) || node.kind === 'bookmarkStart') return true;
  return (
    node.namespaceUri === WML_NAMESPACE_URI &&
    (RANGE_END_NAMES.has(node.localName) || INERT_INLINE_NAMES.has(node.localName))
  );
}

export function paragraphOf(nextId: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

export function cloneWithFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneWithFreshIds(child, nextId)),
  } as OoxmlNode;
}

/** The paragraph mark's `w:rPr`, minus revision records, as the formatting a new run inherits. */
export function paragraphMarkProperties(
  paragraph: OoxmlElement,
  nextId: () => string
): OoxmlNode | undefined {
  const pPr = paragraph.children.find((child) => isWml(child, 'pPr'));
  if (!pPr || pPr.kind === 'textValue') return undefined;
  const rPr = pPr.children.find((child) => isWml(child, 'rPr'));
  if (!rPr || rPr.kind === 'textValue') return undefined;
  const formatting = rPr.children.filter(
    (child) => child.kind !== 'textValue' && !MARK_REVISION_NAMES.has(child.localName)
  );
  if (formatting.length === 0) return undefined;
  return cloneWithFreshIds({ ...rPr, children: formatting } as OoxmlNode, nextId);
}

/**
 * The run properties a rewritten display run keeps. Word's prompt run is styled
 * `PlaceholderText`; the same write clears `w:showingPlcHdr`, so that style must not follow
 * the value onto the glyph.
 */
export function withoutPlaceholderStyle(properties: OoxmlNode | undefined): OoxmlNode | undefined {
  if (!properties || properties.kind === 'textValue') return properties;
  const children = properties.children.filter(
    (child) =>
      !(
        isWml(child, 'rStyle') &&
        child.kind !== 'textValue' &&
        child.attributes.some((a) => a.localName === 'val' && a.value === 'PlaceholderText')
      )
  );
  if (children.length === properties.children.length) return properties;
  return children.length === 0 ? undefined : ({ ...properties, children } as OoxmlNode);
}

/**
 * Whether {@link checkboxContent} can write this content. The validator asks so `can()` and
 * `exec()` agree; the probe's ids are discarded with its result.
 */
export function checkboxContentWritable(
  content: OoxmlElement | undefined,
  inline: boolean
): boolean {
  const probe = { hex: '2612', font: 'MS Gothic', states: ['2612', '2610'] };
  return checkboxContent(content, probe, '☒', () => 'probe', inline) !== null;
}

function normalizedHex(value: string | undefined): string | null {
  if (value === undefined || !/^[0-9A-Fa-f]{1,6}$/.test(value)) return null;
  return value.toUpperCase().padStart(4, '0');
}

function glyphOf(hex: string): string | null {
  const code = Number.parseInt(hex, 16);
  if (!Number.isInteger(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return null;
  }
  return String.fromCodePoint(code);
}

/** A run's content children: properties and Word's rendered page-break hint are not content. */
export function runContentOf(run: OoxmlElement): readonly OoxmlNode[] {
  return run.children.filter(
    (child) =>
      !isWhitespaceText(child) &&
      !(child.kind !== 'textValue' && isRunPropertiesNode(child)) &&
      !isWml(child, 'lastRenderedPageBreak')
  );
}

/** Whether a run shows one of the control's declared state glyphs and nothing else. */
function displaysState(run: OoxmlElement, hexes: ReadonlySet<string>, glyphs: ReadonlySet<string>) {
  const content = runContentOf(run);
  if (content.length !== 1) return false;
  const only = content[0]!;
  if (only.kind === 'textValue') return false;
  if (isWml(only, 'sym')) {
    const char = normalizedHex(only.attributes.find((a) => a.localName === 'char')?.value);
    return char !== null && hexes.has(char);
  }
  if (only.kind === 'text') {
    const value = only.children
      .map((child) => (child.kind === 'textValue' ? child.value : ''))
      .join('');
    return glyphs.has(value);
  }
  return false;
}

/**
 * Whether a run holds only characters, so replacing its content with a glyph loses no field
 * boundary, drawing, break or note reference. A run with no content at all counts.
 */
export function isTextRun(run: OoxmlElement): boolean {
  return runContentOf(run).every((child) => child.kind === 'text' || isWml(child, 'sym'));
}

/**
 * Update a checkbox's display run without replacing its structural content. A cell-level
 * SDT owns w:tc, including its width and borders; flattening that to a run deletes a cell
 * from the table. Row/block controls likewise keep their containers and sibling content.
 *
 * The display run is the one showing a declared state glyph; only when no run does is the
 * first live text run taken. Deleted and moved-from runs are history, never the display. With
 * no live run, a paragraph gets one before its closing markers, and inline content made only
 * of history and markers gets one at its end. Anything else without a run is refused: an
 * unrecognised shape must not be flattened, because that is the data-loss bug.
 *
 * `inline` says where the control sits: a block-level control with no content yet gets its
 * run inside a new paragraph, because w:sdtContent at block level cannot hold a bare w:r.
 */
export function checkboxContent(
  content: OoxmlElement | undefined,
  symbol: CheckboxSymbol,
  text: string,
  nextId: () => string,
  inline: boolean
): readonly OoxmlNode[] | null {
  // Word's defaults stand in for a state that names no font. The fallback text for a code
  // point too wide for `w:sym` is the decoded glyph, never the hex digits the state declares.
  const font = symbol.font || 'MS Gothic';
  const fallback = decodeCheckboxGlyph(symbol.hex) ?? text;
  const mint = (properties?: OoxmlNode): OoxmlNode =>
    mintCheckboxRun(nextId, symbol.hex, font, withoutPlaceholderStyle(properties), fallback);
  if (!content || content.children.every(isWhitespaceText)) {
    return inline ? [mint()] : [paragraphOf(nextId, [mint()])];
  }

  const hexes = new Set<string>();
  const glyphs = new Set<string>();
  for (const state of [symbol.hex, ...symbol.states]) {
    const hex = normalizedHex(state);
    if (hex === null) continue;
    hexes.add(hex);
    const glyph = glyphOf(hex);
    if (glyph !== null) glyphs.add(glyph);
  }
  const isDisplayRun = (run: OoxmlElement): boolean => displaysState(run, hexes, glyphs);

  // Follow content containers only: never mistake a historical run in rPrChange for this
  // checkbox's display. A nested control or simple field is content the checkbox shows, so
  // its runs count; its own properties are not containers and fall out of the walk. Bound
  // recursion on imported XML.
  const isContent = (node: OoxmlElement): boolean =>
    node.kind === 'contentControlContent' || isWml(node, 'sdtContent');
  const isParagraph = (node: OoxmlElement): boolean =>
    node.kind === 'paragraph' || isWml(node, 'p');
  const isContainer = (node: OoxmlElement): boolean =>
    isContent(node) ||
    isParagraph(node) ||
    node.kind === 'contentControl' ||
    BLOCK_KINDS.has(node.kind) ||
    isInlineRunContainer(node) ||
    isWml(node, 'customXml') ||
    isWml(node, 'fldSimple');

  const rewrite = (
    node: OoxmlNode,
    depth: number,
    accept: (run: OoxmlElement) => boolean
  ): OoxmlNode | null => {
    if (node.kind === 'textValue' || depth > 32) return null;
    if (node.kind === 'run') {
      if (!accept(node)) return null;
      const run = mint(runPropertiesNodeOf(node));
      if (run.kind === 'textValue') return null;
      return { ...node, children: run.children } as OoxmlNode;
    }
    if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return null;
    if (!isContainer(node)) return null;
    for (let i = 0; i < node.children.length; i++) {
      const child = rewrite(node.children[i]!, depth + 1, accept);
      if (child) {
        const children = [...node.children];
        children[i] = child;
        return { ...node, children } as OoxmlNode;
      }
    }
    return null;
  };

  const withRunBeforeClosers = (node: OoxmlElement, properties?: OoxmlNode): OoxmlNode => {
    let at = node.children.length;
    while (at > 0 && isRangeEnd(node.children[at - 1]!)) at--;
    const children: OoxmlNode[] = [...node.children];
    children.splice(at, 0, mint(properties));
    return { ...node, children } as OoxmlNode;
  };

  // No live run anywhere: the first paragraph gets one, placed before its closing markers so
  // a bookmark, comment or permission range that covered the empty paragraph covers the glyph.
  const appendRun = (node: OoxmlNode, depth: number): OoxmlNode | null => {
    if (node.kind === 'textValue' || depth > 32) return null;
    if (isParagraph(node)) return withRunBeforeClosers(node, paragraphMarkProperties(node, nextId));
    if (!isContainer(node) || isInlineRunContainer(node)) return null;
    for (let i = 0; i < node.children.length; i++) {
      const child = appendRun(node.children[i]!, depth + 1);
      if (child) {
        const children = [...node.children];
        children[i] = child;
        return { ...node, children } as OoxmlNode;
      }
    }
    // Inline content whose every child is history or a marker gets its run at the end.
    if (inline && isContent(node) && node.children.every(isInertInline)) {
      return withRunBeforeClosers(node);
    }
    return null;
  };

  const updated =
    rewrite(content, 0, isDisplayRun) ?? rewrite(content, 0, isTextRun) ?? appendRun(content, 0);
  return updated && updated.kind !== 'textValue' ? updated.children : null;
}
