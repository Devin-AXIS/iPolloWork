// The revision queue after a paragraph split or join. Far from any revision, the queue of the
// previous revision is reused as it is; next to one, it is derived again. Either way it must
// equal a cold derivation over the same tree.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { OoxmlNode, OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { revisionItemsOf } from '../../store/store/review-reads.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tracked = (text: string, inserted: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${text} </w:t></w:r>` +
  `<w:ins w:id="${text.length}" w:author="Ada" w:date="2026-01-01T00:00:00Z">` +
  `<w:r><w:t>${inserted}</w:t></w:r></w:ins></w:p>`;

function docx(): Uint8Array {
  const body: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    body.push(
      index === 3 || index === 20 ? tracked(`Tracked ${index}`, 'added') : plain(`Plain ${index}`)
    );
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body.join('')}<w:sectPr/></w:body></w:document>`
    ),
  });
}

/** The same tree, every node a new object: no cache can answer for it. */
function cold(part: OoxmlPart): OoxmlPart {
  return { ...part, root: JSON.parse(JSON.stringify(part.root)) as OoxmlNode };
}

for (const [label, index, reused] of [
  ['far from any revision', 10, true],
  ['in a paragraph holding a revision', 3, false],
] as const) {
  test(`a split ${label} leaves the queue equal to a cold derivation`, () => {
    const mounted = mountPaginatedSurface(document.createElement('div'), docx());
    if (!mounted.ok) throw new Error(mounted.reason);
    const { session } = mounted.surface;
    try {
      const before = revisionItemsOf(session.part());
      expect(before.length).toBe(2);
      const paragraphId = session.paragraphIds()[index]!;
      session.applyTreeOps([{ op: 'splitParagraph', paragraphId, offset: 3 }]);
      const after = revisionItemsOf(session.part());
      // Reused by identity only where the split cannot have moved a decision.
      expect(after === before).toBe(reused);
      expect(JSON.stringify(after)).toBe(JSON.stringify(revisionItemsOf(cold(session.part()))));
      // And back: joining the two halves again.
      const ids = session.paragraphIds();
      session.applyTreeOps([
        { op: 'joinParagraphs', firstId: ids[index]!, secondId: ids[index + 1]! },
      ]);
      expect(JSON.stringify(revisionItemsOf(session.part()))).toBe(
        JSON.stringify(revisionItemsOf(cold(session.part())))
      );
    } finally {
      mounted.surface.destroy();
    }
  });
}
