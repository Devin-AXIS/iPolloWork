import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { collectReviewItems, reviewItemKey, serializeOoxmlPart } from '../../store/index.ts';

// Tracked changes inside comment text are review decisions like any other: they list, and
// every decision resolves them in `comments.xml` as one undo step.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
function mount(commentText: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="${CT}.comments+xml"/></Types>`,
        '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
        'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>`,
        'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Cy" w:date="2026-10-01T10:00:00Z"><w:p>${commentText}</w:p></w:comment></w:comments>`,
      }).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
  const editor = createDocxEditor({
    container,
    document: bytes,
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: () => [],
        },
      },
    ],
  });
  const session = editor.surface!.session;
  const comments = () =>
    serializeOoxmlPart(session.currentPackage().parts.get('/word/comments.xml')!);
  const revisions = () => session.reviewItems().filter((item) => item.kind === 'revision');
  return { editor, session, comments, revisions };
}
const text = '<w:r><w:t xml:space="preserve">Remark </w:t></w:r>';
const inserted = `${text}<w:ins w:id="1" w:author="Ann"><w:r><w:t>added</w:t></w:r></w:ins>`;
const deleted = `${text}<w:del w:id="2" w:author="Ann"><w:r><w:delText>gone</w:delText></w:r></w:del>`;

for (const [name, content, accepted, rejected] of [
  ['insertion', inserted, 'Remark added', 'Remark '],
  ['deletion', deleted, 'Remark ', 'Remark gone'],
] as const)
  for (const action of ['accept', 'reject'] as const) {
    const expected = action === 'accept' ? accepted : rejected;
    const plainText = (xml: string) =>
      [...xml.matchAll(/<w:(?:t|delText)(?: [^>]*)?>([^<]*)</g)].map((m) => m[1]).join('');

    test(`${action} all resolves a comment text ${name} with one undo step`, () => {
      const { editor, session, comments, revisions } = mount(content);
      expect(revisions()).toHaveLength(1);
      const before = comments();
      const result = editor.exec({ type: 'resolveAllReviewChanges', action });
      expect(result).toMatchObject({ ok: true, revisions: { remaining: 0 } });
      expect(comments()).not.toMatch(/<w:(ins|del)\b/);
      expect(plainText(comments())).toBe(expected);
      session.undo();
      expect(comments()).toBe(before);
    });

    test(`${action}ing the card resolves a comment text ${name}`, () => {
      const { editor, comments, revisions } = mount(content);
      const key = reviewItemKey(revisions()[0]!);
      const result =
        action === 'accept' ? editor.acceptReviewItem(key) : editor.rejectReviewItem(key);
      expect(result).toMatchObject({ ok: true });
      expect(revisions()).toEqual([]);
      expect(plainText(comments())).toBe(expected);
    });
  }
