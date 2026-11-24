// The review queue's paragraph order over every story, kept across text-only commits.

import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  deepParagraphOrderOfPart,
  findNode,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';

/**
 * Paragraph id to document position over EVERY story the review queue lists — body
 * first, then each furniture part — memoized per package revision and body root.
 *
 * Deliberately NOT the open story's scoped order: `rangeCovers` looks the caret's and an
 * item's paragraphs up here, and an id the index cannot see is an item that can never
 * become active. Scoping to the open story made every header item unactivatable from
 * the body, every body item unactivatable while a header was open, and every textbox
 * item unactivatable always (the shallow order stops at the host paragraph) — the DEEP
 * order descends into `w:txbxContent`. Containment only ever compares positions within
 * one story, and furniture ranks after the body, so the merge cannot invent a cover.
 */
/** A paragraph this large is rebuilt from scratch rather than walked here. */
const MAX_FLAT_CHECK_NODES = 10_000;

export function createReviewOrderIndex(
  session: Pick<
    TreeDocxSessionView,
    'packageRevision' | 'part' | 'partFor' | 'headerFooterPartsBySection'
  >
): {
  /** The index for the session's current revision. */
  index(): Map<string, number>;
  /** Called for every model change; see the note on the body. */
  retain(change: TreeModelChange): void;
} {
  let cache: {
    readonly packageRevision: number;
    readonly bodyRoot: object;
    readonly index: Map<string, number>;
    /** The other stories the index read, in order. */
    readonly otherParts: readonly OoxmlPart[];
  } | null = null;
  /** Every header, footer, and note part, in the order the index appends them. */
  const otherStoryParts = (): OoxmlPart[] => {
    const parts: OoxmlPart[] = [];
    const seen = new Set<OoxmlPart>([session.part()]);
    for (const section of session.headerFooterPartsBySection()) {
      for (const slots of [section.headers, section.footers]) {
        for (const part of slots.values()) {
          if (seen.has(part)) continue;
          seen.add(part);
          parts.push(part);
        }
      }
    }
    for (const noteKind of ['footnote', 'endnote'] as const) {
      const part = session.partFor({ kind: 'notesPart', noteKind });
      if (!part || seen.has(part)) continue;
      seen.add(part);
      parts.push(part);
    }
    return parts;
  };
  const sameParts = (left: readonly OoxmlPart[], right: readonly OoxmlPart[]): boolean =>
    left.length === right.length && left.every((part, index) => part === right[index]);
  /** Whether the body paragraph `id` exists and holds no paragraph of its own (a text box). */
  const flatParagraph = (id: string): boolean => {
    const paragraph = findNode(session.part(), id);
    if (!paragraph || paragraph.kind !== 'paragraph') return false;
    let visited = 0;
    const stack: OoxmlNode[] = [...paragraph.children];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (++visited > MAX_FLAT_CHECK_NODES) return false;
      if (node.kind === 'textValue') continue;
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') return false;
      for (const child of node.children) stack.push(child);
    }
    return true;
  };
  /**
   * Move `index` across one body split or join, in place. A split's tail follows its first
   * half directly, so every later position moves up by one; a join leaves a gap, which no
   * comparison can see. A paragraph that holds a text box is not carried, because its
   * nested paragraphs sit between it and the next one.
   */
  const carryStructure = (change: TreeModelChange, index: Map<string, number>): boolean => {
    if (change.splitJoin.length !== 1) return false;
    if (change.story !== undefined && change.story.kind !== 'body') return false;
    const entry = change.splitJoin[0]!;
    if ('split' in entry) {
      const { from, tail } = entry.split;
      const position = index.get(from);
      if (
        position === undefined ||
        index.has(tail) ||
        change.deleted.length > 0 ||
        change.created.length !== 1 ||
        change.created[0] !== tail ||
        !flatParagraph(from) ||
        !flatParagraph(tail)
      ) {
        return false;
      }
      for (const [id, at] of index) if (at > position) index.set(id, at + 1);
      index.set(tail, position + 1);
      return true;
    }
    const { kept, removed } = entry.join;
    if (
      !index.has(kept) ||
      change.created.length > 0 ||
      change.deleted.length !== 1 ||
      change.deleted[0] !== removed ||
      !flatParagraph(kept)
    ) {
      return false;
    }
    index.delete(removed);
    return true;
  };
  return {
    /**
     * Carry the index across a commit that cannot reorder paragraphs.
     *
     * The key is (package revision, body root) and a keystroke moves both, so without this the
     * memo guaranteed exactly one whole-document rebuild per keystroke — the #391 shape, in the
     * render path. A text-local commit with no created, deleted, split or joined paragraphs
     * preserves every paragraph id and their order in every story, so the index is re-stamped
     * to the values the next read will key on. A property or list commit keeps every paragraph
     * too, but a list commit follows a package-shell write of its definition, so it is carried
     * only while every other story part is still the same object. One split or join moves the
     * index in place under the same condition (`carryStructure`). Anything wider drops it, and
     * commits that bypass the subscription (a package-shell edit) leave a stale key the
     * read-side check rebuilds — the safe direction.
     */
    retain(change) {
      if (!cache) return;
      const reorders =
        change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0;
      const otherParts =
        change.impact === 'text-local' && !reorders ? cache.otherParts : otherStoryParts();
      if (
        change.impact !== 'global' &&
        (change.impact === 'text-local' || sameParts(cache.otherParts, otherParts)) &&
        (!reorders ||
          (sameParts(cache.otherParts, otherParts) && carryStructure(change, cache.index)))
      ) {
        cache = {
          packageRevision: session.packageRevision(),
          bodyRoot: session.part().root,
          index: cache.index,
          otherParts,
        };
      } else {
        cache = null;
      }
    },
    index() {
      const packageRevision = session.packageRevision();
      const bodyRoot = session.part().root;
      if (cache && cache.packageRevision === packageRevision && cache.bodyRoot === bodyRoot) {
        return cache.index;
      }
      const index = new Map<string, number>();
      const append = (order: ReadonlyMap<string, number>): void => {
        const base = index.size;
        for (const [id, position] of order) {
          if (!index.has(id)) index.set(id, base + position);
        }
      };
      append(deepParagraphOrderOfPart(session.part()));
      // Note stories too, now that their revisions reach the queue: a paragraph missing from
      // this index is an item `rangeCovers` can never match, so a footnote card listed but
      // could never become the ACTIVE one — and the rail gates its reply box on that.
      const otherParts = otherStoryParts();
      for (const part of otherParts) append(deepParagraphOrderOfPart(part));
      cache = { packageRevision, bodyRoot, index, otherParts };
      return index;
    },
  };
}
