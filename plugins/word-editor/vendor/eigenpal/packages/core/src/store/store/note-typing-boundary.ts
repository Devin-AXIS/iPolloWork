// Note reference formatting belongs to the reference, not to the next character. Text typed
// after a reference takes the face of the text around it instead (`noteTypingSource`).

import { withFreshIds } from '../package/hf-lifecycle-shell.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { replaceChildren, type EditOptions, type OoxmlEditResult } from '../package/ooxml-edit.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import { NOT_INHERITED } from './mark-character-style-run.ts';
import {
  isRunPropertiesNode,
  paragraphPropertiesNodeOf,
  parentOf,
  runPropertiesNodeOf,
} from './tree-op-nodes.ts';
import { build } from './tree-op-tracked-builders.ts';
import { paragraphOffsetIndex, type OffsetSpan } from './tree-op-segments.ts';
import { isFieldChrome } from '../package/field-nodes.ts';
import { walkParagraphRuns } from './tree-op-restricted-edge.ts';

/** The canonical body-side note reference immediately before this caret, if any. */
export function noteReferenceEndingAt(paragraph: OoxmlParagraphNode, offset: number) {
  return paragraphOffsetIndex(paragraph).segments.find(
    (segment) => segment.end === offset && segment.node.kind === 'noteReference'
  );
}

interface NoteTypingRuns {
  /** Runs that can give a face, in document order. */
  readonly sources: readonly OoxmlNode[];
  /** The innermost hyperlink of each run that holds a note reference. */
  readonly referenceLinks: ReadonlyMap<string, OoxmlElement>;
}

/** One walk per paragraph revision; paragraph nodes are immutable. */
const typingRunsCache = new WeakMap<OoxmlParagraphNode, NoteTypingRuns>();

/** Text, deleted text, or a tab: what lets a run give its face. A break alone does not. */
const holdsContent = (child: OoxmlNode) =>
  child.kind === 'text' || child.kind === 'deletedText' || child.kind === 'tab';

/**
 * Runs that hold content, in document order, deleted ones included. A run that holds a note
 * reference or field chrome does not count. Runs inside a drawing's text box have no offsets
 * in the paragraph, so the search below skips them.
 */
function noteTypingRunsOf(paragraph: OoxmlParagraphNode): NoteTypingRuns {
  const cached = typingRunsCache.get(paragraph);
  if (cached) return cached;
  const sources: OoxmlNode[] = [];
  const referenceLinks = new Map<string, OoxmlElement>();
  walkParagraphRuns(paragraph, (run, { hyperlink }) => {
    const { children } = run;
    if (children.some((child) => child.kind === 'noteReference')) {
      if (hyperlink) referenceLinks.set(run.id, hyperlink);
    } else if (children.some(holdsContent) && !children.some(isFieldChrome)) {
      sources.push(run);
    }
  });
  const runs = { sources, referenceLinks };
  typingRunsCache.set(paragraph, runs);
  return runs;
}

/**
 * Where text typed at `offset` after a note reference takes its face from:
 * - `run`: the nearest run before the caret that holds content, past any note references, or
 *   else the first such run after it. Deleted text and tabs count; a break alone does not.
 * - `paragraphMark`: the paragraph has no such run.
 * - `none`: the reference ends a hyperlink. The text lands after the link and takes no face,
 *   neither from inside the link nor from around it.
 */
export type NoteTypingSource =
  | { readonly kind: 'run'; readonly run: OoxmlNode }
  | { readonly kind: 'paragraphMark' }
  | { readonly kind: 'none' };

const PARAGRAPH_MARK: NoteTypingSource = { kind: 'paragraphMark' };
const NO_FACE: NoteTypingSource = { kind: 'none' };

/** The face source for text typed at `offset`, right after a note reference. */
export function noteTypingSource(paragraph: OoxmlParagraphNode, offset: number): NoteTypingSource {
  const offsets = paragraphOffsetIndex(paragraph);
  const { sources, referenceLinks } = noteTypingRunsOf(paragraph);
  const reference = noteReferenceEndingAt(paragraph, offset);
  const link = reference ? referenceLinks.get(reference.runId) : undefined;
  if (link && offsets.spanOf(link)?.end === offset) return NO_FACE;
  let before: OoxmlNode | null = null;
  for (const run of sources) {
    const span = offsets.spanOf(run);
    if (span === null || span.start === span.end) continue;
    if (span.end <= offset) before = run;
    else if (span.start >= offset) return { kind: 'run', run: before ?? run };
  }
  return before ? { kind: 'run', run: before } : PARAGRAPH_MARK;
}

/** The source run of {@link noteTypingSource}, or `null` when the face comes from no run. */
export function noteTypingSourceRun(
  paragraph: OoxmlParagraphNode,
  offset: number
): OoxmlNode | null {
  const source = noteTypingSource(paragraph, offset);
  return source.kind === 'run' ? source.run : null;
}

/**
 * The offsets of the source run, for a reader that resolves formatting by offset; `null` for
 * the paragraph mark, `undefined` when typing takes no face.
 */
export function noteTypingSourceRange(
  paragraph: OoxmlParagraphNode,
  offset: number
): OffsetSpan | null | undefined {
  const source = noteTypingSource(paragraph, offset);
  if (source.kind === 'none') return undefined;
  return source.kind === 'run' ? paragraphOffsetIndex(paragraph).spanOf(source.run) : null;
}

/**
 * The run properties for text typed at `offset` after a note reference, from
 * {@link noteTypingSource}. Never the reference's own run properties, and never revision or
 * hidden-text properties, so a deleted source run gives its face without its deletion.
 */
export function noteTypingProperties(
  paragraph: OoxmlParagraphNode,
  offset: number,
  mint: () => string
): OoxmlNode[] {
  const source = noteTypingSource(paragraph, offset);
  if (source.kind === 'none') return [];
  const holder = source.kind === 'run' ? source.run : paragraphPropertiesNodeOf(paragraph);
  const properties = holder ? runPropertiesNodeOf(holder) : undefined;
  if (!properties) return [];
  const children = properties.children.filter(
    (node) =>
      node.kind === 'textValue' ||
      node.namespaceUri !== WML_NAMESPACE_URI ||
      !NOT_INHERITED.has(node.localName)
  );
  return children.length ? [withFreshIds({ ...properties, children } as OoxmlNode, mint)] : [];
}

/** Split a shared reference run without changing its reference or remaining text. */
export function insertAfterNoteInRun(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  run: OoxmlNode,
  index: number,
  nodes: readonly OoxmlNode[],
  mint: () => string,
  options?: EditOptions
): OoxmlEditResult | null {
  const parent = parentOf(part, run.id);
  if (!parent || run.kind !== 'run') return null;
  const head = { ...run, children: run.children.slice(0, index) } as OoxmlNode;
  const remaining = run.children.slice(index);
  const tail = remaining.length
    ? [
        {
          ...run,
          id: mint(),
          children: [
            ...run.children.filter(isRunPropertiesNode).map((node) => withFreshIds(node, mint)),
            ...remaining,
          ],
        } as OoxmlNode,
      ]
    : [];
  const inserted = build(
    mint(),
    'run',
    'r',
    [],
    [...noteTypingProperties(paragraph, offset, mint), ...nodes]
  );
  return replaceChildren(
    part,
    parent.id,
    parent.children.flatMap((child) => (child.id === run.id ? [head, inserted, ...tail] : [child])),
    options
  );
}
