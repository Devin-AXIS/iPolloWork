import { normalizeCommentBodyText } from '../store/store/comment-body.ts';
import { answered } from './plan-results.ts';
import {
  validateCommentAuthor,
  validateCommentText,
} from '../store/store/comment-input-validate.ts';
import { commentPartNameOf } from '../store/store/comment-writes.ts';
import { commentTextEditRefusal } from '../store/store/comment-text-support.ts';
import type { ReviewCommentItem } from '../store/store/review-items.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';

/** Validate the supported body and runtime identity before any package mutation. */
export function validateCommentTextEdit(
  operation: Extract<AutomationOperation, { op: 'setCommentText' }>,
  item: ReviewCommentItem,
  reads: AutomationStoryReads,
  packageReads: AutomationPackageReads
): PlannedOperation | null {
  const input = validateCommentAuthor(operation.author) ?? validateCommentText(operation.text);
  if (input)
    return {
      ok: false,
      error: { code: 'unsupported-content', message: 'invalid comment edit', detail: input },
    };
  if (operation.author !== item.comment.author)
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message: 'only the author can edit this comment',
        detail: 'comment-author-mismatch',
      },
    };
  if (reads.story.kind !== 'body')
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message: 'comment editing requires the body story',
        detail: 'unsupported-story',
      },
    };
  const pkg = packageReads.package;
  const part = pkg?.parts.get(commentPartNameOf(pkg, reads.part.name));
  if (part && commentTextEditRefusal(part, item.id))
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message: 'this comment body cannot be replaced with plain text',
        detail: 'unsupported-comment-body',
      },
    };
  return null;
}

/** Keep staged comment reads scoped to their part throughout one atomic batch. */
export function createCommentTextPlanner(packageReads: AutomationPackageReads) {
  const staged = new Map<string, string>();
  const key = (reads: AutomationStoryReads, id: string): string =>
    `${packageReads.package ? commentPartNameOf(packageReads.package, reads.part.name) : reads.part.name}:${id}`;
  return {
    read(
      found:
        | {
            readonly ok: true;
            readonly reads: AutomationStoryReads;
            readonly item: ReviewCommentItem;
          }
        | { readonly ok: false; readonly planned: PlannedOperation },
      fallback: (reads: AutomationStoryReads, id: string) => string
    ): PlannedOperation {
      if (!found.ok) return found.planned;
      const { reads, item } = found;
      return answered({
        kind: 'text',
        text: staged.get(key(reads, item.id)) ?? fallback(reads, item.id),
      });
    },
    edit(
      operation: Extract<AutomationOperation, { op: 'setCommentText' }>,
      item: ReviewCommentItem,
      reads: AutomationStoryReads,
      pinWrite: () => PlannedOperation | null
    ): PlannedOperation {
      const refusal = validateCommentTextEdit(operation, item, reads, packageReads);
      if (refusal) return refusal;
      const conflict = pinWrite();
      if (conflict) return conflict;
      staged.set(key(reads, item.id), normalizeCommentBodyText(operation.text));
      return {
        ok: true,
        kind: 'commentWrite',
        write: { kind: 'edit', commentId: item.id, text: operation.text },
        story: reads.story,
        answer: () => ({ kind: 'applied' }),
      };
    },
  };
}
