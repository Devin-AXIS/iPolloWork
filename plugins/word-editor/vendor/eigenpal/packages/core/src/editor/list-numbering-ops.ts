import {
  findNode,
  readTwipsMeasure,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  cascadeParagraphFormatting,
  readNumPr,
  type SemanticLayout,
  type StyleCascadeTable,
} from '@docx-editor.dev/core/layout';
import { fragmentHolding } from '../layout/line-segments.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import { authoredProperties } from '../store/store/direct-properties.ts';
import { leftIndentTwipsOf } from './surface-indent-step.ts';

const INDENT = new Set(['ind']);

export interface ListNumberingDeps {
  storyPart(): OoxmlPart;
  styleCascade(): StyleCascadeTable | undefined;
  layout(): SemanticLayout;
}

/**
 * List writes for an item numbered through its paragraph style, which has no `w:numPr` of
 * its own for `setListLevel` to rewrite or for `setListNumbering(null)` to remove.
 *
 * A paragraph absorbed into another's fragment by a struck mark is drawn with that
 * paragraph's marker, so it keeps the plain ops: the style writes are for its own marker only.
 */
export function createListNumberingOps(deps: ListNumberingDeps) {
  const absorbed = (paragraphId: string) =>
    fragmentHolding(deps.layout(), paragraphId)?.paragraphId !== paragraphId;

  /** The numbering the paragraph's style chain gives it, its own `w:numPr` aside. */
  function styleNumbering(paragraphId: string): { numId: string; ilvl: number } | null {
    const styles = deps.styleCascade();
    const paragraph = findNode(deps.storyPart(), paragraphId);
    if (!styles || !paragraph) return null;
    const pPr = paragraphPropertiesNodeOf(paragraph);
    // The cascade's last tier is the paragraph's own `w:pPr`, which still names the style.
    const tiers = cascadeParagraphFormatting(styles, pPr).paragraphPropertyNodes;
    return readNumPr(tiers.filter((tier) => tier !== pPr));
  }

  return {
    /**
     * The ops that move a list item from `from` to `level`. `numId` is the list the level was
     * declared on.
     *
     * An item numbered through its style first gets its own `w:numPr` at the level it is at,
     * so the move itself is always `setListLevel`. That op also drops the paragraph's own
     * leading and first-line indent, which would otherwise outrank the new level's.
     */
    levelOps(paragraphId: string, numId: string, from: number, level: number): TreeDocOp[] {
      const paragraph = findNode(deps.storyPart(), paragraphId);
      const ownsNumPr = paragraph && namedChild(paragraphPropertiesNodeOf(paragraph), 'numPr');
      const styleNumbered =
        !ownsNumPr && !absorbed(paragraphId) && styleNumbering(paragraphId)?.numId === numId;
      const move: TreeDocOp = { op: 'setListLevel', paragraphId, level };
      return styleNumbered
        ? [{ op: 'setListNumbering', paragraphId, numId, level: from }, move]
        : [move];
    },

    /**
     * The indent the paragraph's style chain gives it without its list, in twips: the left
     * edge and the signed first-line offset (negative hangs). Each attribute cascades on its
     * own, so the last tier that states it wins. `inChars` says the style also states the
     * first line in character units, which supersede the twips (§17.3.1.12), and
     * `leftInChars` says the same of the left edge. With `defaultStyle`, the chain is the
     * document's default paragraph style, as it is once the paragraph's `w:pStyle` goes.
     */
    styleIndent(
      paragraphId: string,
      defaultStyle = false
    ): { left: number; firstLine: number; inChars: boolean; leftInChars: boolean } {
      const styles = deps.styleCascade();
      const paragraph = findNode(deps.storyPart(), paragraphId);
      if (!styles || !paragraph)
        return { left: 0, firstLine: 0, inChars: false, leftInChars: false };
      const pPr = paragraphPropertiesNodeOf(paragraph);
      const tiers = cascadeParagraphFormatting(
        styles,
        defaultStyle ? undefined : pPr
      ).paragraphPropertyNodes;
      const stated = tiers
        .filter((tier) => tier !== pPr)
        .flatMap((tier) => authoredProperties(tier, INDENT));
      let firstLine = 0;
      let inChars = false;
      let leftInChars = false;
      for (const { attributes } of stated) {
        const hanging = readTwipsMeasure(attributes?.hanging);
        const first = readTwipsMeasure(attributes?.firstLine);
        if (hanging !== null) firstLine = -hanging;
        else if (first !== null) firstLine = first;
        const chars = Number(attributes?.hangingChars ?? attributes?.firstLineChars ?? NaN);
        if (Number.isFinite(chars)) inChars = chars !== 0;
        const leftChars = Number(attributes?.leftChars ?? attributes?.startChars ?? NaN);
        if (Number.isFinite(leftChars)) leftInChars = leftChars !== 0;
      }
      return { left: leftIndentTwipsOf(stated), firstLine, inChars, leftInChars };
    },

    /** Whether the paragraph's numbering comes from its style, so leaving writes `numId` 0. */
    styleNumbered(paragraphId: string): boolean {
      return !absorbed(paragraphId) && styleNumbering(paragraphId) !== null;
    },

    /**
     * Whether the paragraph's OWN tree still numbers it: its `w:numPr`, or its style's.
     *
     * Asked of the tree, not the painted marker. An absorbed paragraph is drawn with its
     * survivor's marker, and the Original view paints a removed number from its revision
     * record, so a marker on screen does not mean there is numbering left to remove.
     */
    numbered(paragraphId: string): boolean {
      if (absorbed(paragraphId)) return false;
      const paragraph = findNode(deps.storyPart(), paragraphId);
      if (!paragraph) return false;
      const numId = namedChild(namedChild(paragraphPropertiesNodeOf(paragraph), 'numPr'), 'numId');
      const value = numId?.attributes.find((attribute) => attribute.localName === 'val')?.value;
      return value !== undefined ? value !== '0' : styleNumbering(paragraphId) !== null;
    },

    /** `w:numId="0"` switches off the style's numbering (§17.9.18); removal alone would not. */
    leaveOp(paragraphId: string): TreeDocOp {
      const styleNumbered = !absorbed(paragraphId) && styleNumbering(paragraphId) !== null;
      return { op: 'setListNumbering', paragraphId, numId: styleNumbered ? '0' : null };
    },
  };
}
