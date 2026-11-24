// A replacement lands in the container of the text it replaces.
//
// Deleting first and inserting at the range start put the new text where an insert at that
// boundary goes: after a hyperlink, a content control, or a bold run that the range ended.
// A fix of "teh" at the end of a link left "t" in the link and "he" outside it.

import { afterEach, describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { docx } from './paginated-surface-fixtures.ts';
import { fix, openReviewEditor } from './replace-accepted-text-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const CONTAINERS = {
  hyperlink: {
    body: `<w:p><w:hyperlink w:anchor="target">${run('see teh')}</w:hyperlink>${run(' cat')}</w:p>`,
    inside: /<w:hyperlink[^>]*>.*see the<\/w:t><\/w:r><\/w:hyperlink>/,
  },
  'inline content control': {
    body:
      `<w:p><w:sdt><w:sdtPr><w:alias w:val="Term"/></w:sdtPr><w:sdtContent>${run('see teh')}` +
      `</w:sdtContent></w:sdt>${run(' cat')}</w:p>`,
    inside: /<w:sdtContent>.*see the<\/w:t><\/w:r><\/w:sdtContent>/,
  },
  'bold run end': {
    body: `<w:p>${run('see teh', '<w:b/>')}${run(' cat')}</w:p>`,
    inside: /<w:b\/><\/w:rPr><w:t[^>]*>see the<\/w:t>/,
  },
} as const;

function mount(body: string) {
  const mounted = openReviewEditor(docx(body));
  cleanups.push(mounted.destroy);
  return mounted.editor;
}

const xmlOf = (editor: ReturnType<typeof mount>) =>
  serializeOoxmlPart(editor.surface!.session.part());

describe.each(Object.entries(CONTAINERS))('a fix at the end of a %s', (_, { body, inside }) => {
  test('replaceAcceptedText keeps the new letters inside', () => {
    const editor = mount(body);
    const paragraph = editor.getParagraphs()[0]!;
    expect(editor.exec(fix(paragraph.blockId, 4, 3, 'the', 'teh')).ok).toBe(true);
    expect(editor.getParagraphs()[0]!.acceptedText).toBe('see the cat');
    expect(xmlOf(editor)).toMatch(inside);
  });

  test('replaceMatch keeps the new letters inside', () => {
    const editor = mount(body);
    const [match] = editor.findMatches('teh');
    expect(editor.exec({ type: 'replaceMatch', match: match!, text: 'the' }).ok).toBe(true);
    expect(editor.getParagraphs()[0]!.acceptedText).toBe('see the cat');
    expect(xmlOf(editor)).toMatch(inside);
  });

  test('replaceAllMatches keeps the new letters inside', () => {
    const editor = mount(body);
    expect(editor.exec({ type: 'replaceAllMatches', query: 'teh', text: 'the' }).ok).toBe(true);
    expect(xmlOf(editor)).toMatch(inside);
  });
});

test('a suggested fix at the end of a hyperlink stays in the link', () => {
  const editor = mount(CONTAINERS.hyperlink.body);
  expect(editor.setEditingMode('suggesting').ok).toBe(true);
  const paragraph = editor.getParagraphs()[0]!;
  expect(editor.exec(fix(paragraph.blockId, 4, 3, 'the')).ok).toBe(true);
  expect(editor.getParagraphs()[0]!.acceptedText).toBe('see the cat');
  const link = /<w:hyperlink[^>]*>(.*?)<\/w:hyperlink>/.exec(xmlOf(editor))?.[1] ?? '';
  expect(link).toContain('<w:ins ');
});
