// A large document lays out its pages in the background after it opens. A range in a
// paragraph that layout has not reached yet counts as unavailable, and the counts a watch
// reported at the open stayed there after every page was laid out.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { acceptedTextRanges } from '../paragraph-text-ranges.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { progressiveOpenPending } from '../surface-progressive-open.ts';
import { watchHighlights } from '../watch-highlights.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Many plain paragraphs, past the open-yield threshold through a filler part. */
function largeDocx(): Uint8Array {
  const lines: string[] = [];
  for (let line = 1, total = 0; total < 700 * 1024; line += 1) {
    const text = `<l>filler line ${line} carrying a little ordinary sentence text.</l>`;
    lines.push(text);
    total += text.length;
  }
  const body = Array.from(
    { length: 1200 },
    (_, index) => `<w:p><w:r><w:t>Paragraph ${index} has one teh typo.</w:t></w:r></w:p>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'customXml/item1.xml': strToU8(`<filler>${lines.join('')}</filler>`),
  });
}

async function until(condition: () => boolean): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 50_000) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a watch counts its ranges again as background layout adds pages', async () => {
  const editor = createDocxEditor({ document: largeDocx() });
  const heard: { applied: number; unavailable: number }[] = [];
  let sawPending = false;
  const watch = watchHighlights(
    editor,
    'spelling',
    (current) => {
      if (current.surface && progressiveOpenPending(current.surface)) sawPending = true;
      return current.getParagraphs().flatMap((paragraph) => {
        const at = paragraph.acceptedText.indexOf('teh');
        return at < 0 ? [] : acceptedTextRanges(paragraph, at, at + 3);
      });
    },
    { onResult: (result) => heard.push(result) }
  );
  editor.attach(document.createElement('div'));
  await until(() => editor.surface !== null && !progressiveOpenPending(editor.surface));
  await until(() => watch.result.unavailable === 0);
  expect(sawPending).toBe(true);
  // The open reported part of the ranges first, then every range once layout finished.
  expect(heard.some((result) => result.unavailable > 0)).toBe(true);
  expect(watch.result).toEqual({ applied: 1200, unavailable: 0 });
  watch.stop();
  editor.destroy();
}, 60_000);
