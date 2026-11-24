// Where an unowned insertion lands at the edge of a control that typing cannot enter.
//
// Kept apart from `tree-op-segments.ts`, which resolves every other insertion site, and
// imports only its types: the segments module passes in the offset index it already built.

import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { isFieldChrome } from '../package/field-nodes.ts';
import { inlineContainersOf, isContentControlNode, refusesTypedContent } from './tree-op-nodes.ts';
import type { InsertionSite, ParagraphOffsetIndex } from './tree-op-segments.ts';

/**
 * An unowned insertion at the OUTER EDGE of an inline content control that typing can never
 * enter ({@link refusesTypedContent}) lands beside the control.
 *
 * The default rule gives a leading edge to the run that starts there, which is inside the
 * control. For a locked or bound control that place refuses every keystroke, so a locked
 * control at the start of a paragraph, or right after another one, left no position before it
 * to type at; a checkbox took the keystroke into its glyph. The trailing edge already lands
 * outside. A text control keeps the default, because typing at its start fills it in.
 *
 * Only the outermost such control whose edge is `offset` is left. A restriction on a
 * control that encloses the whole paragraph still refuses the edit, as it should.
 */
export function besideRestrictedControl(
  paragraph: OoxmlParagraphNode,
  offset: number,
  landingId: string,
  offsets: ParagraphOffsetIndex
): InsertionSite | null {
  // Most paragraphs hold no control, and this runs on every unowned keystroke.
  if (!holdsContentControl(paragraph)) return null;
  const landing = landingId === paragraph.id ? null : findWithin(paragraph, landingId);
  const enclosing = [
    ...(landing && landing.kind !== 'textValue' ? [landing] : []),
    ...inlineContainersOf(paragraph, landingId),
  ];
  const control = enclosing
    .filter((node) => {
      if (!isContentControlNode(node) || !refusesTypedContent(node)) return false;
      const span = offsets.spanOf(node);
      return span !== null && (span.start === offset || span.end === offset);
    })
    .at(-1);
  if (!control) return null;
  const span = offsets.spanOf(control)!;
  const holder = parentWithin(paragraph, control.id) ?? paragraph;
  const index = holder.children.findIndex((child) => child.id === control.id);
  if (index < 0) return null;
  if (span.end === offset && span.start !== offset) {
    return { kind: 'newRun', holder, index: index + 1 };
  }
  // Join the run that ends right before the control when it ends in plain text, so each
  // keystroke there does not mint a run of its own. `atRunIndex`, because the applier writes
  // that kind exactly where it says; its boundary rule would hand the offset back to the
  // control. A run ending in an atom (a note reference, a drawing) or holding field chrome gets
  // a minted run instead: joining it would style the text as the atom, and removing the atom
  // would take the text with it.
  const previous = holder.children[index - 1];
  if (previous?.kind === 'run' && !previous.children.some(isFieldChrome)) {
    const last = lastSegmentEndingAt(offsets, previous.id, offset);
    if (last && last.node.kind === 'textValue' && last.removeNodeIds === undefined) {
      return { kind: 'atRunIndex', run: previous, index: previous.children.length };
    }
  }
  return { kind: 'newRun', holder, index };
}

function lastSegmentEndingAt(offsets: ParagraphOffsetIndex, runId: string, offset: number) {
  for (let index = offsets.segments.length - 1; index >= 0; index -= 1) {
    const segment = offsets.segments[index]!;
    if (segment.runId === runId && segment.end === offset) return segment;
  }
  return undefined;
}

const holdsControl = new WeakMap<OoxmlParagraphNode, boolean>();

/** Whether any content control sits inside the paragraph. Paragraph nodes are immutable. */
export function holdsContentControl(paragraph: OoxmlParagraphNode): boolean {
  let held = holdsControl.get(paragraph);
  if (held === undefined) {
    const walk = (node: OoxmlNode): boolean =>
      node.kind !== 'textValue' && (isContentControlNode(node) || node.children.some(walk));
    held = paragraph.children.some(walk);
    holdsControl.set(paragraph, held);
  }
  return held;
}

function findWithin(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.id === id) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findWithin(child, id);
    if (found) return found;
  }
  return null;
}

function parentWithin(parent: OoxmlElement, id: string): OoxmlElement | null {
  for (const child of parent.children) {
    if (child.id === id) return parent;
    if (child.kind === 'textValue') continue;
    const found = parentWithin(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Every control in the paragraph that typing cannot enter and whose content starts or ends at
 * `offset`, wrapped in a revision or a hyperlink or not.
 */
export function restrictedControlsWithEdgeAt(
  paragraph: OoxmlParagraphNode,
  offset: number,
  offsets: ParagraphOffsetIndex
): OoxmlElement[] {
  return restrictedControlsIn(paragraph).filter((node) => {
    const span = offsets.spanOf(node);
    return span !== null && (span.start === offset || span.end === offset);
  });
}

/** Every control in the paragraph that typing cannot enter, outermost first. */
function restrictedControlsIn(paragraph: OoxmlParagraphNode): readonly OoxmlElement[] {
  return typingSourcesOf(paragraph).restricted;
}

interface TypingSources {
  /** Controls that typing cannot enter, outermost first. */
  readonly restricted: readonly OoxmlElement[];
  /** Plain text runs outside every such control and every deletion, in document order. */
  readonly textRuns: readonly OoxmlNode[];
}

const typingSources = new WeakMap<OoxmlParagraphNode, TypingSources>();

/** Where a run sits in its paragraph, as {@link walkParagraphRuns} reports it. */
export interface RunPlacement {
  /** Inside a control that typing cannot enter. */
  readonly inRestricted: boolean;
  /** Inside a tracked deletion or the source of a tracked move. */
  readonly inDeletion: boolean;
  /** The innermost hyperlink that holds the run, if any. */
  readonly hyperlink: OoxmlElement | null;
}

/**
 * Visit every run of a paragraph in document order, with where it sits, and every control
 * that typing cannot enter, outermost first. The one walk the typing-source readers share.
 */
export function walkParagraphRuns(
  paragraph: OoxmlParagraphNode,
  onRun: (run: OoxmlElement, placement: RunPlacement) => void,
  onRestricted?: (control: OoxmlElement) => void
): void {
  const walk = (node: OoxmlNode, placement: RunPlacement): void => {
    if (node.kind === 'textValue') return;
    const restrictsTyping = isContentControlNode(node) && refusesTypedContent(node);
    if (restrictsTyping) onRestricted?.(node);
    if (node.kind === 'run') onRun(node, placement);
    const deletes = node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom';
    const inner =
      restrictsTyping || deletes || node.kind === 'hyperlink'
        ? {
            inRestricted: placement.inRestricted || restrictsTyping,
            inDeletion: placement.inDeletion || deletes,
            hyperlink: node.kind === 'hyperlink' ? node : placement.hyperlink,
          }
        : placement;
    for (const child of node.children) walk(child, inner);
  };
  const top: RunPlacement = { inRestricted: false, inDeletion: false, hyperlink: null };
  for (const child of paragraph.children) walk(child, top);
}

/** One walk per paragraph revision; paragraph nodes are immutable. */
function typingSourcesOf(paragraph: OoxmlParagraphNode): TypingSources {
  const cached = typingSources.get(paragraph);
  if (cached) return cached;
  const restricted: OoxmlElement[] = [];
  const textRuns: OoxmlNode[] = [];
  if (holdsContentControl(paragraph)) {
    walkParagraphRuns(
      paragraph,
      (run, { inRestricted, inDeletion }) => {
        if (
          !inRestricted &&
          !inDeletion &&
          run.children.some((child) => child.kind === 'text') &&
          !run.children.some(isFieldChrome)
        ) {
          textRuns.push(run);
        }
      },
      (control) => restricted.push(control)
    );
  }
  const sources = { restricted, textRuns };
  typingSources.set(paragraph, sources);
  return sources;
}

/**
 * The run whose formatting typed text takes at the OUTER edge of a control that typing cannot
 * enter.
 *
 * Text typed there lands beside the control ({@link besideRestrictedControl}), so it must not
 * look like the control. The ordinary rule takes the run to the left, which at a control's
 * trailing edge is the control's own run: a citation styled bold and colored at the end of a
 * paragraph passed that style to every word typed after it, and at the start of a paragraph
 * typed text lost the formatting of the words beside it.
 *
 * The source is a plain text run outside every such control and every deletion: the one that
 * starts at `offset`, else the nearest one before it, else the nearest one after it. An atom
 * (a field, a note reference, a drawing) or struck text is never the source.
 *
 * `undefined` when the ordinary rule applies: no such control has an edge at `offset`, or the
 * content to the left is outside it. `null` when no text run qualifies: the text gets no direct
 * formatting. One answer for the store's insertion and for the caret formatting the toolbar
 * reports, so the two agree.
 */
export function formattingRunBesideRestrictedControl(
  paragraph: OoxmlParagraphNode,
  offset: number,
  offsets: ParagraphOffsetIndex
): OoxmlNode | null | undefined {
  const { restricted, textRuns } = typingSourcesOf(paragraph);
  if (restricted.length === 0) return undefined;
  const edges = restricted.filter((node) => {
    const span = offsets.spanOf(node);
    return span !== null && (span.start === offset || span.end === offset);
  });
  if (edges.length === 0) return undefined;
  const segments = offsets.segments;
  let left: (typeof segments)[number] | undefined;
  let right: (typeof segments)[number] | undefined;
  for (const segment of segments) {
    if (segment.start === segment.end) continue;
    if (segment.end === offset) left = segment;
    if (segment.start === offset && right === undefined) right = segment;
  }
  const inEdgeControl = (nodeId: string) =>
    edges.some((control) => findWithin(control, nodeId) !== null);
  const beside = left ?? right;
  if (!beside || !inEdgeControl(beside.node.id)) return undefined;
  let before: OoxmlNode | undefined;
  let after: OoxmlNode | undefined;
  for (const run of textRuns) {
    const span = offsets.spanOf(run);
    if (span === null || span.start === span.end) continue;
    if (span.start === offset) return run;
    if (span.end <= offset) before = run;
    else if (span.start > offset) {
      after = run;
      break;
    }
  }
  return before ?? after ?? null;
}
