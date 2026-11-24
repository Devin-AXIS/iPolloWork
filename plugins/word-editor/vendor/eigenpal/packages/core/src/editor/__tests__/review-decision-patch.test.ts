// Accepting or rejecting one change in a long document. The review queue patches the paragraphs
// the decision changed instead of deriving the whole queue again; the oracle is a full
// derivation over an untouched copy of the same tree, after every decision.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

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

/** A small seeded generator, so a failing seed replays. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const stamp = (id: number, author: string) =>
  `w:id="${id}" w:author="${author}" w:date="2026-03-0${(id % 9) + 1}T10:00:00Z"`;
const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const deleted = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;

/** One paragraph of a generated body: plain text with up to a few changes of several kinds. */
function paragraph(next: () => number, index: number, ids: { next: number }): string {
  const authors = ['Ada', 'Grace', 'Edsger'];
  const author = () => authors[Math.floor(next() * authors.length)]!;
  const parts: string[] = [run(`Paragraph ${index} opens `)];
  let properties = '';
  const kinds = Math.floor(next() * 4);
  for (let change = 0; change < kinds; change += 1) {
    const kind = Math.floor(next() * 6);
    const id = ids.next++;
    if (kind === 0) parts.push(`<w:ins ${stamp(id, author())}>${run('inserted ')}</w:ins>`);
    else if (kind === 1) parts.push(`<w:del ${stamp(id, author())}>${deleted('removed ')}</w:del>`);
    else if (kind === 2)
      parts.push(
        `<w:del ${stamp(id, author())}>${deleted('old ')}</w:del>` +
          `<w:ins ${stamp(ids.next++, author())}>${run('new ')}</w:ins>`
      );
    else if (kind === 3)
      parts.push(run('bold ', `<w:b/><w:rPrChange ${stamp(id, author())}><w:rPr/></w:rPrChange>`));
    else if (kind === 4 && properties === '')
      properties = `<w:pPr><w:jc w:val="center"/><w:pPrChange ${stamp(id, author())}><w:pPr/></w:pPrChange></w:pPr>`;
    else parts.push(run('plain '));
    parts.push(run('and more text '));
  }
  // Now and then a mark change, which joins the next paragraph and must refuse the patch.
  if (properties === '' && next() < 0.08)
    properties = `<w:pPr><w:rPr><w:ins ${stamp(ids.next++, author())}/></w:rPr></w:pPr>`;
  return `<w:p>${properties}${parts.join('')}</w:p>`;
}

function docx(seed: number, paragraphs: number): Uint8Array {
  const next = random(seed);
  const ids = { next: 1 };
  const body: string[] = [];
  const comments: string[] = [];
  for (let index = 0; index < paragraphs; index += 1) {
    let text = paragraph(next, index, ids);
    // A comment on some paragraphs: its cards must keep their ends.
    if (next() < 0.1) {
      const id = comments.length;
      text = text
        .replace('<w:r>', `<w:commentRangeStart w:id="${id}"/><w:r>`)
        .replace(
          '</w:p>',
          `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`
        );
      comments.push(
        `<w:comment w:id="${id}" w:author="Grace" w:date="2026-03-02T10:00:00Z"><w:p>${run(`Note ${id}`)}</w:p></w:comment>`
      );
    }
    body.push(text);
  }
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const parts: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'officeDocument', 'word/document.xml')}</Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId3', 'comments', 'comments.xml')}</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body.join('')}<w:sectPr/></w:body></w:document>`,
    'word/comments.xml': `<w:comments xmlns:w="${W}">${comments.join('')}</w:comments>`,
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}

/** Full review derivations so far. */
let derivations = 0;

function mount(bytes: Uint8Array) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    author: 'Ada',
    document: bytes,
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
            const found = findNode(part, id);
            return found?.kind === 'paragraph' ? revisionItemsOf({ ...part, root: found }) : [];
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

describe('deciding one change in a long document', () => {
  for (const seed of [3, 11, 29]) {
    test(`keeps the queue the full derivation gives, seed ${seed}`, () => {
      using mounted = mount(docx(seed, 60));
      const { editor } = mounted;
      const next = random(seed * 7 + 1);
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
      let decisions = 0;
      for (let step = 0; step < 24; step += 1) {
        const revisions = editor.getReviewItems().filter((item) => item.kind === 'revision');
        if (revisions.length === 0) break;
        const card = revisions[Math.floor(next() * revisions.length)]!;
        const result =
          next() < 0.5 ? editor.acceptReviewItem(card.key) : editor.rejectReviewItem(card.key);
        if (!result.ok) continue;
        decisions += 1;
        expect(shape(session.reviewItems())).toEqual(oracle());
      }
      expect(decisions).toBeGreaterThan(10);
      // Most decisions patched the queue rather than deriving it again.
      expect(derivations - before).toBeLessThan(decisions / 2);
    });
  }
});
