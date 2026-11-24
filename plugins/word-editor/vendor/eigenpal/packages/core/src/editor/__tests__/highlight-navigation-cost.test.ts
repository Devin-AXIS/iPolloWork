// `navigateHighlight` orders marks from the published layout. A step must not read the text of
// every paragraph: on a long document that full read costs more than the step itself.
// Its own file, because it replaces a module for every editor the file mounts.
import { afterEach, expect, mock, test } from 'bun:test';
import * as reads from '../paragraph-text-read.ts';

const realReads = reads.createParagraphTextReads;
let fullReads = 0;
void mock.module('../paragraph-text-read.ts', () => ({
  ...reads,
  createParagraphTextReads: (deps: Parameters<typeof realReads>[0]) => {
    const inner = realReads(deps);
    return {
      ...inner,
      getParagraphs: (options?: Parameters<typeof inner.getParagraphs>[0]) => {
        fullReads += 1;
        return inner.getParagraphs(options);
      },
    };
  },
}));

const { docx } = await import('./paginated-surface-fixtures.ts');
const { mountAnchorEditor } = await import('./scroll-to-anchor-fixture.ts');

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

test('a navigation step reads no paragraph list', () => {
  const filler = Array.from({ length: 40 }, (_, index) => p(`Filler line ${String(index)}.`));
  const mounted = mountAnchorEditor(docx(p('Teh cat.') + filler.join('') + p('A dog barkd.')));
  cleanups.push(mounted.destroy);
  const { editor } = mounted;
  editor.setHighlights('spelling', [...editor.findMatches('barkd'), ...editor.findMatches('Teh')], {
    kind: 'spelling',
  });
  fullReads = 0;
  const next = { type: 'navigateHighlight', name: 'spelling', direction: 'next' } as const;
  expect(editor.exec(next).ok).toBe(true);
  expect(editor.getSelectionRange()!.head.blockId).toBe(editor.findMatches('Teh')[0]!.blockId);
  expect(editor.exec(next).ok).toBe(true);
  expect(editor.getSelectionRange()!.head.blockId).toBe(editor.findMatches('barkd')[0]!.blockId);
  expect(fullReads).toBe(0);
});
