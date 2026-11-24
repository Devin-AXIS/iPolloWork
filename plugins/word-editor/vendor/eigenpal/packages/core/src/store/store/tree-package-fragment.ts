// Fragment-paste intent: resource merge + `insertFragment` in ONE story transaction,
// promoted to a package undo unit (rich-clipboard-fidelity task 2.2, pattern from
// tree-package-images.ts). Undo reverts the tree and the imported styles, numbering,
// media, rels and note parts together — a story-only undo would strand the resources.
//
// The story store commits the write. Capture must be armed on the package store, the
// same way `addPackageComment` does: `storyStore.transact` alone never entered
// `runObservedStoreTransaction`, so a paste produced no primitive journal and a peer
// never saw the blocks or the imported parts.

import {
  packageTransactionPublished,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { withoutStoryEndParagraph } from '../package/ooxml-story-end-repair.ts';
import { mergeFragmentIntoPackage, type FragmentMergeResult } from './clipboard-fragment-merge.ts';
import {
  MAX_FRAGMENT_DEPTH,
  MAX_FRAGMENT_INSERT_BLOCKS,
  MAX_FRAGMENT_NODES,
} from './tree-op-fragment.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphLength } from './tree-op-segments.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { storyParagraphs, storyRootsOf } from '../package/story-blocks.ts';
import type { PackageTransactResult, StoryScope, TreePackageStore } from './tree-package-store.ts';
import type { TreeDocOp } from './tree-op-types.ts';
import type { RevisionAttributionInput } from './tree-op-validate.ts';
import { trackedFragment } from './clipboard-fragment-tracked.ts';

/** Decoded fragment payloads above this cap are refused before any package work. */
export const MAX_FRAGMENT_DECODED_BYTES = 16 * 1024 * 1024;

export interface FragmentPasteInput {
  readonly paragraphId: string;
  readonly offset: number;
  /** The fragment package zip (from the clipboard codec or the HTML projection). */
  readonly fragmentBytes: Uint8Array;
  readonly lastMarkCovered: boolean;
  /** Ops that clear the current selection first (the surface's deleteSelectionPlan). */
  readonly priorOps?: readonly TreeDocOp[];
  /**
   * Collaboration actor for the ids this paste mints.
   *
   * A paste freshens three package-wide namespaces — bookmark `@w:id`, revision `@w:id` and
   * `wp:docPr/@id` — and the merge reads the actor off the open transaction. Without one, two
   * replicas pasting the same fragment from one snapshot mint the same numbers, and only the
   * merged document shows it. Omitted (solo) keeps Word's dense sequences.
   */
  readonly actorId?: string;
  /**
   * Suggesting mode: the author and date the whole paste is proposed under, as one tracked
   * insertion (`trackedFragment`). The caller tracks `priorOps` itself.
   */
  readonly revision?: RevisionAttributionInput;
}

/**
 * The end of the pasted content: where Word leaves the caret after a paste.
 *
 * The id names a paragraph the story holds after the change published, including when a
 * collaboration session re-keyed the paragraphs that the paste created.
 */
export interface FragmentPasteEnd {
  /** The paragraph that holds the end: the host's trailing text follows it. */
  readonly paragraphId: string;
  /** The UTF-16 offset in that paragraph, just after the last pasted unit. */
  readonly offset: number;
}

export type FragmentPasteResult =
  | (Extract<PackageTransactResult, { ok: true }> & {
      readonly blockCount: number;
      /**
       * Where the pasted content ends. Absent when the paste changed nothing, or when the
       * story no longer holds the paragraph that the paste ended in.
       */
      readonly end?: FragmentPasteEnd;
    })
  | Extract<PackageTransactResult, { ok: false }>;

/**
 * One early-exit walk over the fragment against the insertFragment budgets.
 *
 * Bounds the BODY blocks/nodes/depth AND the total node count across the resource parts
 * (styles, numbering, notes) the merge walks and re-serializes. A body-only budget let a
 * fragment ship a near-max styles.xml under a one-block body — the merge then paid a
 * multi-second linear pass no cap rejected.
 */
function withinFragmentBudget(fragment: OoxmlPackage): boolean {
  const doc = fragment.parts.get(fragment.mainDocumentPart);
  if (!doc || doc.root.kind !== 'document') return false;
  const body = doc.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind !== 'body') return false;
  if (body.children.length > MAX_FRAGMENT_INSERT_BLOCKS) return false;

  let total = 0;
  const walk = (node: OoxmlNode, depth: number, maxDepth: number): boolean => {
    if (depth > maxDepth) return false;
    total += 1;
    if (total > MAX_FRAGMENT_NODES) return false;
    if (node.kind === 'textValue') return true;
    for (const child of node.children) {
      if (!walk(child, depth + 1, maxDepth)) return false;
    }
    return true;
  };
  for (const block of body.children) {
    if (!walk(block, 1, MAX_FRAGMENT_DEPTH)) return false;
  }
  // The resource parts share the same total-node budget (a deeper structural cap since a
  // styles/numbering tree is legitimately deeper than body blocks).
  for (const [name, part] of fragment.parts) {
    if (name === fragment.mainDocumentPart) continue;
    if (!/\/(styles|numbering|footnotes|endnotes)\.xml$/.test(name)) continue;
    if (!walk(part.root, 1, MAX_FRAGMENT_DEPTH * 4)) return false;
  }
  return true;
}

/**
 * Read the fragment through the bounded file-open trust boundary, merge its resources,
 * and land its blocks — all inside one transaction. Any refusal leaves the document
 * exactly as it was; the caller (the paste router) degrades to the next flavour.
 */
export function applyFragmentPaste(
  store: TreePackageStore,
  scope: StoryScope,
  input: FragmentPasteInput
): FragmentPasteResult {
  if (input.fragmentBytes.byteLength > MAX_FRAGMENT_DECODED_BYTES) {
    return { ok: false, reason: 'invalidArgs', detail: 'fragment-too-large' };
  }
  const read = readOoxmlPackage(input.fragmentBytes);
  if (!read.ok) {
    return { ok: false, reason: 'invalidArgs', detail: `fragment-read:${read.reason}` };
  }
  const blocks = withoutStoryEndParagraph(read.package);
  const proposed = input.revision ? trackedFragment(blocks, input.revision) : blocks;
  if (!proposed) return { ok: false, reason: 'invalidArgs', detail: 'fragment-untrackable' };
  const fragment: OoxmlPackage = proposed;

  // The insert budgets, applied BEFORE the merge: `insertFragment` would refuse an
  // oversized fragment anyway, but only after the merge had already walked the whole
  // decompressed envelope a dozen times. One bounded pass here rejects it first.
  if (!withinFragmentBudget(fragment)) {
    return { ok: false, reason: 'invalidArgs', detail: 'fragment-over-budget' };
  }

  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const { store: storyStore, story } = resolved;
  if (storyStore.compositionActive || store.compositionSessionOpen()) {
    return { ok: false, reason: 'invalidArgs', detail: 'ime-composition-active' };
  }

  const beforePackage = store.currentPackage();
  const checkpoint = storyStore.checkpoint();
  // The working package starts at the coordinator's truth, as `transact` does: shell writes
  // (a list the toolbar just created, a remote install) never reach the story store's own
  // copy, and the promotion below installs the committed package as it stands.
  storyStore.graftPackage(() => store.currentPackage());
  let blockCount = 0;
  let refusalDetail = '';
  let tailDistance: number | null = null;

  const outcome: FragmentPasteResult = runObservedStoreTransaction(
    store,
    () => {
      const result = storyStore.transact(
        (ctx) => {
          for (const op of input.priorOps ?? []) {
            if (!ctx.apply(op)) return;
          }
          // The merge MUST run against the transaction's WORKING package — the one the
          // selection-clearing ops above just edited. Merging from `store.currentPackage()`
          // (the pre-transaction snapshot) and replacing the working package wholesale threw
          // those deletions away, so a rich paste over a selection kept the old content.
          let merged: FragmentMergeResult | null = null;
          const packageApplied = ctx.applyPackage((current) => {
            merged = mergeFragmentIntoPackage(current, fragment, story.partName);
            return merged.ok ? merged.pkg : current;
          });
          const landed = merged as FragmentMergeResult | null;
          if (!landed || !landed.ok) {
            refusalDetail = `fragment-merge:${landed ? landed.reason : 'no-merge'}`;
            // Poison the transaction so nothing commits.
            ctx.apply({ op: 'insertText', paragraphId: '\0fragment-abort', offset: 0, text: 'x' });
            return;
          }
          if (!packageApplied) return;
          blockCount = landed.blocks.length;
          if (
            !ctx.apply({
              op: 'insertFragment',
              paragraphId: input.paragraphId,
              offset: input.offset,
              blocks: landed.blocks,
              lastMarkCovered: input.lastMarkCovered,
            })
          ) {
            return;
          }
          // A fragment that opens with a table (or another block) splits the host paragraph,
          // and the head keeps a copy of the host mark: a NEW mark, which a suggested paste
          // proposes like its own. Opening with a paragraph, the head takes that one's mark.
          if (input.revision && landed.blocks[0]?.kind !== 'paragraph') {
            ctx.apply({
              op: 'setParagraphMarkRevision',
              paragraphId: input.paragraphId,
              kind: 'ins',
              revision: input.revision,
            });
          }
        },
        {
          story,
          // THE BINDING THAT REACHES THE MINT. `transact` wraps the whole synchronous build in
          // `runWithTransactionActor`, and the build is where the merge takes its bookmark,
          // revision and `docPr` ids.
          ...(input.actorId ? { actorId: input.actorId } : {}),
        }
      );

      if (refusalDetail.length > 0) {
        return { ok: false as const, reason: 'invalidArgs' as const, detail: refusalDetail };
      }
      if (!result.ok) {
        return {
          ok: false as const,
          reason: result.reason,
          ...(result.detail ? { detail: result.detail } : {}),
        };
      }
      if (!result.change) return { ok: true as const, change: null, blockCount };

      // `insertFragment` commits the paste end as the story change's caret. The package
      // unit below publishes a synthetic change without one, so it travels on the result.
      const caret = result.change.caret;
      const end = caret ? { paragraphId: caret.paragraphId, offset: caret.start } : undefined;
      if (end)
        tailDistance = paragraphDistance(storyStore.part, input.paragraphId, end.paragraphId);
      const change = store.promoteStoryTransactionToPackageUnit(
        beforePackage,
        storyStore,
        checkpoint
      );
      return { ok: true as const, change, blockCount, ...(end ? { end } : {}) };
    },
    (outcome) => packageTransactionPublished(outcome)
  );
  if (!outcome.ok || !outcome.end) return outcome;
  const { end: transactionEnd, ...rest } = outcome;
  // Resolved again: a collaboration publish can install a new story store for the part.
  const published = store.resolveStory(scope);
  const end = publishedPasteEnd(
    transactionEnd,
    input.paragraphId,
    tailDistance,
    published.ok ? published.store.part : null
  );
  return end ? { ...rest, end } : rest;
}

/** The paragraphs of every story in a part, in the order the editor addresses them. */
function paragraphIdsOf(part: OoxmlPart): readonly string[] {
  return storyRootsOf(part).flatMap((story) => storyParagraphs(story.root).map((node) => node.id));
}

/** How many paragraphs `to` follows `from` by, or null when either is missing. */
function paragraphDistance(part: OoxmlPart, from: string, to: string): number | null {
  if (from === to) return 0;
  const ids = paragraphIdsOf(part);
  const start = ids.indexOf(from);
  const end = ids.indexOf(to);
  return start === -1 || end === -1 ? null : end - start;
}

/**
 * The paste end in the ids the story holds after the change published.
 *
 * A collaboration session re-keys the paragraphs a paste creates when it publishes the change,
 * so the transaction's id for the landing paragraph can be gone, or name another node. The host
 * paragraph keeps its id, and every paragraph between it and the landing paragraph is pasted
 * content, so the landing paragraph is the same distance after the host.
 */
function publishedPasteEnd(
  end: FragmentPasteEnd,
  hostId: string,
  distance: number | null,
  after: OoxmlPart | null
): FragmentPasteEnd | undefined {
  if (!after || distance === null) return undefined;
  let paragraphId: string | undefined = hostId;
  if (distance > 0) {
    const ids = paragraphIdsOf(after);
    const host = ids.indexOf(hostId);
    paragraphId = host === -1 ? undefined : ids[host + distance];
  }
  if (paragraphId === undefined) return undefined;
  const node = findNode(after, paragraphId);
  if (!node || node.kind !== 'paragraph') return undefined;
  const length = paragraphLength(node as OoxmlParagraphNode);
  return { paragraphId, offset: Math.min(end.offset, length) };
}
