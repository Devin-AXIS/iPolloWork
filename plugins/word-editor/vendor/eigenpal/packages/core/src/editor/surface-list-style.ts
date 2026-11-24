// Word's List Paragraph style, and the `w:pStyle` writes the list gesture carries.
//
// Word's list buttons do not just add `w:numPr`: they put the paragraph in the built-in
// List Paragraph style, and THAT style is what states `w:contextualSpacing` — the property
// that closes the gap between consecutive items. So a list gesture is two writes, and the
// second one is a style decision with rules of its own about which paragraphs it may touch.
//
// Split out of `surface-structure.ts` because it is that: a style question, answered
// against `styles.xml` and the document's own default, rather than a structural edit at the
// selection.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import {
  LEVEL_INDENT_ATTRIBUTES,
  type OoxmlElement,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable } from '@docx-editor.dev/core/layout';
import { directParagraphProperties, mergedProperties } from './surface-formatting.ts';

/** What this lane borrows: the session it reads styles from, and the story it writes to. */
export interface ListStyleDeps {
  readonly session: TreeDocxSessionView;
  /** The part holding the paragraphs a write will name. */
  storyPart(): OoxmlPart;
}

/** The `w:name` Word gives the built-in, case-folded for comparison. */
const LIST_PARAGRAPH_NAME = 'list paragraph';
/** The styleId Word gives the built-in. */
const LIST_PARAGRAPH_STYLE_ID = 'ListParagraph';

const isIndent = (property: { readonly localName: string }): boolean =>
  property.localName === 'ind';

/**
 * How a style write treats the paragraph's own `w:ind`: kept, dropped whole (a paragraph that
 * joins a list), or dropped on the sides a level states (an item that changes level).
 */
export type IndentDrop = false | 'all' | 'level';

type DirectProperty = ReturnType<typeof directParagraphProperties>[number];

/** `property` after `drop`, or null when nothing of it is left. */
function droppedIndent(property: DirectProperty, drop: IndentDrop): DirectProperty | null {
  if (!drop || !isIndent(property)) return property;
  if (drop === 'all') return null;
  const kept = Object.entries(property.attributes ?? {}).filter(
    ([name]) => !LEVEL_INDENT_ATTRIBUTES.has(name)
  );
  return kept.length > 0 ? { ...property, attributes: Object.fromEntries(kept) } : null;
}

/** The `w:pStyle` a paragraph itself authors, or undefined. */
function authoredStyleId(
  properties: ReturnType<typeof directParagraphProperties>
): string | undefined {
  return properties.find((property) => property.localName === 'pStyle')?.attributes?.val;
}

/** Resolve the built-in by name before id, including localized/custom ids. */
export function listParagraphStyleId(
  styles: readonly { type: string; name: string; styleId: string }[]
): string | null {
  let byId: string | null = null;
  for (const style of styles) {
    if (style.type !== 'paragraph') continue;
    if (style.name.trim().toLowerCase() === LIST_PARAGRAPH_NAME) return style.styleId;
    if (byId === null && style.styleId === LIST_PARAGRAPH_STYLE_ID) byId = style.styleId;
  }
  return byId;
}

/** The two writes a list gesture may need, resolved against one document's styles. */
export interface ListStyleWrites {
  /**
   * The `w:pStyle` writes that turning a list ON carries, the way Word's own gesture does.
   *
   * A paragraph in a NON-DEFAULT style keeps it: bulleting a Heading 1 in Word leaves it a
   * heading. A paragraph in the default style does not, and that is not the same as
   * authoring no style at all — a converter stamps `<w:pStyle w:val="Normal"/>` on every
   * paragraph it writes, and reading that as "has a style of its own" left the whole class
   * of converted files with 8pt between their list items.
   *
   * These ops must go BEFORE the numbering ops, because `setParagraphProperties` replaces
   * the authorable set it is handed and `setListNumbering` is surgical on `w:numPr` — the
   * other order would drop the numbering the same transaction had just written.
   *
   * A paragraph for which `dropsIndent` holds also loses its own `w:ind`, as a paragraph that
   * joins the list above does in reference renderings, whether or not its style changes.
   */
  applyOps(touched: readonly string[], dropsIndent?: (paragraphId: string) => boolean): TreeDocOp[];
  /**
   * The write that takes a paragraph OUT of List Paragraph, or null when it is not in it.
   *
   * Enter on an empty item is Word's "I am done with this list", and Word returns the text
   * to the LEFT MARGIN. Dropping only `w:numPr` leaves the style's own `w:ind w:left="720"`
   * standing, so the paragraph would keep sitting half an inch in with no marker to explain
   * it. The toolbar toggle deliberately does NOT do this: clicking Bullets off in Word
   * leaves the paragraph styled, and indented.
   */
  clearOp(paragraphId: string): TreeDocOp | null;
  /**
   * The write that puts a paragraph in the paragraph style a list level is linked to, or null
   * when no paragraph style of that id exists.
   *
   * A level linked through `w:pStyle`, as in a heading numbering, numbers the paragraphs of
   * that style. A list gesture that joins such a list puts the paragraph in the style and
   * drops its own `w:numPr`, so the paragraph becomes one of the list's headings rather than a
   * plain paragraph with a heading's number. `dropIndent` also removes its own `w:ind`, whole
   * or on the sides a level states.
   */
  linkedStyleOp(paragraphId: string, styleId: string, dropIndent?: IndentDrop): TreeDocOp | null;
}

export function createListStyleWrites(deps: ListStyleDeps): ListStyleWrites {
  const { session } = deps;

  /**
   * The document's `w:default="1"` paragraph style, memoized on the styles root.
   *
   * Read through the layout cascade's own resolver rather than by matching the attribute:
   * `w:default` is `ST_OnOff`, so `on` and `true` are legal spellings of `1`, and defaults
   * are last-wins. The styles part is immutable for the session, so this builds once.
   */
  let defaultStyleMemo:
    { readonly root: OoxmlElement | null; readonly styleId: string | null } | undefined;
  function defaultParagraphStyleId(): string | null {
    const root = session.stylesRoot();
    if (defaultStyleMemo === undefined || defaultStyleMemo.root !== root) {
      defaultStyleMemo = {
        root,
        styleId: buildStyleCascadeTable(root, session.documentThemeFonts()).defaultParagraphStyleId,
      };
    }
    return defaultStyleMemo.styleId;
  }

  return {
    applyOps(touched, dropsIndent) {
      const styleId = listParagraphStyleId(session.documentStyles());
      const defaultStyleId = defaultParagraphStyleId();
      const part = deps.storyPart();
      const ops: TreeDocOp[] = [];
      for (const paragraphId of touched) {
        const own = directParagraphProperties(part, paragraphId);
        const dropping = dropsIndent?.(paragraphId) === true && own.some(isIndent);
        const properties = dropping ? own.filter((property) => !isIndent(property)) : own;
        const authored = authoredStyleId(own);
        const restyles =
          styleId !== null && (authored === undefined || authored === defaultStyleId);
        if (!restyles && !dropping) continue;
        ops.push({
          op: 'setParagraphProperties',
          paragraphId,
          properties:
            restyles && styleId !== null
              ? mergedProperties(properties, { localName: 'pStyle', attributes: { val: styleId } })
              : properties,
        });
      }
      return ops;
    },

    linkedStyleOp(paragraphId, styleId, dropIndent = false) {
      const exists = session
        .documentStyles()
        .some((style) => style.type === 'paragraph' && style.styleId === styleId);
      if (!exists) return null;
      const properties = directParagraphProperties(deps.storyPart(), paragraphId).flatMap(
        (property) => {
          if (property.localName === 'numPr') return [];
          const kept = droppedIndent(property, dropIndent);
          return kept ? [kept] : [];
        }
      );
      return {
        op: 'setParagraphProperties',
        paragraphId,
        properties: mergedProperties(properties, {
          localName: 'pStyle',
          attributes: { val: styleId },
        }),
      };
    },

    clearOp(paragraphId) {
      const styleId = listParagraphStyleId(session.documentStyles());
      if (styleId === null) return null;
      const properties = directParagraphProperties(deps.storyPart(), paragraphId);
      if (authoredStyleId(properties) !== styleId) return null;
      return {
        op: 'setParagraphProperties',
        paragraphId,
        properties: properties.filter((property) => property.localName !== 'pStyle'),
      };
    },
  };
}
