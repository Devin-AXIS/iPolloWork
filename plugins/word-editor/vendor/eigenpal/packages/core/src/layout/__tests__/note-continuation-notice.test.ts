import { expect, test } from 'bun:test';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { forEachSemanticSpan } from '../export-traversal.ts';
import type { PageRecord } from '../semantic-records.ts';
import { noticeFixture } from './note-continuation-fixture.ts';
const noteLines = (page: PageRecord) =>
  page.footnotes?.notes.reduce(
    (n, note) =>
      n + note.fragments.reduce((n, p) => n + (p.kind === 'paragraph' ? p.lines.length : 0), 0),
    0
  ) ?? 0;
for (const notice of [null, '', 'Continued']) {
  test(`notice ${String(notice)} respects a required body opening`, () => {
    const { document, options } = noticeFixture(notice);
    const layout = layoutSemanticDocument(document, 0, options);
    expect(layout.pages).toHaveLength(2);
    expect(noteLines(layout.pages[0]!)).toBe(notice === null ? 4 : 3);
    expect(noteLines(layout.pages[1]!)).toBe(notice === null ? 2 : 3);
    const furniture = layout.pages[0]!.footnotes?.continuationNotice;
    expect(furniture?.box.height ?? 0).toBe(notice === null ? 0 : 12);
    expect(layout.pages[1]!.footnotes?.continuationNotice).toBeUndefined();
    const text: string[] = [];
    forEachSemanticSpan(layout, (v) => {
      if (v.story === 'note-separator') text.push(v.span.text);
    });
    if (notice) expect(text.join('')).toBe(notice);
    const paragraph = furniture?.fragments[0];
    if (paragraph?.kind === 'paragraph')
      expect(caretAt(layout, { paragraphId: paragraph.paragraphId, offset: 0 })).toBeNull();
    expect(layoutSemanticDocument(document, 0, options).pages).toEqual(layout.pages);
    expect(
      layoutSemanticDocument(document, 0, { ...options, session: createLayoutSession() }).pages
    ).toEqual(layout.pages);
  });
}
test('notice growth and removal retain cold geometry', () => {
  const initial = noticeFixture(null);
  layoutSemanticDocument(initial.document, 0, initial.options);
  for (const [text, height] of [
    ['Continued', 12],
    ['', 24],
    [null, 12],
  ] as const) {
    const changed = noticeFixture(text, height);
    const options = { ...changed.options, session: initial.options.session };
    const warm = layoutSemanticDocument(changed.document, height, options);
    expect(warm.pages).toEqual(
      layoutSemanticDocument(changed.document, height, {
        ...options,
        session: createLayoutSession(),
      }).pages
    );
  }
});
test('a fitting note has no continuation notice', () => {
  const { document, options } = noticeFixture('Continued', 12, false, 1);
  const layout = layoutSemanticDocument(document, 0, options);
  expect(layout.pages.every((p) => !p.footnotes?.continuationNotice)).toBe(true);
});
test('a later reference cannot consume room occupied by an earlier split head', () => {
  const { document, options } = noticeFixture('Continued', 12, true);
  const layout = layoutSemanticDocument(document, 0, options);
  const referencePage = layout.pages.find((p) =>
    p.fragments.some(
      (f) =>
        f.kind === 'paragraph' && f.lines.some((l) => l.spans.some((s) => s.text === 'Reference'))
    )
  );
  expect(referencePage).toBeDefined();
  for (const id of [2, 3])
    expect(
      layout.pages.find((p) => p.footnotes?.notes.some((n) => n.noteId === id && !n.continuation))
        ?.index
    ).toBe(referencePage!.index);
  for (const page of layout.pages) {
    const area = page.footnotes;
    if (!area) continue;
    for (const block of page.fragments) {
      if (block.kind !== 'paragraph') continue;
      for (const line of block.lines)
        expect(page.contentBox.y + line.box.y + line.box.height).toBeLessThanOrEqual(
          area.box.y + 0.001
        );
    }
    expect(area.box.y + area.box.height).toBeLessThanOrEqual(
      page.contentBox.y + page.contentBox.height + 0.001
    );
    for (const note of area.notes)
      expect(note.box.y + note.box.height).toBeLessThanOrEqual(
        area.continuationNotice?.box.y ?? area.box.y + area.box.height + 0.001
      );
  }
  expect(layoutSemanticDocument(document, 0, options).pages).toEqual(layout.pages);
});
test('oversized notices retain bounded progress', () => {
  const { document, options } = noticeFixture('Continued', 1000);
  const layout = layoutSemanticDocument(document, 0, options);
  expect(layout.pages.length).toBeLessThanOrEqual(3);
  expect(layout.pages.reduce((n, p) => n + noteLines(p), 0)).toBe(6);
  expect(layout.pages.every((p) => !p.footnotes?.continuationNotice)).toBe(true);
  expect(
    layout.pages.some((p) => p.footnotes?.fallbackReason === 'note-continuation-notice-height-cap')
  ).toBe(true);
});

test('multi-paragraph notices reserve their complete height without extra note ownership', () => {
  const { document, options } = noticeFixture('Continued', 12, false, 6, 2);
  const layout = layoutSemanticDocument(document, 0, options);
  expect(noteLines(layout.pages[0]!)).toBe(2);
  expect(noteLines(layout.pages[1]!)).toBe(4);
  expect(layout.pages[0]!.footnotes?.continuationNotice?.box.height).toBe(24);
  expect(layout.pages.flatMap((p) => p.footnotes?.notes.map((n) => n.noteId) ?? [])).toEqual([
    2, 2,
  ]);
});

test('a notice that leaves no legal note line cannot stall the continuation stream', () => {
  const { document, options } = noticeFixture('Continued', 620, false, 70);
  const layout = layoutSemanticDocument(document, 0, options);
  expect(layout.pages.length).toBeLessThanOrEqual(4);
  expect(layout.pages.reduce((count, page) => count + noteLines(page), 0)).toBe(70);
  expect(
    layout.pages.some(
      (page) => page.footnotes?.fallbackReason === 'note-continuation-notice-height-cap'
    )
  ).toBe(true);
});
