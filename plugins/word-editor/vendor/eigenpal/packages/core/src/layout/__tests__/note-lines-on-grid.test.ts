// Footnote and endnote lines snap to the line grid of the section that owns them.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openDocumentForExport } from '../../export/export-session.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// The fixed measurer gives default 12pt text a 14 * 12 / 11pt box; an 18pt pitch snaps it to
// one pitch.
const NATURAL = +((14 * 12) / 11).toFixed(6);
const GRID = '<w:docGrid w:type="lines" w:linePitch="360"/>';
const SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';

function noteBody(pPr: string, spacing: string): string {
  return `<w:p><w:pPr>${pPr}${spacing}</w:pPr><w:r><w:t>Note</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Two</w:t></w:r></w:p>`;
}

function documentBytes(
  kind: 'footnote' | 'endnote',
  grid: string,
  notePPr = '',
  noteSpacing = SPACING
): Uint8Array {
  const part = kind === 'footnote' ? 'footnotes' : 'endnotes';
  const notes =
    `<w:${part} xmlns:w="${W}">` +
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:id="1">${noteBody(notePPr, noteSpacing)}</w:${kind}></w:${part}>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part}+xml"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdN" Type="${R}/${part}" Target="${part}.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:pPr>${SPACING}</w:pPr><w:r><w:t>Body</w:t></w:r><w:r><w:${kind}Reference w:id="1"/></w:r></w:p>` +
        `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ` +
        `w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>${grid}</w:sectPr></w:body></w:document>`
    ),
    [`word/${part}.xml`]: strToU8(notes),
  });
}

async function noteLineHeights(bytes: Uint8Array): Promise<number[]> {
  const opened = openDocumentForExport(bytes, { measurer: createFixedMeasurer(6, 14) });
  if (!opened.ok) throw new Error(opened.reason);
  const layout: SemanticLayout = await opened.session.layout();
  opened.session.dispose();
  return layout.pages.flatMap((page) =>
    [...(page.footnotes?.notes ?? []), ...(page.endnotes?.notes ?? [])].flatMap((note) =>
      note.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.map((line) => +line.box.height.toFixed(6))
          : []
      )
    )
  );
}

for (const kind of ['footnote', 'endnote'] as const) {
  test(`${kind} lines snap to the section line grid`, async () => {
    expect(await noteLineHeights(documentBytes(kind, GRID))).toEqual([18, 18]);
  });

  test(`${kind} lines keep their own height without a grid or with snapping off`, async () => {
    expect(await noteLineHeights(documentBytes(kind, ''))).toEqual([NATURAL, NATURAL]);
    const off = '<w:snapToGrid w:val="0"/>';
    expect(await noteLineHeights(documentBytes(kind, GRID, off))).toEqual([NATURAL, NATURAL]);
  });

  test(`${kind} lines follow the grid rules for multiple spacing`, async () => {
    // Double spacing counts two pitches.
    const double = '<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/>';
    expect(await noteLineHeights(documentBytes(kind, GRID, '', double))).toEqual([36, 36]);
  });
}
