import { CONTENT_TYPES, REL_TYPES, richDocx, type SidePart } from './furniture.ts';
import { handleAt, handlesAt, open, textAt } from './protocol.ts';
import type { AutomationHandle, AutomationHost } from '../../protocol.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

export const commentsPart = (inner: string): SidePart => ({
  name: 'word/comments.xml',
  contentType: CONTENT_TYPES.comments,
  xml: `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${inner}</w:comments>`,
});

export const commentsExtendedPart = (inner: string): SidePart => ({
  name: 'word/commentsExtended.xml',
  contentType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
  xml: `<w15:commentsEx xmlns:w15="${W15}">${inner}</w15:commentsEx>`,
});

export const comment = (id: string, author: string, paraId: string, text: string): string =>
  `<w:comment w:id="${id}" w:author="${author}" w:initials="${author[0] ?? 'x'}" ` +
  `w:date="2026-01-0${id}T10:00:00Z">` +
  `<w:p w14:paraId="${paraId}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:comment>`;

export const markedCommentParagraph = (word: string, id = '1'): string =>
  `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t xml:space="preserve">${word}</w:t></w:r>` +
  `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;

/** A body with one commented stretch and one tracked insertion and deletion. */
export function reviewed(): AutomationHost {
  return open(
    richDocx({
      body:
        `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>reviewed</w:t></w:r>` +
        `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> words</w:t></w:r></w:p>` +
        `<w:p><w:ins w:id="10" w:author="Ada" w:date="2026-02-01T09:00:00Z">` +
        `<w:r><w:t>added</w:t></w:r></w:ins>` +
        `<w:del w:id="11" w:author="Grace" w:date="2026-02-02T09:00:00Z">` +
        `<w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`,
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
          comment('1', 'Ada', '11111111', 'the remark') +
            comment('2', 'Grace', '22222222', 'a reply')
        ),
        commentsExtendedPart(
          `<w15:commentEx w15:paraId="11111111" w15:done="0"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/>`
        ),
      ],
    })
  );
}

export function commentsOf(
  host: AutomationHost,
  body: AutomationHandle
): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getComments', scope: { body } }] }), 0);
}

export function noteBodies(host: AutomationHost): readonly AutomationHandle[] {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const notes = handlesAt(
    host.execute({ operations: [{ op: 'getNotes', document, noteKind: 'footnote' }] }),
    0
  );
  const bodies = host.execute({
    operations: notes.map((note) => ({ op: 'getNoteBody' as const, note })),
  });
  return notes.map((_, index) => handleAt(bodies, index));
}

export function textsOfComments(host: AutomationHost, body: AutomationHandle): readonly string[] {
  const found = commentsOf(host, body);
  const response = host.execute({
    operations: found.map((commentHandle) => ({
      op: 'getCommentText' as const,
      comment: commentHandle,
    })),
  });
  return found.map((_, index) => textAt(response, index));
}
