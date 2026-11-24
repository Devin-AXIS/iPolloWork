// Leaving a list from the keyboard: Enter on an empty item, Backspace at an item's start, and
// Backspace at the start of an indented paragraph.
//
// Each key takes one step back from a list or an indent before it reaches the paragraph
// break, and each answers whether it handled the key, so the caller falls through to its
// ordinary split or join when it did not.

import type { TreeApplyResult } from '@docx-editor.dev/core/binding';
import type {
  ListMarkerRecord,
  SemanticLayout,
  SemanticPosition,
} from '@docx-editor.dev/core/layout';
import { readTwipsMeasure, type OoxmlPart, type TreeDocOp } from '@docx-editor.dev/core/store';
import type { createListNumberingOps } from './list-numbering-ops.ts';
import type { createListStyleWrites } from './surface-list-style.ts';
import { parentOf } from '../store/store/tree-op-nodes.ts';
import { treeLockRefusal } from './content-control-locks.ts';
import { directParagraphProperties, paragraphPropertiesOf } from './surface-formatting.ts';
import { leftIndentTwipsOf } from './surface-indent-step.ts';

export interface ListExitDeps {
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  layout(): SemanticLayout;
  storyPart(): OoxmlPart;
  markerOf(paragraphId: string): ListMarkerRecord | null;
  listLevelExists(marker: ListMarkerRecord, level: number): boolean;
  paragraphTextOf(paragraphId: string): string;
  listNumbering: ReturnType<typeof createListNumberingOps>;
  listStyle: ReturnType<typeof createListStyleWrites>;
  /** Apply ops in one commit; answers whether they committed. */
  commitOps(ops: readonly TreeDocOp[]): boolean;
}

/** The `w:ind` attributes that state a first-line or hanging indent, in both units. */
const FIRST_LINE_ATTRIBUTES = ['firstLine', 'hanging', 'firstLineChars', 'hangingChars'];
/** The `w:ind` attributes that state the leading edge, in both units and both spellings. */
const LEADING_ATTRIBUTES = ['left', 'start', 'leftChars', 'startChars'];
/** Range and permission markup that can sit between two block siblings. */
const INLINE_BETWEEN_BLOCKS = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'permStart',
  'permEnd',
  'proofErr',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
]);
/** The `w:ind` attributes in character units, which supersede their twips (§17.3.1.12). */
const CHARACTER_ATTRIBUTES = ['leftChars', 'startChars', 'firstLineChars', 'hangingChars'];

export function createListExit(deps: ListExitDeps) {
  /** The list item a collapsed caret is in, or null for a range or an ordinary paragraph. */
  function caretItem(): { position: SemanticPosition; marker: ListMarkerRecord } | null {
    const { from, to } = deps.orderedRange();
    if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return null;
    const marker = deps.markerOf(from.paragraphId);
    return marker ? { position: from, marker } : null;
  }

  /**
   * The paragraph's own `w:ind` after its marker goes, holding the text where it was.
   *
   * Word writes the left indent the list gave the text as the paragraph's own, and drops the
   * hanging indent that made room for the marker. A style that numbers the paragraph always
   * gets the left indent written. Otherwise Word writes it only when the style alone would
   * put the text elsewhere, and cancels a first-line or hanging indent the style carries with
   * `w:firstLine="0"`. List Paragraph at the first level needs neither, so nothing is written.
   */
  function heldIndentOp(paragraphId: string): TreeDocOp | null {
    const textLeft = leftIndentTwipsOf(paragraphPropertiesOf(deps.layout(), paragraphId));
    const direct = directParagraphProperties(deps.storyPart(), paragraphId);
    const authored = direct.find((property) => property.localName === 'ind')?.attributes;
    const fromStyle = deps.listNumbering.styleNumbered(paragraphId);
    const style = deps.listNumbering.styleIndent(paragraphId);
    const writeLeft = fromStyle || authored !== undefined || style.left !== textLeft;
    const cancelFirstLine = !fromStyle && (style.firstLine !== 0 || style.inChars);
    if (!writeLeft && !cancelFirstLine) return null;
    const attributes: Record<string, string> = { ...(authored ?? {}) };
    for (const name of FIRST_LINE_ATTRIBUTES) delete attributes[name];
    if (cancelFirstLine) attributes.firstLine = '0';
    // A style's character-unit first line supersedes the twips, so it is cancelled too.
    if (cancelFirstLine && style.inChars) attributes.firstLineChars = '0';
    if (writeLeft) {
      // The character-unit twin supersedes the twips (§17.3.1.12), so it goes with the write.
      delete attributes.leftChars;
      delete attributes.startChars;
      const value = String(textLeft);
      if (authored?.start !== undefined) attributes.start = value;
      if (authored?.start === undefined || authored.left !== undefined) attributes.left = value;
    }
    return {
      op: 'setParagraphProperties',
      paragraphId,
      properties: [
        ...direct.filter((property) => property.localName !== 'ind'),
        { localName: 'ind', attributes },
      ],
    };
  }

  /**
   * The paragraph just before `paragraphId` in the same container, or null when a table, a
   * block control, or the container's start comes first. Markup between paragraphs, such as
   * a bookmark, is passed over. A paragraph after a table does not line up with a list item
   * in the table's last cell.
   */
  function previousSibling(paragraphId: string): string | null {
    const part = deps.storyPart();
    const children = parentOf(part, paragraphId)?.children ?? [];
    const index = children.findIndex(
      (child) => child.kind !== 'textValue' && child.id === paragraphId
    );
    for (let at = index - 1; at >= 0; at -= 1) {
      const child = children[at]!;
      if (child.kind === 'textValue' || INLINE_BETWEEN_BLOCKS.has(child.localName)) continue;
      return child.kind === 'paragraph' ? child.id : null;
    }
    return null;
  }

  /** Whether a content control around `paragraphId` locks its content. */
  function insideContentLock(paragraphId: string): boolean {
    const part = deps.storyPart();
    for (let node = parentOf(part, paragraphId); node; node = parentOf(part, node.id)) {
      if (node.localName === 'sdt' && treeLockRefusal(node, 'edit') === 'locked') return true;
    }
    return false;
  }

  /**
   * The indent a paragraph's resolved properties state, in `w:ind` terms: `left` is `w:left`
   * or `w:start` in twips, `firstLine` is signed (negative hangs), and `inChars` says either
   * is also stated in character units. These are the attributes Backspace removes, in either
   * direction: a right-to-left paragraph's `w:right` stays, as a left-to-right one's does.
   */
  function resolvedIndent(paragraphId: string) {
    const properties = paragraphPropertiesOf(deps.layout(), paragraphId);
    let firstLine = 0;
    let inChars = false;
    for (const property of properties) {
      if (property.localName !== 'ind') continue;
      const attributes = property.attributes ?? {};
      const hanging = readTwipsMeasure(attributes.hanging);
      const first = readTwipsMeasure(attributes.firstLine);
      if (hanging !== null) firstLine = -hanging;
      else if (first !== null) firstLine = first;
      for (const name of CHARACTER_ATTRIBUTES) {
        const chars = Number(attributes[name] ?? NaN);
        if (Number.isFinite(chars) && chars !== 0) inChars = true;
      }
    }
    return { left: leftIndentTwipsOf(properties), firstLine, inChars };
  }

  /**
   * Where a Backspace at the start of an unnumbered paragraph moves its left edge: to the
   * marker of the list item just before it, when the paragraph's text lines up with that
   * item's text and has no first-line or hanging indent of its own; otherwise to 0.
   */
  function steppedLeft(paragraphId: string, indent: ReturnType<typeof resolvedIndent>): number {
    const previous = previousSibling(paragraphId);
    if (indent.firstLine !== 0 || indent.inChars || previous === null) return 0;
    if (!deps.markerOf(previous)) return 0;
    const item = resolvedIndent(previous);
    if (item.inChars || item.left !== indent.left) return 0;
    const marker = item.left + item.firstLine;
    return marker > 0 && marker < indent.left ? marker : 0;
  }

  return {
    /**
     * Enter on an EMPTY list item leaves the list, the way Word does.
     *
     * Pressing Enter at the end of a list makes another item; pressing it again on that
     * still-empty item is how a user says "I am done with this list". Word outdents one
     * level per press and drops the numbering at level 0.
     */
    exitListOnEmptyItem(): boolean {
      const item = caretItem();
      if (!item) return false;
      const { position, marker } = item;
      // Only an EMPTY item: Enter inside text still splits the paragraph.
      if (deps.paragraphTextOf(position.paragraphId).length > 0) return false;

      const outdented = marker.level > 0 && deps.listLevelExists(marker, marker.level - 1);
      // Outdenting stays in the list, so it keeps the style. Leaving the list sheds it, or
      // the paragraph keeps List Paragraph's half-inch indent with no marker beside it —
      // see `clearListParagraphStyleOp`. The style write goes first for the same reason it
      // does in `toggleList`: it carries the authored `w:numPr` forward, so running it
      // after the numbering op would put back what that op had just removed.
      const ops: TreeDocOp[] = [];
      if (outdented) {
        ops.push(
          ...deps.listNumbering.levelOps(
            position.paragraphId,
            marker.numId,
            marker.level,
            marker.level - 1
          )
        );
      } else {
        const cleared = deps.listStyle.clearOp(position.paragraphId);
        if (cleared) ops.push(cleared);
        ops.push(deps.listNumbering.leaveOp(position.paragraphId));
      }
      return deps.commitOps(ops);
    },

    /**
     * Backspace at the START of a list item removes its number or bullet, the way Word does.
     *
     * The text stays on its own line, where the list put it, and the paragraph keeps its
     * style. Only a later Backspace reaches the previous paragraph. The caller has already
     * found the caret at the paragraph's visible start. The indent write goes first: it
     * restates the paragraph's own properties, `w:numPr` included, so the numbering op has to
     * run after it.
     */
    removeListNumber(paragraphId: string): boolean {
      // The tree decides, not the painted marker: see `numbered`. A paragraph with nothing
      // left to remove falls through to the join instead of committing a no-op forever.
      if (!deps.markerOf(paragraphId) || !deps.listNumbering.numbered(paragraphId)) return false;
      const held = heldIndentOp(paragraphId);
      // A refused write still answers true: the key is spent on the refusal the commit
      // published, rather than joining the paragraph the user asked to keep.
      deps.commitOps([...(held ? [held] : []), deps.listNumbering.leaveOp(paragraphId)]);
      return true;
    },

    /**
     * Backspace at the START of an indented paragraph removes the indent, the way Word does.
     *
     * The left and the first-line or hanging indent go together; the right indent stays. A
     * paragraph in List Paragraph leaves that style, which is where its indent comes from. An
     * indent from any other style is cancelled with a 0, so the paragraph keeps its style. A
     * paragraph lined up with the text of the list item before it steps back to that item's
     * marker first. Only a later Backspace reaches the previous paragraph. The caller has
     * already found the caret at the paragraph's visible start, and a list item's number goes
     * first (`removeListNumber`).
     */
    removeParagraphIndent(paragraphId: string): boolean {
      // An EMPTY paragraph joins at once, indent and all: nothing in it is kept in place.
      if (deps.markerOf(paragraphId) || deps.paragraphTextOf(paragraphId).length === 0)
        return false;
      // Backspace is a delete key: in a content-locked control it reaches the join, which the
      // lock refuses, rather than reformatting the locked paragraph.
      if (insideContentLock(paragraphId)) return false;
      const indent = resolvedIndent(paragraphId);
      if (indent.left === 0 && indent.firstLine === 0 && !indent.inChars) return false;
      const left = steppedLeft(paragraphId, indent);
      const leavesStyle = deps.listStyle.clearOp(paragraphId) !== null;
      const style = deps.listNumbering.styleIndent(paragraphId, leavesStyle);
      const direct = directParagraphProperties(deps.storyPart(), paragraphId);
      const authored = direct.find((property) => property.localName === 'ind')?.attributes;
      const attributes: Record<string, string> = { ...(authored ?? {}) };
      for (const name of [...LEADING_ATTRIBUTES, ...FIRST_LINE_ATTRIBUTES]) delete attributes[name];
      if (left !== 0 || style.left !== 0 || style.leftInChars) attributes.left = String(left);
      if (style.leftInChars) attributes.leftChars = '0';
      if (style.firstLine !== 0 || style.inChars) attributes.firstLine = '0';
      if (style.inChars) attributes.firstLineChars = '0';
      const kept = direct.filter(
        (property) =>
          property.localName !== 'ind' && !(leavesStyle && property.localName === 'pStyle')
      );
      // An indent this write cannot reach (a table style's, a level without a marker, or the
      // earlier properties the Original view paints) leaves nothing to remove: join instead.
      if (!leavesStyle && sameAttributes(attributes, authored ?? {})) return false;
      const ind = Object.keys(attributes).length > 0 ? [{ localName: 'ind', attributes }] : [];
      // A refused write still answers true, as in `removeListNumber`: the key is spent on the
      // refusal rather than joining the paragraph the user asked to keep.
      deps.commitOps([
        { op: 'setParagraphProperties', paragraphId, properties: [...kept, ...ind] },
      ]);
      return true;
    },
  };
}

function sameAttributes(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const names = Object.keys(left);
  return (
    names.length === Object.keys(right).length && names.every((name) => left[name] === right[name])
  );
}

export type ListExitMethods = ReturnType<typeof createListExit>;

/** Commit `ops` through a lane's commit, reporting whether the transaction landed. */
export function commitListOps(
  commit: (run: () => TreeApplyResult | boolean) => void,
  apply: (ops: TreeDocOp[]) => TreeApplyResult,
  ops: readonly TreeDocOp[]
): boolean {
  let committed = false;
  commit(() => {
    const result = apply([...ops]);
    committed = result.committed;
    return result;
  });
  return committed;
}
