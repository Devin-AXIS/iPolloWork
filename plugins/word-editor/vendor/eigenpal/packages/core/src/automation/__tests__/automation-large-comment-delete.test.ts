import { expect, test } from 'bun:test';
import { richDocx, REL_TYPES } from './support/furniture.ts';
import {
  comment,
  commentsPart,
  commentsOf,
  markedCommentParagraph,
} from './support/review-comments.ts';
import { open, reopen, roots, savedPartBytes } from './support/protocol.ts';

for (const count of [6_250, 12_500, 20_000]) {
  test(`deletes a comment completely beside ${count} filler paragraphs`, () => {
    const host = open(
      richDocx({
        body: markedCommentParagraph('kept') + '<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(count),
        rels: [{ id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' }],
        parts: [commentsPart(comment('1', 'Ada', '11111111', 'remark'))],
      })
    );
    const { body } = roots(host);
    const [target] = commentsOf(host, body);
    expect(target).toBeDefined();
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: target! }] }).ok).toBe(true);
    expect(commentsOf(host, body)).toHaveLength(0);
    const xml = savedPartBytes(host, 'word/document.xml');
    expect(xml).not.toContain('commentRange');
    expect(xml).not.toContain('commentReference');
    expect(xml).toContain('kept');
    expect(savedPartBytes(host, 'word/comments.xml')).not.toContain('remark');
    const restored = reopen(host);
    expect(commentsOf(restored.host, restored.body)).toHaveLength(0);
  });
}
