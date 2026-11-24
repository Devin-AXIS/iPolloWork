// The `paragraphsChange` event: which paragraphs one commit added, changed, or deleted.
//
// Derived from the commit, never from a read of every paragraph. The tree is persistent: a
// commit replaces only the nodes on the path to what it edited, and every untouched subtree
// keeps its object. So a part that kept its object changed nothing, and inside a changed part
// a story block (a paragraph, a table, a block control) that kept its object holds no changed
// paragraph. A keystroke takes the fast path: its commit names the edited paragraphs.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { ParagraphsChangeEvent } from '../contracts/editor-events.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { ooxmlTreesEqual } from '../store/package/ooxml-serialize.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  collectStoryParagraphs,
  storyParagraphs,
  storyRootsOf,
} from '../store/package/story-blocks.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import { resolveHeaderFooterResolutionBySection } from '../store/package/hf-references.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import { sessionStylesRootOf } from '../store/package/ooxml-indexes.ts';
import { ORIGIN_IDS } from '../store/registry/frozen-ids.ts';
import type { TreeModelChange } from '../store/store/tree-store.ts';

/** Paragraph nodes by id. */
type Paragraphs = Map<string, OoxmlNode>;

interface Lists {
  readonly added: Set<string>;
  readonly changed: Set<string>;
  readonly deleted: Set<string>;
}

function newLists(): Lists {
  return { added: new Set(), changed: new Set(), deleted: new Set() };
}

/** The blocks directly under every story root of a part, in document order. */
function storyBlocksOf(part: OoxmlPart): readonly OoxmlNode[] {
  const blocks: OoxmlNode[] = [];
  for (const story of storyRootsOf(part)) {
    if (story.root.kind === 'textValue') continue;
    for (const child of story.root.children) blocks.push(child);
  }
  return blocks;
}

function addParagraphsOf(blocks: readonly OoxmlNode[], into: Paragraphs): void {
  const found: OoxmlNode[] = [];
  collectStoryParagraphs(blocks, found, 0);
  for (const paragraph of found) into.set(paragraph.id, paragraph);
}

/** Text-box paragraphs by host paragraph id, as `getParagraphs()` lists them. */
function textboxParagraphsOf(part: OoxmlPart): Map<string, Paragraphs> {
  const byHost = new Map<string, Paragraphs>();
  for (const box of textboxStoriesInPart(part)) {
    let nested = byHost.get(box.hostParagraphId);
    if (!nested) byHost.set(box.hostParagraphId, (nested = new Map()));
    for (const paragraph of storyParagraphs(box.root)) {
      if (paragraph.kind === 'paragraph') nested.set(paragraph.id, paragraph);
    }
  }
  return byHost;
}

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** Paragraph attributes without the `w14:paraId` and `w14:textId` stamps. */
function contentAttributes(node: OoxmlNode): string {
  if (node.kind === 'textValue') return '';
  return JSON.stringify(
    node.attributes
      .filter(
        (attribute) =>
          attribute.namespaceUri !== W14 ||
          (attribute.localName !== 'paraId' && attribute.localName !== 'textId')
      )
      .map((attribute) => [attribute.namespaceUri, attribute.localName, attribute.value])
  );
}

/**
 * Whether two nodes of one paragraph say the same thing. The first edit of a header or footer
 * stamps `w14:paraId` on each of its paragraphs, which changes no text.
 */
function sameContent(before: OoxmlNode, after: OoxmlNode): boolean {
  if (before.kind === 'textValue' || after.kind === 'textValue') {
    return ooxmlTreesEqual(before, after);
  }
  if (before.children.length !== after.children.length) return false;
  for (let index = 0; index < before.children.length; index += 1) {
    const left = before.children[index]!;
    const right = after.children[index]!;
    if (left !== right && !ooxmlTreesEqual(left, right)) return false;
  }
  return contentAttributes(before) === contentAttributes(after);
}

/**
 * Sort `before` and `after` paragraphs into the three lists by id. A paragraph with a new
 * node is compared by content, because some commits rebuild a whole story, such as a header.
 */
function compare(before: Paragraphs, after: Paragraphs, lists: Lists): void {
  for (const [id, node] of after) {
    const previous = before.get(id);
    if (!previous) lists.added.add(id);
    else if (previous !== node && !sameContent(previous, node)) lists.changed.add(id);
  }
  for (const id of before.keys()) if (!after.has(id)) lists.deleted.add(id);
}

/** Every listed paragraph of a part, text boxes included. */
function allListed(part: OoxmlPart): Paragraphs {
  const paragraphs: Paragraphs = new Map();
  addParagraphsOf(storyBlocksOf(part), paragraphs);
  for (const nested of textboxParagraphsOf(part).values()) {
    for (const [id, node] of nested) paragraphs.set(id, node);
  }
  return paragraphs;
}

/** The structural comparison of two revisions of one part. */
function compareParts(before: OoxmlPart, after: OoxmlPart, lists: Lists): void {
  const beforeBlocks = storyBlocksOf(before);
  const afterBlocks = storyBlocksOf(after);
  const kept = new Set(afterBlocks);
  const shared = new Set<OoxmlNode>();
  const old: Paragraphs = new Map();
  for (const block of beforeBlocks) {
    if (kept.has(block)) shared.add(block);
    else addParagraphsOf([block], old);
  }
  const next: Paragraphs = new Map();
  for (const block of afterBlocks) if (!shared.has(block)) addParagraphsOf([block], next);
  const hosts = newLists();
  compare(old, next, hosts);
  for (const id of hosts.added) lists.added.add(id);
  for (const id of hosts.changed) lists.changed.add(id);
  for (const id of hosts.deleted) lists.deleted.add(id);
  if (hosts.added.size + hosts.changed.size + hosts.deleted.size === 0) return;
  // Text-box paragraphs sit inside their host paragraph, so only a listed host can hold a
  // changed one. Both enumerations reuse the stories of unchanged paragraphs.
  const oldBoxes = textboxParagraphsOf(before);
  const newBoxes = textboxParagraphsOf(after);
  if (oldBoxes.size === 0 && newBoxes.size === 0) return;
  const empty: Paragraphs = new Map();
  for (const id of [...hosts.added, ...hosts.changed, ...hosts.deleted]) {
    compare(oldBoxes.get(id) ?? empty, newBoxes.get(id) ?? empty, lists);
  }
}

/**
 * The fast path: a text-local commit in one part names the paragraphs it edited in `dirty`.
 * Returns false when the commit does not have that shape, so the caller compares blocks.
 */
function fromDirty(
  change: TreeModelChange,
  before: OoxmlPart,
  after: OoxmlPart,
  lists: Lists
): boolean {
  if (change.impact !== 'text-local' || change.created.length > 0 || change.deleted.length > 0) {
    return false;
  }
  if (change.dirty.length === 0 || change.splitJoin.length > 0) return false;
  const changed: string[] = [];
  for (const id of change.dirty) {
    const previous = findNode(before, id);
    const node = findNode(after, id);
    if (previous?.kind !== 'paragraph' || node?.kind !== 'paragraph') return false;
    if (previous !== node) changed.push(id);
  }
  for (const id of changed) lists.changed.add(id);
  return true;
}

/** A peer's change. A collaborative undo or redo of this replica carries its own actor. */
function isPeerChange(change: TreeModelChange, localActor: string | undefined): boolean {
  if (change.origin !== ORIGIN_IDS.mutationRemote) return false;
  return localActor === undefined || change.actorId !== localActor;
}

function frozenList(ids: Set<string>): readonly string[] {
  return Object.freeze([...ids]);
}

/** The same referenced story parts that the session lists, from an earlier package. */
function storyNamesOf(pkg: OoxmlPackage): ReadonlySet<string> {
  const names = new Set([pkg.mainDocumentPart]);
  for (const section of resolveHeaderFooterResolutionBySection(pkg)) {
    for (const slots of [section.headers, section.footers]) {
      for (const slot of slots.values()) names.add(slot.partName);
    }
  }
  for (const kind of ['footnote', 'endnote'] as const) {
    const part = resolveNotesPart(pkg, kind);
    if (part) names.add(part.name);
  }
  return names;
}

/**
 * Follow one session's commits and say which paragraphs each changed. `note` must see every
 * commit, also when nobody listens: it keeps the package of each commit, which the session
 * has already built, so a commit nobody reads costs one reference.
 */
export function createParagraphChangeTracker(
  session: TreeDocxSessionView,
  /** This replica's collaboration actor: its own undo and redo install under it. */
  localActor: () => string | undefined = () => undefined
) {
  let previous: OoxmlPackage = session.currentPackage();
  /** Story part names at the last commit that had a listener; null when none had one. */
  let previousStory: ReadonlySet<string> | null = null;
  return {
    note(change: TreeModelChange, revision: number, wanted: boolean): ParagraphsChangeEvent | null {
      const before = previous;
      const after = session.currentPackage();
      previous = after;
      if (!wanted) {
        previousStory = null;
        return null;
      }
      const storyParts = session.storyParts();
      const story = new Set(storyParts.map((part) => part.name));
      const wasStory = previousStory ?? storyNamesOf(before);
      previousStory = story;
      if (before === after) return null;
      if (change.origin === ORIGIN_IDS.projection || change.origin === ORIGIN_IDS.awareness) {
        return null;
      }
      const lists = newLists();
      const changedParts: [OoxmlPart | undefined, OoxmlPart | undefined][] = [];
      for (const part of storyParts) {
        const old = wasStory.has(part.name) ? before.parts.get(part.name) : undefined;
        if (old !== part) changedParts.push([old, part]);
      }
      for (const name of wasStory) {
        const old = before.parts.get(name);
        if (old && !story.has(name)) changedParts.push([old, undefined]);
      }
      // Every read depends on the styles part, so new styles can change every paragraph.
      const styles = session.stylesRoot();
      const stylesChanged = sessionStylesRootOf(before) !== styles;
      const single = changedParts.length === 1 && !stylesChanged;
      for (const [old, part] of changedParts) {
        if (!old) compare(new Map(), allListed(part!), lists);
        else if (!part) compare(allListed(old), new Map(), lists);
        else if (!(single && fromDirty(change, old, part, lists))) compareParts(old, part, lists);
      }
      if (stylesChanged) {
        for (const part of storyParts) {
          for (const id of allListed(part).keys()) {
            if (!lists.added.has(id)) lists.changed.add(id);
          }
        }
      }
      // An id that left one part and entered another still names one paragraph.
      for (const id of lists.added) {
        if (!lists.deleted.has(id)) continue;
        lists.added.delete(id);
        lists.deleted.delete(id);
        lists.changed.add(id);
      }
      if (lists.added.size + lists.changed.size + lists.deleted.size === 0) return null;
      return Object.freeze({
        added: frozenList(lists.added),
        changed: frozenList(lists.changed),
        deleted: frozenList(lists.deleted),
        source: isPeerChange(change, localActor()) ? 'remote' : 'local',
        revision,
      });
    },
  };
}
