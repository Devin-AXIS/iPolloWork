import { expect, test } from 'bun:test';
import type { AutomationOperation } from '../operations.ts';
import type { AutomationHandle } from '../protocol.ts';
import {
  cell,
  docx,
  handlesAt,
  open,
  p,
  roots,
  row,
  savedMainXml,
  savedPartBytes,
  table,
} from './support/protocol.ts';
import { REL_TYPES, noteReference, notesPart, richDocx } from './support/furniture.ts';
import { noteBodies } from './support/review-comments.ts';

const marker = (name: string) =>
  `<w:${name} w:id="1" w:author="Human" w:date="2026-08-01T00:00:00Z"/>`;
const text = () => p('head target tail');
const revisedRow = (kind: 'ins' | 'del') =>
  `<w:tr><w:trPr>${marker(kind)}</w:trPr>` +
  cell(text(), text()) +
  cell(text(), table(row(cell(text())))) +
  '</w:tr>';

function proposal(
  paragraph: AutomationHandle,
  kind: 'insertion' | 'deletion' | 'replacement',
  tracked: boolean
): AutomationOperation {
  const span = { start: { paragraph, offset: 5 }, end: { paragraph, offset: 11 } };
  if (tracked) {
    return kind === 'insertion'
      ? { op: 'insertText', at: span.start, text: 'NEW' }
      : { op: 'replaceSpan', span, text: kind === 'deletion' ? '' : 'NEW' };
  }
  if (kind === 'insertion')
    return { op: 'proposeInsertion', span, text: 'NEW', where: 'After', author: 'Agent' };
  if (kind === 'deletion') return { op: 'proposeDeletion', span, author: 'Agent' };
  return { op: 'proposeReplacement', span, text: 'NEW', author: 'Agent' };
}

for (const revision of ['ins', 'del'] as const) {
  for (const tracked of [false, true]) {
    for (const kind of ['insertion', 'deletion', 'replacement'] as const) {
      test(`${tracked ? 'tracked' : 'explicit'} ${kind} refuses every paragraph of a row ${revision}`, () => {
        const host = open(docx(table(revisedRow(revision), row(cell(text())))));
        try {
          const { body } = roots(host);
          const paragraphs = handlesAt(
            host.execute({ operations: [{ op: 'getParagraphs', body }] }),
            0
          );
          expect(paragraphs).toHaveLength(6); // The last is the body's paragraph after the table.
          const before = savedMainXml(host);
          const revisionBefore = host.revision();
          // First/later paragraphs, another cell, and a nested table share the row revision.
          for (const paragraph of paragraphs.slice(0, 4)) {
            const operations: AutomationOperation[] = tracked
              ? [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' }]
              : [];
            operations.push(proposal(paragraph, kind, tracked));
            const result = host.execute({ operations });
            expect(result.ok).toBe(false);
            expect(result.results.at(-1)).toMatchObject({
              status: 'error',
              error: { code: 'unsupported-revision' },
            });
            expect(host.revision()).toBe(revisionBefore);
            expect(savedMainXml(host)).toBe(before);
          }
          // The row revision must not prevent a proposal in a separate row.
          const operations: AutomationOperation[] = tracked
            ? [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' }]
            : [];
          operations.push(proposal(paragraphs[4]!, kind, tracked));
          expect(host.execute({ operations }).ok).toBe(true);
          expect(savedMainXml(host)).toContain('w:author="Agent"');
        } finally {
          host.dispose();
        }
      });
    }
  }
}

for (const revision of ['cellIns', 'cellDel']) {
  test(`${revision} covers its own cell without blocking the row's display anchor`, () => {
    const changedCell = `<w:tc><w:tcPr>${marker(revision)}</w:tcPr>${text()}${text()}</w:tc>`;
    const host = open(docx(table(row(cell(text()), changedCell))));
    try {
      const { body } = roots(host);
      const paragraphs = handlesAt(
        host.execute({ operations: [{ op: 'getParagraphs', body }] }),
        0
      );
      for (const paragraph of paragraphs.slice(1, 3)) {
        expect(host.execute({ operations: [proposal(paragraph, 'replacement', false)] }).ok).toBe(
          false
        );
      }
      // Cell revision cards use offset zero of the first cell as their display anchor.
      expect(
        host.execute({
          operations: [
            {
              op: 'proposeInsertion',
              span: {
                start: { paragraph: paragraphs[0]!, offset: 0 },
                end: { paragraph: paragraphs[0]!, offset: 0 },
              },
              where: 'Before',
              text: 'NEW',
              author: 'Agent',
            },
          ],
        }).ok
      ).toBe(true);
    } finally {
      host.dispose();
    }
  });
}

for (const revision of ['rowIns', 'rowDel', 'cellMerge', 'inlineIns'] as const) {
  // A tracked edit nests in another author's inserted text; see the test after this loop.
  for (const tracked of revision === 'inlineIns' ? [false] : [false, true]) {
    test(`${tracked ? 'tracked' : 'explicit'} proposals check ${revision} shared across notes`, () => {
      const content =
        revision === 'inlineIns'
          ? '<w:p><w:ins w:id="1" w:author="Human">' +
            '<w:r><w:t>head target tail</w:t></w:r></w:ins></w:p>'
          : revision === 'cellMerge'
            ? table(row(`<w:tc><w:tcPr>${marker('cellMerge')}</w:tcPr>${text()}${text()}</w:tc>`))
            : table(revisedRow(revision === 'rowIns' ? 'ins' : 'del'));
      const host = open(
        richDocx({
          body: `<w:p>${[1, 2, 3].map((id) => noteReference('footnote', id)).join('')}</w:p>`,
          rels: [{ id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
          parts: [
            notesPart('footnote', [
              { id: 1, xml: content },
              { id: 2, xml: content },
              { id: 3, xml: text() },
            ]),
          ],
        })
      );
      try {
        const bodies = noteBodies(host);
        const before = savedPartBytes(host, 'word/footnotes.xml');
        const revisionBefore = host.revision();
        for (const body of bodies.slice(0, 2)) {
          const paragraphs = handlesAt(
            host.execute({ operations: [{ op: 'getParagraphs', body }] }),
            0
          );
          // A note that ends with a table reads an empty paragraph after it, outside the table.
          for (const paragraph of revision === 'inlineIns' ? paragraphs : paragraphs.slice(0, -1)) {
            const operations: AutomationOperation[] = tracked
              ? [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' }]
              : [];
            operations.push(proposal(paragraph, 'replacement', tracked));
            const response = host.execute({ operations });
            expect(response.results.at(-1)).toMatchObject({
              status: 'error',
              error: { code: 'unsupported-revision' },
            });
            expect(host.revision()).toBe(revisionBefore);
            expect(savedPartBytes(host, 'word/footnotes.xml')).toBe(before);
          }
        }
        // A third note shares the part, but none of the revised owners or text ranges.
        const [paragraph] = handlesAt(
          host.execute({ operations: [{ op: 'getParagraphs', body: bodies[2]! }] }),
          0
        );
        const operations: AutomationOperation[] = tracked
          ? [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' }]
          : [];
        operations.push(proposal(paragraph!, 'replacement', tracked));
        expect(host.execute({ operations }).ok).toBe(true);
      } finally {
        host.dispose();
      }
    });
  }
}

test("a tracked replacement nests in another author's insertion in one note only", () => {
  const inserted =
    '<w:p><w:ins w:id="1" w:author="Human"><w:r><w:t>head target tail</w:t></w:r></w:ins></w:p>';
  const host = open(
    richDocx({
      body: `<w:p>${[1, 2].map((id) => noteReference('footnote', id)).join('')}</w:p>`,
      rels: [{ id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
      parts: [
        notesPart('footnote', [
          { id: 1, xml: inserted },
          { id: 2, xml: inserted },
        ]),
      ],
    })
  );
  try {
    const [first] = noteBodies(host);
    const [paragraph] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body: first! }] }),
      0
    );
    const response = host.execute({
      operations: [
        { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' },
        proposal(paragraph!, 'replacement', true),
      ],
    });
    expect(response.ok).toBe(true);
    const xml = savedPartBytes(host, 'word/footnotes.xml');
    expect(xml.match(/<w:del [^>]*w:author="Agent"/g)).toHaveLength(1);
    expect(xml).toMatch(
      /<w:ins w:author="Human" w:id="1"><w:r>[^<]*<w:t[^>]*>head <\/w:t><\/w:r><w:del w:author="Agent"/
    );
    // The other note's insertion shared the id in the file. It is another note's change, so
    // the saved copy gives it its own; the pieces of this note's insertion keep id 1.
    const other = xml.match(
      /<w:ins w:author="Human" w:id="(\d+)"><w:r><w:t>head target tail<\/w:t><\/w:r><\/w:ins>/
    );
    expect(other?.[1]).toBeDefined();
    expect(other?.[1]).not.toBe('1');
    // The author's own deletion and insertion each resolve alone.
    const saved = host.save();
    if (!saved.ok) throw new Error(saved.error.code);
    for (const action of ['acceptRevision', 'rejectRevision'] as const) {
      const copy = open(saved.bytes);
      try {
        const [note] = noteBodies(copy);
        const found = handlesAt(
          copy.execute({ operations: [{ op: 'getRevisions', body: note! }] }),
          0
        );
        const authors = copy.execute({
          operations: found.map((revision) => ({ op: 'getRevisionAuthor' as const, revision })),
        });
        const own = found.filter(
          (_, index) =>
            (authors.results[index] as { value: { text: string } }).value.text === 'Agent'
        );
        expect(own).toHaveLength(2);
        for (const revision of own) {
          const decided = copy.execute({ operations: [{ op: action, revision }] });
          expect(decided.results[0]).toMatchObject({ status: 'ok' });
        }
        expect(savedPartBytes(copy, 'word/footnotes.xml')).not.toContain('w:author="Agent"');
      } finally {
        copy.dispose();
      }
    }
  } finally {
    host.dispose();
  }
});
