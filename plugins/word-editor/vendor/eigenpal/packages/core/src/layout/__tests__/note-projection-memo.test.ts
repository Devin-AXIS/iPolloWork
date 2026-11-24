import { fingerprintNotesInput } from '../note-input-fingerprint.ts';
import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import {
  attachNotesToLayout,
  buildPageRefHits,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { collectBodyNoteReferences } from '../note-reference-visibility.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function documentWithTableNote(): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="1"><w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>' +
        '<w:p><w:r><w:t>Table note</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:footnote>' +
        '</w:footnotes>'
    ),
  });
}

function fixture(): {
  readonly part: ReturnType<typeof readOoxmlPackage> extends {
    ok: true;
    package: { parts: Map<string, infer Part> };
  }
    ? Part
    : never;
  readonly notes: NotesLayoutInput;
} {
  const loaded = readOoxmlPackage(documentWithTableNote());
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.reason);
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  return {
    part: loaded.package.parts.get(loaded.package.mainDocumentPart)!,
    notes: {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [footnoteProps],
      endnotePropsBySection: [endnoteProps],
      documentFootnoteProps: footnoteProps,
      documentEndnoteProps: endnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-projection-memo',
    },
  };
}

function laidNote(
  part: ReturnType<typeof fixture>['part'],
  notes: NotesLayoutInput,
  session: ReturnType<typeof createLayoutSession>,
  revision: number
) {
  const layout = layoutSemanticDocument(part, revision, {
    measurer: notes.measurer,
    producer: notes.producer,
    notes,
    session,
  });
  const note = layout.pages.flatMap((page) => page.footnotes?.notes ?? [])[0];
  expect(note).toBeDefined();
  return note!;
}

test('a table-only projection callback without an epoch disables whole-note memo reuse', () => {
  const { part, notes } = fixture();
  const session = createLayoutSession();
  const first = laidNote(
    part,
    { ...notes, projectionTokenForTableForPart: () => 'projection:one' },
    session,
    1
  );
  expect(session.notes).toBeNull();

  const second = laidNote(
    part,
    { ...notes, projectionTokenForTableForPart: () => 'projection:two' },
    session,
    2
  );
  expect(session.notes).toBeNull();
  expect(second).not.toBe(first);
});

test('a stable projection epoch keeps callback allocation out of whole-note memo identity', () => {
  const { part, notes } = fixture();
  const session = createLayoutSession();
  const first = laidNote(
    part,
    {
      ...notes,
      projectionTokenForTableForPart: () => 'projection:stable',
      projectionEpoch: 'projection-epoch:stable',
    },
    session,
    1
  );
  const memo = session.notes;
  expect(memo).not.toBeNull();

  const second = laidNote(
    part,
    {
      ...notes,
      projectionTokenForTableForPart: () => 'projection:stable',
      projectionEpoch: 'projection-epoch:stable',
    },
    session,
    2
  );
  expect(session.notes).toBe(memo);
  expect(second).toBe(first);
});

test('compatibility-only changes invalidate the note geometry fingerprint', () => {
  const { notes } = fixture();
  const legacy = fingerprintNotesInput({ ...notes, compatibilityMode: 14 });
  expect(legacy).not.toBeNull();
  expect(fingerprintNotesInput({ ...notes, compatibilityMode: 15 })).not.toBe(legacy);
  expect(fingerprintNotesInput({ ...notes, compatibilityMode: 14 })).toBe(legacy);
});

test('repeated attachment to the same body page retains the note page', () => {
  const { part, notes } = fixture();
  const session = createLayoutSession();
  const complete = layoutSemanticDocument(part, 1, {
    measurer: notes.measurer,
    producer: notes.producer,
    notes,
    session,
  });
  const body = { ...complete, pages: complete.pages.map(({ footnotes: _notes, ...page }) => page) };
  const refs = buildPageRefHits(collectBodyNoteReferences(part, 'all-markup'), new Map());
  const first = attachNotesToLayout(body, refs, notes, { memo: session.notes });
  expect(first.layout.pages[0]!.footnotes).toBeDefined();
  const second = attachNotesToLayout(body, refs, notes, { memo: session.notes });
  expect(second.layout.pages[0]).toBe(first.layout.pages[0]);
  const attached = attachNotesToLayout(first.layout, refs, notes, { memo: session.notes });
  expect(attached.layout.pages[0]).toBe(first.layout.pages[0]);
  expect(second.layout).toEqual(attachNotesToLayout(body, refs, notes).layout);

  // A changed page shell must not receive the old note position.
  const moved = {
    ...body,
    pages: body.pages.map((page) => ({
      ...page,
      contentBox: { ...page.contentBox, height: page.contentBox.height - 20 },
    })),
  };
  const movedResult = attachNotesToLayout(moved, refs, notes, { memo: session.notes });
  expect(movedResult.layout.pages[0]).not.toBe(first.layout.pages[0]);
  expect(movedResult.layout).toEqual(attachNotesToLayout(moved, refs, notes).layout);

  // An unchanged page record alone cannot prove unchanged reference offsets.
  const changedRefs = refs.map((ref) => ({ ...ref, atomOffset: ref.atomOffset + 1 }));
  const changed = attachNotesToLayout(body, changedRefs, notes, { memo: session.notes });
  expect(changed.layout.pages[0]).not.toBe(first.layout.pages[0]);
  expect(changed.layout).toEqual(attachNotesToLayout(body, changedRefs, notes).layout);
});
