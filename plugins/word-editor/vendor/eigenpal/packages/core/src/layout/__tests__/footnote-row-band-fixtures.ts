// Shared fixtures for the footnote reference band tests: a 350pt by 210pt page with 20pt
// margins, so a 170pt body of exact 14pt lines; the footnote separator and every note line
// are exact 14pt lines too.
import { expect } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { collectNoteReferences, resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createLayoutSession } from '../layout-session.ts';
import { bodyOnlyPage, noteReferenceLineBandPt } from '../note-fragment-geometry.ts';
import {
  buildPageRefHits,
  computeFootnoteReserves,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { footnoteReservesEqual } from '../note-reserves.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { blockText, measurer, para, SECT, W } from './table-row-keep-fixtures.ts';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const EXACT = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';

/** A one-line paragraph `text`, citing footnote `note` when given. */
export const cite = (text: string, note?: number, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/>${EXACT}</w:pPr><w:r><w:t>${text}</w:t></w:r>` +
  (note === undefined ? '' : `<w:r><w:footnoteReference w:id="${note}"/></w:r>`) +
  '</w:p>';

const tc = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;

export interface RowSpec {
  readonly name: string;
  readonly note?: number;
  readonly trPr?: string;
  /** First cell; defaults to a plain `${name}a` paragraph. */
  readonly first?: string;
  readonly firstTcPr?: string;
  /** Second cell; defaults to `${name}b`, citing `note`. */
  readonly second?: string;
  readonly secondTcPr?: string;
}

export const tr = (spec: RowSpec) =>
  `<w:tr>${spec.trPr ? `<w:trPr>${spec.trPr}</w:trPr>` : ''}` +
  tc(spec.first ?? cite(`${spec.name}a`), spec.firstTcPr) +
  tc(spec.second ?? cite(`${spec.name}b`, spec.note), spec.secondTcPr) +
  '</w:tr>';

export const tbl = (rows: readonly string[], tblPr = '') =>
  `<w:tbl><w:tblPr>${tblPr}<w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;

/** Rows `R1`..`R{count}`; `refs` maps a row number to the footnote its second cell cites. */
export const rows = (
  count: number,
  refs: ReadonlyMap<number, number>,
  edit: (n: number, spec: RowSpec) => RowSpec = (_n, spec) => spec
): string[] =>
  Array.from({ length: count }, (_, i) =>
    tr(edit(i + 1, { name: `R${i + 1}`, note: refs.get(i + 1) }))
  );

export function probeDocx(body: string, notes: ReadonlyMap<number, number>): Uint8Array {
  const noteXml = [...notes]
    .map(([id, lines]) => {
      const runs = Array.from({ length: lines }, (_, i) => `<w:t>N${id}-${i + 1}</w:t>`);
      return (
        `<w:footnote w:id="${id}"><w:p><w:pPr>${EXACT}</w:pPr>` +
        `<w:r><w:footnoteRef/></w:r><w:r>${runs.join('<w:br/>')}</w:r></w:p></w:footnote>`
      );
    })
    .join('');
  const separator = (type: string, tag: string) =>
    `<w:footnote w:type="${type}" w:id="${type === 'separator' ? -1 : 0}"><w:p><w:pPr>${EXACT}</w:pPr>` +
    `<w:r><w:${tag}/></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${SECT}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${separator('separator', 'separator')}` +
        `${separator('continuationSeparator', 'continuationSeparator')}${noteXml}</w:footnotes>`
    ),
  });
}

export interface Laid {
  readonly layout: SemanticLayout;
  /** The published reserves reproduce themselves from the layout they produced. */
  readonly fixedPoint: boolean;
  readonly refs: ReturnType<typeof buildPageRefHits>;
  /** The reserves the layout was laid under, by page index. */
  readonly reserves: ReadonlyMap<number, number>;
  readonly compatibilityMode?: number;
}

export function layoutProbe(
  body: string,
  notes: ReadonlyMap<number, number>,
  session = createLayoutSession(),
  revision = 1,
  compatibilityMode?: number
): Laid {
  const loaded = readOoxmlPackage(probeDocx(body, notes));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const input: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fn],
    endnotePropsBySection: [en],
    documentFootnoteProps: fn,
    documentEndnoteProps: en,
    measurer,
    producer: 'footnote-table-row-bands',
    compatibilityMode,
  };
  const layout = layoutSemanticDocument(part, revision, {
    measurer,
    notes: input,
    session,
    producer: 'footnote-table-row-bands',
    compatibilityMode,
  });
  const used = session.notePageBottomReserves ?? new Map<number, number>();
  const collected = collectNoteReferences(part);
  const refs = buildPageRefHits(collected, new Map(collected.map((ref) => [ref.paragraphId, 0])));
  const computed = computeFootnoteReserves(
    { ...layout, pages: layout.pages.map(bodyOnlyPage) },
    refs,
    input,
    provisionalNoteMarks(refs, input),
    undefined,
    used
  );
  return {
    layout,
    refs,
    reserves: used,
    compatibilityMode,
    fixedPoint: computed.stable && footnoteReservesEqual(computed.reserves, used),
  };
}

/** `body text | notes` per page; a trailing `c` marks a note continuation. */
export function pages(layout: SemanticLayout): string[] {
  return layout.pages.map((page) => {
    const body = page.fragments.flatMap(blockText).join(' ');
    const notes = (page.footnotes?.notes ?? []).map(
      (n) => `${n.noteId}${n.continuation ? 'c' : ''}`
    );
    return `${body} | ${notes.join(',')}`;
  });
}

/** Lines of footnote `noteId` on page `index`. */
export function noteLines(layout: SemanticLayout, index: number, noteId: number): number {
  const note = layout.pages[index]?.footnotes?.notes.find((n) => n.noteId === noteId);
  return (note?.fragments ?? []).reduce(
    (sum, block) => sum + (block.kind === 'paragraph' ? block.lines.length : 0),
    0
  );
}

/** Every body line and note opening appears: no row or note is dropped or doubled. */
export function expectComplete(
  layout: SemanticLayout,
  lines: readonly string[],
  noteIds?: number[]
) {
  const painted = layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'table'
        ? fragment.rows
            .filter((row) => !row.isHeaderRepeat)
            .flatMap((row) => row.cells.flatMap((c) => c.blocks.flatMap(blockText)))
        : blockText(fragment)
    )
  );
  // Sorted: a split row interleaves its cells' lines across page fragments.
  expect(painted.map(unmark).sort()).toEqual([...lines].sort());
  if (!noteIds) return;
  const opened = layout.pages.flatMap((page) =>
    (page.footnotes?.notes ?? []).filter((n) => !n.continuation).map((n) => n.noteId)
  );
  expect(opened).toEqual(noteIds);
}

/** The band of footnote `noteId`'s reference on the page that paints it. */
export function bandOf(laid: Laid, noteId: number) {
  const ref = laid.refs.find((hit) => hit.noteId === noteId)!;
  for (const page of laid.layout.pages) {
    const body = bodyOnlyPage(page);
    const band = noteReferenceLineBandPt(body, ref, laid.compatibilityMode);
    if (band.bottom > 0) {
      const table = body.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
      return { page: page.index, band, table };
    }
  }
  throw new Error(`reference ${noteId} is not on any page`);
}

/** Drops a painted footnote mark (`R2b1` -> `R2b`); note ids stay below 10 here. */
export const unmark = (text: string) => text.replace(/^(R\d+b|Nb)\d$/, '$1');

export const INTRO = para('INTRO', 2);
export const TAIL = cite('TAIL');
export const names = (count: number) =>
  Array.from({ length: count }, (_, i) => [`R${i + 1}a`, `R${i + 1}b`]).flat();
