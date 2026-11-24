// Document-derived catalogs: the fonts a document uses and the styles it defines.
//
// Both derivations read the CANONICAL TREES — the current main part, the immutable
// styles part, and the resolved header/footer parts — never the DOM or the layout.
// They exist for chrome (font picker, style picker), so every string that leaves this
// module is validated here at the derivation boundary: a font name or style name is
// authored file content, and downstream sinks (CSS font-family, dropdown labels) must
// only ever receive names this module has already bounded.

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { runIsDirectlyHidden } from '../store/package/run-hidden.ts';
import { themeFontFamilyOf, type ThemeSchemeFaces } from '../store/package/theme-font-scheme.ts';
import { symbolFontFamily } from '../store/package/run-defaults.ts';
import { symbolGlyphOf } from '../store/package/symbol-glyph.ts';
import { weakRefOf, type WeakRefOf } from '../store/package/weak-ref.ts';

/**
 * The same shape `semantic-paint.ts` enforces at the CSS sink (its `FONT_NAME`):
 * Unicode letters/digits/marks plus the join punctuation real family names use,
 * bounded to 64 characters. Controls, quotes, backslashes, and empty names fail.
 * Commas and semicolons belong to one name, never a list of fallback faces.
 * Kept in sync by value rather than import because the
 * paint module is a different lane (output) and deliberately re-validates at its own
 * sink either way.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

/** `w:rFonts` attributes that name a font family (theme* attributes name theme SLOTS). */
const RFONTS_FAMILY_ATTRS = ['ascii', 'hAnsi', 'cs', 'eastAsia'] as const;

/** `w:rFonts` attributes that reference a theme font slot rather than naming a family. */
const RFONTS_THEME_ATTRS = ['asciiTheme', 'hAnsiTheme', 'cstheme', 'eastAsiaTheme'] as const;

/** Identifier-ish strings from a file (style ids, style names): bounded, no controls. */
const STYLE_STRING_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * Every valid family name any `w:rFonts` in `roots` mentions, deduplicated
 * case-insensitively (first-seen casing wins, so `Arial` and `arial` collapse to one
 * entry spelled the way the document first spelled it) and sorted by code point for a
 * deterministic picker order. Invalid names — over 64 characters, control characters,
 * CSS-breaking punctuation — are dropped, never repaired.
 */
export function collectDocumentFonts(
  roots: readonly OoxmlElement[],
  themeFonts?: ThemeSchemeFaces
): readonly string[] {
  const byFold = new Map<string, string>();
  // Composed from per-subtree memos: every keystroke publishes a new root whose children
  // are all shared but one, and re-walking the whole document per commit made the font
  // picker's derivation a per-keystroke cost on long documents. The memo is keyed on the
  // immutable subtree node plus the theme pair, because the theme decides what a theme
  // slot reference contributes.
  for (const root of roots) {
    // The root ELEMENT itself is walked directly (a root is never an `rFonts`); its
    // children carry the memo.
    for (const child of root.children) {
      if (!isElement(child)) continue;
      for (const [fold, family] of subtreeFontsOf(child, themeFonts)) {
        if (!byFold.has(fold)) byFold.set(fold, family);
      }
    }
  }
  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // The same list as last time is the same array, so a picker that compares by identity does
  // not render again after a keystroke that named no new font.
  if (lastFonts.length === fonts.length && lastFonts.every((family, i) => family === fonts[i]))
    return lastFonts;
  lastFonts = fonts;
  return fonts;
}
let lastFonts: readonly string[] = [];

interface SubtreeFontsMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly majorEastAsia: string | null;
  readonly minorEastAsia: string | null;
  readonly majorBidi: string | null;
  readonly minorBidi: string | null;
  readonly byFold: ReadonlyMap<string, string>;
}
const subtreeFontsMemos = new WeakMap<OoxmlElement, SubtreeFontsMemo>();

/**
 * Containers at least this wide compose from their children's memos instead of walking:
 * `w:body` (thousands of blocks) must not be one memo entry, or the first edit under it
 * re-walks the whole story anyway.
 */
const COMPOSE_CHILD_THRESHOLD = 16;
/** Compose recursion stops here; deeper subtrees take the iterative terminal walk. */
const MAX_COMPOSE_DEPTH = 32;

/** One wide container's composition, kept for its next revision; see {@link composedFonts}. */
interface FontComposition {
  /** Weakly: a kept composition must not keep a closed document's tree alive. */
  readonly children: WeakRefOf<readonly OoxmlNode[]>;
  readonly parts: readonly (ReadonlyMap<string, string> | null)[];
  readonly byFold: ReadonlyMap<string, string>;
  readonly themeFonts: ThemeSchemeFaces | undefined;
}
/** The last composition per container id: an edit makes a new container that keeps its id. */
const fontCompositions = new Map<string, FontComposition>();
const MAX_FONT_COMPOSITIONS = 64;

/** Theme faces by value: the theme decides what a slot reference contributes. */
function sameThemeFaces(a: ThemeSchemeFaces | undefined, b: ThemeSchemeFaces | undefined): boolean {
  return (
    a?.major === b?.major &&
    a?.minor === b?.minor &&
    a?.majorEastAsia === b?.majorEastAsia &&
    a?.minorEastAsia === b?.minorEastAsia &&
    a?.majorBidi === b?.majorBidi &&
    a?.minorBidi === b?.minorBidi
  );
}

function sameFonts(
  a: ReadonlyMap<string, string> | null,
  b: ReadonlyMap<string, string> | null
): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [fold, family] of a) if (b.get(fold) !== family) return false;
  return true;
}

/**
 * A wide container's fonts from its children's, in order. An edit rebuilds the path to what
 * it changed, so a body of thousands of blocks is new after every keystroke while all but one
 * of its children are the objects it had. Those keep their fonts without a memo lookup, and
 * when the changed ones name the fonts they replace, the previous composition stands.
 */
function composedFonts(
  subtree: OoxmlElement,
  themeFonts: ThemeSchemeFaces | undefined,
  depth: number
): ReadonlyMap<string, string> {
  const children = subtree.children;
  const previous = fontCompositions.get(subtree.id);
  const previousChildren = previous?.children.deref();
  const reusable =
    previous !== undefined &&
    previousChildren !== undefined &&
    previousChildren.length === children.length &&
    sameThemeFaces(previous.themeFonts, themeFonts);
  let unchanged = reusable;
  const parts = children.map((child, index) => {
    if (reusable && child === previousChildren[index]) return previous.parts[index]!;
    const part = isElement(child) ? subtreeFontsOf(child, themeFonts, depth + 1) : null;
    if (unchanged && !sameFonts(part, previous!.parts[index]!)) unchanged = false;
    return part;
  });
  let byFold: ReadonlyMap<string, string>;
  if (unchanged) byFold = previous!.byFold;
  else {
    const merged = new Map<string, string>();
    for (const part of parts)
      if (part) for (const [fold, family] of part) if (!merged.has(fold)) merged.set(fold, family);
    byFold = merged;
  }
  fontCompositions.delete(subtree.id);
  fontCompositions.set(subtree.id, { children: weakRefOf(children), parts, byFold, themeFonts });
  if (fontCompositions.size > MAX_FONT_COMPOSITIONS)
    fontCompositions.delete(fontCompositions.keys().next().value!);
  return byFold;
}

function subtreeFontsOf(
  subtree: OoxmlElement,
  themeFonts: ThemeSchemeFaces | undefined,
  depth = 0
): ReadonlyMap<string, string> {
  const major = themeFonts?.major ?? null;
  const minor = themeFonts?.minor ?? null;
  // The East Asian faces are part of the memo key for the same reason the Latin pair is:
  // the theme decides what a theme slot reference contributes, so a memo keyed on fewer
  // faces than the resolution reads would answer stale fonts after a retheme.
  const majorEastAsia = themeFonts?.majorEastAsia ?? null;
  const minorEastAsia = themeFonts?.minorEastAsia ?? null;
  const majorBidi = themeFonts?.majorBidi ?? null;
  const minorBidi = themeFonts?.minorBidi ?? null;
  const cached = subtreeFontsMemos.get(subtree);
  if (
    cached &&
    cached.major === major &&
    cached.minor === minor &&
    cached.majorEastAsia === majorEastAsia &&
    cached.minorEastAsia === minorEastAsia &&
    cached.majorBidi === majorBidi &&
    cached.minorBidi === minorBidi
  ) {
    return cached.byFold;
  }
  if (
    subtree.children.length >= COMPOSE_CHILD_THRESHOLD &&
    depth < MAX_COMPOSE_DEPTH &&
    subtree.localName !== 'rFonts'
  ) {
    const merged = composedFonts(subtree, themeFonts, depth);
    subtreeFontsMemos.set(subtree, {
      major,
      minor,
      majorEastAsia,
      minorEastAsia,
      majorBidi,
      minorBidi,
      byFold: merged,
    });
    return merged;
  }
  const byFold = new Map<string, string>();
  const add = (family: string | null | undefined): void => {
    if (!family || !FONT_NAME.test(family)) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };
  // Iterative walk: the parse already bounds tree depth, but this derivation must not
  // be the one place a deep generic subtree can overflow the call stack. Children are
  // pushed in reverse so the stack pops them in DOCUMENT order — "first-seen casing"
  // has to mean the first occurrence a reader would see, not the last.
  const stack: OoxmlNode[] = [subtree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === 'rFonts') {
      for (const attr of RFONTS_FAMILY_ATTRS) {
        add(attributeValue(node, attr));
      }
      // A theme reference (`w:asciiTheme="minorHAnsi"`) names no family itself, but the
      // document still USES the theme's face — a template styled entirely through the
      // theme otherwise reported "no fonts" while every run rendered in one.
      if (themeFonts) {
        for (const attr of RFONTS_THEME_ATTRS) {
          add(themeFontFamilyOf(attributeValue(node, attr), themeFonts));
        }
      }
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  subtreeFontsMemos.set(subtree, {
    major,
    minor,
    majorEastAsia,
    minorEastAsia,
    majorBidi,
    minorBidi,
    byFold,
  });
  return byFold;
}

/**
 * Every valid family a `w:sym/@w:font` names, deduplicated and sorted like
 * {@link collectDocumentFonts}, and validated at the same boundary for the same reason.
 *
 * Kept apart from the font catalog because the two answer different questions.
 * `collectDocumentFonts` answers what the document DECLARES — `w:rFonts` — and a `w:sym`
 * face is not a declaration; it is the face ONE glyph is drawn from. A font resolver still
 * has to hear about it: `layout/symbol-run.ts` keeps an unmapped private-use code point in
 * the authored face, which paints as a tofu box in any other, and an app that owns those
 * bytes can only supply them if it is told the document wants them.
 */
export function collectSymbolFontFamilies(roots: readonly OoxmlElement[]): readonly string[] {
  const byFold = new Map<string, string>();
  for (const root of roots) {
    // The root element is never a `w:sym`; its children carry the memo, exactly as in
    // `collectDocumentFonts`.
    for (const child of root.children) {
      if (!isElement(child)) continue;
      for (const [fold, family] of subtreeSymbolFontsOf(child).all) {
        if (!byFold.has(fold)) byFold.set(fold, family);
      }
    }
  }
  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return fonts;
}

/**
 * The `w:sym` faces whose glyph has no Unicode equivalent, in reading order and deduplicated
 * case-insensitively. Such a glyph means something only in its own face, so without the face
 * the reader sees a missing-glyph box. Shares the subtree memo of
 * {@link collectSymbolFontFamilies}.
 */
export function collectUnmappedSymbolFaces(roots: readonly OoxmlElement[]): readonly string[] {
  const byFold = new Map<string, string>();
  for (const root of roots) {
    for (const child of root.children) {
      if (!isElement(child)) continue;
      for (const [fold, family] of subtreeSymbolFontsOf(child).unmapped) {
        if (!byFold.has(fold)) byFold.set(fold, family);
      }
    }
  }
  return [...byFold.values()];
}

/**
 * Per-subtree memo, for the reason {@link collectDocumentFonts} has one: this is a public
 * session answer, and a derivation that re-walks every story per revision becomes a
 * per-keystroke cost the moment any chrome reads it in a selector. No theme in the key —
 * `w:sym/@w:font` is a literal family name, never a theme slot.
 */
const subtreeSymbolFontsMemos = new WeakMap<OoxmlElement, SubtreeSymbolFaces>();

/** A subtree's symbol faces: every one, and those an unmapped glyph needs. Both by fold. */
interface SubtreeSymbolFaces {
  readonly all: ReadonlyMap<string, string>;
  readonly unmapped: ReadonlyMap<string, string>;
}

/**
 * Shared by every subtree that names no symbol face, which in a real document is nearly all
 * of them: a per-block empty `Map` retained for the life of the tree is pure overhead.
 */
const NO_FACES: ReadonlyMap<string, string> = new Map();
const NO_SYMBOL_FONTS: SubtreeSymbolFaces = { all: NO_FACES, unmapped: NO_FACES };

function subtreeSymbolFontsOf(subtree: OoxmlElement, depth = 0): SubtreeSymbolFaces {
  const cached = subtreeSymbolFontsMemos.get(subtree);
  if (cached) return cached;
  const byFold = new Map<string, string>();
  const unmapped = new Map<string, string>();
  const remember = (): SubtreeSymbolFaces => {
    const answer: SubtreeSymbolFaces =
      byFold.size === 0
        ? NO_SYMBOL_FONTS
        : { all: byFold, unmapped: unmapped.size === 0 ? NO_FACES : unmapped };
    subtreeSymbolFontsMemos.set(subtree, answer);
    return answer;
  };
  // The compose branch never inspects the node itself, so a `w:sym` wide enough to take it
  // would lose its own face — the same self-check `subtreeFontsOf` makes for `w:rFonts`.
  // `w:sym` is a generic node, so a hand-built package can give it children. A run never
  // composes either: its children's memos cannot know that the run hides them.
  if (
    subtree.children.length >= COMPOSE_CHILD_THRESHOLD &&
    depth < MAX_COMPOSE_DEPTH &&
    subtree.localName !== 'sym' &&
    subtree.localName !== 'r'
  ) {
    for (const child of subtree.children) {
      if (!isElement(child)) continue;
      const faces = subtreeSymbolFontsOf(child, depth + 1);
      for (const [fold, family] of faces.all) if (!byFold.has(fold)) byFold.set(fold, family);
      for (const [fold, family] of faces.unmapped)
        if (!unmapped.has(fold)) unmapped.set(fold, family);
    }
    return remember();
  }
  // Iterative and depth-safe like its sibling, and children push in reverse for the same
  // reason: first-seen casing has to mean the first occurrence a reader would see. A node
  // inside a run with direct `w:vanish` is hidden: layout neither measures nor paints it.
  const stack: OoxmlNode[] = [subtree];
  const hidden = new Set<OoxmlNode>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    const hides =
      hidden.has(node) ||
      (node.localName === 'r' &&
        node.namespaceUri === WML_NAMESPACE_URI &&
        runIsDirectlyHidden(node));
    if (node.localName === 'sym' && node.namespaceUri === WML_NAMESPACE_URI) {
      // The WML namespace or none, matching how `layout/symbol-run.ts` reads it: a face
      // layout will not use is a face no resolver should be asked for.
      const authored = node.attributes.find(
        (attribute) =>
          attribute.localName === 'font' &&
          (attribute.namespaceUri === WML_NAMESPACE_URI || attribute.namespaceUri === '')
      )?.value;
      // One rule for every caller that asks a resolver for a symbol face, shared with the
      // export lane's own walk: a name no measurer or paint sink would take is a face
      // nothing could supply, so it is not asked for.
      const family = symbolFontFamily(authored);
      if (family !== null) {
        const fold = family.toLowerCase();
        if (!byFold.has(fold)) byFold.set(fold, family);
        // A private-use code point with no Unicode equivalent paints only in its own face.
        // The test is on the text shown, so a glyph mapped past the private-use block (an
        // emoji check box) counts as mapped.
        // A hidden glyph shows nothing, so its face is still one to try but not one the
        // notice names.
        const glyph = hides ? null : symbolGlyphOf(node);
        if (glyph && isPrivateUseText(glyph.text) && !unmapped.has(fold))
          unmapped.set(fold, family);
      }
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const child = node.children[i]!;
      if (hides) hidden.add(child);
      stack.push(child);
    }
  }
  return remember();
}

function isPrivateUseText(text: string): boolean {
  const code = text.codePointAt(0);
  return code !== undefined && code >= 0xe000 && code <= 0xf8ff;
}

/**
 * Whether any of `roots` actually puts CHARACTERS on a page.
 *
 * `collectDocumentFonts` answers what the document DECLARES, which is what a font picker
 * wants: a catalog of names. A font-substitution notice asks a different question — is
 * any text rendering in the wrong face — and a declaration alone never renders anything.
 * A freshly created document carries Word's `w:docDefaults` (Calibri) over a single empty
 * paragraph, so it declares a family while showing no glyph of it.
 *
 * Deliberately literal characters only: `w:t` (typed or demoted to generic) holding a
 * non-empty value. A drawing, a bookmark or an empty run puts no glyph on the page, so a
 * document made only of those has nothing a substitute face could get wrong. Same
 * iterative, depth-safe walk as the font catalog, and the same roots, so the two
 * derivations can never disagree about what "the document" is.
 */
export function documentRendersText(roots: readonly OoxmlElement[]): boolean {
  const stack: OoxmlNode[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === 't' && node.namespaceUri === WML_NAMESPACE_URI) {
      for (const child of node.children) {
        if (!isElement(child) && child.value.length > 0) return true;
      }
      continue;
    }
    for (const child of node.children) stack.push(child);
  }
  return false;
}

/**
 * How a style LOOKS, for a picker to preview it in its own face — Word shows the gallery
 * that way, and a list of identical rows makes the user apply a style to find out what it
 * is. PRESENTATION ONLY: these are the few properties a one-line preview can show, not the
 * cascade layout resolves. Every value is already bounded here (the family against the same
 * shape the CSS sink enforces, the colour against six hex digits), because a picker renders
 * them into a style attribute and they come from an attacker-controlled `styles.xml`.
 */
export interface DocumentStylePreview {
  readonly fontFamily: string | null;
  /** Points, already halved from `w:sz`. Null when the style states no size. */
  readonly fontSizePt: number | null;
  readonly bold: boolean;
  readonly italic: boolean;
  /** RRGGBB, or null for inherited/automatic — theme colours are not resolved here. */
  readonly color: string | null;
}

/** One `w:style` definition, projected for a style picker. */
export interface DocumentStyleEntry {
  readonly styleId: string;
  readonly name: string;
  readonly type: string;
  readonly preview: DocumentStylePreview;
}

const STYLE_TYPES = new Set(['paragraph', 'character', 'table', 'numbering']);

/** Six hex digits — the only `w:color` value a preview will render. */
const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;

/**
 * How far a `w:basedOn` chain is walked. Deep enough for any real styles part, bounded
 * because the chain comes from the file and can be made circular (D14 resource limits).
 */
const BASED_ON_DEPTH = 16;

/**
 * Word's Styles gallery order, which is NOT the order `styles.xml` lists definitions in —
 * a round-tripped file commonly puts Heading 6 above Heading 1, and a picker showing that
 * looks broken. Everything unranked keeps its document order after the ranked ones.
 */
const STYLE_RANK: ReadonlyMap<string, number> = new Map([
  ['normal', 0],
  ['title', 1],
  ['subtitle', 2],
  ['heading 1', 11],
  ['heading 2', 12],
  ['heading 3', 13],
  ['heading 4', 14],
  ['heading 5', 15],
  ['heading 6', 16],
  ['heading 7', 17],
  ['heading 8', 18],
  ['heading 9', 19],
]);

/**
 * A node's children as a plain node list.
 *
 * `OoxmlElement` is a union whose leaf members declare `readonly []`, so reading `.children`
 * off the union loses `Array.find`'s type-guard overload — the same reason the run-defaults
 * lane widens before iterating.
 */
function childrenOf(node: OoxmlElement): readonly OoxmlNode[] {
  return node.children as readonly OoxmlNode[];
}

/** The first child element with this local name. */
function childElementNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of childrenOf(node)) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

function styleRank(entry: DocumentStyleEntry): number {
  return (
    STYLE_RANK.get(entry.name.toLowerCase()) ??
    STYLE_RANK.get(entry.styleId.toLowerCase()) ??
    Number.MAX_SAFE_INTEGER
  );
}

function boundedString(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0 || raw.length > STYLE_STRING_MAX) return null;
  if (CONTROL_CHARS.test(raw)) return null;
  return raw;
}

/**
 * The style definitions of a `/word/styles.xml` tree: every `w:style` child of the
 * root with an accepted `w:type`, a valid `w:styleId`, and a display name from the
 * `w:name` child's `w:val` (falling back to the styleId when the name is absent or
 * fails validation). Definitions with a missing or invalid styleId are dropped: an
 * unaddressable style cannot be applied, so listing it would be a dead control.
 */
export function collectDocumentStyles(
  stylesRoot: OoxmlElement | null,
  /**
   * Font family and size for a styleId, resolved through the basedOn chain, `docDefaults`
   * and the theme font scheme. Injected because THAT resolution belongs to the run-defaults
   * lane, which already owns theme slots — this module would otherwise grow a second,
   * divergent copy of it. Without one the preview simply carries no font or size.
   */
  resolveDefaults?: (styleId: string) => {
    readonly fontFamily: string | null;
    readonly fontSizeHalfPoints: number | null;
  }
): readonly DocumentStyleEntry[] {
  if (!stylesRoot) return [];
  const definitions = new Map<string, OoxmlElement>();
  for (const child of stylesRoot.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    const styleId = boundedString(attributeValue(child, 'styleId'));
    if (styleId !== null && !definitions.has(styleId)) definitions.set(styleId, child);
  }

  /** `w:b`/`w:i`/`w:color` as the style chain leaves them, nearest definition winning. */
  const previewOf = (styleId: string): DocumentStylePreview => {
    let bold = false;
    let italic = false;
    let color: string | null = null;
    let seenBold = false;
    let seenItalic = false;
    const seen = new Set<string>();
    let current: string | null = styleId;
    for (let depth = 0; depth < BASED_ON_DEPTH && current !== null; depth += 1) {
      // A `w:basedOn` cycle is authored content, not a bug — refuse to walk it twice.
      if (seen.has(current)) break;
      seen.add(current);
      const definition = definitions.get(current);
      if (!definition) break;
      const rPr = childElementNamed(definition, 'rPr');
      for (const property of rPr ? childrenOf(rPr) : []) {
        if (!isElement(property)) continue;
        const val = attributeValue(property, 'val');
        // `w:b`/`w:i` are ST_OnOff: present with no `w:val` means on.
        const on = val !== '0' && val !== 'false' && val !== 'off';
        if (property.localName === 'b' && !seenBold) {
          bold = on;
          seenBold = true;
        } else if (property.localName === 'i' && !seenItalic) {
          italic = on;
          seenItalic = true;
        } else if (property.localName === 'color' && color === null && val && HEX_COLOR.test(val)) {
          color = val;
        }
      }
      const basedOn = childElementNamed(definition, 'basedOn');
      current = basedOn ? boundedString(attributeValue(basedOn, 'val')) : null;
    }
    const defaults = resolveDefaults?.(styleId);
    const family = defaults?.fontFamily ?? null;
    return {
      // Re-validated at THIS boundary even though the resolver bounds it too: the preview
      // is rendered into a font-family declaration, and this module is the one that
      // promises every string leaving it is safe for that sink.
      fontFamily: family !== null && FONT_NAME.test(family) ? family : null,
      fontSizePt:
        defaults?.fontSizeHalfPoints != null && defaults.fontSizeHalfPoints > 0
          ? defaults.fontSizeHalfPoints / 2
          : null,
      bold,
      italic,
      color,
    };
  };

  const entries: DocumentStyleEntry[] = [];
  for (const [styleId, definition] of definitions) {
    const type = attributeValue(definition, 'type');
    if (type === undefined || !STYLE_TYPES.has(type)) continue;
    const nameElement = childElementNamed(definition, 'name');
    const name = boundedString(nameElement ? attributeValue(nameElement, 'val') : undefined);
    entries.push({ styleId, name: name ?? styleId, type, preview: previewOf(styleId) });
  }
  // Stable: equal ranks keep document order, so an unranked style never jumps around
  // between reads of the same document.
  return entries
    .map((entry, index) => ({ entry, index, rank: styleRank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.entry);
}
