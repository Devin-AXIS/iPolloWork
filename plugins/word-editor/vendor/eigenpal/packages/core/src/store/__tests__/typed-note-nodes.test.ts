// Typed footnote/endnote canonical nodes + UTF-16 atoms + diagnostics.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  NOTE_ATOM_CHAR,
  applyTreeOp,
  canonicalOoxmlFingerprint,
  customMarkFollows,
  diagnoseNoteReferences,
  formatNoteScopeId,
  isNoteNode,
  isNoteRefNode,
  isNoteReferenceNode,
  isSeparatorNode,
  noteIdOf,
  noteKindOf,
  noteTypeOf,
  paragraphTextOf,
  parseNoteScopeId,
  readOoxmlPackage,
  readOoxmlPart,
  segmentsOf,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FIXTURE = join(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};
const fnMeta = {
  name: '/word/footnotes.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function parseNotes(inner: string): OoxmlPart {
  const result = readOoxmlPart(`<w:footnotes xmlns:w="${W}">${inner}</w:footnotes>`, fnMeta);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children.find((child) => child.kind === 'body') as OoxmlElement;
  const paragraph = body.children.find((child) => child.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph;
}

describe('EditorScope note id encoding', () => {
  test('format/parse footnote and endnote scope ids', () => {
    expect(formatNoteScopeId('footnote', 2)).toBe('footnote:2');
    expect(formatNoteScopeId('endnote', -1)).toBe('endnote:-1');
    expect(parseNoteScopeId('footnote:2')).toEqual({ noteKind: 'footnote', noteId: 2 });
    expect(parseNoteScopeId('endnote:1')).toEqual({ noteKind: 'endnote', noteId: 1 });
    expect(parseNoteScopeId('2')).toBeNull();
    expect(parseNoteScopeId('footnote:abc')).toBeNull();
  });
});

describe('typed note parse / serialize', () => {
  test('types footnotes root, notes, refs, separators, and preserves ST_FtnEdn normal', () => {
    const part = parseNotes(
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="normal" w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>a</w:t></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="2"><w:p><w:r><w:t>b</w:t></w:r></w:p></w:footnote>`
    );
    expect(part.root.kind).toBe('footnotes');
    const notes = part.root.children.filter((child) => child.kind === 'note');
    expect(notes).toHaveLength(4);
    expect(noteTypeOf(notes[0]!)).toBe('separator');
    expect(noteIdOf(notes[0]!)).toBe(-1);
    expect(noteTypeOf(notes[2]!)).toBe('normal');
    expect(noteTypeOf(notes[3]!)).toBeUndefined();

    const sepRun = (notes[0]!.children[0] as OoxmlElement).children.find(
      (child) => child.kind === 'run'
    )!;
    expect(isSeparatorNode(sepRun.children.find((child) => child.kind === 'separator')!)).toBe(
      true
    );

    const ref = (notes[2]!.children[0] as OoxmlElement).children
      .find((child) => child.kind === 'run')!
      .children.find((child) => child.kind === 'noteRef')!;
    expect(isNoteRefNode(ref)).toBe(true);

    const again = readOoxmlPart(serializeOoxmlPart(part), fnMeta);
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error(again.reason);
    expect(canonicalOoxmlFingerprint(again.part)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('types noteReference with customMarkFollows', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="2" w:customMarkFollows="1"/><w:t>Z</w:t></w:r></w:p>`
    );
    const run = paragraphOf(part).children.find((child) => child.kind === 'run')!;
    const ref = run.children.find((child) => child.kind === 'noteReference')!;
    expect(isNoteReferenceNode(ref)).toBe(true);
    expect(noteKindOf(ref)).toBeNull();
    expect(noteIdOf(ref)).toBe(2);
    expect(customMarkFollows(ref)).toBe(true);
  });

  test('demotes misplaced / malformed known note nodes fail-open', () => {
    const badId = parseNotes(`<w:footnote w:id="nope"><w:p/></w:footnote>`);
    expect(badId.root.children[0]!.kind).toBe('generic');

    const badType = parseNotes(`<w:footnote w:id="1" w:type="bogus"><w:p/></w:footnote>`);
    expect(badType.root.children[0]!.kind).toBe('generic');

    // Known element in the wrong place: the run demotes (note is not a legal run child),
    // while the inner footnote may remain typed — fail-open preservation either way.
    const misplaced = parseDoc(`<w:p><w:r><w:footnote w:id="1"/></w:r></w:p>`);
    const container = paragraphOf(misplaced).children.find(
      (child) => child.kind === 'run' || child.localName === 'r'
    )!;
    expect(container.kind === 'generic' || container.kind === 'run').toBe(true);
    const inner = container.children.find((child) => child.localName === 'footnote');
    expect(inner).toBeDefined();
  });

  test('comprehensive fixture unedited fingerprint round-trip for note parts', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const footnotes = loaded.package.parts.get('/word/footnotes.xml');
    const endnotes = loaded.package.parts.get('/word/endnotes.xml');
    expect(footnotes?.root.kind).toBe('footnotes');
    expect(endnotes?.root.kind).toBe('endnotes');
    expect(footnotes!.root.children.filter((child) => isNoteNode(child))).toHaveLength(5);

    const fnAgain = readOoxmlPart(serializeOoxmlPart(footnotes!), {
      name: footnotes!.name,
      contentType: footnotes!.contentType,
    });
    expect(fnAgain.ok).toBe(true);
    if (!fnAgain.ok) throw new Error(fnAgain.reason);
    expect(canonicalOoxmlFingerprint(fnAgain.part)).toBe(canonicalOoxmlFingerprint(footnotes!));

    const enAgain = readOoxmlPart(serializeOoxmlPart(endnotes!), {
      name: endnotes!.name,
      contentType: endnotes!.contentType,
    });
    expect(enAgain.ok).toBe(true);
    if (!enAgain.ok) throw new Error(enAgain.reason);
    expect(canonicalOoxmlFingerprint(enAgain.part)).toBe(canonicalOoxmlFingerprint(endnotes!));
  });
});

describe('UTF-16 note atoms', () => {
  test('A[noteRef]Z offsets and atomic delete', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    const text = paragraphTextOf(part, paragraph.id);
    expect(text).toBe(`A${NOTE_ATOM_CHAR}Z`);
    const segments = segmentsOf(paragraph);
    expect(segments).toHaveLength(3);
    expect(segments[1]!.end - segments[1]!.start).toBe(1);
    expect(segments[1]!.removeNodeIds).toEqual([segments[1]!.node.id]);

    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 1,
      end: 2,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error(deleted.reason);
    expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('AZ');
    const run = paragraphOf(deleted.part).children.find((child) => child.kind === 'run')!;
    expect(run.children.some((child) => child.kind === 'noteReference')).toBe(false);
  });

  test('noteRef / separator / continuationSeparator are one atom each', () => {
    const part = parseNotes(
      `<w:footnote w:id="1"><w:p><w:r>` +
        `<w:footnoteRef/><w:separator/><w:continuationSeparator/><w:t>x</w:t>` +
        `</w:r></w:p></w:footnote>`
    );
    const note = part.root.children.find((child) => child.kind === 'note')!;
    const paragraph = note.children.find((child) => child.kind === 'paragraph')!;
    const text = paragraphTextOf(part, paragraph.id);
    expect(text).toBe(`${NOTE_ATOM_CHAR}${NOTE_ATOM_CHAR}${NOTE_ATOM_CHAR}x`);
  });

  test('note atoms inside a hyperlink stay one UTF-16 unit', () => {
    const part = parseDoc(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:hyperlink w:anchor="here">` +
        `<w:r><w:t>L</w:t><w:footnoteReference w:id="1"/><w:t>K</w:t></w:r>` +
        `</w:hyperlink>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`AL${NOTE_ATOM_CHAR}KZ`);
    const segments = segmentsOf(paragraph);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(segments[2]!.removeNodeIds).toEqual([segments[2]!.node.id]);

    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 2,
      end: 3,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error(deleted.reason);
    expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('ALKZ');
    const run = paragraphOf(deleted.part)
      .children.filter((child) => child.kind === 'hyperlink')
      .flatMap((link) => link.children)
      .find((child) => child.kind === 'run');
    expect(run?.children.some((child) => child.kind === 'noteReference')).toBe(false);
  });
});

describe('dangling note references', () => {
  test('load reports dangling refs fail-open', () => {
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          `<w:p><w:r><w:footnoteReference w:id="99"/></w:r></w:p>` +
          `<w:sectPr/></w:body></w:document>`
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const diagnostics = diagnoseNoteReferences(loaded.package);
    expect(diagnostics.some((d) => d.code === 'dangling-note-reference' && d.noteId === 99)).toBe(
      true
    );
  });
});
