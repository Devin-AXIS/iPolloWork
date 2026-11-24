import { afterEach, expect, test } from 'bun:test';
import {
  collectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
function sample(options: { gap?: string; secondAuthor?: string; mark?: boolean } = {}) {
  let id = 0;
  const ins = (xml: string, author = 'Reviewer') =>
    `<w:ins w:id="${++id}" w:author="${author}" w:date="2026-01-01T10:00:0${id % 2}Z">${xml}</w:ins>`;
  const mark = () => (options.mark === false ? '' : `<w:pPr><w:rPr>${ins('')}</w:rPr></w:pPr>`);
  const field = () =>
    ins('<w:r><w:fldChar w:fldCharType="begin"/></w:r>') +
    ins('<w:r><w:instrText xml:space="preserve"> REF </w:instrText></w:r>') +
    ins('<w:r><w:instrText xml:space="preserve"> target \\h </w:instrText></w:r>') +
    ins('<w:r><w:fldChar w:fldCharType="separate"/></w:r>') +
    ins(run('2')) +
    ins('<w:r><w:fldChar w:fldCharType="end"/></w:r>');
  return (
    `<w:p>${mark()}${ins(run('See '))}${field()}${ins(run('.'))}</w:p>` +
    (options.gap ? `<w:p>${run(options.gap)}</w:p>` : '') +
    `<w:p>${mark()}${ins(run('More text.'), options.secondAuthor)}</w:p><w:p>${run('Unchanged')}</w:p>`
  );
}
function mount(body: string | Uint8Array) {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: typeof body === 'string' ? docx(body) : body,
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: (part, id) => {
            const root = findNode(part, id);
            return root?.kind === 'paragraph' ? revisionItemsOf({ ...part, root }) : [];
          },
        },
      },
    ],
  });
  editors.push(editor);
  return editor;
}
for (const action of ['acceptReviewItem', 'rejectReviewItem'] as const) {
  test(`${action} resolves an entire inserted block containing split field wrappers`, async () => {
    const editor = mount(sample());
    const before = serializeOoxmlPart(editor.surface!.session.part());
    const items = editor.getReviewItems({ pairReplacements: false });
    expect(items).toHaveLength(1);
    expect(revisionItemsOf(editor.surface!.session.part())[0]!.text).toBe('See 2.\nMore text.\n');
    expect(editor[action](items[0]!.key).ok).toBe(true);
    expect(editor.getReviewItems({ pairReplacements: false })).toHaveLength(0);
    const resolved = serializeOoxmlPart(editor.surface!.session.part());
    expect(resolved).not.toMatch(/<w:ins(?:\s|\/|>)/);
    expect(resolved.includes('fldChar')).toBe(action === 'acceptReviewItem');
    expect(resolved).toContain('Unchanged');
    const reopened = mount(new Uint8Array(await editor.save()));
    expect(reopened.getReviewItems({ pairReplacements: false })).toHaveLength(0);
    expect(serializeOoxmlPart(reopened.surface!.session.part()).includes('fldChar')).toBe(
      action === 'acceptReviewItem'
    );
    editor.exec({ type: 'undo' });
    expect(serializeOoxmlPart(editor.surface!.session.part())).toBe(before);
    expect(editor.getReviewItems({ pairReplacements: false })).toHaveLength(1);
  });
}
for (const options of [{ gap: 'Kept gap' }, { secondAuthor: 'Someone else' }, { mark: false }]) {
  test(`keeps unrelated edits separate: ${JSON.stringify(options)}`, () => {
    const editor = mount(sample(options));
    expect(editor.getReviewItems({ pairReplacements: false }).length).toBeGreaterThan(1);
  });
}

test('a replacement does not split an independent inserted block containing field wrappers', () => {
  const replacement =
    '<w:p><w:del w:id="90" w:author="Reviewer" w:date="2026-01-02T10:00:00Z"><w:r><w:delText>old</w:delText></w:r></w:del>' +
    '<w:ins w:id="91" w:author="Reviewer" w:date="2026-01-02T10:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins></w:p>';
  const editor = mount(sample() + replacement);
  const items = revisionItemsOf(editor.surface!.session.part());
  expect(items.map((item) => item.revisionKind)).toEqual(['insert', 'delete', 'insert']);
  expect(items[0]!.text).toBe('See 2.\nMore text.\n');
  const card = editor
    .getReviewItems({ pairReplacements: false })
    .find((item) => item.kind === 'revision' && item.revisionKind === 'insert')!;
  expect(editor.acceptReviewItem(card.key).ok).toBe(true);
  expect(editor.getReviewItems({ pairReplacements: false })).toHaveLength(2);
});
