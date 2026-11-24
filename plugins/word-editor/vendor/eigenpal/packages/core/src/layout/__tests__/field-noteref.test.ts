// NOTEREF fields: the number of the note whose reference mark sits inside the bookmark,
// derived through the painter's own numbering path (`deriveNoteDisplayMarksResolved` over
// per-section resolved properties) and gated by the same per-field calibration the REF
// grammar uses. Everything unsupported — `\p` / `\f`, a missing bookmark, a bookmark with no
// note mark inside, `eachPage` restart, a custom-marked citation — keeps the cached result.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { isFldSimple } from '@docx-editor.dev/core/store';
import {
  DEFAULT_ENDNOTE_PROPERTIES,
  DEFAULT_FOOTNOTE_PROPERTIES,
} from '../../store/package/note-properties.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import { locateFieldResults } from '../../store/store/tree-op-field-results.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import type { NoteRefNumberingInput } from '../field-noteref.ts';
import { parseRefInstruction, resolveStoryRefFieldsWithNoteNumbers } from '../field-ref.ts';
import { planRefFieldResultRefresh } from '../field-ref-refresh.ts';
import { isFldChar } from '../field-instruction.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../index.ts';
import { paragraphFragmentsOf } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function document(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function blocksOf(part: OoxmlPart): OoxmlElement[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  return body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
}

/** Field anchor ids (begin `w:fldChar` / `w:fldSimple`) in document order, for lookups. */
function refAnchorIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isFldChar(node, 'begin') || isFldSimple(node)) ids.push(node.id);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return ids;
}

const refField = (instr: string, cached = '') =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  (cached ? `<w:r><w:t xml:space="preserve">${cached}</w:t></w:r>` : '') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const cite = (id: number, extra = '') => `<w:r><w:footnoteReference w:id="${id}"${extra}/></w:r>`;
const bookmarkedCite = (name: string, inner: string) =>
  `<w:bookmarkStart w:id="7" w:name="${name}"/>${inner}<w:bookmarkEnd w:id="7"/>`;

/** Numbering input over one implicit section, with overridable footnote properties. */
function numberingInput(overrides?: Partial<NoteRefNumberingInput>): NoteRefNumberingInput {
  return {
    sections: [],
    footnotePropsBySection: [],
    endnotePropsBySection: [],
    documentFootnoteProps: DEFAULT_FOOTNOTE_PROPERTIES,
    documentEndnoteProps: DEFAULT_ENDNOTE_PROPERTIES,
    ...overrides,
  };
}

function liveAt(
  part: OoxmlPart,
  input: NoteRefNumberingInput | undefined,
  ordinal: number,
  instruction: string
): string | null {
  const context = resolveStoryRefFieldsWithNoteNumbers(blocksOf(part), undefined, undefined, input);
  if (context === null) throw new Error('no context');
  const anchorId = refAnchorIds(part)[ordinal];
  if (anchorId === undefined) throw new Error('no such field');
  const spec = parseRefInstruction(instruction);
  if (spec === null) throw new Error('instruction must parse');
  return context.liveValueOf(anchorId, spec);
}

describe('NOTEREF resolution against the body story', () => {
  test('paints the display number of the note referenced inside the bookmark', () => {
    const part = document(
      `<w:p>${cite(11)}</w:p>` +
        `<w:p><w:r><w:t xml:space="preserve">lead </w:t></w:r>${bookmarkedCite('nb', cite(12))}</w:p>` +
        `<w:p>${refField(' NOTEREF nb \\h ')}</w:p>`
    );
    // Second citation in document order under the default decimal footnote numbering.
    expect(liveAt(part, numberingInput(), 0, ' NOTEREF nb \\h ')).toBe('2');
  });

  test('a w:numFmt-styled sequence resolves through the same format mapping', () => {
    const part = document(
      `<w:p>${cite(11)}</w:p>` +
        `<w:p>${bookmarkedCite('nb', cite(12))}</w:p>` +
        `<w:p>${refField(' NOTEREF nb ')}</w:p>`
    );
    const input = numberingInput({
      footnotePropsBySection: [{ ...DEFAULT_FOOTNOTE_PROPERTIES, numFmt: 'lowerRoman' }],
    });
    expect(liveAt(part, input, 0, ' NOTEREF nb ')).toBe('ii');
  });

  test('an endnote reference numbers under the endnote properties (lowerRoman default)', () => {
    const part = document(
      `<w:p>${bookmarkedCite('nb', `<w:r><w:endnoteReference w:id="3"/></w:r>`)}</w:p>` +
        `<w:p>${refField(' NOTEREF nb ')}</w:p>`
    );
    expect(liveAt(part, numberingInput(), 0, ' NOTEREF nb ')).toBe('i');
  });

  test('eachSect restart counts per section, through the section bounds', () => {
    const part = document(
      `<w:p>${cite(11)}</w:p>` +
        `<w:p>${bookmarkedCite('nb', cite(12))}</w:p>` +
        `<w:p>${refField(' NOTEREF nb ')}</w:p>`
    );
    const props = { ...DEFAULT_FOOTNOTE_PROPERTIES, numRestart: 'eachSect' as const };
    const input = numberingInput({
      sections: [
        { blockStart: 0, blockEndExclusive: 1 },
        { blockStart: 1, blockEndExclusive: 3 },
      ],
      footnotePropsBySection: [props, props],
    });
    // The bookmarked citation opens section 1, so its number restarts at 1.
    expect(liveAt(part, input, 0, ' NOTEREF nb ')).toBe('1');
  });

  test('unsupported shapes keep the cache: eachPage, custom mark, no mark, no bookmark', () => {
    const eachPage = numberingInput({
      footnotePropsBySection: [{ ...DEFAULT_FOOTNOTE_PROPERTIES, numRestart: 'eachPage' }],
    });
    const paged = document(
      `<w:p>${bookmarkedCite('nb', cite(11))}</w:p>` + `<w:p>${refField(' NOTEREF nb ')}</w:p>`
    );
    // Page assignment does not exist pre-pagination; the kind is refused whole.
    expect(liveAt(paged, eachPage, 0, ' NOTEREF nb ')).toBeNull();

    const custom = document(
      `<w:p>${bookmarkedCite('nb', cite(11, ' w:customMarkFollows="1"'))}</w:p>` +
        `<w:p>${refField(' NOTEREF nb ')}</w:p>`
    );
    expect(liveAt(custom, numberingInput(), 0, ' NOTEREF nb ')).toBeNull();

    const markless = document(
      `<w:p>${bookmarkedCite('nb', '<w:r><w:t>text only</w:t></w:r>')}${cite(11)}</w:p>` +
        `<w:p>${refField(' NOTEREF nb ')}</w:p>`
    );
    expect(liveAt(markless, numberingInput(), 0, ' NOTEREF nb ')).toBeNull();

    const unbookmarked = document(
      `<w:p>${cite(11)}</w:p>` + `<w:p>${refField(' NOTEREF absent ')}</w:p>`
    );
    expect(liveAt(unbookmarked, numberingInput(), 0, ' NOTEREF absent ')).toBeNull();

    // No numbering input at all (a story laid out without notes) keeps the cache too.
    const plain = document(
      `<w:p>${bookmarkedCite('nb', cite(11))}</w:p>` + `<w:p>${refField(' NOTEREF nb ')}</w:p>`
    );
    expect(liveAt(plain, undefined, 0, ' NOTEREF nb ')).toBeNull();
  });

  test('calibration: a cache the computed number cannot reproduce wins permanently', () => {
    const body =
      `<w:p>${bookmarkedCite('nb', cite(11))}</w:p>` +
      `<w:p>${refField(' NOTEREF nb ', '9')}</w:p>` +
      `<w:p>${refField(' NOTEREF nb \\h ', '1')}</w:p>`;
    const part = document(body);
    expect(liveAt(part, numberingInput(), 0, ' NOTEREF nb ')).toBeNull();
    expect(liveAt(part, numberingInput(), 1, ' NOTEREF nb \\h ')).toBe('1');
  });
});

// ------------------------------------------------------------------------------------------
// Full layout: painted values, painter parity and the session repaint path.
// ------------------------------------------------------------------------------------------

function notesDoc(body: string): Uint8Array {
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:t>first note</w:t></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="2"><w:p><w:r><w:t>second note</w:t></w:r></w:p></w:footnote>`;
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

function openNotesDoc(
  bytes: Uint8Array,
  footnoteNumFmt = 'decimal'
): { part: OoxmlPart; notes: NotesLayoutInput } {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const documentFootnoteProps = { ...DEFAULT_FOOTNOTE_PROPERTIES, numFmt: footnoteNumFmt };
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [documentFootnoteProps],
    endnotePropsBySection: [DEFAULT_ENDNOTE_PROPERTIES],
    documentFootnoteProps,
    documentEndnoteProps: DEFAULT_ENDNOTE_PROPERTIES,
    measurer: createFixedMeasurer(6, 14),
    producer: 'noteref',
  };
  return { part, notes };
}
function packageOf(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

const textsOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map((fragment) =>
      fragment.lines
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim()
    )
  );

/** Structural-sharing body edit: every surviving node kept BY IDENTITY, like a store commit. */
function withBlocks(
  part: OoxmlPart,
  edit: (blocks: readonly OoxmlElement[]) => readonly OoxmlElement[]
): OoxmlPart {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  const blocks = body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
  const edited = edit(blocks);
  const nextChildren = [
    ...edited,
    ...body.children.filter(
      (child) =>
        child.kind === 'textValue' || (child.kind !== 'paragraph' && child.kind !== 'table')
    ),
  ];
  const nextBody = { ...body, children: nextChildren } as OoxmlElement;
  const nextRoot = {
    ...part.root,
    children: part.root.children.map((child) => (child === body ? nextBody : child)),
  } as OoxmlElement;
  return { ...part, root: nextRoot };
}

const CITING_BODY =
  `<w:p><w:r><w:t>gone soon</w:t></w:r>${cite(1)}</w:p>` +
  `<w:p><w:r><w:t>keeps</w:t></w:r>${bookmarkedCite('noteBm', cite(2))}</w:p>`;

describe('NOTEREF through full layout', () => {
  test('paints the number the note area shows, per-section numFmt included', () => {
    const { part, notes } = openNotesDoc(
      notesDoc(
        CITING_BODY +
          `<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>${refField(' NOTEREF noteBm \\h ')}</w:p>`
      ),
      'lowerRoman'
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'noteref',
    });
    const texts = textsOf(layout);
    // The citation itself paints `ii`, and the NOTEREF paints the same rendering.
    expect(texts).toContain('see ii');
    expect(texts.join('|')).toContain('keepsii');
  });

  test('`\\p`, a missing bookmark and a mismatched cache keep their cached results', () => {
    const { part, notes } = openNotesDoc(
      notesDoc(
        CITING_BODY +
          `<w:p><w:r><w:t xml:space="preserve">a </w:t></w:r>${refField(' NOTEREF noteBm \\p ', 'above')}</w:p>` +
          `<w:p><w:r><w:t xml:space="preserve">b </w:t></w:r>${refField(' NOTEREF gone ', 'kept')}</w:p>` +
          `<w:p><w:r><w:t xml:space="preserve">c </w:t></w:r>${refField(' NOTEREF noteBm ', 'IX')}</w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'noteref',
    });
    const texts = textsOf(layout);
    expect(texts).toContain('a above');
    expect(texts).toContain('b kept');
    expect(texts).toContain('c IX');
  });

  test('a renumbering edit repaints a live NOTEREF on a warm session; a cached one stays put', () => {
    const { part, notes } = openNotesDoc(
      notesDoc(
        CITING_BODY +
          // Empty cache: always calibration-eligible, paints live.
          `<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>${refField(' NOTEREF noteBm \\h ')}</w:p>` +
          // A cache the computed value never reproduces: pinned to `X` before and after.
          `<w:p><w:r><w:t xml:space="preserve">pin </w:t></w:r>${refField(' NOTEREF noteBm ', 'X')}</w:p>`
      )
    );
    const options = {
      measurer: notes.measurer,
      notes,
      producer: 'noteref',
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    expect(textsOf(first)).toContain('see 2');
    expect(textsOf(first)).toContain('pin X');

    // Remove the paragraph citing note 1: note 2 renumbers to 1. The NOTEREF paragraph
    // survives BY IDENTITY, so only the resolved-value tokens can repaint it.
    const after = withBlocks(part, (blocks) => blocks.filter((_, index) => index !== 0));
    const warm = layoutSemanticDocument(after, 2, options);
    const texts = textsOf(warm);
    expect(texts).toContain('see 1');
    expect(texts.join('|')).not.toContain('see 2');
    expect(texts).toContain('pin X');
  });
});

describe('NOTEREF results ride the save refresh plan', () => {
  test('a calibrated body NOTEREF whose raw run differs from the live value is planned', () => {
    // The cache normalizes to the computed `2` (NBSP = space), so the field calibrates
    // live; the raw run still carries the NBSP, so the plan rewrites it to the painted text.
    const bytes = notesDoc(
      CITING_BODY +
        `<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>${refField(' NOTEREF noteBm \\h ', ' 2')}</w:p>`
    );
    const pkg = packageOf(bytes);
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const op = planRefFieldResultRefresh(part, { package: pkg });
    expect(op).not.toBeNull();
    expect(op!.updates).toHaveLength(1);
    expect(op!.updates[0]!.text).toBe('2');
  });

  test('a fresh document with an exact NOTEREF cache plans nothing', () => {
    const bytes = notesDoc(
      CITING_BODY +
        `<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>${refField(' NOTEREF noteBm \\h ', '2')}</w:p>`
    );
    const pkg = packageOf(bytes);
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    expect(planRefFieldResultRefresh(part, { package: pkg })).toBeNull();
    // Sanity: the locator sees the field this asserts about.
    const located = blocksOf(part).flatMap((block) => locateFieldResults(block));
    expect(located.some((field) => field.instruction.includes('NOTEREF'))).toBe(true);
  });
});
