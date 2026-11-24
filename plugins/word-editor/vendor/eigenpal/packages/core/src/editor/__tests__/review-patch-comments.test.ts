// Typing in a paragraph that holds comment markers. The review queue keeps its comment cards
// and reads their ends again from the paragraph, instead of deriving the whole queue on every
// keystroke; the oracle is a full derivation over an untouched copy of the same tree.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  collectReviewItems,
  findNode,
  revisionItemsOf,
  reviewItemKey,
  type OoxmlNode,
  type OoxmlPart,
  type ReviewItem,
} from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STAMP = 'w:author="Ada" w:date="2026-03-01T10:00:00Z"';

const comment = (id: number, text: string) =>
  `<w:comment w:id="${id}" w:author="Grace" w:date="2026-03-02T10:00:00Z"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
const COMMENTS = `<w:comments xmlns:w="${W}">${comment(0, 'inside')}${comment(1, 'across')}${comment(2, 'on the change')}</w:comments>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const reference = (id: number) => `<w:r><w:commentReference w:id="${id}"/></w:r>`;
const BODY =
  `<w:p>${run('Plain intro text')}</w:p>` +
  `<w:p>${run('AAA ')}<w:commentRangeStart w:id="0"/>${run('BBB')}<w:commentRangeEnd w:id="0"/>${reference(0)}${run(' CCC')}</w:p>` +
  `<w:p>${run('Start ')}<w:commentRangeStart w:id="1"/>${run('spans')}</w:p>` +
  `<w:p>${run('into')}<w:commentRangeEnd w:id="1"/>${reference(1)}${run(' next')}</w:p>` +
  `<w:p>${run('Keep ')}<w:commentRangeStart w:id="2"/><w:ins w:id="9" ${STAMP}>${run('added')}</w:ins><w:commentRangeEnd w:id="2"/>${reference(2)}${run(' tail')}</w:p>` +
  `<w:p>${run('Closing text')}</w:p>`;

function docx(): Uint8Array {
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const parts: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'officeDocument', 'word/document.xml')}</Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId3', 'comments', 'comments.xml')}</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${BODY}<w:sectPr/></w:body></w:document>`,
    'word/comments.xml': COMMENTS,
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}

/** Full review derivations so far. */
let derivations = 0;

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    author: 'Ada',
    document: docx(),
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
          collectReviewItems: (input) => {
            derivations += 1;
            return collectReviewItems(input);
          },
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
  return {
    editor,
    [Symbol.dispose]: () => {
      editor.destroy();
      container.remove();
    },
  };
}

/** Each card's key, place, and the change a comment answers, in queue order. */
function shape(items: readonly ReviewItem[]): string[] {
  return items.map((item) =>
    item.kind === 'comment'
      ? `${reviewItemKey(item)}|${JSON.stringify(item.range)}|${item.parentRevisionId ?? ''}|${item.orphaned}`
      : `${reviewItemKey(item)}|${JSON.stringify(item.kind === 'revision' ? item.ranges : null)}`
  );
}

/** The same tree, every node a new object: no cache can answer for it. */
function cold(part: OoxmlPart): OoxmlPart {
  return { ...part, root: JSON.parse(JSON.stringify(part.root)) as OoxmlNode };
}

describe('typing in a paragraph that holds comment markers', () => {
  for (const mode of ['editing', 'suggesting'] as const) {
    test(`keeps the comment cards at the right offsets, ${mode}`, () => {
      using mounted = mount();
      const { editor } = mounted;
      expect(editor.exec({ type: 'setEditingMode', mode }).ok).toBe(true);
      const session = editor.surface!.session;
      const oracle = () =>
        shape(
          collectReviewItems({
            storyPart: cold(session.part()),
            commentsPart: session.currentPackage().parts.get('/word/comments.xml'),
          })
        );
      expect(shape(session.reviewItems())).toEqual(oracle());
      const before = derivations;
      // Before, inside and after the comment in paragraph 1; at both ends of the comment that
      // runs into the next paragraph; around the change the third comment answers.
      for (const [index, offset] of [
        [1, 0],
        [1, 5],
        [1, 9],
        [2, 7],
        [3, 1],
        [3, 5],
        [4, 2],
        [4, 6],
        [4, 12],
      ] as const) {
        const paragraphId = session.paragraphIds()[index]!;
        editor.surface!.setSelection({
          anchor: { paragraphId, offset },
          head: { paragraphId, offset },
        });
        editor.surface!.type('x');
        expect(shape(session.reviewItems())).toEqual(oracle());
      }
      // Every keystroke kept the queue without deriving it again.
      expect(derivations).toBe(before);
    });
  }
});
