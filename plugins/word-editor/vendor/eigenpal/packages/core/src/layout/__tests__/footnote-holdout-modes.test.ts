// A paragraph that splits across pages returns its opening lines with only the notes those
// lines reference. The pagination is the same in every compatibility mode: Word places the same
// body and note lines on each page for these documents with no mode and with modes 11 to 16.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { PageRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (runs: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>${props}</w:pPr>${runs}</w:p>`;
const lines = (count: number, label: (line: number) => string, after?: (line: number) => string) =>
  Array.from(
    { length: count },
    (_, i) => `<w:r>${i ? '<w:br/>' : ''}<w:t>${label(i)}</w:t></w:r>${after?.(i) ?? ''}`
  ).join('');

function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

/** `filler` one-line paragraphs, then one paragraph of `count` lines with note references. */
function layout(
  filler: number,
  count: number,
  references: readonly number[],
  noteLines: readonly number[],
  widow: boolean,
  mode: number | undefined
) {
  const body =
    Array.from({ length: filler }, (_, i) => paragraph(`<w:r><w:t>F${i + 1}</w:t></w:r>`)).join(
      ''
    ) +
    paragraph(
      lines(
        count,
        (i) => `L${i + 1}`,
        (i) =>
          references.includes(i)
            ? `<w:r><w:footnoteReference w:id="${references.indexOf(i) + 1}"/></w:r>`
            : ''
      ),
      `<w:widowControl w:val="${widow ? 1 : 0}"/>`
    ) +
    paragraph('<w:r><w:t>After</w:t></w:r>');
  const notes =
    `<w:footnotes xmlns:w="${W}">` +
    `<w:footnote w:type="separator" w:id="-1">${paragraph('<w:r><w:separator/></w:r>')}</w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0">${paragraph('<w:r><w:continuationSeparator/></w:r>')}</w:footnote>` +
    noteLines
      .map(
        (n, id) =>
          `<w:footnote w:id="${id + 1}">${paragraph(lines(n, (i) => `N${id + 1}x${i + 1}`))}</w:footnote>`
      )
      .join('') +
    '</w:footnotes>';
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`,
    '/word/document.xml'
  );
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer(5, 14);
  return layoutSemanticDocument(document, 0, {
    measurer,
    compatibilityMode: mode,
    session: createLayoutSession(),
    notes: {
      compatibilityMode: mode,
      footnotesPart: part(notes, '/word/footnotes.xml'),
      endnotesPart: null,
      documentFootnoteProps: fn,
      footnotePropsBySection: [fn],
      documentEndnoteProps: en,
      endnotePropsBySection: [en],
      measurer,
      producer: 'holdout-modes',
    },
  }).pages;
}

/** Body lines, then `note:lines` for each note, per page. */
function summary(pages: readonly PageRecord[]) {
  return pages.map((page) => {
    const body = page.fragments.reduce(
      (n, f) => n + (f.kind === 'paragraph' ? f.lines.length : 0),
      0
    );
    const notes = (page.footnotes?.notes ?? []).map(
      (note) =>
        `${note.noteId}:${note.fragments.reduce((n, f) => n + (f.kind === 'paragraph' ? f.lines.length : 0), 0)}`
    );
    return [body, ...notes].join(' ');
  });
}

const MODES = [undefined, 11, 12, 14, 15, 16];

test('a split paragraph without widow control returns its opening in every mode', () => {
  for (const mode of MODES) {
    expect([
      mode,
      summary(layout(41, 27, [0, 5, 9, 20, 22, 24], [2, 8, 6, 4, 6, 5], false, mode)),
    ]).toEqual([mode, ['43 1:2', '21 2:8 3:6 4:4 5:6', '5 6:5']]);
  }
});

test('a split paragraph with widow control returns its opening in every mode', () => {
  for (const mode of MODES) {
    expect([
      mode,
      summary(layout(38, 27, [0, 11, 20, 22, 25], [7, 8, 8, 8, 8], true, mode)),
    ]).toEqual([mode, ['40 1:5', '21 1:2 2:8 3:8 4:6', '5 4:2 5:8']]);
  }
});
