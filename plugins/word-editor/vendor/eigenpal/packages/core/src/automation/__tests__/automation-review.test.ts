// Comments and tracked changes: the two things a document holds that are ABOUT its text.
//
// Both are derived in the store lane, where the review rail already reads them, and that is the
// point of these tests. A second derivation here would eventually disagree with the pane on
// screen — a comment listed by a script and missing from the rail, a change the rail offers to
// accept and the object model cannot find — so the protocol asks the SAME question the surface
// asks, and these tests pin the answers to a real package rather than to a fixture of items.
//
// WHAT A REVISION CAN BE ASKED TO DO is narrower than what it can be asked about. Structural
// cards whose Word subtype this protocol cannot name are omitted from the listing. Collection
// accept/reject still resolve every store-resolvable revision, including a complete tracked row,
// and refuse atomically when any unsupported one remains.

import { describe, expect, test } from 'bun:test';
import { REL_TYPES, noteReference, notesPart, richDocx } from './support/furniture.ts';
import {
  comment,
  commentsExtendedPart,
  commentsOf,
  commentsPart,
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
  spanAt,
  storyText,
  textAt,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

function twoReviewedComments(): AutomationHost {
  return open(
    richDocx({
      body:
        `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>first</w:t></w:r>` +
        `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>` +
        `<w:p><w:commentRangeStart w:id="3"/><w:r><w:t>second</w:t></w:r>` +
        `<w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r></w:p>`,
      rels: [{ id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' }],
      parts: [
        commentsPart(
          comment('1', 'Ada', '11111111', 'first remark') +
            comment('3', 'Grace', '33333333', 'second remark')
        ),
      ],
    })
  );
}

function nestedReviewedComment(): AutomationHost {
  return open(
    richDocx({
      body:
        `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>nested</w:t></w:r>` +
        `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>`,
      rels: [
        { id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' },
        {
          id: 'rId6',
          type: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
          target: 'commentsExtended.xml',
        },
      ],
      parts: [
        commentsPart(
          comment('1', 'Ada', '11111111', 'root') +
            comment('2', 'Grace', '22222222', 'reply') +
            comment('4', 'Linus', '44444444', 'nested reply')
        ),
        commentsExtendedPart(
          `<w15:commentEx w15:paraId="11111111"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111"/>` +
            `<w15:commentEx w15:paraId="44444444" w15:paraIdParent="22222222"/>`
        ),
      ],
    })
  );
}

function flagOf(host: AutomationHost, commentHandle: AutomationHandle): boolean {
  const response = host.execute({
    operations: [{ op: 'getCommentResolved', comment: commentHandle }],
  });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'flag') {
    throw new Error(`expected a flag: ${JSON.stringify(response)}`);
  }
  return result.value.value;
}

function revisionsOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0);
}

/**
 * Two footnotes in ONE `footnotes.xml`, each with a tracked insertion and a comment of its own,
 * and a third of each in the body.
 *
 * The shape that matters: three stories, two of them sharing a part. Everything a part-scoped
 * derivation gets wrong shows up as one story answering another's review items.
 */
function twoReviewedNotes(): AutomationHost {
  const noteXml = (word: string, id: string, author: string, commentId: string): string =>
    `<w:p><w:commentRangeStart w:id="${commentId}"/>` +
    `<w:ins w:id="${id}" w:author="${author}" w:date="2026-04-0${commentId}T09:00:00Z">` +
    `<w:r><w:t xml:space="preserve">${word}</w:t></w:r></w:ins>` +
    `<w:commentRangeEnd w:id="${commentId}"/>` +
    `<w:r><w:commentReference w:id="${commentId}"/></w:r></w:p>`;
  return open(
    richDocx({
      body:
        `<w:p><w:commentRangeStart w:id="3"/>` +
        `<w:ins w:id="30" w:author="Linus" w:date="2026-04-03T09:00:00Z">` +
        `<w:r><w:t>body words</w:t></w:r></w:ins>` +
        `<w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>` +
        noteReference('footnote', 1) +
        noteReference('footnote', 2) +
        `</w:p>`,
      rels: [
        { id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' },
        { id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' },
      ],
      parts: [
        notesPart('footnote', [
          { id: 1, xml: noteXml('one', '10', 'Ada', '1') },
          { id: 2, xml: noteXml('two', '20', 'Grace', '2') },
        ]),
        commentsPart(
          comment('1', 'Ada', '11111111', 'about one') +
            comment('2', 'Grace', '22222222', 'about two') +
            comment('3', 'Linus', '33333333', 'about the body')
        ),
      ],
    })
  );
}

function authorsOfRevisions(host: AutomationHost, body: AutomationHandle): readonly string[] {
  const found = revisionsOf(host, body);
  const response = host.execute({
    operations: found.map((revision) => ({ op: 'getRevisionAuthor' as const, revision })),
  });
  return found.map((_, index) => textAt(response, index));
}

describe('a document holds its comments, and a script reads the same ones the rail shows', () => {
  test('a story answers its top-level comments, replies under them rather than beside them', () => {
    const host = reviewed();
    const { body } = roots(host);
    const found = commentsOf(host, body);
    expect(found.length).toBe(1);
    const [first] = found as [AutomationHandle];
    const replies = handlesAt(
      host.execute({ operations: [{ op: 'getCommentReplies', comment: first }] }),
      0
    );
    expect(replies.length).toBe(1);
    expect(
      textAt(host.execute({ operations: [{ op: 'getCommentText', comment: replies[0]! }] }), 0)
    ).toBe('a reply');
  });

  test('deleting a reply preserves its parent', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [root] = commentsOf(host, body) as [AutomationHandle];
    const [reply] = handlesAt(
      host.execute({ operations: [{ op: 'getCommentReplies', comment: root }] }),
      0
    ) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: reply }] }).ok).toBe(true);

    const next = reopen(host);
    const [kept] = commentsOf(next.host, next.body) as [AutomationHandle];
    expect(
      handlesAt(next.host.execute({ operations: [{ op: 'getCommentReplies', comment: kept }] }), 0)
    ).toEqual([]);
    expect(
      textAt(next.host.execute({ operations: [{ op: 'getCommentText', comment: kept }] }), 0)
    ).toBe('the remark');
  });

  test('deleting a nested parent reparents descendants instead of deleting them', () => {
    const host = nestedReviewedComment();
    const { body } = roots(host);
    const [root] = commentsOf(host, body) as [AutomationHandle];
    const [reply] = handlesAt(
      host.execute({ operations: [{ op: 'getCommentReplies', comment: root }] }),
      0
    ) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: reply }] }).ok).toBe(true);

    const next = reopen(host);
    const [keptRoot] = commentsOf(next.host, next.body) as [AutomationHandle];
    const [reparented] = handlesAt(
      next.host.execute({ operations: [{ op: 'getCommentReplies', comment: keptRoot }] }),
      0
    ) as [AutomationHandle];
    expect(
      textAt(next.host.execute({ operations: [{ op: 'getCommentText', comment: reparented }] }), 0)
    ).toBe('nested reply');
  });

  test('deleting a root removes the thread and story anchors', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [root] = commentsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: root }] }).ok).toBe(true);
    const next = reopen(host);
    expect(commentsOf(next.host, next.body)).toEqual([]);
    expect(savedPartBytes(host, 'word/document.xml')).not.toContain('commentRange');
    expect(savedPartBytes(host, 'word/comments.xml')).not.toContain('the remark');
  });

  test('several queued deletions share one batch, while mixed writes are refused', () => {
    const host = twoReviewedComments();
    const { body } = roots(host);
    const [first, second] = commentsOf(host, body) as [AutomationHandle, AutomationHandle];
    const deleted = host.execute({
      operations: [
        { op: 'deleteComment', comment: first },
        { op: 'deleteComment', comment: second },
      ],
    });
    expect(deleted.ok).toBe(true);
    const next = reopen(host);
    expect(commentsOf(next.host, next.body)).toEqual([]);

    const mixed = reviewed();
    const mixedRoots = roots(mixed);
    const [commentHandle] = commentsOf(mixed, mixedRoots.body) as [AutomationHandle];
    const response = mixed.execute({
      operations: [
        { op: 'deleteComment', comment: commentHandle },
        { op: 'setCommentResolved', comment: commentHandle, resolved: true },
      ],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('conflicting-operations');
    expect(commentsOf(mixed, mixedRoots.body)).toHaveLength(1);
  });

  test('a stale comment handle is refused before deletion reaches the store', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [root] = commentsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: root }] }).ok).toBe(true);
    expect(host.execute({ operations: [{ op: 'deleteComment', comment: root }] }).ok).toBe(false);
  });

  test('a comment answers who wrote it, when, and what it says', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [
        { op: 'getCommentAuthor', comment: first },
        { op: 'getCommentDate', comment: first },
        { op: 'getCommentText', comment: first },
      ],
    });
    // No address: `CT_Comment` records an author and initials and nothing else. Word's own
    // `authorEmail` comes from `people.xml`, which this slice does not read — see the omissions.
    expect([0, 1, 2].map((index) => textAt(response, index))).toEqual([
      'Ada',
      '2026-01-01T10:00:00Z',
      'the remark',
    ]);
  });

  test('a comment answers the words it is about', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const span = spanAt(
      host.execute({ operations: [{ op: 'getCommentRange', comment: first }] }),
      0
    );
    expect(textAt(host.execute({ operations: [{ op: 'getSpanText', span }] }), 0)).toBe('reviewed');
  });

  test('an unresolved comment says so, and resolving it survives save and reopen', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    expect(flagOf(host, first)).toBe(false);

    const response = host.execute({
      operations: [{ op: 'setCommentResolved', comment: first, resolved: true }],
    });
    expect(response.ok).toBe(true);
    expect(response.changed).toBe(true);

    const next = reopen(host);
    const [reopened] = commentsOf(next.host, next.body) as [AutomationHandle];
    expect(flagOf(next.host, reopened)).toBe(true);
    // A THREAD resolves as one, which is what resolving means in Word: the reply is not left
    // open under a closed remark.
    const replies = handlesAt(
      next.host.execute({ operations: [{ op: 'getCommentReplies', comment: reopened }] }),
      0
    );
    expect(flagOf(next.host, replies[0]!)).toBe(true);
  });

  test('reopening a resolved comment is the same operation the other way', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    expect(
      host.execute({ operations: [{ op: 'setCommentResolved', comment: first, resolved: true }] })
        .ok
    ).toBe(true);
    const mid = reopen(host);
    const [again] = commentsOf(mid.host, mid.body) as [AutomationHandle];
    expect(
      mid.host.execute({
        operations: [{ op: 'setCommentResolved', comment: again, resolved: false }],
      }).ok
    ).toBe(true);
    const next = reopen(mid.host);
    expect(flagOf(next.host, commentsOf(next.host, next.body)[0]!)).toBe(false);
  });

  test('a reply is authored on the comment’s own range, and reads back as its reply', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: 'agreed', author: 'Linus' }],
    });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    const [reopened] = commentsOf(next.host, next.body) as [AutomationHandle];
    const replies = handlesAt(
      next.host.execute({ operations: [{ op: 'getCommentReplies', comment: reopened }] }),
      0
    );
    const texts = replies.map((reply, index) =>
      textAt(
        next.host.execute({
          operations: replies.map((each) => ({ op: 'getCommentText' as const, comment: each })),
        }),
        index
      )
    );
    expect(texts).toContain('agreed');
  });

  test('a comment answers the id the document holds it under, and a reply answers as an object', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    expect(textAt(host.execute({ operations: [{ op: 'getCommentId', comment: first }] }), 0)).toBe(
      '1'
    );
    // The reply's id is minted inside the package transaction, so the write answers the new comment
    // rather than only that it committed — otherwise a caller has to re-read the thread to find it.
    const written = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: 'noted', author: 'Linus' }],
    });
    const reply = handleAt(written, 0);
    expect(
      textAt(host.execute({ operations: [{ op: 'getCommentText', comment: reply }] }), 0)
    ).toBe('noted');
  });

  test('a reply lands even where the file wrote a paraId Word would not have written', () => {
    // `BBBBBBBB` is 8 hex digits and out of range: MS-DOCX puts `w14:paraId` below 0x80000000, so
    // the reader treats this one as absent. What must NOT follow is a second `w14:paraId` beside it
    // — a duplicate expanded attribute, which fails the part's invariants and takes the whole reply
    // down with it. An out-of-range id is REPLACED, so a file another editor wrote is repaired by
    // the edit rather than made unrepliable by it.
    const host = open(
      richDocx({
        body:
          `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>reviewed</w:t></w:r>` +
          `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>`,
        rels: [{ id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' }],
        parts: [commentsPart(comment('1', 'Ada', 'BBBBBBBB', 'the remark'))],
      })
    );
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const written = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: 'agreed', author: 'Linus' }],
    });
    expect(written.ok).toBe(true);

    const next = reopen(host);
    const [reopened] = commentsOf(next.host, next.body) as [AutomationHandle];
    const replies = handlesAt(
      next.host.execute({ operations: [{ op: 'getCommentReplies', comment: reopened }] }),
      0
    );
    expect(
      replies.map((reply, index) =>
        textAt(
          next.host.execute({
            operations: replies.map((each) => ({ op: 'getCommentText' as const, comment: each })),
          }),
          index
        )
      )
    ).toEqual(['agreed']);
  });

  test('resolving lands even where the file wrote a paraId Word would not have written', () => {
    // The resolve path stamps the same identity the reply path does, and for the same reason: a
    // `w15:commentEx` entry is keyed by `w14:paraId`, so a comment without a usable one has to be
    // given one. It must REPLACE the id the reader refused — appending a second `w14:paraId`
    // failed the part's invariants and took the whole resolve down with it.
    const host = open(
      richDocx({
        body:
          `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>reviewed</w:t></w:r>` +
          `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>`,
        rels: [{ id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' }],
        parts: [commentsPart(comment('1', 'Ada', 'BBBBBBBB', 'the remark'))],
      })
    );
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'setCommentResolved', comment: first, resolved: true }],
    });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    expect(flagOf(next.host, commentsOf(next.host, next.body)[0]!)).toBe(true);
    // One id, not two: the repaired file is one Word can open.
    expect((savedPartBytes(next.host, 'word/comments.xml').match(/w14:paraId/g) ?? []).length).toBe(
      1
    );
  });

  test('a reply with no author is refused, because a comment without one is invalid XML', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: 'x', author: '  ' }],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('a forged comment handle is refused', () => {
    const host = reviewed();
    const forged = { kind: 'comment', ref: 'comment:forged:1' } as unknown as AutomationHandle;
    expect(
      refusal(host.execute({ operations: [{ op: 'getCommentAuthor', comment: forged }] }))
    ).toBe('invalid-handle');
  });

  test('a document with no comment part answers no comments rather than refusing', () => {
    const host = open(richDocx({ body: `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` }));
    expect(commentsOf(host, roots(host).body)).toEqual([]);
  });
});

describe('a range creates a root comment through the package transaction', () => {
  test('a collapsed range is preserved, and author names need not be unique', () => {
    const host = open(richDocx({ body: `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` }));
    const { body } = roots(host);
    const paragraph = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    )[0]!;
    const span = {
      start: { paragraph, offset: 2 },
      end: { paragraph, offset: 2 },
    } as const;

    for (const text of ['first', 'second']) {
      expect(
        host.execute({
          operations: [{ op: 'insertComment', span, text, author: 'Same Reviewer' }],
        }).results[0]?.status
      ).toBe('ok');
    }

    const comments = commentsOf(host, body);
    expect(comments).toHaveLength(2);
    for (const item of comments) {
      expect(
        spanAt(host.execute({ operations: [{ op: 'getCommentRange', comment: item }] }), 0)
      ).toEqual({ start: { paragraph, offset: 2 }, end: { paragraph, offset: 2 } });
      expect(
        textAt(host.execute({ operations: [{ op: 'getCommentAuthor', comment: item }] }), 0)
      ).toBe('Same Reviewer');
    }
  });

  test('empty text and a range crossing table cells are refused without writing', () => {
    const host = open(
      richDocx({
        body:
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>left</w:t></w:r></w:p></w:tc>` +
          `<w:tc><w:p><w:r><w:t>right</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      })
    );
    const { body } = roots(host);
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    const before = savedPartBytes(host, 'word/document.xml');

    expect(
      refusal(
        host.execute({
          operations: [
            {
              op: 'insertComment',
              span: {
                start: { paragraph: paragraphs[0]!, offset: 0 },
                end: { paragraph: paragraphs[0]!, offset: 1 },
              },
              text: '',
              author: 'Reviewer',
            },
          ],
        })
      )
    ).toBe('unsupported-content');
    expect(
      refusal(
        host.execute({
          operations: [
            {
              op: 'insertComment',
              span: {
                start: { paragraph: paragraphs[0]!, offset: 0 },
                end: { paragraph: paragraphs[1]!, offset: 1 },
              },
              text: 'unsafe anchor',
              author: 'Reviewer',
            },
          ],
        })
      )
    ).toBe('unsupported-content');
    expect(savedPartBytes(host, 'word/document.xml')).toBe(before);
    expect(commentsOf(host, body)).toEqual([]);
  });

  test('date-only input serializes as normalized xsd:dateTime on w:date', () => {
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
    expect(
      host.execute({
        operations: [
          { op: 'insertComment', span, text: 'dated', author: 'Reviewer', date: '2026-03-09' },
        ],
      }).ok
    ).toBe(true);
    const xml = savedPartBytes(host, 'word/comments.xml');
    expect(xml).toContain('w:date="2026-03-09T00:00:00Z"');
    expect(xml).not.toContain('w:date="2026-03-09"');
  });

  test('fractional seconds and legal offsets survive on w:date', () => {
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
    expect(
      host.execute({
        operations: [
          {
            op: 'insertComment',
            span,
            text: 'fractional',
            author: 'Reviewer',
            date: '2026-03-09T12:30:45.5Z',
          },
        ],
      }).ok
    ).toBe(true);
    expect(savedPartBytes(host, 'word/comments.xml')).toContain('w:date="2026-03-09T12:30:45.5Z"');

    const replyHost = reviewed();
    const { body: replyBody } = roots(replyHost);
    const [parent] = commentsOf(replyHost, replyBody) as [AutomationHandle];
    expect(
      replyHost.execute({
        operations: [
          {
            op: 'replyToComment',
            comment: parent,
            text: 'offset',
            author: 'Linus',
            date: '2026-04-01T09:00:00+05:30',
          },
        ],
      }).ok
    ).toBe(true);
    expect(savedPartBytes(replyHost, 'word/comments.xml')).toContain(
      'w:date="2026-04-01T09:00:00+05:30"'
    );
  });

  test('an offset beyond xsd ±14:00 is refused with no comment write', () => {
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
    const beforeDoc = savedPartBytes(host, 'word/document.xml');
    const beforeComments = savedPartBytes(host, 'word/comments.xml');
    expect(
      refusal(
        host.execute({
          operations: [
            {
              op: 'insertComment',
              span,
              text: 'too far east',
              author: 'Reviewer',
              date: '2026-03-09T00:00:00+15:00',
            },
          ],
        })
      )
    ).toBe('unsupported-content');
    expect(savedPartBytes(host, 'word/document.xml')).toBe(beforeDoc);
    expect(savedPartBytes(host, 'word/comments.xml')).toBe(beforeComments);
    expect(commentsOf(host, body)).toEqual([]);
  });
});

describe('a tracked change is a decision, and the ones offered are the ones the engine can make', () => {
  test('empty collection decisions preserve document content', () => {
    for (const op of ['acceptAllRevisions', 'rejectAllRevisions'] as const) {
      for (const form of ['body', 'document'] as const) {
        const host = open(richDocx({ body: '<w:p><w:r><w:t>Example</w:t></w:r></w:p>' }));
        const { body, document } = roots(host);
        const before = savedPartBytes(host, 'word/document.xml');
        const response =
          op === 'acceptAllRevisions'
            ? host.execute({ operations: [form === 'body' ? { op, body } : { op, document }] })
            : host.execute({ operations: [form === 'body' ? { op, body } : { op, document }] });
        expect(response.ok).toBe(true);
        expect(savedPartBytes(host, 'word/document.xml')).toBe(before);
      }
    }
  });

  test('a story answers its pending changes, each with its author, date and kind', () => {
    const host = reviewed();
    const { body } = roots(host);
    const found = revisionsOf(host, body);
    expect(found.length).toBe(2);
    const response = host.execute({
      operations: [
        { op: 'getRevisionAuthor', revision: found[0]! },
        { op: 'getRevisionType', revision: found[0]! },
        { op: 'getRevisionDate', revision: found[0]! },
        { op: 'getRevisionAuthor', revision: found[1]! },
        { op: 'getRevisionType', revision: found[1]! },
      ],
    });
    expect(textAt(response, 0)).toBe('Ada');
    expect(textAt(response, 1)).toBe('Insert');
    expect(textAt(response, 2)).toBe('2026-02-01T09:00:00Z');
    expect(textAt(response, 3)).toBe('Grace');
    expect(textAt(response, 4)).toBe('Delete');
  });

  test('a change answers the words it covers', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    const span = spanAt(
      host.execute({ operations: [{ op: 'getRevisionRange', revision: insertion }] }),
      0
    );
    expect(textAt(host.execute({ operations: [{ op: 'getSpanText', span }] }), 0)).toBe('added');
  });

  test('accepting an insertion keeps its words and removes the decision', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    const response = host.execute({ operations: [{ op: 'acceptRevision', revision: insertion }] });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    expect(revisionsOf(next.host, next.body).length).toBe(1);
    expect(
      textAt(next.host.execute({ operations: [{ op: 'getText', target: next.body }] }), 0)
    ).toContain('added');
  });

  test('rejecting an insertion takes its words with it', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'rejectRevision', revision: insertion }] }).ok).toBe(
      true
    );
    const next = reopen(host);
    expect(
      textAt(next.host.execute({ operations: [{ op: 'getText', target: next.body }] }), 0)
    ).not.toContain('added');
  });

  test('accepting every change is one decision and one transaction', () => {
    const host = reviewed();
    const { document, body } = roots(host);
    const response = host.execute({ operations: [{ op: 'acceptAllRevisions', document }] });
    expect(response.ok).toBe(true);
    const next = reopen(host);
    expect(revisionsOf(next.host, next.body)).toEqual([]);
    const text = textAt(
      next.host.execute({ operations: [{ op: 'getText', target: next.body }] }),
      0
    );
    expect(text).toContain('added');
    expect(text).not.toContain('gone');
    void body;
  });

  test('rejecting every change is the same, the other way', () => {
    const host = reviewed();
    const { document } = roots(host);
    expect(host.execute({ operations: [{ op: 'rejectAllRevisions', document }] }).ok).toBe(true);
    const next = reopen(host);
    expect(revisionsOf(next.host, next.body)).toEqual([]);
    const text = textAt(
      next.host.execute({ operations: [{ op: 'getText', target: next.body }] }),
      0
    );
    expect(text).not.toContain('added');
    expect(text).toContain('gone');
  });

  test('a decision the document no longer holds is refused rather than applied to nothing', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'acceptRevision', revision: insertion }] }).ok).toBe(
      true
    );
    const response = host.execute({ operations: [{ op: 'acceptRevision', revision: insertion }] });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('invalid-handle');
  });

  test('a tracked row is answered as an insertion decision', () => {
    // Word exposes a tracked row as an insertion, even without cell markers.
    const host = open(
      richDocx({
        body:
          `<w:tbl><w:tr><w:trPr><w:ins w:id="20" w:author="Ada" w:date="2026-03-01T09:00:00Z"/></w:trPr>` +
          `<w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      })
    );
    const { body } = roots(host);
    const revisions = revisionsOf(host, body);
    expect(revisions).toHaveLength(1);
    expect(
      host.execute({ operations: [{ op: 'acceptRevision', revision: revisions[0]! }] }).ok
    ).toBe(true);
    expect(revisionsOf(host, body)).toHaveLength(0);
  });

  test('accepting a complete tracked row keeps the row and drops the marks', () => {
    const markup =
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>keep</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:trPr><w:ins w:id="50" w:author="Ada" w:date="2026-01-03T00:00:00Z"/></w:trPr>` +
      `<w:tc><w:tcPr><w:cellIns w:id="50" w:author="Ada" w:date="2026-01-03T00:00:00Z"/></w:tcPr>` +
      `<w:p><w:r><w:t>added row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const bytes = richDocx({ body: markup });
    for (const form of ['body', 'document'] as const) {
      const host = open(bytes);
      const { document, body } = roots(host);
      // The row and its cell record are one listed insertion.
      const [row, ...rest] = revisionsOf(host, body);
      const type = host.execute({ operations: [{ op: 'getRevisionType', revision: row! }] });
      expect([textAt(type, 0), rest.length]).toEqual(['Insert', 0]);
      const operation =
        form === 'body'
          ? ({ op: 'acceptAllRevisions', body } as const)
          : ({ op: 'acceptAllRevisions', document } as const);
      expect(host.execute({ operations: [operation] }).ok).toBe(true);
      const xml = savedPartBytes(reopen(host).host, 'word/document.xml');
      expect(xml).not.toContain('<w:ins');
      expect(xml).not.toContain('cellIns');
      expect(xml).toContain('added row');
      expect(xml).toContain('keep');
    }
  });

  test('a malformed row refuses the collection without changing the story', () => {
    const host = open(
      richDocx({
        body:
          `<w:p><w:ins w:id="10" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins></w:p>` +
          `<w:tbl><w:tr><w:trPr><w:ins w:id="20" w:author="Grace"/><w:ins w:id="20" w:author="Grace"/></w:trPr>` +
          `<w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      })
    );
    const { body } = roots(host);
    const before = savedPartBytes(host, 'word/document.xml');
    const response = host.execute({ operations: [{ op: 'acceptAllRevisions', body }] });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-revision');
    expect(savedPartBytes(host, 'word/document.xml')).toBe(before);
    expect(revisionsOf(host, body)).toHaveLength(1);
  });

  test('two decisions in one batch are one transaction', () => {
    const host = reviewed();
    const { body } = roots(host);
    const found = revisionsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'acceptRevision', revision: found[0]! },
        { op: 'acceptRevision', revision: found[1]! },
      ],
    });
    expect(response.ok).toBe(true);
    const next = reopen(host);
    expect(revisionsOf(next.host, next.body)).toEqual([]);
  });
});

describe('two notes share one part, and neither reviews the other', () => {
  test('a note answers its own changes and comments, not its neighbour’s', () => {
    const host = twoReviewedNotes();
    const [first, second] = noteBodies(host);
    // `footnotes.xml` holds every note in the document. Reading the part and calling the answer a
    // STORY's put note two's tracked insertion and note two's comment in note one's lists — and a
    // handle minted from that list would accept a change in a story the caller never addressed.
    expect(authorsOfRevisions(host, first)).toEqual(['Ada']);
    expect(authorsOfRevisions(host, second)).toEqual(['Grace']);
    expect(textsOfComments(host, first)).toEqual(['about one']);
    expect(textsOfComments(host, second)).toEqual(['about two']);
  });

  test('accepting a note’s change leaves the other note’s alone', () => {
    const host = twoReviewedNotes();
    const [first, second] = noteBodies(host);
    const [own] = revisionsOf(host, first) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'acceptRevision', revision: own }] }).ok).toBe(true);

    const next = reopen(host);
    const [afterFirst, afterSecond] = noteBodies(next.host);
    expect(authorsOfRevisions(next.host, afterFirst)).toEqual([]);
    expect(authorsOfRevisions(next.host, afterSecond)).toEqual(['Grace']);
    expect(storyText(next.host, afterFirst)).toContain('one');
    // The neighbour's proposed words are still proposed, which is what "not accepted" means.
    expect(storyText(next.host, afterSecond)).toContain('two');
    void second;
  });

  test('accepting a story collection resolves that story, not the main body', () => {
    const host = twoReviewedNotes();
    const [first, second] = noteBodies(host);
    const response = host.execute({ operations: [{ op: 'acceptAllRevisions', body: first }] });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    const [afterFirst, afterSecond] = noteBodies(next.host);
    expect(authorsOfRevisions(next.host, afterFirst)).toEqual([]);
    expect(authorsOfRevisions(next.host, afterSecond)).toEqual(['Grace']);
    expect(authorsOfRevisions(next.host, next.body)).toEqual(['Linus']);
    void second;
  });

  test('the body’s changes are not the note’s, and the note’s are not the body’s', () => {
    const host = twoReviewedNotes();
    const { body } = roots(host);
    expect(authorsOfRevisions(host, body)).toEqual(['Linus']);
    expect(textsOfComments(host, body)).toEqual(['about the body']);
  });

  test('resolving a comment a note holds does not resolve the neighbour’s', () => {
    const host = twoReviewedNotes();
    const [first, second] = noteBodies(host);
    const [own] = commentsOf(host, first) as [AutomationHandle];
    expect(
      host.execute({ operations: [{ op: 'setCommentResolved', comment: own, resolved: true }] }).ok
    ).toBe(true);
    expect(flagOf(host, commentsOf(host, second)[0]!)).toBe(false);
  });
});

describe('a file with a great many comments is read once, not once per comment', () => {
  /**
   * Entries COPIED into maps while `run` executes.
   *
   * A count of work rather than of time: a wall-clock threshold on a machine under load is a
   * flaky test, and the failure being pinned here is not slowness but shape — an index rebuilt
   * per item copies the whole set per item, so the count squares while the file only doubles.
   * `new Map(entries)` is where a rebuild is visible; a map filled by `set` in a loop is linear
   * by construction and is deliberately not counted.
   */
  function copiedIntoMaps(run: () => void): number {
    const real = globalThis.Map;
    let copied = 0;
    class CountingMap<K, V> extends real<K, V> {
      constructor(entries?: Iterable<readonly [K, V]> | null) {
        super(entries as never);
        copied += this.size;
      }
    }
    globalThis.Map = CountingMap as unknown as MapConstructor;
    try {
      run();
    } finally {
      globalThis.Map = real;
    }
    return copied;
  }

  /** `count` commented paragraphs, each with its own comment: the file an attacker writes. */
  function manyComments(count: number): AutomationHost {
    const ids = Array.from({ length: count }, (_, index) => index + 1);
    return open(
      richDocx({
        body: ids
          .map(
            (id) =>
              `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>t${id}</w:t></w:r>` +
              `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`
          )
          .join(''),
        rels: [{ id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' }],
        parts: [
          commentsPart(
            ids
              .map(
                (id) =>
                  `<w:comment w:id="${id}" w:author="Ada" w:initials="A" ` +
                  `w:date="2026-01-01T10:00:00Z"><w:p w14:paraId="${id.toString(16).padStart(8, '0').toUpperCase()}">` +
                  `<w:r><w:t>remark ${id}</w:t></w:r></w:p></w:comment>`
              )
              .join('')
          ),
        ],
      })
    );
  }

  function readAll(count: number): { copied: number; comments: number } {
    const host = manyComments(count);
    const { body } = roots(host);
    let comments = 0;
    // The host is built OUTSIDE the measurement: parsing a bigger file is linearly more work and
    // would dilute the ratio the assertion depends on. Only the derivation is measured.
    const copied = copiedIntoMaps(() => {
      comments = commentsOf(host, body).length;
    });
    return { copied, comments };
  }

  test('the thread index is built once per read, not once per comment', () => {
    // Eight times the comments, and the derivation was doing sixty-four times the work: the
    // anchoring filter rebuilt an id-to-comment map for every comment it judged. A comments part
    // is attacker-controlled — it is XML inside a zip anyone can hand a server — so a read whose
    // cost squares with its size is a way to take that server down with one upload.
    const small = readAll(40);
    const large = readAll(320);
    expect({ small: small.comments, large: large.comments }).toEqual({ small: 40, large: 320 });
    expect(small.copied).toBeGreaterThan(0);
    // Linear work over an eight-fold file is an eight-fold count; quadratic is sixty-four-fold.
    // Halfway between the two is a bound neither a fixture detail nor a machine can move.
    expect(large.copied).toBeLessThan(small.copied * 24);
  });
});
