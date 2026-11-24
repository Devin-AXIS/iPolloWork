// The two hosts over everything a document has BESIDES its text.
//
// `automation-host-parity.test.ts` pairs the hosts over paragraphs, spans and the transaction. This
// file pairs them over the rest of the object model: the sections and the furniture they print, the
// notes part, the lists a story numbers, its bookmarks and links, the comment threads and the
// tracked changes. Those are the reads most likely to diverge, because the browser host reaches them
// through a mounted editor's session and the headless one through bytes it opened itself — and
// several of them (a reply, a resolve, a note deletion) are PACKAGE transactions, where "who owns the
// document" is not a detail.
//
// The shape is the same as next door on purpose: one identical script, both transcripts compared
// whole, refs normalized only for the per-host token that cannot agree by design.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createServerAutomationHost } from '../../automation/index.ts';
import type {
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
} from '../../automation/index.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { stubReviewModule } from './review-test-module.ts';
import {
  CONTENT_TYPES,
  REL_TYPES,
  noteReference,
  notesPart,
  richDocx,
  type SidePart,
} from '../../automation/__tests__/support/furniture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const EXTENDED_REL = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';

const furniture = (kind: 'hdr' | 'ftr', text: string): SidePart => ({
  name: `word/${kind === 'hdr' ? 'header1' : 'footer1'}.xml`,
  contentType: `${WML}.${kind === 'hdr' ? 'header' : 'footer'}+xml`,
  xml: `<w:${kind} xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:${kind}>`,
});

/** A note whose second word is a tracked insertion, attributed to the note's own author. */
const proposedIn = (word: string): string =>
  `<w:p><w:r><w:t xml:space="preserve">${word} </w:t></w:r>` +
  `<w:ins w:id="${word === 'one' ? '31' : '32'}" w:author="${word === 'one' ? 'Ada' : 'Grace'}"` +
  ` w:date="2026-05-01T09:00:00Z"><w:r><w:t>proposed</w:t></w:r></w:ins></w:p>`;

/**
 * One document holding every group at once.
 *
 * Two sections so `getNext` has somewhere to go, a header and a footer on the first, a footnote, a
 * numbered list, a bookmark, a comment thread and a tracked insertion. Built with the same helper
 * the engine's own fixtures use, so the packaging (content types, relationships) is the packaging
 * those tests already exercise rather than a second hand-rolled one that can be subtly wrong.
 */
const EVERYTHING: Uint8Array = richDocx({
  body:
    '<w:p w14:paraId="11111111"><w:commentRangeStart w:id="1"/>' +
    '<w:r><w:t>Quarterly report</w:t></w:r><w:commentRangeEnd w:id="1"/>' +
    '<w:r><w:commentReference w:id="1"/></w:r>' +
    '</w:p>' +
    '<w:p w14:paraId="22222222"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>' +
    '<w:r><w:t>first item</w:t></w:r></w:p>' +
    '<w:p w14:paraId="33333333"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>' +
    '<w:r><w:t>second item</w:t></w:r></w:p>' +
    '<w:p w14:paraId="44444444"><w:bookmarkStart w:id="5" w:name="Summary"/>' +
    '<w:r><w:t>marked words</w:t></w:r><w:bookmarkEnd w:id="5"/>' +
    '<w:ins w:id="6" w:author="Ada" w:date="2026-02-01T09:00:00Z">' +
    '<w:r><w:t xml:space="preserve"> and added ones</w:t></w:r></w:ins></w:p>' +
    '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId7"/>' +
    '<w:footerReference w:type="default" r:id="rId8"/>' +
    '<w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr></w:p>' +
    `<w:p w14:paraId="55555555"><w:r><w:t>after the break</w:t></w:r>${noteReference('footnote', 2)}` +
    `${noteReference('endnote', 1)}${noteReference('endnote', 2)}</w:p>` +
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>',
  rels: [
    { id: 'rId7', type: REL_TYPES.header, target: 'header1.xml' },
    { id: 'rId8', type: REL_TYPES.footer, target: 'footer1.xml' },
    { id: 'rId9', type: REL_TYPES.footnotes, target: 'footnotes.xml' },
    { id: 'rId10', type: REL_TYPES.comments, target: 'comments.xml' },
    { id: 'rId11', type: EXTENDED_REL, target: 'commentsExtended.xml' },
    { id: 'rId12', type: REL_TYPES.endnotes, target: 'endnotes.xml' },
  ],
  parts: [
    furniture('hdr', 'in the header'),
    furniture('ftr', 'in the footer'),
    notesPart('footnote', [{ id: 2, text: 'in the footnote' }]),
    // TWO endnotes in ONE part, each with a tracked insertion of its own: the shape where a
    // part-scoped derivation reports one story's changes as another's.
    notesPart('endnote', [
      { id: 1, xml: proposedIn('one') },
      { id: 2, xml: proposedIn('two') },
    ]),
    {
      name: 'word/comments.xml',
      contentType: CONTENT_TYPES.comments,
      xml:
        `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">` +
        '<w:comment w:id="1" w:author="Grace" w:initials="G" w:date="2026-01-02T10:00:00Z">' +
        '<w:p w14:paraId="1B2C3D4E"><w:r><w:t>needs a number</w:t></w:r></w:p></w:comment>' +
        '</w:comments>',
    },
    {
      name: 'word/commentsExtended.xml',
      contentType: `${WML}.commentsExtended+xml`,
      xml:
        `<w15:commentsEx xmlns:w15="${W15}">` +
        '<w15:commentEx w15:paraId="1B2C3D4E" w15:done="0"/>' +
        '</w15:commentsEx>',
    },
  ],
});

function serverHost(): AutomationHost {
  const opened = createServerAutomationHost(EVERYTHING);
  if (!opened.ok) throw new Error(`headless host did not open: ${opened.reason}`);
  return opened.host;
}

function browserHost(): AutomationHost {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: EVERYTHING,
    modules: [stubReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return createBrowserAutomationHost(editor);
}

function onBoth<T>(run: (host: AutomationHost) => T): { server: T; browser: T } {
  return { server: run(serverHost()), browser: run(browserHost()) };
}

function handleAt(response: AutomationBatchResponse, index: number): AutomationHandle {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`expected a handle at ${index}`);
  }
  return result.value.handle;
}

function handlesAt(response: AutomationBatchResponse, index: number): readonly AutomationHandle[] {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error(`expected handles at ${index}`);
  }
  return result.value.handles;
}

/**
 * Every result of one batch, as a plain value a comparison can hold.
 *
 * The per-host token in each ref is collapsed and nothing else is: a ref that is portable between
 * hosts is a ref that can address a document its holder was never given, so THAT half cannot agree
 * by design — while the ordinal half, minted in first-seen order per kind, must.
 */
function answers(response: AutomationBatchResponse): unknown {
  const text = JSON.stringify({
    ok: response.ok,
    changed: response.changed,
    values: response.results.map((result) =>
      result.status === 'ok' ? result.value : { error: result.error.code }
    ),
  });
  return JSON.parse(text.replace(/:[0-9a-f]{32}:/g, ':<host>:'));
}

/** The roots every script below starts from. */
function roots(host: AutomationHost): { document: AutomationHandle; body: AutomationHandle } {
  const document_ = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  return {
    document: document_,
    body: handleAt(host.execute({ operations: [{ op: 'getBody', document: document_ }] }), 0),
  };
}

describe('the two hosts agree about sections, furniture and notes', () => {
  test('the sections, their page setup, their header and footer, and the next one', () => {
    const outcome = onBoth((host) => {
      const { document: document_ } = roots(host);
      const listed = host.execute({ operations: [{ op: 'getSections', document: document_ }] });
      const sections = handlesAt(listed, 0);
      const [first, second] = sections as [AutomationHandle, AutomationHandle];
      const read = host.execute({
        operations: [
          { op: 'getPageSetup', section: first },
          { op: 'getPageSetup', section: second },
          { op: 'getFurniture', section: first, kind: 'header', variant: 'default' },
          { op: 'getFurniture', section: first, kind: 'footer', variant: 'default' },
        ],
      });
      const header = handleAt(read, 2);
      const footer = handleAt(read, 3);
      return {
        sections: answers(listed),
        setup: answers(read),
        stories: answers(
          host.execute({
            operations: [
              { op: 'getText', target: header },
              { op: 'getText', target: footer },
            ],
          })
        ),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
  });

  test('the notes part: what it holds, what each note says, and deleting one', () => {
    const outcome = onBoth((host) => {
      const { document: document_ } = roots(host);
      const listed = host.execute({
        operations: [{ op: 'getNotes', document: document_, noteKind: 'footnote' }],
      });
      const [note] = handlesAt(listed, 0) as [AutomationHandle];
      const read = host.execute({
        operations: [
          { op: 'getNoteKind', note },
          { op: 'getNoteBody', note },
        ],
      });
      const body = handleAt(read, 1);
      const text = answers(host.execute({ operations: [{ op: 'getText', target: body }] }));
      const deleted = host.execute({ operations: [{ op: 'deleteNote', note }] });
      const after = host.execute({
        operations: [{ op: 'getNotes', document: document_, noteKind: 'footnote' }],
      });
      return {
        listed: answers(listed),
        read: answers(read),
        text,
        deleted: answers(deleted),
        after: answers(after),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
  });

  test('a page-setup write lands in the same section on both', () => {
    const outcome = onBoth((host) => {
      const { document: document_ } = roots(host);
      const sections = handlesAt(
        host.execute({ operations: [{ op: 'getSections', document: document_ }] }),
        0
      );
      const written = host.execute({
        operations: [
          {
            op: 'setPageSetup',
            section: sections[0]!,
            setup: { topMargin: 36, orientation: 'landscape' },
          },
        ],
      });
      const after = host.execute({ operations: [{ op: 'getPageSetup', section: sections[0]! }] });
      return { written: answers(written), after: answers(after) };
    });
    expect(outcome.server).toEqual(outcome.browser);
  });
});

describe('the two hosts agree about lists, bookmarks and links', () => {
  test('the lists a story numbers, their paragraphs, and a level write', () => {
    const outcome = onBoth((host) => {
      const { body } = roots(host);
      const listed = host.execute({ operations: [{ op: 'getLists', body }] });
      const [list] = handlesAt(listed, 0) as [AutomationHandle];
      const read = host.execute({
        operations: [
          { op: 'getListId', list },
          { op: 'getListParagraphs', list },
          { op: 'getListParagraphs', list, level: 1 },
        ],
      });
      const paragraphs = handlesAt(read, 1);
      const written = host.execute({
        operations: [{ op: 'setListLevel', paragraph: paragraphs[1]!, level: 1 }],
      });
      const after = host.execute({ operations: [{ op: 'getListParagraphs', list, level: 1 }] });
      return {
        listed: answers(listed),
        read: answers(read),
        written: answers(written),
        after: answers(after),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
  });

  test('a bookmark by name and range, and a hyperlink written then read back', () => {
    const outcome = onBoth((host) => {
      const { body } = roots(host);
      const listed = host.execute({ operations: [{ op: 'getBookmarks', scope: { body } }] });
      const [bookmark] = handlesAt(listed, 0) as [AutomationHandle];
      const read = host.execute({
        operations: [
          { op: 'getBookmarkName', bookmark },
          { op: 'getBookmarkRange', bookmark },
        ],
      });
      const found = host.execute({
        operations: [{ op: 'search', scope: { body }, text: 'marked words' }],
      });
      const spans = found.results[0];
      if (spans?.status !== 'ok' || spans.value.kind !== 'spans') throw new Error('expected spans');
      const span = spans.value.spans[0]!;
      const written = host.execute({
        operations: [
          {
            op: 'setHyperlink',
            span: { start: span.start, end: span.end },
            target: 'https://example.com/q4',
          },
        ],
      });
      const after = host.execute({
        operations: [{ op: 'getHyperlink', span: { start: span.start, end: span.end } }],
      });
      const refused = host.execute({
        operations: [
          {
            op: 'setHyperlink',
            span: { start: span.start, end: span.end },
            target: 'javascript:alert(1)',
          },
        ],
      });
      return {
        listed: answers(listed),
        read: answers(read),
        written: answers(written),
        after: answers(after),
        refused: answers(refused),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
  });
});

describe('the two hosts agree about comments and tracked changes', () => {
  test('a thread: what it says, who said it, replying to it and resolving it', () => {
    const outcome = onBoth((host) => {
      const { body } = roots(host);
      const listed = host.execute({ operations: [{ op: 'getComments', scope: { body } }] });
      const [comment] = handlesAt(listed, 0) as [AutomationHandle];
      const read = host.execute({
        operations: [
          { op: 'getCommentId', comment },
          { op: 'getCommentAuthor', comment },
          { op: 'getCommentDate', comment },
          { op: 'getCommentText', comment },
          { op: 'getCommentRange', comment },
          { op: 'getCommentResolved', comment },
          { op: 'getCommentReplies', comment },
        ],
      });
      const replied = host.execute({
        operations: [{ op: 'replyToComment', comment, text: 'on it', author: 'Linus' }],
      });
      const reply = handleAt(replied, 0);
      const resolved = host.execute({
        operations: [{ op: 'setCommentResolved', comment, resolved: true }],
      });
      const after = host.execute({
        operations: [
          { op: 'getCommentReplies', comment },
          { op: 'getCommentResolved', comment },
          { op: 'getCommentText', comment: reply },
        ],
      });
      return {
        listed: answers(listed),
        read: answers(read),
        replied: answers(replied),
        resolved: answers(resolved),
        after: answers(after),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
  });

  test('two notes in one part: each reviews itself, on both hosts', () => {
    const outcome = onBoth((host) => {
      const document_ = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
      const notes = handlesAt(
        host.execute({
          operations: [{ op: 'getNotes', document: document_, noteKind: 'endnote' }],
        }),
        0
      );
      const bodies = host.execute({
        operations: notes.map((note) => ({ op: 'getNoteBody' as const, note })),
      });
      const first = handleAt(bodies, 0);
      const second = handleAt(bodies, 1);
      const listed = host.execute({
        operations: [
          { op: 'getRevisions', body: first },
          { op: 'getRevisions', body: second },
        ],
      });
      const [own] = handlesAt(listed, 0) as [AutomationHandle];
      const accepted = host.execute({ operations: [{ op: 'acceptRevision', revision: own }] });
      const after = host.execute({
        operations: [
          { op: 'getRevisions', body: first },
          { op: 'getRevisions', body: second },
          { op: 'getText', target: first },
          { op: 'getText', target: second },
        ],
      });
      return { listed: answers(listed), accepted: answers(accepted), after: answers(after) };
    });
    expect(outcome.server).toEqual(outcome.browser);
    // Paired AND correct: a pair of hosts that both leak the neighbour's change agree perfectly.
    expect(outcome.server).toEqual({
      listed: {
        ok: true,
        changed: false,
        values: [
          { kind: 'handles', handles: [{ kind: 'revision', ref: 'revision:<host>:1' }] },
          { kind: 'handles', handles: [{ kind: 'revision', ref: 'revision:<host>:2' }] },
        ],
      },
      accepted: { ok: true, changed: true, values: [{ kind: 'applied' }] },
      after: {
        ok: true,
        changed: false,
        values: [
          { kind: 'handles', handles: [] },
          { kind: 'handles', handles: [{ kind: 'revision', ref: 'revision:<host>:2' }] },
          { kind: 'text', text: 'one proposed' },
          { kind: 'text', text: 'two proposed' },
        ],
      },
    });
  });

  test('a tracked insertion: what it is, and accepting it', () => {
    const outcome = onBoth((host) => {
      const { document: document_, body } = roots(host);
      const listed = host.execute({ operations: [{ op: 'getRevisions', body }] });
      const [revision] = handlesAt(listed, 0) as [AutomationHandle];
      const read = host.execute({
        operations: [
          { op: 'getRevisionType', revision },
          { op: 'getRevisionAuthor', revision },
          { op: 'getRevisionDate', revision },
          { op: 'getRevisionRange', revision },
        ],
      });
      const accepted = host.execute({ operations: [{ op: 'acceptRevision', revision }] });
      const after = host.execute({ operations: [{ op: 'getRevisions', body }] });
      const all = host.execute({ operations: [{ op: 'acceptAllRevisions', document: document_ }] });
      return {
        listed: answers(listed),
        read: answers(read),
        accepted: answers(accepted),
        after: answers(after),
        all: answers(all),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
  });
});
