// Typing next to a formatting change that continues from another cell's paragraph mark, or from
// the paragraph before a table, keeps the live review queue equal to a full derivation.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '../../store/index.ts';
import { reviewTableGroupingParts } from '../../store/__tests__/fixtures/review-table-grouping-cases.ts';

let nextId = 1;
const change = () =>
  `<w:rPrChange w:id="${nextId++}" w:author="Ada" w:date="2026-10-01T10:00:00Z"><w:rPr/></w:rPrChange>`;
const BOLD = '<w:b/>';
const BOOKMARK = '<w:bookmarkStart w:id="90" w:name="mark"/><w:bookmarkEnd w:id="90"/>';
const markBold = (text: string) =>
  `<w:p><w:pPr><w:rPr>${BOLD}${change()}</w:rPr></w:pPr><w:r><w:rPr>${BOLD}${change()}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
// Plain "x" first, so deleting it brings the formatting change to the start of the paragraph.
const leadingPlain = (text: string) =>
  `<w:p><w:r><w:t>x</w:t></w:r><w:r><w:rPr>${BOLD}${change()}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const table = (cells: string) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;

function mount(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  return createDocxEditor({
    container,
    author: 'Ada',
    document: zipSync(
      Object.fromEntries(
        Object.entries(reviewTableGroupingParts({ name: 'patch', body })).map(([name, xml]) => [
          name,
          strToU8(xml),
        ])
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

for (const [name, body, target] of [
  ['the next cell of a row', table(cell(markBold('A')) + cell(leadingPlain('B'))), 'B'],
  [
    'the first cell after a paragraph',
    markBold('Before') + table(cell(leadingPlain('B')) + cell('<w:p/>')),
    'B',
  ],
  ['the next paragraph past a bookmark', markBold('A') + BOOKMARK + leadingPlain('B'), 'B'],
  [
    'the first cell past a bookmark',
    markBold('Before') + BOOKMARK + table(cell(leadingPlain('B')) + cell('<w:p/>')),
    'B',
  ],
] as const)
  test(`deleting text before a change that continues into ${name} keeps one card`, () => {
    const editor = mount(body);
    try {
      const session = editor.surface!.session;
      // The paragraph that holds the target text.
      const paragraphId = session
        .paragraphIds()
        .find((id) => JSON.stringify(findNode(session.part(), id)).includes(`"${target}"`))!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 1 },
      });
      expect(editor.exec({ type: 'deleteText' }).ok).toBe(true);
      const live = editor
        .getReviewItems({ placement: false })
        .filter((entry) => entry.item.kind === 'revision');
      const derived = revisionItemsOf(session.part());
      expect(live).toHaveLength(derived.length);
      expect(derived).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
