// Every trailing U+0020 hangs past a centred or right-aligned line: the spaces at a wrap that
// still fit before the measure, and the space that closes the last word's own span.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The visible end (right alignment) or centre (centre alignment) of each line's last word. */
function lines(alignment: 'center' | 'right', text: string) {
  const body = `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 120, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  return linesOf(layout).map((line) => {
    const words = line.spans.filter((span) => span.text.trim());
    const first = words[0]!;
    const last = words.at(-1)!;
    const lastWidth = (last.box.width * last.text.trimEnd().length) / last.text.length;
    return { start: first.box.x, end: last.box.x + lastWidth };
  });
}

test('spaces at a wrap hang, also those that fit before the measure', () => {
  const [right] = lines('right', 'FIRST WORDS' + ' '.repeat(30) + 'SECOND LINE');
  expect(right!.end).toBeCloseTo(120, 3);
  const [center] = lines('center', 'FIRST WORDS' + ' '.repeat(30) + 'SECOND LINE');
  expect((center!.start + center!.end) / 2).toBeCloseTo(60, 3);
});

test('the space closing the last word hangs at the paragraph end', () => {
  const [right] = lines('right', 'ONLY TEXT' + ' '.repeat(10));
  expect(right!.end).toBeCloseTo(120, 3);
  const [center] = lines('center', 'ONLY TEXT' + ' '.repeat(10));
  expect((center!.start + center!.end) / 2).toBeCloseTo(60, 3);
});
