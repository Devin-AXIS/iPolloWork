import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from '../../store/__tests__/fixtures/review-table-grouping-cases.ts';
import { handlesAt, open, reopen, savedPartBytes } from './support/protocol.ts';
for (const action of ['acceptRevision', 'rejectRevision'] as const) {
  test(`automation ${action} resolves an ordinary move and saves the remaining insertion`, () => {
    const fixture = reviewTableGroupingCases.find((entry) => entry.name === 'move-range-pair')!;
    const current = reopen(
      open(
        zipSync(
          Object.fromEntries(
            Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [
              name,
              strToU8(xml),
            ])
          )
        )
      )
    );
    const revisions = handlesAt(
      current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
      0
    );
    expect(revisions).toHaveLength(4);
    expect(
      current.host.execute({ operations: [{ op: action, revision: revisions[0]! }] })
    ).toMatchObject({ ok: true });
    const after = reopen(current.host);
    expect(
      handlesAt(after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }), 0)
    ).toHaveLength(1);
    const xml = savedPartBytes(after.host, 'word/document.xml');
    expect(xml).toContain('<w:ins');
    expect(xml).not.toMatch(/<w:move(?:From|To)Range/);
  });
  test(`automation ${action} resolves each row and text decision alone`, () => {
    const fixture = reviewTableGroupingCases.find(
      (c) =>
        c.name ===
        (action === 'acceptRevision' ? 'nested-following-gap-del' : 'nested-following-gap-ins')
    )!;
    const bytes = zipSync(
      Object.fromEntries(
        Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [name, strToU8(xml)])
      )
    );
    let refused = 0;
    for (let index = 0; index < 4; index++) {
      const current = reopen(open(bytes));
      const before = savedPartBytes(current.host, 'word/document.xml');
      const revisions = handlesAt(
        current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
        0
      );
      expect(revisions).toHaveLength(4);
      const result = current.host.execute({
        operations: [{ op: action, revision: revisions[index]! }],
      });
      if (!result.ok) {
        refused++;
        expect(savedPartBytes(current.host, 'word/document.xml')).toEqual(before);
      }
    }
    // Three text edits resolve alone, and the row resolves with the cell text it removes.
    expect(refused).toBe(0);
  });
  test(`automation ${action} resolves mixed table formatting`, () => {
    const fixture = reviewTableGroupingCases.find((c) => c.name === 'format-row-and-cells')!;
    const current = reopen(
      open(
        zipSync(
          Object.fromEntries(
            Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [
              name,
              strToU8(xml),
            ])
          )
        )
      )
    );
    const revisions = handlesAt(
      current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
      0
    );
    expect(revisions).toHaveLength(1);
    expect(
      current.host.execute({ operations: [{ op: action, revision: revisions[0]! }] })
    ).toMatchObject({ ok: true });
    const after = reopen(current.host);
    expect(
      handlesAt(after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }), 0)
    ).toHaveLength(0);
    expect(savedPartBytes(after.host, 'word/document.xml').includes('FFFF00')).toBe(
      action === 'acceptRevision'
    );
    expect(savedPartBytes(after.host, 'word/document.xml').includes('<w:trHeight')).toBe(
      action === 'acceptRevision'
    );
  });
  test(`automation ${action} resolves a whole table group`, () => {
    const fixture = reviewTableGroupingCases.find((c) => c.name === 'paragraph-marks-ins')!;
    const host = open(
      zipSync(
        Object.fromEntries(
          Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [
            name,
            strToU8(xml),
          ])
        )
      )
    );
    const current = reopen(host);
    const revisions = handlesAt(
      current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
      0
    );
    expect(revisions).toHaveLength(1);
    const result = current.host.execute({ operations: [{ op: action, revision: revisions[0]! }] });
    expect(result).toMatchObject({ ok: true });
    const after = reopen(current.host);
    expect(
      handlesAt(after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }), 0)
    ).toHaveLength(0);
    expect(savedPartBytes(after.host, 'word/document.xml').includes('First A')).toBe(
      action === 'acceptRevision'
    );
  });
}

test('automation resolves an insertion without answering a move range sharing its address', () => {
  const attrs = 'w:id="7" w:author="Ada"';
  const body = `<w:p><w:moveToRangeStart ${attrs} w:name="Alias"/><w:ins ${attrs}><w:r><w:t>Keep</w:t></w:r></w:ins><w:moveToRangeEnd w:id="7"/></w:p>`;
  const current = reopen(
    open(
      zipSync(
        Object.fromEntries(
          Object.entries(reviewTableGroupingParts({ name: 'move-address-alias', body })).map(
            ([name, xml]) => [name, strToU8(xml)]
          )
        )
      )
    )
  );
  const revisions = handlesAt(
    current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
    0
  );
  expect(revisions).toHaveLength(2);
  expect(
    current.host.execute({ operations: [{ op: 'acceptRevision', revision: revisions[1]! }] })
  ).toMatchObject({ ok: true });
  const xml = savedPartBytes(current.host, 'word/document.xml');
  expect(xml).toContain('<w:moveToRangeStart');
  expect(xml).not.toContain('<w:ins');
  const after = reopen(current.host);
  expect(
    handlesAt(after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }), 0)
  ).toHaveLength(1);
});

for (const action of ['acceptRevision', 'rejectRevision'] as const) {
  test(`automation ${action} preserves shared grid history through a partial save/reopen`, () => {
    const fixture = reviewTableGroupingCases.find(
      (entry) => entry.name === 'format-grid-with-gap'
    )!;
    const current = reopen(
      open(
        zipSync(
          Object.fromEntries(
            Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [
              name,
              strToU8(xml),
            ])
          )
        )
      )
    );
    const revisions = handlesAt(
      current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
      0
    );
    expect(revisions).toHaveLength(2);
    expect(
      current.host.execute({ operations: [{ op: action, revision: revisions[1]! }] })
    ).toMatchObject({ ok: true });
    expect(savedPartBytes(current.host, 'word/document.xml')).toContain('<w:tblGridChange');
    const after = reopen(current.host);
    const remaining = handlesAt(
      after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }),
      0
    );
    expect(remaining).toHaveLength(1);
    expect(
      after.host.execute({ operations: [{ op: action, revision: remaining[0]! }] })
    ).toMatchObject({ ok: true });
    expect(savedPartBytes(after.host, 'word/document.xml')).not.toContain('<w:tblGridChange');
    expect(
      handlesAt(after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }), 0)
    ).toHaveLength(0);
  });
}
