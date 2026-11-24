// Handle minting and resolution.
//
// INTERNAL. A handle is a name this table invented, mapped privately to the engine identity
// it stands for. Consumers get the name; nothing else ever leaves.
//
// Three properties matter and all three are easy to lose:
//
// STABLE — the same document object asked for twice yields the same ref, so an object model
// can hold a reference across batches and compare two references for identity. A table that
// minted per read would make every held reference a distinct object naming the same thing.
//
// STORY-QUALIFIED — a body ref names ONE story: the main body, a header or footer of a given
// section and variant, or one footnote. So does a paragraph ref, and it carries its story with it.
// Without that, "the body" meant whatever story the reader happened to be in and a scripted edit
// followed the user's caret into a header; and a paragraph ref could be planned against the wrong
// part, which is an offset landing in different text rather than anything that looks like an error.
//
// HOST-SCOPED — every ref carries a token drawn from the platform CSPRNG when the table is
// created. Without it, refs were numbered per host and every host's first paragraph was
// `paragraph:1`: two hosts open on two different documents accepted each other's refs and
// resolved them against their own tree, so a ref legitimately obtained from one document named
// a paragraph in another. An opaque name that collides is not opaque. The token makes a ref
// neither transplantable nor guessable, which is what an object model behind a transport needs.
//
// The ORDINAL half is still allocated in first-seen order per kind, so two hosts asked the same
// questions in the same order agree about everything except the token — which is what lets the
// differential tests compare two hosts' responses whole, normalizing only the token.
//
// Lookup is by Map, never by object key: a forged ref is untrusted input, and `__proto__` as
// a property name on a plain object is the prototype-pollution hazard this avoids by
// construction.

import type { NoteKind } from '../store/package/note-nodes.ts';
import type { AutomationHandle, AutomationHandleRef, AutomationObjectKind } from './protocol.ts';
import { storyKey, type AutomationStoryId } from './stories.ts';

/**
 * 128 bits of hex from the platform CSPRNG.
 *
 * `globalThis.crypto.getRandomValues` and nothing else: it is the one random source that exists
 * in a browser, in Bun and in Node without importing anything, which is what a lane compiled
 * without the DOM lib and without Node builtins can reach. Read through a narrow structural
 * type for the same reason — the typed global differs between those environments.
 *
 * FAILS CLOSED. A runtime without it throws here rather than falling back to a counter or a
 * clock: a guessable token restores the collision this exists to prevent while every test that
 * checks refs are distinct keeps passing, so the fallback would be invisible.
 */
function hostToken(): string {
  const source = (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto;
  const fill = source?.getRandomValues;
  if (typeof fill !== 'function') {
    throw new Error(
      'automation: no secure random source. globalThis.crypto.getRandomValues is required to ' +
        'scope document handles to one host.'
    );
  }
  const bytes = (fill as (array: Uint8Array) => Uint8Array).call(source, new Uint8Array(16));
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export type AutomationHandleTarget =
  | {
      readonly kind: 'field';
      readonly paragraphId: string;
      readonly fieldNodeId: string;
      readonly story: AutomationStoryId;
    }
  | { readonly kind: 'document' }
  | { readonly kind: 'body'; readonly story: AutomationStoryId; readonly rootNodeId?: string }
  | {
      readonly kind: 'table' | 'tableRow' | 'tableCell';
      readonly nodeId: string;
      readonly story: AutomationStoryId;
    }
  | {
      readonly kind: 'inlinePicture';
      readonly drawingNodeId: string;
      readonly story: AutomationStoryId;
    }
  | {
      readonly kind: 'paragraph';
      readonly paragraphId: string;
      readonly story: AutomationStoryId;
    }
  /** One floating shape, by its `wp:docPr/@id` and the story that anchors it. */
  | {
      readonly kind: 'shape';
      readonly shapeId: number;
      readonly owner: AutomationStoryId;
    }
  /** One `w:sectPr`, by its position in the document. */
  | { readonly kind: 'section'; readonly index: number }
  /** One footnote or endnote, by the `w:id` the reference in the story names. */
  | { readonly kind: 'note'; readonly noteKind: NoteKind; readonly noteId: number }
  /**
   * One comment, by its `w:id` AND the story its markers are anchored in.
   *
   * Story-qualified for the same reason a bookmark is: `w:id` is scoped to the comments part a
   * story's relationship names, so two stories can each hold a comment 1 and they are two remarks.
   */
  | { readonly kind: 'comment'; readonly commentId: string; readonly story: AutomationStoryId }
  /** One tracked-change decision, by the review queue's item id and the story it sits in. */
  | { readonly kind: 'revision'; readonly revisionId: string; readonly story: AutomationStoryId }
  /**
   * One bookmark, by the name it is declared with and the story its markers sit in.
   *
   * A name is a bookmark's only identity in a document; the story is what makes two markers of
   * the same name in a header and in the body two objects rather than one.
   */
  | { readonly kind: 'bookmark'; readonly name: string; readonly story: AutomationStoryId }
  /**
   * One list, by the `w:numId` its paragraphs share AND the story they are in.
   *
   * Story-qualified because a list is its paragraphs: a header and the body may both number with
   * `w:numId` 3 and they are two lists, so one handle for both would answer a header's items to a
   * caller asking about the body's.
   */
  | { readonly kind: 'list'; readonly numId: string; readonly story: AutomationStoryId }
  /**
   * One content control, by the CANONICAL NODE ID and the story it lives in.
   *
   * Not by `w:id`: the attribute is optional and not unique, so a table keyed on it would make
   * an unnumbered control unreachable and two identically numbered controls one object. The
   * node id never leaves the host — it is the private half of a minted ref, exactly like a
   * paragraph's.
   */
  | {
      readonly kind: 'contentControl';
      readonly nodeId: string;
      readonly story: AutomationStoryId;
    };

export interface AutomationHandleTable {
  /** The document handle. One per host, minted on first ask. */
  document(): AutomationHandle<'document'>;
  /** The handle for one STORY's body — the main body, a header/footer variant, or a note. */
  body(story: AutomationStoryId, rootNodeId?: string): AutomationHandle<'body'>;
  table(nodeId: string, story: AutomationStoryId): AutomationHandle<'table'>;
  tableRow(nodeId: string, story: AutomationStoryId): AutomationHandle<'tableRow'>;
  tableCell(nodeId: string, story: AutomationStoryId): AutomationHandle<'tableCell'>;
  field(
    paragraphId: string,
    fieldNodeId: string,
    story: AutomationStoryId
  ): AutomationHandle<'field'>;
  inlinePicture(drawingNodeId: string, story: AutomationStoryId): AutomationHandle<'inlinePicture'>;
  shape(shapeId: number, owner: AutomationStoryId): AutomationHandle<'shape'>;
  /** The handle for a canonical paragraph id, minted once and reused thereafter. */
  paragraph(paragraphId: string, story: AutomationStoryId): AutomationHandle<'paragraph'>;
  section(index: number): AutomationHandle<'section'>;
  note(noteKind: NoteKind, noteId: number): AutomationHandle<'note'>;
  comment(commentId: string, story: AutomationStoryId): AutomationHandle<'comment'>;
  revision(revisionId: string, story: AutomationStoryId): AutomationHandle<'revision'>;
  bookmark(name: string, story: AutomationStoryId): AutomationHandle<'bookmark'>;
  list(numId: string, story: AutomationStoryId): AutomationHandle<'list'>;
  /** The handle for one content control's canonical node, minted once and reused. */
  contentControl(nodeId: string, story: AutomationStoryId): AutomationHandle<'contentControl'>;
  /**
   * Point an already-issued paragraph handle at a different canonical id.
   *
   * For the one structural case where a paragraph's CONTENT moves to a new node while the old
   * node keeps the id: inserting a paragraph before another one is a text insert plus a split,
   * and the split leaves the head — the new paragraph — on the original node. Without this, a
   * consumer's reference to the paragraph it inserted before would silently name the paragraph
   * it just created. Nothing else in the lane may call this: an identity that can be re-aimed
   * for convenience is not an identity.
   */
  retarget(fromParagraphId: string, toParagraphId: string): void;
  /**
   * Keep an issued revision handle on its change after the change's identity moved.
   *
   * A revision's identity includes its author, so a committed attribution change gives the
   * same pending decision a new id. Only that commit may call this: the decision did not change.
   * All moves apply together, so one change may take an id another change just left.
   */
  retargetRevisions(
    story: AutomationStoryId,
    moves: readonly { readonly from: string; readonly to: string }[]
  ): void;
  /**
   * What a handle names, or null when this table never minted it or the caller's declared
   * kind disagrees with what was minted. Both are `invalid-handle` to the protocol: a ref
   * whose kind can be talked into something else is not opaque.
   */
  resolve(handle: unknown, expected: AutomationObjectKind): AutomationHandleTarget | null;
}

function isHandleShaped(value: unknown): value is { kind: unknown; ref: unknown } {
  return typeof value === 'object' && value !== null && 'kind' in value && 'ref' in value;
}

export function createHandleTable(): AutomationHandleTable {
  const targets = new Map<string, AutomationHandleTarget>();
  const refByParagraph = new Map<string, AutomationHandleRef>();
  /** One ref per named object, per kind: `kind\0name` -> ref. What makes a handle stable. */
  const refByName = new Map<string, AutomationHandleRef>();
  const counters = new Map<AutomationObjectKind, number>();
  // Minted eagerly, so a host that cannot scope its handles never comes into existence at all.
  const token = hostToken();
  let documentHandle: AutomationHandle<'document'> | null = null;

  const mint = <K extends AutomationObjectKind>(
    kind: K,
    target: AutomationHandleTarget
  ): AutomationHandle<K> => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    const ref = `${kind}:${token}:${String(next)}` as AutomationHandleRef;
    targets.set(ref, target);
    return Object.freeze({ kind, ref });
  };

  /** Mint once per name and reuse, so two asks for one object are one reference. */
  const named = <K extends AutomationObjectKind>(
    kind: K,
    name: string,
    target: AutomationHandleTarget
  ): AutomationHandle<K> => {
    const key = `${kind}\u0000${name}`;
    const existing = refByName.get(key);
    if (existing) return Object.freeze({ kind, ref: existing });
    const handle = mint(kind, target);
    refByName.set(key, handle.ref);
    return handle;
  };

  return {
    document() {
      documentHandle ??= mint('document', { kind: 'document' });
      return documentHandle;
    },
    body(story, rootNodeId) {
      return named('body', `${storyKey(story)}:${rootNodeId ?? ''}`, {
        kind: 'body',
        story,
        ...(rootNodeId ? { rootNodeId } : {}),
      });
    },
    table(nodeId, story) {
      return named('table', `${storyKey(story)}:${nodeId}`, { kind: 'table', nodeId, story });
    },
    tableRow(nodeId, story) {
      return named('tableRow', `${storyKey(story)}:${nodeId}`, { kind: 'tableRow', nodeId, story });
    },
    tableCell(nodeId, story) {
      return named('tableCell', `${storyKey(story)}:${nodeId}`, {
        kind: 'tableCell',
        nodeId,
        story,
      });
    },
    field(paragraphId, fieldNodeId, story) {
      return named('field', `${storyKey(story)}:${fieldNodeId}`, {
        kind: 'field',
        paragraphId,
        fieldNodeId,
        story,
      });
    },
    inlinePicture(drawingNodeId, story) {
      return named('inlinePicture', `${storyKey(story)}:${drawingNodeId}`, {
        kind: 'inlinePicture',
        drawingNodeId,
        story,
      });
    },
    shape(shapeId, owner) {
      return named('shape', `${storyKey(owner)}:${String(shapeId)}`, {
        kind: 'shape',
        shapeId,
        owner,
      });
    },
    paragraph(paragraphId, story) {
      const existing = refByParagraph.get(paragraphId);
      if (existing) return Object.freeze({ kind: 'paragraph' as const, ref: existing });
      const handle = mint('paragraph', { kind: 'paragraph', paragraphId, story });
      refByParagraph.set(paragraphId, handle.ref);
      return handle;
    },
    section(index) {
      return named('section', String(index), { kind: 'section', index });
    },
    note(noteKind, noteId) {
      return named('note', `${noteKind}:${String(noteId)}`, { kind: 'note', noteKind, noteId });
    },
    comment(commentId, story) {
      return named('comment', `${storyKey(story)}\u0000${commentId}`, {
        kind: 'comment',
        commentId,
        story,
      });
    },
    revision(revisionId, story) {
      return named('revision', `${storyKey(story)}\u0000${revisionId}`, {
        kind: 'revision',
        revisionId,
        story,
      });
    },
    bookmark(name, story) {
      return named('bookmark', `${storyKey(story)}\u0000${name}`, {
        kind: 'bookmark',
        name,
        story,
      });
    },
    list(numId, story) {
      return named('list', `${storyKey(story)}\u0000${numId}`, { kind: 'list', numId, story });
    },
    contentControl(nodeId, story) {
      return named('contentControl', `${storyKey(story)}\u0000${nodeId}`, {
        kind: 'contentControl',
        nodeId,
        story,
      });
    },
    retargetRevisions(story, moves) {
      const name = (revisionId: string) => `revision\u0000${storyKey(story)}\u0000${revisionId}`;
      const moving = moves.flatMap(({ from, to }) => {
        const ref = from === to ? undefined : refByName.get(name(from));
        return ref ? [{ ref, from, to }] : [];
      });
      // Two phases: every old name is released before any new one is taken.
      for (const { from } of moving) refByName.delete(name(from));
      for (const { ref, to } of moving) {
        if (refByName.has(name(to))) continue;
        refByName.set(name(to), ref);
        targets.set(ref, { kind: 'revision', revisionId: to, story });
      }
    },
    retarget(fromParagraphId, toParagraphId) {
      const ref = refByParagraph.get(fromParagraphId);
      // Nobody ever asked for this paragraph, so no reference can be pointing at the wrong one.
      if (!ref || fromParagraphId === toParagraphId) return;
      const target = targets.get(ref);
      if (!target || target.kind !== 'paragraph') return;
      refByParagraph.delete(fromParagraphId);
      // The STORY is carried over: re-aiming an identity must not also move it to another story.
      targets.set(ref, { kind: 'paragraph', paragraphId: toParagraphId, story: target.story });
      // The destination is a node this transaction created, so it cannot already have a ref;
      // guarded anyway, because two refs naming one paragraph would break handle identity.
      if (!refByParagraph.has(toParagraphId)) refByParagraph.set(toParagraphId, ref);
    },
    resolve(handle, expected) {
      if (!isHandleShaped(handle)) return null;
      if (handle.kind !== expected || typeof handle.ref !== 'string') return null;
      const target = targets.get(handle.ref);
      if (!target || target.kind !== expected) return null;
      return target;
    },
  };
}
