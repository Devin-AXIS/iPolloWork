// Comment input validation and story-scoped deletion: guards that refuse bad writes and keep
// each story's anchors separate when the same w:id appears in more than one place.

import { describe, expect, test } from 'bun:test';
import {
  furnitureRef,
  headerPart,
  noteReference,
  notesPart,
  richDocx,
  REL_TYPES,
  sectionProperties,
} from './support/furniture.ts';
import {
  comment,
  commentsOf,
  commentsPart,
  markedCommentParagraph,
  noteBodies,
  reviewed,
  textsOfComments,
} from './support/review-comments.ts';
import {
  handleAt,
  handlesAt,
  open,
  refusal,
  reopen,
  roots,
  savedPartBytes,
  textAt,
} from './support/protocol.ts';
import type { AutomationHandle } from '../protocol.ts';
import {
  MAX_COMMENT_AUTHOR_UTF16,
  MAX_COMMENT_TEXT_UTF16,
} from '../../store/store/comment-input-validate.ts';

describe('comment input is validated before it reaches the package', () => {
  test('a reply with invalid XML text is refused before the package changes', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const before = savedPartBytes(host, 'word/comments.xml');
    const response = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: '\u0001', author: 'Linus' }],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-content');
    expect(savedPartBytes(host, 'word/comments.xml')).toBe(before);
    expect(commentsOf(host, body)).toHaveLength(1);
  });

  test('invalid XML controls and over-limit values are refused before any write lands', () => {
    const host = open(richDocx({ body: `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` }));
    const { body } = roots(host);
    const paragraph = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    )[0]!;
    const span = {
      start: { paragraph, offset: 0 },
      end: { paragraph, offset: 1 },
    } as const;
    const beforeDoc = savedPartBytes(host, 'word/document.xml');
    const beforeComments = savedPartBytes(host, 'word/comments.xml');

    const badAuthor = host.execute({
      operations: [{ op: 'insertComment', span, text: 'ok', author: `Ada\u0001` }],
    });
    expect(badAuthor.ok).toBe(false);
    expect(refusal(badAuthor)).toBe('unsupported-content');

    const longAuthor = 'A'.repeat(MAX_COMMENT_AUTHOR_UTF16 + 1);
    expect(
      refusal(
        host.execute({
          operations: [{ op: 'insertComment', span, text: 'ok', author: longAuthor }],
        })
      )
    ).toBe('unsupported-content');

    const longText = 'x'.repeat(MAX_COMMENT_TEXT_UTF16 + 1);
    expect(
      refusal(
        host.execute({
          operations: [{ op: 'insertComment', span, text: longText, author: 'Reviewer' }],
        })
      )
    ).toBe('unsupported-content');

    expect(
      refusal(
        host.execute({
          operations: [
            {
              op: 'insertComment',
              span,
              text: 'dated',
              author: 'Reviewer',
              date: 'not-a-date',
            },
          ],
        })
      )
    ).toBe('unsupported-content');

    expect(savedPartBytes(host, 'word/document.xml')).toBe(beforeDoc);
    expect(savedPartBytes(host, 'word/comments.xml')).toBe(beforeComments);
    expect(commentsOf(host, body)).toEqual([]);
  });

  test('valid Unicode and accepted OOXML dates survive create and save', () => {
    const host = open(richDocx({ body: `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` }));
    const { body } = roots(host);
    const paragraph = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    )[0]!;
    const span = {
      start: { paragraph, offset: 0 },
      end: { paragraph, offset: 5 },
    } as const;
    const text = 'caf\u00e9 \uD83D\uDE00';
    const response = host.execute({
      operations: [
        {
          op: 'insertComment',
          span,
          text,
          author: 'R\u00e9viewer',
          date: '2026-03-09T12:00:00Z',
        },
      ],
    });
    expect(response.ok).toBe(true);
    const [commentHandle] = commentsOf(host, body) as [AutomationHandle];
    expect(
      textAt(host.execute({ operations: [{ op: 'getCommentText', comment: commentHandle }] }), 0)
    ).toBe(text);
    expect(
      textAt(host.execute({ operations: [{ op: 'getCommentAuthor', comment: commentHandle }] }), 0)
    ).toBe('R\u00e9viewer');
    const next = reopen(host);
    const [saved] = commentsOf(next.host, next.body) as [AutomationHandle];
    expect(
      textAt(next.host.execute({ operations: [{ op: 'getCommentText', comment: saved }] }), 0)
    ).toBe(text);
    expect(savedPartBytes(next.host, 'word/comments.xml')).toContain('2026-03-09T12:00:00Z');
  });
});

describe('comment deletion stays within the story that owns the handle', () => {
  test('deleting a note’s comment does not strip the neighbour that reused the same w:id', () => {
    const host = open(
      richDocx({
        body: `<w:p>${noteReference('footnote', 1)}${noteReference('footnote', 2)}</w:p>`,
        rels: [
          { id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' },
          { id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' },
        ],
        parts: [
          notesPart('footnote', [
            { id: 1, xml: markedCommentParagraph('one') },
            { id: 2, xml: markedCommentParagraph('two') },
          ]),
          commentsPart(comment('1', 'Ada', '11111111', 'shared id')),
        ],
      })
    );
    const [first, second] = noteBodies(host);
    const [own] = commentsOf(host, first) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: own }] }).ok).toBe(true);
    expect(textsOfComments(host, second)).toEqual(['shared id']);
    expect(savedPartBytes(host, 'word/footnotes.xml')).toContain('two');
    expect(savedPartBytes(host, 'word/footnotes.xml')).toContain('w:id="1"');
  });

  test('deleting the body’s comment 1 leaves the header’s comment 1', () => {
    const host = open(
      richDocx({
        body:
          markedCommentParagraph('body words') +
          sectionProperties([furnitureRef('header', 'rId10', 'default')]),
        rels: [
          { id: 'rId10', type: REL_TYPES.header, target: 'header1.xml' },
          { id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' },
        ],
        parts: [
          headerPart('word/header1.xml', markedCommentParagraph('header words')),
          commentsPart(comment('1', 'Ada', '11111111', 'shared id')),
        ],
      })
    );
    const { document, body } = roots(host);
    const [section] = handlesAt(
      host.execute({ operations: [{ op: 'getSections', document }] }),
      0
    ) as [AutomationHandle];
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
      }),
      0
    );
    const [bodyComment] = commentsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: bodyComment }] }).ok).toBe(
      true
    );
    expect(commentsOf(host, body)).toEqual([]);
    expect(textsOfComments(host, header)).toEqual(['shared id']);
    expect(savedPartBytes(host, 'word/header1.xml')).toContain('commentRange');
    expect(savedPartBytes(host, 'word/document.xml')).not.toContain('commentRange');
    expect(savedPartBytes(host, 'word/comments.xml')).toContain('shared id');
  });
});
