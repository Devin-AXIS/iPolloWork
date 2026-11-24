// The document vocabulary's comment and revision commands in a live editor.
//
// `addComment`, `replyComment`, `resolveComment`, `acceptRevision`, and `rejectRevision` are
// spelled by `DocEdits` in OOXML terms: a comment `w:id` and a revision `w:id`. The editor's
// review methods address review cards by key. This lane maps one to the other and runs the
// method, so the command and the method share every gate, refusal, and history group.

import type {
  CanResult,
  EditorCommand,
  ExecResult,
  HistoryGroupOptions,
  ReviewItemPlacement,
} from '../contracts/editor.ts';
import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlPart } from '../store/package/ooxml-tree.ts';
import { revisionSiteNodeIdsOf } from '../store/store/review-items.ts';
import type { ReviewItem } from '../layout/index.ts';
import { commentForKey } from './docx-editor-comment-resolution.ts';
import type { createReviewCommands } from './docx-editor-review-commands.ts';
import type { createReviewWrites, ReviewWriteDeps } from './docx-editor-review-writes.ts';
import { reviewReplyRefusal } from './review-reply.ts';
import { partOfNodeId } from './surface-scope.ts';

type DocumentReviewCommand = Extract<
  EditorCommand,
  { type: 'addComment' | 'replyComment' | 'resolveComment' | 'acceptRevision' | 'rejectRevision' }
>;

const DOCUMENT_REVIEW_TYPES: ReadonlySet<string> = new Set<DocumentReviewCommand['type']>([
  'addComment',
  'replyComment',
  'resolveComment',
  'acceptRevision',
  'rejectRevision',
]);

/** Whether a command is one of the document vocabulary's comment or revision commands. */
export function isDocumentReviewCommand(command: EditorCommand): command is DocumentReviewCommand {
  return DOCUMENT_REVIEW_TYPES.has(command.type);
}

const VIEWING: CanResult = Object.freeze({
  ok: false,
  code: 'locked',
  reason: 'the document is open for viewing',
});
const COMMENT_TARGET_REFUSAL: CanResult = Object.freeze({
  ok: false,
  code: 'unsupported',
  reason: 'DocTarget addressing is not supported; a comment covers the selection',
});

const wmlAttribute = (
  node: {
    attributes: readonly { namespaceUri: string | null; localName: string; value: string }[];
  },
  name: string
) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

/** The note element holding a node, or null when it is not inside a footnote or endnote. */
function noteIdAbove(part: OoxmlPart, nodeId: string): string | null {
  let current = parentNodeOf(part, nodeId);
  for (let depth = 0; current && depth < 256; depth += 1) {
    if (
      current.namespaceUri === WML_NAMESPACE_URI &&
      (current.localName === 'footnote' || current.localName === 'endnote')
    )
      return wmlAttribute(current, 'id') ?? null;
    current = parentNodeOf(part, current.id);
  }
  return null;
}

type RevisionCommand = Extract<
  DocumentReviewCommand,
  { type: 'acceptRevision' | 'rejectRevision' }
>;

function revisionArgumentRefusal(command: RevisionCommand): CanResult | null {
  const invalid = (reason: string): CanResult => ({ ok: false, code: 'invalidArgs', reason });
  if (!Number.isInteger(command.id) || command.id < 0)
    return invalid(`${command.type} requires a revision id that is a whole number`);
  const part = command.part ?? 'body';
  if (part !== 'body' && part !== 'footnote' && part !== 'endnote')
    return invalid("part must be 'body', 'footnote', or 'endnote'");
  if (command.noteId !== undefined) {
    if (part === 'body') return invalid('noteId requires part footnote or endnote');
    if (!Number.isInteger(command.noteId)) return invalid('noteId must be a whole number');
  }
  return null;
}

/** Whether a part is the one `part` names: the main document, or the notes part of a kind. */
function partMatches(
  part: OoxmlPart,
  mainDocumentPart: string,
  kind: 'body' | 'footnote' | 'endnote'
): boolean {
  if (kind === 'body') return part.name === mainDocumentPart;
  return part.contentType.endsWith(kind === 'footnote' ? '.footnotes+xml' : '.endnotes+xml');
}

export function createDocumentReviewCommands(
  deps: ReviewWriteDeps,
  writes: ReturnType<typeof createReviewWrites>,
  review: ReturnType<typeof createReviewCommands>
) {
  /** The editor's review gate: destroyed, Pro module, open document. */
  const ready = (): CanResult => review.can({ type: 'setReviewDisplayMode', mode: 'all-markup' })!;
  /** The cards the review methods address: unpaired, and without hidden authors. */
  const cards = (): readonly ReviewItemPlacement[] =>
    deps.placements({ pairReplacements: false, placement: false });

  const commentKey = (commentId: unknown): { key: string } | CanResult => {
    if (typeof commentId !== 'string' || commentId.length === 0)
      return { ok: false, code: 'invalidArgs', reason: 'commentId must be a non-empty string' };
    const found = cards().find(
      (entry) =>
        entry.item.kind === 'comment' &&
        (entry.item as ReviewItem & { kind: 'comment' }).comment.id === commentId
    );
    return found
      ? { key: found.key }
      : { ok: false, code: 'notFound', reason: `no comment with id ${commentId}` };
  };

  const revisionKey = (command: RevisionCommand): { key: string } | CanResult => {
    const invalid = revisionArgumentRefusal(command);
    if (invalid) return invalid;
    const surface = deps.surface()!;
    const pkg = surface.session.currentPackage();
    const kind = command.part ?? 'body';
    const id = String(command.id);
    const keys = new Set<string>();
    for (const entry of cards()) {
      const item = entry.item;
      if (item.kind !== 'revision' || !item.addresses.some((address) => address.id === id))
        continue;
      const site = revisionSiteNodeIdsOf(item)[0];
      const part = partOfNodeId(surface.session, site);
      if (!part || !site || !partMatches(part, pkg.mainDocumentPart, kind)) continue;
      if (command.noteId !== undefined && noteIdAbove(part, site) !== String(command.noteId))
        continue;
      if (findNode(part, site)) keys.add(entry.key);
    }
    if (keys.size === 0)
      return {
        ok: false,
        code: 'notFound',
        reason: `no tracked change with id ${id} in the ${kind}`,
      };
    if (keys.size > 1)
      return {
        ok: false,
        code: 'invalidArgs',
        reason: `id ${id} names more than one change; decide each with acceptReviewItem or rejectReviewItem`,
      };
    return { key: [...keys][0]! };
  };

  const can = (command: EditorCommand): CanResult | null => {
    if (!isDocumentReviewCommand(command)) return null;
    const gate = ready();
    if (!gate.ok) return gate;
    if (deps.editingMode() === 'viewing') return VIEWING;
    switch (command.type) {
      case 'addComment': {
        if (command.target !== undefined) return COMMENT_TARGET_REFUSAL;
        const writer = (command.author ?? deps.author() ?? '').trim();
        if (typeof command.text !== 'string' || !command.text.trim() || !writer)
          return {
            ok: false,
            code: 'invalidArgs',
            reason: 'a comment needs both an author and text',
          };
        return deps.commentTargetRange()
          ? { ok: true }
          : { ok: false, code: 'invalidArgs', reason: 'a comment needs a selected range' };
      }
      case 'replyComment': {
        const found = commentKey(command.commentId);
        if (!('key' in found)) return found;
        const item = commentForKey(deps.placements({ pairReplacements: false }), found.key);
        if (!('kind' in item)) return item;
        const writer = (command.author ?? deps.author() ?? '').trim();
        return (
          reviewReplyRefusal(
            item,
            typeof command.text === 'string' ? command.text : '',
            writer
          ) ?? { ok: true }
        );
      }
      case 'resolveComment': {
        const found = commentKey(command.commentId);
        return 'key' in found ? { ok: true } : found;
      }
      default: {
        const found = revisionKey(command);
        if (!('key' in found)) return found;
        return review.can({
          type: 'resolveAllReviewChanges',
          action: command.type === 'acceptRevision' ? 'accept' : 'reject',
          keys: [found.key],
        });
      }
    }
  };

  const exec = (command: EditorCommand, options?: HistoryGroupOptions): ExecResult | null => {
    if (!isDocumentReviewCommand(command)) return null;
    const gate = ready();
    if (!gate.ok) return gate as ExecResult;
    if (command.type === 'addComment') {
      if (command.target !== undefined) return COMMENT_TARGET_REFUSAL as ExecResult;
      return command.author === undefined
        ? writes.addComment(command.text, options)
        : writes.addComment(command.text, command.author, options);
    }
    const found =
      command.type === 'acceptRevision' || command.type === 'rejectRevision'
        ? revisionKey(command)
        : commentKey(command.commentId);
    if (!('key' in found)) return found as ExecResult;
    switch (command.type) {
      case 'replyComment':
        return command.author === undefined
          ? writes.replyToReviewItem(found.key, command.text, options)
          : writes.replyToReviewItem(found.key, command.text, command.author, options);
      case 'resolveComment':
        return writes.setCommentResolved(found.key, true, options);
      case 'acceptRevision':
        return writes.acceptReviewItem(found.key, options);
      default:
        return writes.rejectReviewItem(found.key, options);
    }
  };

  return { can, exec };
}
