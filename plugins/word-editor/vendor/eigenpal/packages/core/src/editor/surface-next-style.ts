// Word's "style for following paragraph" (`w:next`), and the one gesture that reads it.
//
// Pressing Enter at the END of a paragraph starts a new one, and Word gives that new
// paragraph the style's `w:next` rather than the style the caret was in. That is why a
// heading is followed by body text: `Heading 1` declares `<w:next w:val="Normal"/>`.
// Without it, Enter after a heading produced a second heading, and every following
// paragraph inherited the heading's size, colour and outline level until the user reset
// the style by hand.
//
// The rule is about the CARET, not about the split: a split in the MIDDLE of a paragraph
// divides one paragraph into two of the same kind, so `w:next` does not apply there. Word
// draws the line the same way, which is why Enter at the start of a heading leaves an
// empty heading above rather than an empty body paragraph.
//
// Split out of `surface-structure.ts` for the reason `surface-list-style.ts` was: it is a
// style question, answered against `styles.xml` and the document's own default, rather
// than a structural edit at the selection.

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { directParagraphProperties, paragraphTextOf } from '@docx-editor.dev/core/store';
import type { StyleCascadeTable } from '@docx-editor.dev/core/layout';

/** What this lane borrows: the styles index, and the part the split's paragraph lives in. */
export interface NextStyleDeps {
  /**
   * The styles part, indexed. The surface already holds one memoized on the styles root's
   * identity; a second table here would be a second FNV pass over every style, and a
   * second answer to what a style id means.
   */
  styleCascade(): StyleCascadeTable | undefined;
  /** The part holding the paragraph an Enter is splitting, by that paragraph's node id. */
  partOf(paragraphId: string): OoxmlPart;
}

export interface NextStyleWrites {
  /**
   * Whether an offset sits at the very end of a paragraph's MODEL text.
   *
   * Model, not layout. `paragraphTextFromLayout` reconstructs from painted spans, and in
   * `proposed` display mode a deletion struck at the END of a paragraph is not painted at
   * all — the caret then read as "at the end" with model content still after it, and the
   * struck words fell into the tail wearing the follower style. `paragraphTextOf` is the
   * vocabulary the split op's own offsets are in.
   */
  atParagraphEnd(paragraphId: string, offset: number): boolean;
  /**
   * The `w:pStyle` the paragraph FOLLOWING this one takes, as `splitParagraph.tailStyleId`.
   *
   * `undefined` means "clone this paragraph's own style", which is the answer whenever the
   * rule does not apply: a style that names no `w:next`, a `w:next` that points back at the
   * same style, or one that names a style the document never defines. `null` means "author
   * no `w:pStyle`" and is how the document's DEFAULT style is spelled — writing
   * `<w:pStyle w:val="Normal"/>` on every new body paragraph would be legal but is not what
   * Word emits.
   */
  followerStyleId(paragraphId: string): string | null | undefined;
}

export function createNextStyleWrites(deps: NextStyleDeps): NextStyleWrites {
  return {
    atParagraphEnd(paragraphId, offset) {
      const text = paragraphTextOf(deps.partOf(paragraphId), paragraphId);
      return text !== null && offset === text.length;
    },

    followerStyleId(paragraphId) {
      const part = deps.partOf(paragraphId);
      const table = deps.styleCascade();
      if (!table) return undefined;
      const authored = directParagraphProperties(part, paragraphId).find(
        (property) => property.localName === 'pStyle'
      )?.attributes?.val;
      // A paragraph with no `w:pStyle` of its own is in the document's default style, and
      // that style has a `w:next` like any other. Word's own blank template points Normal
      // back at Normal, so this usually resolves to "no change" rather than to nothing.
      const current = authored ?? table.defaultParagraphStyleId;
      if (current === null || current === undefined) return undefined;
      const next = table.styles.get(current)?.next;
      if (!next || next === current) return undefined;
      // A `w:next` nobody defined would render as the default here and as a missing style
      // everywhere else. Leaving this paragraph's style alone is the smaller wrong answer.
      const target = table.styles.get(next);
      if (!target || target.type !== 'paragraph') return undefined;
      return next === table.defaultParagraphStyleId ? null : next;
    },
  };
}
