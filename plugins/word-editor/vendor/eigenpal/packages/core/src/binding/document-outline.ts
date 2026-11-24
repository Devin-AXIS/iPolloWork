// Document-derived heading outline, for the navigation panel.
//
// Sibling of `document-catalog.ts` and under the same discipline: the derivation reads
// the CANONICAL TREES — the current main part plus the immutable styles part — never the
// DOM or the layout, and every string that leaves this module is validated here at the
// derivation boundary. Heading text and style ids are authored file content; the outline
// is chrome, so downstream sinks (panel rows, tooltips) must only ever receive strings
// this module has already bounded.
//
// WHAT COUNTS AS A HEADING. A body-story paragraph (direct child of `w:body`; paragraphs
// inside table cells are structure, not document outline) whose `w:pPr/w:pStyle/@w:val`
// names a paragraph style that is heading-shaped:
//
// - the style's `w:name/@w:val` matches Word's built-in heading names
//   (`heading 1` … `heading 9`, case-insensitive), or
// - the style's own `w:pPr/w:outlineLvl/@w:val` is 0..8 (9 is Word's "body text"
//   sentinel and is NOT an outline level).
//
// The paragraph's own direct formatting is deliberately not consulted, and `basedOn`
// chains are deliberately not chased: both are bounded-cost rules, and the style-level
// answer is what Word's navigation pane keys on for the documents this slice loads.

import { withDisplayedHyphens } from '../store/package/hyphen-text.ts';
import { withoutSymbols } from '../store/store/paragraph-model-text.ts';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { styleOutlineLevel } from '../store/package/style-outline.ts';
import { bodyParagraphs } from './tree-binding.ts';

/** One heading of the outline, in document order. `level` is 0-based (Heading 1 = 0). */
export interface DocumentOutlineEntry {
  /** The paragraph's text, control characters flattened, bounded to 200 characters. */
  readonly text: string;
  /** 0-based outline level: `heading 1` / `outlineLvl 0` → 0. */
  readonly level: number;
  /** The paragraph's canonical node id — the address `setSelection` navigates to. */
  readonly blockId: string;
}

/** Identifier-ish strings from a file (style ids): bounded, no control characters. */
const STYLE_ID_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
/** Flatten controls (tabs, stray C0/C1) to spaces INSIDE heading text, then trim. */
const CONTROL_CHARS_ALL = /[\u0000-\u001F\u007F-\u009F]/g;
const OUTLINE_TEXT_MAX = 200;

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function childElement(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  // A plain loop: `parent.children` is a UNION of typed child-array shapes, and calling
  // `.find` with a type-guard callback across that union defeats the guard overload.
  for (const child of parent.children as readonly OoxmlNode[]) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * The 0-based outline level each paragraph style confers, keyed by styleId.
 *
 * Only paragraph styles participate; a styleId that is over-long or carries control
 * characters is dropped, never repaired — an unaddressable style cannot be a heading.
 */
export function headingLevelsByStyleId(
  stylesRoot: OoxmlElement | null
): ReadonlyMap<string, number> {
  const levels = new Map<string, number>();
  if (!stylesRoot) return levels;
  for (const child of stylesRoot.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    if (attributeValue(child, 'type') !== 'paragraph') continue;
    const styleId = attributeValue(child, 'styleId');
    if (
      styleId === undefined ||
      styleId.length === 0 ||
      styleId.length > STYLE_ID_MAX ||
      CONTROL_CHARS.test(styleId)
    ) {
      continue;
    }

    const level = styleOutlineLevel(child);
    if (level !== null) levels.set(styleId, level);
  }
  return levels;
}

/** The `w:pPr/w:pStyle/@w:val` of one paragraph element, unvalidated. */
export function paragraphStyleId(paragraph: OoxmlElement): string | undefined {
  const pPr = childElement(paragraph, 'pPr');
  const pStyle = pPr ? childElement(pPr, 'pStyle') : undefined;
  return pStyle ? attributeValue(pStyle, 'val') : undefined;
}

/**
 * The heading outline of the main part, in document order: BODY-STORY paragraphs only,
 * heading level resolved through the styles part, text read from the canonical tree and
 * bounded here. Headings whose text flattens to nothing are skipped — a blank row is
 * unnavigable noise, not an outline entry.
 */
export function collectDocumentOutline(
  part: OoxmlPart,
  stylesRoot: OoxmlElement | null
): readonly DocumentOutlineEntry[] {
  const levels = headingLevelsByStyleId(stylesRoot);
  if (levels.size === 0) return [];
  const entries: DocumentOutlineEntry[] = [];
  for (const paragraph of bodyParagraphs(part)) {
    if (!isElement(paragraph)) continue;
    const styleId = paragraphStyleId(paragraph);
    if (styleId === undefined) continue;
    const level = levels.get(styleId);
    if (level === undefined) continue;
    // A symbol reads as "(" in model text; an entry, and the TOC row built from it, leaves it out.
    const model = paragraphTextOf(part, paragraph.id) ?? '';
    const raw = paragraph.kind === 'paragraph' ? withoutSymbols(paragraph, model) : model;
    const text = withDisplayedHyphens(raw)
      .replace(CONTROL_CHARS_ALL, ' ')
      .trim()
      .slice(0, OUTLINE_TEXT_MAX);
    if (text.length === 0) continue;
    entries.push({ text, level, blockId: paragraph.id });
  }
  return entries;
}
