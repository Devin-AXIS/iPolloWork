import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { layoutNoteById, layoutNoteSeparator } from '../note-layout.ts';
import type { PendingLine } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

test('a shared break cache never leaks all-markup note or separator projection into original', () => {
  const tracked =
    '<w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
    '<w:ins w:id="1" w:author="QA"><w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins>' +
    '<w:del w:id="2" w:author="QA"><w:r><w:delText>removed</w:delText></w:r></w:del>';
  const parsed = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p>${tracked}</w:p></w:footnote>` +
      `<w:footnote w:id="1"><w:p>${tracked}</w:p></w:footnote>` +
      '</w:footnotes>',
    {
      name: '/word/footnotes.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
    }
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.reason);

  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const measurer = createFixedMeasurer();
  const textOf = (fragments: NonNullable<ReturnType<typeof layoutNoteById>>['fragments']): string =>
    fragments
      .flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
          : []
      )
      .join('');
  const options = { measurer, producer: 'shared-export-cache', cache };

  const all = layoutNoteById(parsed.part, 1, 400, {
    ...options,
    displayMode: 'all-markup',
  });
  const original = layoutNoteById(parsed.part, 1, 400, {
    ...options,
    displayMode: 'original',
  });
  expect(all).not.toBeNull();
  expect(original).not.toBeNull();
  expect(textOf(all!.fragments)).toBe('keep added removed');
  expect(textOf(original!.fragments)).toBe('keep removed');

  const allSeparator = layoutNoteSeparator(
    parsed.part,
    'separator',
    400,
    { ...options, displayMode: 'all-markup' },
    'footnote'
  );
  const originalSeparator = layoutNoteSeparator(
    parsed.part,
    'separator',
    400,
    { ...options, displayMode: 'original' },
    'footnote'
  );
  expect(textOf(allSeparator.fragments)).toBe('keep added removed');
  expect(textOf(originalSeparator.fragments)).toBe('keep removed');
});
