import type { ExecResult } from '../contracts/editor.ts';
import type { ReviewItem } from '../layout/index.ts';

/** Refuse reply shapes that can never create a valid review conversation. */
export function reviewReplyRefusal(
  item: ReviewItem,
  text: string,
  author: string
): ExecResult | null {
  if (item.kind === 'comment' && item.resolved) {
    return { ok: false, code: 'unsupported', reason: 'a resolved comment takes no replies' };
  }
  if (author.length === 0 || text.trim().length === 0) {
    return { ok: false, code: 'invalidArgs', reason: 'a reply needs both an author and text' };
  }
  if (item.kind === 'custom') {
    return { ok: false, code: 'unsupported', reason: 'a custom node card takes no replies' };
  }
  return null;
}
