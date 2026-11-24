// Paragraph styles, named the way a reader names them.
//
// INTERNAL. Two directions over one index of `styles.xml`.
//
// THE NAME IS NOT THE ID. `w:styleId="Heading1"` is what a paragraph states; `heading 1` is what the
// styles gallery shows and what an object model talks in. They are routinely different, and a lane
// that answered the id would hand a caller a value that reads like a name, works on documents Word
// wrote in English, and stops working on one it wrote in German. So a read resolves the id to the
// part's own `w:name`, and a write resolves the name back to an id.
//
// AN UNKNOWN NAME IS REFUSED, NEVER MINTED. A host that added a style definition on demand would
// report "applied" for a style with no formatting in it: the paragraph would look untouched while
// reading back as styled. It also turns an attacker-controlled string into a new part rather than an
// error, which is the wrong way round for a lane whose input is a file and a caller it does not
// trust.
//
// UNTRUSTED VALUES. A name reaching `setStyle` is caller input; a name read back is FILE input. The
// caller's is bounded and validated as XML text here, and only ever compared against names the
// document already declares — nothing is templated into markup and no id is derived from it.

import { numberingRootOf, stylesPartOf } from '../store/package/ooxml-indexes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import {
  inheritedParagraphPropertyNodes,
  paragraphInheritsRtl,
  type DirectionSources,
} from '../layout/paragraph-direction-inheritance.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { MAX_STYLE_NAME, styleDefinitionsOf } from './style-definitions.ts';

/** What the document says its paragraph styles are. */
export interface AutomationStyleIndex {
  /**
   * The name a paragraph style id shows in a gallery, or null for an id the part omits one for.
   *
   * Also null when that name belongs to an EARLIER paragraph style, or is one a write refuses
   * (blank or not valid XML text): a name read is always one `idOf` resolves back to this style.
   */
  nameOf(styleId: string): string | null;
  /** The paragraph style id a name belongs to, matched case-insensitively, or null. */
  idOf(name: string): string | null;
  /**
   * The CHARACTER style id a name belongs to, or null. Run styles such as the one a hyperlink
   * takes are character styles; looking them up among paragraph styles would write a `w:rStyle`
   * that names a paragraph style.
   */
  characterIdOf(name: string): string | null;
  /** The id the part marks as the default paragraph style, or null. */
  readonly defaultId: string | null;
  /** Whether the package has a styles part at all. */
  readonly present: boolean;
  /**
   * Whether the paragraph is right to left when its own `w:bidi` is ignored: document defaults,
   * an enclosing cell's table style, its paragraph style chain, and its numbering level, as
   * layout resolves them. `styleId` resolves it as if it named that paragraph style.
   */
  inheritsRtl(part: OoxmlPart, paragraph: OoxmlNode, styleId?: string): boolean;
  /**
   * The `w:pBdr` elements the paragraph inherits, in cascade order, ignoring its own: document
   * defaults, an enclosing cell's table style, its style chain, and its numbering level, as
   * layout resolves them. Layout folds them edge by edge. `styleId` resolves them as if the
   * paragraph named that style.
   */
  inheritedBorders(part: OoxmlPart, paragraph: OoxmlNode, styleId?: string): readonly OoxmlNode[];
  /**
   * The `w:spacing` line attributes the paragraph inherits, ignoring its own: document defaults,
   * an enclosing cell's table style, its style chain, and its numbering level, as layout resolves
   * them, each attribute from the last level that states it. `styleId` resolves them as if the
   * paragraph named that style.
   */
  inheritedLineSpacing(
    part: OoxmlPart,
    paragraph: OoxmlNode,
    styleId?: string
  ): InheritedLineSpacing;
}

/** Inherited `w:spacing` line attributes, as the file spells them. Absent = nothing states it. */
export interface InheritedLineSpacing {
  readonly line?: string;
  readonly lineRule?: string;
}

/** The line attributes several `w:pPr` nodes state, folded attribute by attribute in order. */
function foldedLineSpacing(nodes: readonly (OoxmlNode | undefined)[]): InheritedLineSpacing {
  let line: string | undefined;
  let lineRule: string | undefined;
  for (const node of nodes) {
    const spacing = node ? namedChild(node, 'spacing') : undefined;
    if (!spacing) continue;
    for (const attribute of spacing.attributes) {
      if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
      if (attribute.localName === 'line') line = attribute.value;
      else if (attribute.localName === 'lineRule') lineRule = attribute.value;
    }
  }
  return {
    ...(line === undefined ? {} : { line }),
    ...(lineRule === undefined ? {} : { lineRule }),
  };
}

/**
 * Index the package's PARAGRAPH styles.
 *
 * Character and table styles are indexed by the store helper too and are dropped here on purpose:
 * this is what a paragraph may be set to, and quietly accepting a character style would write a
 * `w:pStyle` naming something Word resolves to nothing.
 */
export function styleIndex(pkg: OoxmlPackage): AutomationStyleIndex {
  const part = stylesPartOf(pkg);
  const sources: DirectionSources = {
    styles: part?.root ?? null,
    settings: settingsPartOf(pkg)?.root ?? null,
    numbering: numberingRootOf(pkg),
  };
  // Cell styles resolve as the proposed document shows them, like automation's run writes.
  const inheritsRtl = (target: OoxmlPart, paragraph: OoxmlNode, styleId?: string) =>
    paragraphInheritsRtl(sources, target, paragraph, 'proposed', styleId);
  const inheritedBorders = (target: OoxmlPart, paragraph: OoxmlNode, styleId?: string) =>
    inheritedParagraphPropertyNodes(
      sources,
      target,
      paragraph,
      'proposed',
      'pBdr',
      styleId
    ).flatMap((node) => {
      const pBdr = namedChild(node, 'pBdr');
      return pBdr ? [pBdr] : [];
    });
  const inheritedLineSpacing = (target: OoxmlPart, paragraph: OoxmlNode, styleId?: string) =>
    foldedLineSpacing(
      inheritedParagraphPropertyNodes(sources, target, paragraph, 'proposed', 'spacing', styleId)
    );
  if (!part) {
    return Object.freeze({
      nameOf: () => null,
      idOf: () => null,
      characterIdOf: () => null,
      defaultId: null,
      present: false,
      inheritsRtl,
      inheritedBorders,
      inheritedLineSpacing,
    });
  }
  // The same cached definitions the style listing reads, so the two agree on every name.
  const definitions = styleDefinitionsOf(part);
  const defaultId = definitions.defaultParagraphId;
  return Object.freeze({
    nameOf: (styleId: string) => definitions.nameOf('paragraph', styleId),
    idOf: (name: string) => definitions.idOf('paragraph', name),
    characterIdOf: (name: string) => definitions.idOf('character', name),
    defaultId,
    present: true,
    inheritsRtl,
    inheritedBorders,
    inheritedLineSpacing,
  });
}

/**
 * The style NAME a paragraph has, or null when nothing names one.
 *
 * A paragraph that states no `w:pStyle` answers the part's own default paragraph style, because
 * that is the style it has — `w:docDefaults` and `w:default="1"` are the document saying so, not
 * this lane guessing. A package with no styles part answers null: there is no name to give. A
 * style whose name an earlier paragraph style already has answers null too (see `nameOf`).
 */
export function paragraphStyleName(
  part: OoxmlPart,
  paragraphId: string,
  styles: AutomationStyleIndex
): string | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const stated = attributeOf(namedChild(paragraphPropertiesNodeOf(paragraph), 'pStyle'));
  if (stated !== null) return styles.nameOf(stated);
  return styles.defaultId === null ? null : styles.nameOf(styles.defaultId);
}

function attributeOf(
  element:
    | { readonly attributes: readonly { readonly localName: string; readonly value: string }[] }
    | undefined
): string | null {
  if (!element) return null;
  for (const entry of element.attributes) {
    if (entry.localName === 'val') return entry.value;
  }
  return null;
}

export type StylePlan =
  { readonly ok: true; readonly styleId: string } | { readonly ok: false; readonly detail: string };

/**
 * The `w:pStyle` id a name may be written as, or why it may not.
 *
 * Every refusal is the same kind of refusal — this document does not define that paragraph style —
 * and the detail says which check it failed, so a caller can tell a typo from a character style
 * from a name the file never had.
 */
export function styleIdFor(name: unknown, styles: AutomationStyleIndex): StylePlan {
  if (typeof name !== 'string' || name.trim().length === 0)
    return { ok: false, detail: 'style: not a name' };
  if (name.length > MAX_STYLE_NAME) return { ok: false, detail: 'style: name too long' };
  if (!isValidXmlText(name)) return { ok: false, detail: 'style: not valid XML text' };
  if (!styles.present)
    return { ok: false, detail: 'no-styles-defined: this document defines no styles' };
  const styleId = styles.idOf(name);
  if (styleId === null)
    return {
      ok: false,
      // The token before the colon selects the public diagnostic that points to getStyles().
      detail: 'style-not-defined: this document defines no paragraph style with that name',
    };
  return { ok: true, styleId };
}
