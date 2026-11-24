// `deleteParagraph` inside a footnote or endnote, at the protocol boundary.
//
// A note is a story of its own: deleting one of its paragraphs works as it does in the body,
// and only the note's last paragraph is refused, with a code that says why.

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { AutomationBatchResponse, AutomationHandle, AutomationHost } from '../protocol.ts';
import { open, paragraphTexts } from './support/protocol.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WML_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const refP = (kind: NoteKind, text: string): string =>
  `<w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p>`;

type NoteKind = 'footnote' | 'endnote';

/** The note's own reference mark reads as one object replacement character. */
const MARK = '\uFFFC';

/** A document whose first body paragraph references note 1 of `kind`, and note 2 after it. */
function notesDocx(kind: NoteKind, first: string, second = p('Other note.')): Uint8Array {
  const part = `${kind}s`;
  const separators =
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML_CT}.document.main+xml"/>` +
        `<Override PartName="/word/${part}.xml" ContentType="${WML_CT}.${part}+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/${part}" Target="${part}.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:r><w:t>Text with notes.</w:t></w:r><w:r><w:${kind}Reference w:id="1"/></w:r>` +
        `<w:r><w:${kind}Reference w:id="2"/></w:r></w:p>${p('Second body paragraph.')}` +
        `</w:body></w:document>`
    ),
    [`word/${part}.xml`]: strToU8(
      `<w:${part} xmlns:w="${W}" xmlns:r="${R}">${separators}` +
        `<w:${kind} w:id="1">${first}</w:${kind}><w:${kind} w:id="2">${second}</w:${kind}></w:${part}>`
    ),
  });
}

function value(host: AutomationHost, operation: object) {
  const response = host.execute({ operations: [operation as never] });
  const result = response.results[0];
  if (!response.ok || result?.status !== 'ok') throw new Error(JSON.stringify(response.results));
  return result.value as { handle?: AutomationHandle; handles?: AutomationHandle[] };
}

/** The bodies of the document's notes of `kind`, in reference order. */
function noteBodies(host: AutomationHost, noteKind: NoteKind): AutomationHandle[] {
  const document = value(host, { op: 'getDocument' }).handle!;
  return value(host, { op: 'getNotes', document, noteKind }).handles!.map(
    (note) => value(host, { op: 'getNoteBody', note }).handle!
  );
}

const paragraphsIn = (host: AutomationHost, body: AutomationHandle): AutomationHandle[] =>
  value(host, { op: 'getParagraphs', body }).handles!;

const deleteParagraph = (host: AutomationHost, paragraph: AutomationHandle) =>
  host.execute({ operations: [{ op: 'deleteParagraph', paragraph }] });

const errorOf = (response: AutomationBatchResponse) => {
  const result = response.results[0];
  return result?.status === 'error' ? result.error : null;
};

describe.each(['footnote', 'endnote'] as const)('deleteParagraph in a %s', (kind) => {
  const twoParagraphs = refP(kind, 'First note paragraph.') + p('Second note paragraph.');

  test('removes the second paragraph and leaves the other note alone', () => {
    const host = open(notesDocx(kind, twoParagraphs));
    const [note, other] = noteBodies(host, kind) as [AutomationHandle, AutomationHandle];
    const [, second] = paragraphsIn(host, note);

    const response = deleteParagraph(host, second!);

    expect(response.ok).toBe(true);
    expect(response.changed).toBe(true);
    expect(paragraphTexts(host, note)).toEqual([`${MARK} First note paragraph.`]);
    expect(paragraphTexts(host, other)).toEqual(['Other note.']);
  });

  test('removes the first paragraph, with the reference mark it holds', () => {
    const host = open(notesDocx(kind, twoParagraphs));
    const [note] = noteBodies(host, kind) as [AutomationHandle];
    const [first] = paragraphsIn(host, note);

    expect(deleteParagraph(host, first!).ok).toBe(true);
    expect(paragraphTexts(host, note)).toEqual(['Second note paragraph.']);
  });

  test('refuses the only paragraph of a note as unsupported, not as a stale target', () => {
    const host = open(notesDocx(kind, refP(kind, 'Only paragraph.')));
    const [note] = noteBodies(host, kind) as [AutomationHandle];
    const [only] = paragraphsIn(host, note);

    const response = deleteParagraph(host, only!);

    expect(response.changed).toBe(false);
    expect(errorOf(response)).toMatchObject({
      code: 'unsupported-capability',
      detail: 'block-required',
    });
    expect(paragraphTexts(host, note)).toEqual([`${MARK} Only paragraph.`]);
  });

  test('saves the note without the paragraph, and the reopened note reads the same', () => {
    const host = open(notesDocx(kind, twoParagraphs));
    const [note] = noteBodies(host, kind) as [AutomationHandle];
    deleteParagraph(host, paragraphsIn(host, note)[1]!);

    const saved = host.save();
    if (!saved.ok) throw new Error(saved.error.code);
    const xml = strFromU8(unzipSync(saved.bytes)[`word/${kind}s.xml`]!);
    expect(xml).not.toContain('Second note paragraph.');
    expect(xml).toContain(`<w:${kind}Ref/>`);

    const reopened = open(saved.bytes);
    const [reopenedNote] = noteBodies(reopened, kind) as [AutomationHandle];
    expect(paragraphTexts(reopened, reopenedNote)).toEqual([`${MARK} First note paragraph.`]);
  });

  test('keeps the handles of the surviving note paragraphs naming the same paragraphs', () => {
    const host = open(notesDocx(kind, twoParagraphs + p('Third note paragraph.')));
    const [note] = noteBodies(host, kind) as [AutomationHandle];
    const [first, second, third] = paragraphsIn(host, note);
    expect(deleteParagraph(host, second!).ok).toBe(true);
    const response = host.execute({
      operations: [
        { op: 'getText', target: first! },
        { op: 'getText', target: third! },
      ],
    });
    expect(
      response.results.map((result) => (result.status === 'ok' ? result.value : null))
    ).toEqual([
      { kind: 'text', text: `${MARK} First note paragraph.` },
      { kind: 'text', text: 'Third note paragraph.' },
    ]);
  });
});
