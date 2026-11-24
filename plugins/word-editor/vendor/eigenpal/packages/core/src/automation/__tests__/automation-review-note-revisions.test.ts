import { describe, expect, test } from 'bun:test';
import { MAX_NOTES_PER_PART } from '../../store/package/note-nodes.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import { REL_TYPES, noteReference, notesPart, richDocx } from './support/furniture.ts';
import { noteBodies } from './support/review-comments.ts';
import { errorAt, handleAt, handlesAt, open, reopen, savedPartBytes } from './support/protocol.ts';

function revisionsOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0);
}

function collidingReviewedNotes(siblingKind: 'ins' | 'del'): AutomationHost {
  const triple = `w:id="7" w:author="Same" w:date="2026-04-07T09:00:00Z"`;
  const tracked = (kind: 'ins' | 'del', text: string): string =>
    kind === 'ins'
      ? `<w:ins ${triple}><w:r><w:t>${text}</w:t></w:r></w:ins>`
      : `<w:del ${triple}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
  return open(
    richDocx({
      body: `<w:p>${noteReference('footnote', 1)}${noteReference('footnote', 2)}</w:p>`,
      rels: [{ id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
      parts: [
        notesPart('footnote', [
          { id: 1, xml: `<w:p>${tracked('ins', 'target')}</w:p>` },
          { id: 2, xml: `<w:p>${tracked(siblingKind, 'sibling')}</w:p>` },
        ]),
      ],
    })
  );
}

describe('a note revision collection is rooted in exactly one shared-part story', () => {
  test('same-identity sibling insertions cannot turn accept-all into a false no-op', () => {
    const host = collidingReviewedNotes('ins');
    const [first] = noteBodies(host);
    // The old listing-based planner grouped both sites into one mixed-story card, listed it in
    // neither note, and reported success after planning zero writes.
    expect(revisionsOf(host, first!)).toEqual([]);
    expect(host.execute({ operations: [{ op: 'acceptAllRevisions', body: first! }] }).ok).toBe(
      true
    );

    const next = reopen(host);
    const [afterFirst, afterSecond] = noteBodies(next.host);
    expect(revisionsOf(next.host, afterFirst!)).toEqual([]);
    expect(revisionsOf(next.host, afterSecond!)).toHaveLength(1);
    expect(savedPartBytes(next.host, 'word/footnotes.xml').match(/<w:ins\b/g) ?? []).toHaveLength(
      1
    );
  });

  test('a target insertion cannot leak to a sibling deletion with the same identity', () => {
    const host = collidingReviewedNotes('del');
    const [first] = noteBodies(host);
    expect(host.execute({ operations: [{ op: 'acceptAllRevisions', body: first! }] }).ok).toBe(
      true
    );

    const next = reopen(host);
    const [afterFirst, afterSecond] = noteBodies(next.host);
    expect(revisionsOf(next.host, afterFirst!)).toEqual([]);
    expect(revisionsOf(next.host, afterSecond!)).toHaveLength(1);
    const notesXml = savedPartBytes(next.host, 'word/footnotes.xml');
    expect(notesXml).not.toContain('<w:ins');
    expect(notesXml).toContain('<w:del ');
  });
});

describe('duplicate note identities fail closed before handles exist', () => {
  test('getNotes refuses ambiguity and exposes no proxy that can resolve revisions', () => {
    const triple = `w:id="7" w:author="Same" w:date="2026-04-07T09:00:00Z"`;
    const host = open(
      richDocx({
        body: `<w:p>${noteReference('footnote', 1)}</w:p>`,
        rels: [{ id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
        parts: [
          notesPart('footnote', [
            { id: 1, xml: `<w:p><w:ins ${triple}><w:r><w:t>first</w:t></w:r></w:ins></w:p>` },
            { id: 1, xml: `<w:p><w:ins ${triple}><w:r><w:t>second</w:t></w:r></w:ins></w:p>` },
          ]),
        ],
      })
    );
    const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
    const before = savedPartBytes(host, 'word/footnotes.xml');
    const response = host.execute({
      operations: [{ op: 'getNotes', document, noteKind: 'footnote' }],
    });

    expect(errorAt(response, 0)).toBe('ambiguous-document');
    expect(response.changed).toBe(false);
    expect(savedPartBytes(host, 'word/footnotes.xml')).toBe(before);
    expect(before.match(/<w:ins\b/g) ?? []).toHaveLength(2);
  });

  test('a duplicate beyond the note cap cannot hide behind a truncated prefix', () => {
    const notes = Array.from({ length: MAX_NOTES_PER_PART - 1 }, (_, index) => ({
      id: index === MAX_NOTES_PER_PART - 2 ? 1 : index + 1,
      xml: '<w:p/>',
    }));
    const host = open(
      richDocx({
        body: `<w:p>${noteReference('footnote', 1)}</w:p>`,
        rels: [{ id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
        parts: [notesPart('footnote', notes)],
      })
    );
    const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
    const before = savedPartBytes(host, 'word/footnotes.xml');
    const response = host.execute({
      operations: [{ op: 'getNotes', document, noteKind: 'footnote' }],
    });

    expect(errorAt(response, 0)).toBe('ambiguous-document');
    expect(response.changed).toBe(false);
    expect(savedPartBytes(host, 'word/footnotes.xml')).toBe(before);
  });
});

for (const action of ['accept', 'reject'] as const) {
  test(`batch ${action} scopes repeated note identities without consuming sibling changes`, () => {
    const host = collidingReviewedNotes('ins');
    const [first] = noteBodies(host);
    const response = host.execute({
      operations: [{ op: 'resolveRevisionBatch', body: first!, action }],
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('batch refused');
    expect(response.results[0]).toMatchObject({
      status: 'ok',
      value: { kind: 'revisionBatch', result: { remaining: 0, skipped: [] } },
    });
    const next = reopen(host);
    const notesXml = savedPartBytes(next.host, 'word/footnotes.xml');
    expect(notesXml.match(/<w:ins\b/g) ?? []).toHaveLength(1);
    expect(notesXml).toContain('sibling');
    expect(notesXml.includes('target')).toBe(action === 'accept');
  });
}

test('an explicit batch refuses a revision handle from another note atomically', () => {
  const host = open(
    richDocx({
      body: `<w:p>${noteReference('footnote', 1)}${noteReference('footnote', 2)}</w:p>`,
      rels: [{ id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
      parts: [
        notesPart(
          'footnote',
          [1, 2].map((id) => ({
            id,
            xml: `<w:p><w:ins w:id="${id}" w:author="Ada"><w:r><w:t>note${id}</w:t></w:r></w:ins></w:p>`,
          }))
        ),
      ],
    })
  );
  const [first, second] = noteBodies(host);
  const local = revisionsOf(host, first!);
  const foreign = revisionsOf(host, second!);
  expect(local).toHaveLength(1);
  expect(foreign).toHaveLength(1);
  const before = savedPartBytes(host, 'word/footnotes.xml');
  const result = host.execute({
    operations: [
      {
        op: 'resolveRevisionBatch',
        body: first!,
        action: 'accept',
        revisions: [...local, ...foreign],
      },
    ],
  });
  expect(errorAt(result, 0)).toBe('invalid-handle');
  expect(result.changed).toBe(false);
  expect(savedPartBytes(host, 'word/footnotes.xml')).toBe(before);
});
