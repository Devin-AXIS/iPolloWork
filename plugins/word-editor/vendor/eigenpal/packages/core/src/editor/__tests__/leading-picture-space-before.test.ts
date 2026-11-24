import { expect, test } from 'bun:test';
import { mountWithImages } from './image-decode-harness.ts';
import { documentWithPicture } from './leading-picture-spacing-fixture.ts';

for (const relativeFrom of ['paragraph', 'line'] as const) {
  for (const before of [0, 240, 480]) {
    test(`leading ${relativeFrom} picture respects ${before} twips of paragraph spacing`, async () => {
      const { surface, container } = await mountWithImages(
        documentWithPicture(relativeFrom, before)
      );
      try {
        const page = surface.layout().pages[0]!;
        const drawing = page.anchoredDrawings![0]!;
        const paragraph = page.fragments.find(
          (f) => f.kind === 'paragraph' && f.paragraphId === drawing.anchorParagraphId
        )!;
        if (paragraph.kind !== 'paragraph') throw Error('Missing paragraph');
        const line = paragraph.lines[0]!;
        const intersects =
          line.box.y + line.box.height > drawing.y && line.box.y < drawing.y + drawing.height;
        // Both frames start above the space before on the first line, so with space before the
        // 14pt offset puts the picture beside the line and the text wraps around it.
        expect(intersects).toBe(before > 0);
        if (intersects)
          expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(drawing.x + drawing.width);
        else expect(line.spans[0]!.box.x).toBe(0);
      } finally {
        surface.destroy();
        container.remove();
      }
    });
  }
}

for (const before of [0, 240, 480]) {
  test(`picture-only paragraph measures from above ${before} twips of spacing`, async () => {
    const { surface, container } = await mountWithImages(
      documentWithPicture('paragraph', before, true)
    );
    try {
      const page = surface.layout().pages[0]!;
      const drawing = page.anchoredDrawings![0]!;
      // The lead line is 12pt; the picture sits 14pt below its paragraph's top edge.
      expect(drawing.y).toBeCloseTo(12 + 14, 3);
      const text = page.fragments.filter((f) => f.kind === 'paragraph').at(-1)!;
      if (text.kind !== 'paragraph') throw Error('Missing paragraph');
      for (const line of text.lines) {
        if (line.box.y + line.box.height <= drawing.y || line.box.y >= drawing.y + drawing.height)
          continue;
        expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(drawing.x + drawing.width);
      }
    } finally {
      surface.destroy();
      container.remove();
    }
  });
}
