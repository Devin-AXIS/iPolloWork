// `getReviewAuthors` and `setRevisionStyles` on the facade.
//
// The roster is the discovery surface: authors depend on the loaded file, so a legend or a
// per-reviewer colour picker has to READ who is in the document rather than be configured
// up front. The setter is the other half — a colour change is paint-level, so it must not
// cost the reader a remount (their undo history and caret).
//
// Runs on the free tier deliberately: the proposed view still projects surviving
// insertions with their attribution, which is enough for both the roster and the paint.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const TRACKED = docx(
  '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins>' +
    '<w:ins w:id="2" w:author="Grace Hopper" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t xml:space="preserve"> more</w:t></w:r></w:ins></w:p>'
);

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: TRACKED });
  return { editor, container };
}

function inkOf(container: HTMLElement, author: string): string | undefined {
  return container.querySelector<HTMLElement>(`.docx-revision[data-review-author="${author}"]`)
    ?.style.color;
}

describe('the author roster', () => {
  test('lists every revision author, in slot order, with the colour each resolves to', () => {
    const { editor } = mount();
    expect(editor.getReviewAuthors()).toEqual([
      { author: 'Ada Lovelace', slot: 0, color: 'var(--doc-review-author-0)' },
      { author: 'Grace Hopper', slot: 1, color: 'var(--doc-review-author-1)' },
    ]);
    editor.destroy();
  });

  test('is reference-stable between changes, and resolves host styles when set', () => {
    const { editor } = mount();
    expect(editor.getReviewAuthors()).toBe(editor.getReviewAuthors());
    editor.setRevisionStyles({
      authors: { 'Ada Lovelace': { color: '#7c3aed', avatarUrl: '/ada.png' } },
    });
    const authors = editor.getReviewAuthors();
    expect(authors[0]).toEqual({
      author: 'Ada Lovelace',
      slot: 0,
      color: '#7c3aed',
      style: { color: '#7c3aed', avatarUrl: '/ada.png' },
    });
    expect(authors[1]!.color).toBe('var(--doc-review-author-1)');
    editor.destroy();
  });

  test('answers empty while no surface is mounted', () => {
    const editor = createDocxEditor({});
    expect(editor.getReviewAuthors()).toEqual([]);
    editor.destroy();
  });
});

describe('setRevisionStyles, live', () => {
  test('repaints without a remount: the caret survives and the undo history stays', () => {
    const { editor, container } = mount();
    // Opens on the by-author default.
    expect(inkOf(container, 'Ada Lovelace')).toBe('var(--doc-review-author-0)');

    // Something to lose: an edit on the undo stack.
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);

    const before = editor.stateVersion();
    editor.setRevisionStyles('kind');
    expect(inkOf(container, 'Ada Lovelace')).toBe('var(--doc-revision-insertion)');
    expect(inkOf(container, 'Grace Hopper')).toBe('var(--doc-revision-insertion)');
    expect(editor.stateVersion()).toBeGreaterThan(before);

    // The undo history is intact — a remount would have emptied it.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);

    // And back to the by-author default.
    editor.setRevisionStyles('author');
    expect(inkOf(container, 'Ada Lovelace')).toBe('var(--doc-review-author-0)');
    editor.destroy();
  });

  test('live assignments are selective: one author restyles, the rest keep the default', () => {
    const { editor, container } = mount();
    editor.setRevisionStyles({ authors: { 'Grace Hopper': 'var(--brand-grace)' } });
    expect(inkOf(container, 'Grace Hopper')).toBe('var(--brand-grace)');
    // Ada has no assignment, and `others` defaults to the by-author ramp.
    expect(inkOf(container, 'Ada Lovelace')).toBe('var(--doc-review-author-0)');
    expect(editor.getReviewAuthors()[1]!.color).toBe('var(--brand-grace)');

    // `others: 'kind'` is how "highlight Grace, leave the rest green and red" is said.
    editor.setRevisionStyles({
      others: 'kind',
      authors: { 'Grace Hopper': 'var(--brand-grace)' },
    });
    expect(inkOf(container, 'Ada Lovelace')).toBe('var(--doc-revision-insertion)');
    expect(inkOf(container, 'Grace Hopper')).toBe('var(--brand-grace)');
    editor.destroy();
  });
});
