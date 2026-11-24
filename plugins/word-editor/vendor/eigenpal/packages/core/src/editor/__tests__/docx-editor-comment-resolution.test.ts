import { describe, expect, test } from 'bun:test';
import type { ReviewItemPlacement } from '../contracts/editor.ts';
import type { ReviewCommentItem } from '../../layout/index.ts';
import { setReviewCommentResolved } from '../docx-editor-comment-resolution.ts';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';

function commentItem(
  id: string,
  record: object,
  extra: Partial<ReviewCommentItem> = {}
): ReviewCommentItem {
  return {
    kind: 'comment',
    id,
    comment: record as ReviewCommentItem['comment'],
    range: null,
    resolved: false,
    replyIds: [],
    orphaned: false,
    ...extra,
  };
}

function placement(item: ReviewCommentItem): ReviewItemPlacement {
  return {
    key: `comment-${item.id}`,
    id: item.id,
    kind: 'comment',
    author: 'Ada',
    initials: 'A',
    text: 'x',
    resolved: item.resolved,
    replyIds: item.replyIds,
    readOnly: false,
    activatable: true,
    anchorY: null,
    pageIndex: null,
    isActive: false,
    item,
  };
}

function surface(resolved: (id: string) => boolean): PaginatedSurface {
  let revision = 0;
  return {
    commitReviewOps(run) {
      run();
    },
    session: {
      setCommentResolved: (id: string) => {
        const ok = resolved(id);
        if (ok) revision += 1;
        return ok;
      },
      packageRevision: () => revision,
    },
  } as unknown as PaginatedSurface;
}

describe('setReviewCommentResolved refuses duplicate records', () => {
  test('duplicate records sharing a key refuse before mutation', () => {
    const first = commentItem('7', { id: 'first' });
    const second = commentItem('7', { id: 'second' });
    let wrote = false;
    const result = setReviewCommentResolved(
      {
        reviewEnabled: true,
        editingMode: 'editing',
        placements: () => [placement(first), placement(second)],
        surface: surface(() => {
          wrote = true;
          return true;
        }),
        proReviewReason: 'pro',
        bump: () => undefined,
      },
      'comment-7',
      true
    );
    expect(result).toEqual({
      ok: false,
      code: 'ambiguous',
      reason: 'duplicate comment records share that key',
    });
    expect(wrote).toBe(false);
  });

  test('the same global record listed twice still resolves once', () => {
    const record = { id: 'shared' };
    const item = commentItem('7', record);
    const again = commentItem('7', record);
    let wrote = false;
    const result = setReviewCommentResolved(
      {
        reviewEnabled: true,
        editingMode: 'editing',
        placements: () => [placement(item), placement(again)],
        surface: surface((id) => {
          wrote = id === '7';
          return true;
        }),
        proReviewReason: 'pro',
        bump: () => undefined,
      },
      'comment-7',
      true
    );
    expect(result).toEqual({ ok: true, changed: true });
    expect(wrote).toBe(true);
  });

  test('a resolved root with an unresolved descendant still reaches the session', () => {
    const root = commentItem('1', { id: 'root' }, { resolved: true, replyIds: ['2'] });
    const child = commentItem('2', { id: 'child' }, { resolved: false, parentId: '1' });
    let wrote = false;
    const result = setReviewCommentResolved(
      {
        reviewEnabled: true,
        editingMode: 'editing',
        placements: () => [placement(root), placement(child)],
        surface: surface((id) => {
          wrote = id === '1';
          return true;
        }),
        proReviewReason: 'pro',
        bump: () => undefined,
      },
      'comment-1',
      true
    );
    expect(wrote).toBe(true);
    expect(result).toEqual({ ok: true, changed: true });
  });
});
