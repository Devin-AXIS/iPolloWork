import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { openStory, PART_OF_STORY } from './story-parity-harness.ts';
import { editorHostElement } from '../host-realm.ts';
import { stubRect } from './surface-pointer-harness.ts';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { storyParityDocx } from './story-parity-fixture.ts';

for (const kind of ['header', 'footer', 'footnote', 'endnote'] as const) {
  test(`${kind} point lookup stays in the active story`, () => {
    const open = openStory(kind);
    try {
      const pages = editorHostElement(open.editor)!.querySelector<HTMLElement>('.docx-pages')!;
      stubRect(pages, { left: 100, top: 50 });
      const layout = open.surface.layout();
      const { paintScale, pageOffsetX } = open.surface.overlayCoordinates();
      const paragraphId = open.paragraphIds[1]!;
      let found = false;
      for (const page of layout.pages) {
        const stories =
          kind === 'header' || kind === 'footer'
            ? [page[kind]]
            : ((kind === 'footnote' ? page.footnotes?.notes : page.endnotes?.notes) ?? []);
        for (const story of stories) {
          if (!story) continue;
          const block = story.fragments.find(
            (block: BlockFragmentRecord) =>
              block.kind === 'paragraph' && block.paragraphId === paragraphId
          );
          if (!block || block.kind !== 'paragraph') continue;
          const line = block.lines[0]!;
          const position = open.editor.positionAtPoint(
            100 +
              (story.box.x + (pageOffsetX.get(page.index) ?? 0) + line.spans[0]!.box.x + 1) *
                paintScale,
            50 + (story.box.y + line.box.y + line.box.height / 2) * paintScale
          );
          expect(position).toMatchObject({ part: `/${PART_OF_STORY[kind]}`, paragraphId });
          found = true;
          break;
        }
        if (found) break;
      }
      expect(found).toBe(true);
      const body = layout.pages[0]!.contentBox;
      expect(
        open.editor.positionAtPoint(100 + (body.x + 5) * paintScale, 50 + (body.y + 5) * paintScale)
      ).toBeNull();
    } finally {
      open.destroy();
    }
  });
}

test('another occurrence of the active header is not a drop target', () => {
  const entries = unzipSync(storyParityDocx());
  entries['word/document.xml'] = strToU8(
    strFromU8(entries['word/document.xml']!).replace(
      '<w:sectPr>',
      '<w:p><w:r><w:br w:type="page"/><w:t>Second page</w:t></w:r></w:p><w:sectPr>'
    )
  );
  const open = openStory('header', zipSync(entries));
  try {
    const pages = editorHostElement(open.editor)!.querySelector<HTMLElement>('.docx-pages')!;
    stubRect(pages, { left: 100, top: 50 });
    const layout = open.surface.layout();
    const other = layout.pages.find((page) => page.index > 0 && page.header);
    expect(other).toBeDefined();
    const story = other!.header!;
    const { paintScale, pageOffsetX } = open.surface.overlayCoordinates();
    expect(
      open.editor.positionAtPoint(
        100 + (story.box.x + (pageOffsetX.get(other!.index) ?? 0) + 5) * paintScale,
        50 + (story.box.y + 5) * paintScale
      )
    ).toBeNull();
  } finally {
    open.destroy();
  }
});
