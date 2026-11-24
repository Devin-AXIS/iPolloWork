// Which paragraphs a tracked revision removes from the laid-out document.
//
// A `w:del` on the paragraph MARK (17.13.5.15, `w:pPr/w:rPr/w:del`) says the mark itself was
// deleted, which in Word joins the paragraph to the one after it. When everything the
// paragraph would have rendered is deleted too, that join leaves nothing at all — Word shows
// no line where the paragraph was.
//
// Layout does not render deleted run content (a `w:del` is not a run container it walks, and
// `w:delText` is not model text), so such a paragraph reaches pagination with no spans and
// still claims a full line box. A cell of them is a stack of blank lines that pushes real
// content down the page and off it. This module identifies exactly that case.
//
// The narrow condition matters. A paragraph whose CONTENT is deleted but whose mark survives
// is a paragraph Word still shows as empty, and suppressing it would delete a blank line the
// document really has. A paragraph whose mark is deleted but which still renders something
// has to keep its box, because that content is visible and Word merely merges it forward —
// dropping it would lose text. Only the intersection is removed.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import {
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  readOnOffChild,
} from '../store/package/ooxml-shared.ts';
import {
  contentControlContentOf,
  isContentControl,
} from '../store/package/content-control-walk.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import {
  isRevisionWrapper,
  paragraphMarkRevisionsOf,
  revisionAttributionOf,
  revisionProjectionMode,
  revisionsVisible,
  withRevision,
  revisionFilterSelects,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

/**
 * Matches the layout walk's own container recursion; see `piecesOfParagraph`.
 *
 * Taken FROM that walk rather than restated. At a local 8 against layout's 32, a paragraph
 * nested past 8 was called empty here while layout still emitted its spans — so file-
 * controlled nesting, which costs an attacker nothing, dropped visible text from the page.
 */
/**
 * A child in the WordprocessingML namespace, by name.
 *
 * The namespace is the difference between a revision and a look-alike. A `.docx` is a zip of
 * XML the sender controls, so an `<x:del/>` sitting in the paragraph mark's `w:rPr` is markup
 * anyone can author — and matching on the local name alone let it merge two paragraphs in the
 * default view, a join no decision in the file can produce and no Accept can undo.
 */
function wmlChildNamed(node: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * `w:pPr/w:rPr/w:del` or `w:moveFrom` — a tracked revision REMOVES the paragraph mark.
 *
 * Both say the break goes away once the decision is taken: a deletion outright, a `moveFrom`
 * because the paragraph left this place for another. Read from the paragraph-mark run
 * properties only. A `w:del` anywhere else in the paragraph deletes run content, which is a
 * different statement entirely.
 */
export function paragraphMarkDeleted(paragraph: OoxmlNode): boolean {
  if (paragraph.kind === 'textValue') return false;
  const properties =
    wmlChildNamed(paragraph, 'paragraphProperties') ?? wmlChildNamed(paragraph, 'pPr');
  if (!properties) return false;
  const markRunProperties =
    wmlChildNamed(properties, 'runProperties') ?? wmlChildNamed(properties, 'rPr');
  if (markRunProperties === undefined) return false;
  return (
    wmlChildNamed(markRunProperties, 'del') !== undefined ||
    wmlChildNamed(markRunProperties, 'moveFrom') !== undefined
  );
}

/**
 * Whether the paragraph would put any text on the page.
 *
 * Judged in the view this suppression MODELS: the one where the mark deletion has been
 * accepted and the paragraph joined the next. There, deleted content is gone and inserted
 * content stays, so `w:del` and `w:moveFrom` render nothing while `w:ins` and `w:moveTo` are
 * descended into like any other run container — as is `w:hyperlink`, and either can hold the
 * other. Inline content controls flatten the same way layout does.
 *
 * Not mode-parameterised on purpose. `storyBlocks` is indexed by section addressing, so a
 * block list that changed shape with the display mode would move section boundaries under it.
 *
 * Descending into insertions is load-bearing: a paragraph whose mark is struck and whose
 * content is an insertion is Word's shape for "this line was added, then merged upward", and
 * treating its content as unrendered dropped the added words from every mode.
 *
 * `skipHiddenRuns` also treats a run whose DIRECT `w:rPr` sets `w:vanish` as rendering nothing.
 * Direct formatting decides the toggle outright, so that answer needs no style cascade; a run
 * hidden only through a style still counts as rendering, which keeps its line.
 */
function rendersNoText(
  node: OoxmlNode,
  depth: number,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  revisions: readonly RevisionAttribution[] = [],
  skipHiddenRuns = false
): boolean {
  if (node.kind === 'textValue') return true;
  // Past the cap the strict walk cannot see the content, so it assumes some is there.
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return !skipHiddenRuns;
  const walkChildren = (children: readonly OoxmlNode[], childDepth: number): boolean => {
    for (const child of children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'run') {
        if (skipHiddenRuns && runDirectlyHidden(child)) continue;
        for (const grand of child.children) {
          if (grand.kind === 'text') {
            for (const value of grand.children) {
              if (value.kind === 'textValue' && value.value.length > 0) return false;
            }
            continue;
          }
          // A tab, a break, or a drawing all occupy the line even with no characters. Anything
          // unrecognised counts as rendering too: keeping a paragraph that renders nothing
          // costs a blank line, dropping one that renders something loses content.
          if (grand.kind !== 'runProperties') return false;
        }
        continue;
      }
      if (isContentControl(child)) {
        if (childDepth + 1 >= MAX_INLINE_CONTAINER_DEPTH) {
          if (skipHiddenRuns) return false;
          continue;
        }
        const content = contentControlContentOf(child);
        if (content && !walkChildren(content, childDepth + 1)) return false;
        continue;
      }
      if (isInlineRunContainer(child) && !isRevisionWrapper(child)) {
        if (
          !rendersNoText(
            child,
            childDepth + 1,
            displayMode,
            authorFilter,
            revisions,
            skipHiddenRuns
          )
        )
          return false;
        continue;
      }
      if (!isRevisionWrapper(child)) {
        // The strict walk refuses to call an unknown element empty: math, a field wrapper it
        // does not descend, or anything a later schema adds may well draw something.
        if (skipHiddenRuns && !isInertParagraphChild(child)) return false;
        continue;
      }
      const attribution = revisionAttributionOf(child);
      if (!attribution) continue;
      const local = withRevision(revisions, attribution);
      if (!revisionsVisible(local, displayMode, authorFilter)) continue;
      if (!rendersNoText(child, childDepth + 1, displayMode, authorFilter, local, skipHiddenRuns))
        return false;
    }
    return true;
  };
  return walkChildren(node.children, depth);
}

/** Paragraph children that never draw anything: properties, and range and proofing markers. */
const INERT_PARAGRAPH_CHILDREN = new Set([
  'pPr',
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'permStart',
  'permEnd',
  'proofErr',
]);

function isInertParagraphChild(node: OoxmlElement): boolean {
  if (node.kind === 'paragraphProperties') return true;
  return node.namespaceUri === WML_NAMESPACE_URI && INERT_PARAGRAPH_CHILDREN.has(node.localName);
}

/** A run whose own `w:rPr` sets `w:vanish` on. */
function runDirectlyHidden(run: OoxmlElement): boolean {
  const properties = run.children.find((child) => child.kind === 'runProperties');
  return properties !== undefined && readOnOffChild(properties, 'vanish');
}

/**
 * Would this paragraph put anything visible on the page in this display mode?
 *
 * The {@link revisionRemovesParagraph} walk, with directly hidden runs counted as rendering
 * nothing too. Unrecognised content still counts as rendering.
 */
export function paragraphRendersNothingVisible(
  paragraph: OoxmlNode,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  return rendersNoText(paragraph, 0, displayMode, authorFilter, [], true);
}

/**
 * Does this display mode REMOVE the paragraph's mark, and with it the break it draws?
 *
 * A mark records a break that a decision would take away. `proposed` answers what the document
 * becomes when every decision is accepted, so a deleted or moved-from mark is gone there;
 * `original` answers what it was before any of them, so an inserted or moved-to mark is gone
 * there. `all-markup` takes no decision and removes nothing.
 *
 * The paragraph then runs into the one after it, which is exactly what `resolveRevisions` does
 * with the same four elements.
 */
export function markRemovedInMode(
  paragraph: OoxmlNode,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  if (displayMode === 'all-markup' && !revisionFilterSelects(authorFilter)) return false;
  for (const revision of paragraphMarkRevisionsOf(paragraph)) {
    const effectiveMode = authorFilter
      ? revisionProjectionMode(authorFilter, revision, displayMode)
      : displayMode;
    if (effectiveMode === 'all-markup') continue;
    const removes = revision.kind === 'delete' || revision.kind === 'moveFrom';
    if ((effectiveMode === 'proposed' && removes) || (effectiveMode === 'original' && !removes))
      return true;
  }
  return false;
}

/**
 * True when a tracked revision has removed this paragraph from the rendered document, so
 * layout should emit no box for it at all.
 */
export function revisionRemovesParagraph(
  paragraph: OoxmlNode,
  displayMode: RevisionDisplayMode = 'proposed',
  authorFilter?: RevisionAuthorFilter
): boolean {
  if (paragraph.kind !== 'paragraph') return false;
  // ORIGINAL rejects every revision, so the mark deletion is rejected too and the paragraph
  // stays — with the words its `w:del` was hiding. ALL-MARKUP shows the deletion struck
  // through, which is also a line. Only the PROPOSED result actually performs the join, and
  // it is the only view this suppression describes.
  if (!markRemovedInMode(paragraph, displayMode, authorFilter)) return false;
  return rendersNoText(paragraph, 0, displayMode, authorFilter);
}
