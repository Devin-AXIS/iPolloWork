import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  collectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '../../store/index.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from '../../store/__tests__/fixtures/review-table-grouping-cases.ts';
function mount(name: string) {
  const c = reviewTableGroupingCases.find((c) => c.name === name)!;
  const container = document.createElement('div');
  document.body.append(container);
  return createDocxEditor({
    container,
    author: 'Ada',
    document: zipSync(
      Object.fromEntries(
        Object.entries(reviewTableGroupingParts(c)).map(([key, value]) => [key, strToU8(value)])
      )
    ),
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: (part, id) => {
            const paragraph = findNode(part, id);
            return paragraph?.kind === 'paragraph'
              ? revisionItemsOf({ ...part, root: paragraph })
              : [];
          },
        },
      },
    ],
  });
}
for (const name of ['nested-two-rows-ins', 'nested-following-gap-ins']) {
  test(`${name} places nested row boundaries after independent cell text`, () => {
    const editor = mount(name);
    try {
      const items = editor.getReviewItems({ placement: false });
      expect(
        items.map((item) => (item.kind === 'revision' ? item.revisionKind : item.kind))
      ).toEqual(
        name === 'nested-two-rows-ins'
          ? ['insert', 'insert', 'structural', 'insert', 'structural']
          : ['insert', 'insert', 'structural', 'insert']
      );
    } finally {
      editor.destroy();
    }
  });
}
for (const command of ['acceptReviewItem', 'rejectReviewItem'] as const) {
  test(`${command} resolves an ordinary move while keeping its independent insertion`, () => {
    const editor = mount('move-range-pair');
    try {
      const before = editor.getReviewItems({ placement: false });
      expect(before).toHaveLength(4);
      const move = before.find(
        (entry) => entry.item.kind === 'revision' && entry.item.revisionKind === 'moveTo'
      )!;
      expect(editor[command](move.key).ok).toBe(true);
      const after = editor.getReviewItems({ placement: false });
      expect(after).toHaveLength(1);
      expect(after[0]!.item).toMatchObject({ revisionKind: 'insert', text: 'Moved' });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false }).map((item) => item.key)).toEqual(
        before.map((item) => item.key)
      );
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
  test(`${command} resolves a removed nested row with its own cell text`, () => {
    const editor = mount(
      command === 'acceptReviewItem' ? 'nested-following-gap-del' : 'nested-following-gap-ins'
    );
    try {
      const xml = () => serializeOoxmlPart(editor.surface!.session.part());
      const before = editor.getReviewItems({ placement: false });
      const original = xml();
      const row = before.find((item) => item.key.includes('revision-structural'))!;
      expect(row).toBeDefined();
      expect(editor[command](row.key).ok).toBe(true);
      // The row's cell text goes with the row; the text after the nested table stays pending.
      expect(
        editor
          .getReviewItems({ placement: false })
          .map((entry) => entry.item.kind === 'revision' && entry.item.text)
      ).toEqual(['Following']);
      expect(xml()).not.toContain('Nested A');
      expect(xml()).toContain('Unchanged');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(xml()).toBe(original);
    } finally {
      editor.destroy();
    }
  });
  for (const name of ['format-row-and-cells', 'adjacent-format-different-baseline']) {
    test(`${command} resolves ${name} atomically with undo and redo`, () => {
      const editor = mount(name);
      try {
        const before = editor.getReviewItems({ placement: false });
        expect(before).toHaveLength(1);
        expect(editor[command](before[0]!.key).ok).toBe(true);
        expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
        expect(editor.exec({ type: 'undo' }).ok).toBe(true);
        expect(editor.getReviewItems({ placement: false }).map((item) => item.key)).toEqual(
          before.map((item) => item.key)
        );
        expect(editor.exec({ type: 'redo' }).ok).toBe(true);
        expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
      } finally {
        editor.destroy();
      }
    });
  }
  test(`${command} resolves a table group in one undoable action`, () => {
    const editor = mount('paragraph-marks-ins');
    try {
      const before = editor.getReviewItems({ placement: false });
      expect(before).toHaveLength(1);
      expect(editor[command](before[0]!.key).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false }).map((i) => i.key)).toEqual(
        before.map((i) => i.key)
      );
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });
}
test('editing any grouped cell refreshes the full structural decision', () => {
  const editor = mount('two-rows-ins');
  try {
    const initial = editor.getReviewItems({ placement: false })[0]!;
    if (initial.item.kind !== 'revision') throw Error('Expected revision');
    const ranges = initial.item.ranges;
    expect(ranges).toHaveLength(4);
    const end = ranges[3]!.end;
    expect(
      editor.surface!.session.applyTreeOps([
        { op: 'insertText', paragraphId: end.paragraphId, offset: end.offset, text: 'Updated' },
      ]).committed
    ).toBe(true);
    const refreshed = editor.getReviewItems({ placement: false });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]!.key).toBe(initial.key);
    expect(refreshed[0]!.text).toContain('Updated');
  } finally {
    editor.destroy();
  }
});
test('independent deletion stays selectable beside the table group', () => {
  const editor = mount('row-insert-with-deletion');
  try {
    const items = editor.getReviewItems({ placement: false });
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(editor.setActiveReviewItem(item.key).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false }).find((i) => i.isActive)?.key).toBe(
        item.key
      );
    }
  } finally {
    editor.destroy();
  }
});

for (const command of ['acceptReviewItem', 'rejectReviewItem'] as const) {
  test(`${command} resolves the last grid-sharing row first across undo and redo`, () => {
    const editor = mount('format-grid-with-gap');
    try {
      const before = editor.getReviewItems({ placement: false });
      expect(before).toHaveLength(2);
      expect(editor[command](before[1]!.key).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(1);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false }).map((entry) => entry.key)).toEqual(
        before.map((entry) => entry.key)
      );
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      const remaining = editor.getReviewItems({ placement: false });
      expect(remaining).toHaveLength(1);
      expect(editor[command](remaining[0]!.key).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });
}

for (const name of ['format-table-property', 'format-grid-only'])
  for (const action of ['accept', 'reject'] as const) {
    test(`${action}: document-wide cleanup preserves ${name} with undo/redo`, () => {
      const editor = mount(name);
      try {
        const session = editor.surface!.session;
        const xml = () => serializeOoxmlPart(session.part());
        const before = xml();
        expect(editor.getReviewItems()).toHaveLength(0);
        expect(
          editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document', keys: [] }).ok
        ).toBe(false);
        expect(xml()).toBe(before);
        expect(
          editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' })
        ).toMatchObject({
          ok: true,
          changed: true,
          revisions: { resolved: [], skipped: [], remaining: 0 },
        });
        expect(xml()).not.toMatch(/<w:(tblPr|tblGrid)Change\b/);
        if (name === 'format-table-property') expect(xml()).toContain('w:val="center"');
        else
          expect([...xml().matchAll(/<w:gridCol[^>]*w:w="(\d+)"/g)].map((m) => m[1])).toEqual([
            '2000',
            '2000',
          ]);
        const after = xml();
        expect(editor.exec({ type: 'undo' }).ok).toBe(true);
        expect(xml()).toBe(before);
        expect(editor.exec({ type: 'redo' }).ok).toBe(true);
        expect(xml()).toBe(after);
      } finally {
        editor.destroy();
      }
    });
  }

for (const action of ['acceptReviewItem', 'rejectReviewItem'] as const) {
  for (const target of ['moveTo', 'insert'] as const) {
    test(`${action} orphan ${target} matches Word and undoes atomically`, () => {
      const editor = mount('move-range-wrapper-destination');
      try {
        const before = editor.getReviewItems();
        expect(before).toHaveLength(2);
        const item = before.find((i) => i.kind === 'revision' && i.revisionKind === target)!;
        expect(editor[action](item.key).ok).toBe(true);
        expect(editor.getReviewItems()).toHaveLength(
          action === 'acceptReviewItem' && target === 'insert' ? 1 : 0
        );
        const after = serializeOoxmlPart(editor.surface!.session.part());
        expect(after.includes('>Destination<')).toBe(
          action !== 'rejectReviewItem' || target !== 'insert'
        );
        expect(editor.exec({ type: 'undo' }).ok).toBe(true);
        expect(editor.getReviewItems().map((i) => i.key)).toEqual(before.map((i) => i.key));
        expect(editor.exec({ type: 'redo' }).ok).toBe(true);
        expect(serializeOoxmlPart(editor.surface!.session.part())).toBe(after);
      } finally {
        editor.destroy();
      }
    });
  }
}

for (const name of ['format-table-property', 'format-grid-only'])
  for (const action of ['accept', 'reject'] as const) {
    test(`${action}: the toolbar decision has nothing to do when ${name} is the only history`, () => {
      // The review list is empty, so the button agrees with it; history beside a listed change
      // clears with that change.
      const editor = mount(name);
      try {
        const xml = () => serializeOoxmlPart(editor.surface!.session.part());
        const before = xml();
        expect(editor.can({ type: 'resolveAllReviewChanges', action })).toMatchObject({
          ok: false,
          code: 'notFound',
        });
        expect(editor.exec({ type: 'resolveAllReviewChanges', action }).ok).toBe(false);
        expect(xml()).toBe(before);
      } finally {
        editor.destroy();
      }
    });
  }

test('a bulk decision that keeps a row says so in reviewChangesResolved', () => {
  const editor = mount('nested-plain-ins');
  try {
    const events: unknown[] = [];
    const off = editor.on('reviewChangesResolved', (event) => events.push(event));
    const row = editor
      .getReviewItems({ placement: false })
      .find((entry) => entry.item.kind === 'revision' && entry.item.revisionKind === 'structural')!;
    expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'reject' }).ok).toBe(true);
    off();
    expect(events).toEqual([
      expect.objectContaining({
        action: 'reject',
        skipped: [{ key: row.key, reason: 'retained-structure', detail: 'nested-table' }],
      }),
    ]);
  } finally {
    editor.destroy();
  }
});

for (const [name, command] of [
  ['nested-plain-ins', 'rejectReviewItem'],
  ['nested-plain-del', 'acceptReviewItem'],
] as const)
  test(`${command} on a row kept for its nested table refuses and changes nothing`, () => {
    const editor = mount(name);
    try {
      const xml = () => serializeOoxmlPart(editor.surface!.session.part());
      const before = xml();
      const row = editor
        .getReviewItems({ placement: false })
        .find(
          (entry) => entry.item.kind === 'revision' && entry.item.revisionKind === 'structural'
        )!;
      const result = editor[command](row.key);
      expect(result).toMatchObject({ ok: false, code: 'unsupported' });
      expect(result.ok ? '' : result.reason).toContain('retained-structure');
      expect(xml()).toBe(before);
    } finally {
      editor.destroy();
    }
  });

for (const [name, action] of [
  ['nested-plain-ins', 'reject'],
  ['nested-plain-del', 'accept'],
  ['nested-opposite-row-ins', 'reject'],
  ['nested-opposite-row-del', 'accept'],
] as const) {
  test(`${action} ${name} reports a retained structure and undoes the partial decision`, () => {
    const editor = mount(name);
    try {
      const session = editor.surface!.session;
      const xml = () => serializeOoxmlPart(session.part());
      const before = xml();
      const count = editor.getReviewItems().length;
      expect(
        editor.exec({
          type: 'resolveAllReviewChanges',
          action,
          scope: 'document',
          unsupported: 'fail',
        }).ok
      ).toBe(false);
      expect(xml()).toBe(before);
      const result = editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' });
      expect(result).toMatchObject({
        ok: true,
        changed: true,
        revisions: { remaining: 1, skipped: [{ reason: 'retained-structure' }] },
      });
      expect(editor.getReviewItems()).toHaveLength(1);
      expect(xml().match(/<w:tbl\b/g)).toHaveLength(2);
      expect(xml()).not.toContain('>Outer<');
      const after = xml();
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(xml()).toBe(before);
      expect(editor.getReviewItems()).toHaveLength(count);
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(xml()).toBe(after);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' }).ok).toBe(
        false
      );
      expect(xml()).toBe(after);
    } finally {
      editor.destroy();
    }
  });
}

for (const [name, command] of [
  ['cell-markers-del', 'acceptReviewItem'],
  ['cell-markers-ins', 'rejectReviewItem'],
] as const)
  test(`${command} on one changed cell leaves the neighbour cell's change pending`, () => {
    const editor = mount(name);
    try {
      const cells = () =>
        editor
          .getReviewItems({ placement: false })
          .filter(
            (entry) => entry.item.kind === 'revision' && entry.item.revisionKind === 'structural'
          );
      expect(cells()).toHaveLength(2);
      expect(editor[command](cells()[0]!.key)).toMatchObject({ ok: true });
      expect(cells()).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
