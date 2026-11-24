// The D9 oracles applied to object-model edits.
//
// The write tests assert that a document says what it should after an edit. These assert the
// thing that is easy to lose and impossible to see from the outside: that the edit went into the
// DOCUMENT rather than into a session's idea of one, and that everything the edit did not touch
// came out the other side unchanged.
//
// Two oracles, both from the store lane, both applied to bytes this lane produced:
//
//   `canonicalOoxmlFingerprint` — structural identity of a part. Equal fingerprints mean equal
//   trees under the normalization the serializer performs.
//
//   `semanticDigest` / `diffSemanticDigests` — what a story SAYS, per paragraph. It answers
//   "did this edit change anything it should not have" with a path rather than a boolean.
//
// Serializing must be a FIXED POINT: saving, reopening and saving again has to produce the same
// bytes, or every later comparison in this suite is comparing noise.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { canonicalOoxmlFingerprint } from '../../store/package/ooxml-tree.ts';
import type { OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../../store/package/ooxml-digest.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import {
  cell,
  docx,
  handleAt,
  open,
  paragraphsOf,
  pWithId,
  row,
  savedMainXml,
  table,
} from './support/protocol.ts';

/** A fixture that already carries the identity Word writes, so an open mints nothing. */
const AUTHORED = docx(
  pWithId('alpha', '11111111') + pWithId('beta', '22222222') + pWithId('gamma', '33333333')
);

function savedMainPart(host: AutomationHost): OoxmlPart {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save refused: ${saved.error.code}`);
  const opened = readOoxmlPackage(saved.bytes);
  if (!opened.ok) throw new Error(`saved bytes did not reopen: ${opened.reason}`);
  const main = opened.package.parts.get(opened.package.mainDocumentPart);
  if (!main) throw new Error('saved package has no main document part');
  return main;
}

function savedBytes(host: AutomationHost): Uint8Array {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save refused: ${saved.error.code}`);
  return saved.bytes;
}

function bodyOf(host: AutomationHost): AutomationHandle {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  return handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
}

/** Each paragraph's `w14:paraId`, as the saved document writes it. */
function identitiesOf(
  host: AutomationHost,
  paragraphs: readonly AutomationHandle[]
): readonly string[] {
  const response = host.execute({
    operations: paragraphs.map((paragraph) => ({ op: 'getParagraphId' as const, paragraph })),
  });
  return paragraphs.map((_, index) => {
    const result = response.results[index];
    if (result?.status !== 'ok' || result.value.kind !== 'text')
      throw new Error(`no identity at ${String(index)}`);
    return result.value.text;
  });
}

describe('saving is a fixed point', () => {
  test('open, save, reopen, save again is byte-identical', () => {
    const first = savedBytes(open(AUTHORED));
    const second = savedBytes(open(first));
    expect([...second]).toEqual([...first]);
  });

  test('an unedited pass leaves the body part structurally identical', () => {
    const once = canonicalOoxmlFingerprint(savedMainPart(open(AUTHORED)));
    const twice = canonicalOoxmlFingerprint(savedMainPart(open(savedBytes(open(AUTHORED)))));
    expect(twice).toBe(once);
  });
});

describe('an edit changes the document, and only where it was made', () => {
  test('inserting text changes one paragraph and nothing else', () => {
    const before = semanticDigest([savedMainPart(open(AUTHORED))]);

    const host = open(AUTHORED);
    const list = paragraphsOf(host, bodyOf(host));
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: list[1]!, offset: 0 }, text: 'X' }],
    });
    const after = semanticDigest([savedMainPart(host)]);

    const differences = diffSemanticDigests(before, after);
    expect(differences.length).toBeGreaterThan(0);
    // Every reported difference is about the paragraph that was edited: none of them mention
    // the first or third, which is what "and nothing else" has to mean to be worth asserting.
    const changed = differences.map((difference) => difference.path).join(' ');
    expect(changed).not.toContain('alpha');
    expect(changed).not.toContain('gamma');
  });

  test('the structural fingerprint moves for an edit and stands still without one', () => {
    const untouched = canonicalOoxmlFingerprint(savedMainPart(open(AUTHORED)));

    const host = open(AUTHORED);
    const list = paragraphsOf(host, bodyOf(host));
    const read = host.execute({ operations: [{ op: 'getText', target: list[0]! }] });
    expect(read.ok).toBe(true);
    // A batch of reads is not an edit, however many of them there are.
    expect(canonicalOoxmlFingerprint(savedMainPart(host))).toBe(untouched);

    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'X' }],
    });
    expect(canonicalOoxmlFingerprint(savedMainPart(host))).not.toBe(untouched);
  });

  test('a refused batch leaves the document structurally where it was', () => {
    const host = open(AUTHORED);
    const list = paragraphsOf(host, bodyOf(host));
    const before = canonicalOoxmlFingerprint(savedMainPart(host));
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'good' },
        { op: 'insertText', at: { paragraph: list[1]!, offset: 999 }, text: 'bad' },
      ],
    });
    expect(response.ok).toBe(false);
    expect(canonicalOoxmlFingerprint(savedMainPart(host))).toBe(before);
  });
});

describe('a formatting edit survives the serializer, and stays where it was made', () => {
  test('a font write changes one paragraph and leaves the others structurally identical', () => {
    const before = semanticDigest([savedMainPart(open(AUTHORED))]);

    const host = open(AUTHORED);
    const list = paragraphsOf(host, bodyOf(host));
    const response = host.execute({
      operations: [
        { op: 'setFont', span: { paragraph: list[1]! }, font: { bold: true, size: 12 } },
      ],
    });
    expect(response.ok).toBe(true);

    const differences = diffSemanticDigests(before, semanticDigest([savedMainPart(host)]));
    const changed = differences.map((difference) => difference.path).join(' ');
    expect(changed).not.toContain('alpha');
    expect(changed).not.toContain('gamma');

    // And the formatted document is a fixed point, so the properties were written as properties
    // rather than as something the next save normalizes differently.
    expect([...savedBytes(host)]).toEqual([...savedBytes(open(savedBytes(host)))]);
  });

  test('a paragraph-format write keeps the paragraph properties it was not asked about', () => {
    // `setParagraphProperties` REPLACES the container it writes, so this is the assertion that the
    // op carried the paragraph's existing children forward: a write of one attribute that dropped
    // the paragraph's style and numbering would still pass every read of the attribute written.
    const source = docx(
      '<w:p w14:paraId="88888888"><w:pPr><w:pStyle w:val="Quote"/>' +
        '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' +
        '<w:spacing w:before="240"/></w:pPr><w:r><w:t>listed</w:t></w:r></w:p>'
    );
    const host = open(source);
    const list = paragraphsOf(host, bodyOf(host));
    const response = host.execute({
      operations: [
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph: list[0]! },
          format: { leftIndent: 18 },
        },
      ],
    });
    expect(response.ok).toBe(true);

    const saved = savedMainXml(host);
    expect(saved).toContain('w:val="Quote"');
    expect(saved).toContain('w:numId w:val="3"');
    expect(saved).toContain('w:before="240"');
    expect(saved).toContain('w:left="360"');
    expect([...savedBytes(host)]).toEqual([...savedBytes(open(savedBytes(host)))]);
  });

  test('a style write names the id the part declares, and keeps the rest of the pPr', () => {
    // The document names the style `heading 1` and identifies it as `Heading1`. A host that wrote
    // the caller's string straight into `w:pStyle` would produce a paragraph pointing at a style
    // definition that does not exist — Word would silently render it as the default.
    const source = docx(
      '<w:p w14:paraId="77777777"><w:pPr><w:spacing w:after="120"/></w:pPr>' +
        '<w:r><w:t>plain</w:t></w:r></w:p>',
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
    );
    const host = open(source);
    const list = paragraphsOf(host, bodyOf(host));
    const response = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: list[0]! }, name: 'HEADING 1' }],
    });
    expect(response.ok).toBe(true);

    const saved = savedMainXml(host);
    expect(saved).toContain('<w:pStyle w:val="Heading1"/>');
    expect(saved).toContain('w:after="120"');
    expect([...savedBytes(host)]).toEqual([...savedBytes(open(savedBytes(host)))]);

    // And reopening reads the name back, so the write and the read agree about the same document.
    const reopened = open(savedBytes(host));
    const answer = reopened.execute({
      operations: [
        { op: 'getStyle', span: { paragraph: paragraphsOf(reopened, bodyOf(reopened))[0]! } },
      ],
    });
    const result = answer.results[0];
    expect(result?.status === 'ok' && result.value).toEqual({ kind: 'style', name: 'heading 1' });
  });

  test('a refused formatting write leaves the document structurally where it was', () => {
    const host = open(AUTHORED);
    const list = paragraphsOf(host, bodyOf(host));
    const before = canonicalOoxmlFingerprint(savedMainPart(host));
    const response = host.execute({
      operations: [
        { op: 'setFont', span: { paragraph: list[0]! }, font: { bold: true } },
        { op: 'setFont', span: { paragraph: list[1]! }, font: { color: 'not a colour' } },
      ],
    });
    expect(response.ok).toBe(false);
    expect(canonicalOoxmlFingerprint(savedMainPart(host))).toBe(before);
  });
});

describe('a structural edit survives the serializer', () => {
  test('an inserted paragraph reopens as a paragraph with its own identity', () => {
    const host = open(AUTHORED);
    const list = paragraphsOf(host, bodyOf(host));
    host.execute({
      operations: [
        {
          op: 'insertParagraph',
          anchor: { paragraph: list[0]! },
          where: 'after',
          text: 'inserted',
        },
      ],
    });

    const reopened = open(savedBytes(host));
    const reopenedList = paragraphsOf(reopened, bodyOf(reopened));
    expect(reopenedList).toHaveLength(4);
    expect(new Set(identitiesOf(reopened, reopenedList)).size).toBe(4);

    // And the reopened document is itself a fixed point, so the inserted paragraph was written
    // as a paragraph rather than as something the serializer normalizes away next time.
    expect([...savedBytes(reopened)]).toEqual([...savedBytes(open(savedBytes(reopened)))]);
  });

  test('a split reopens as separate paragraphs, each with a distinct identity', () => {
    const host = open(docx(pWithId('a,b,c', '44444444')));
    const list = paragraphsOf(host, bodyOf(host));
    host.execute({
      operations: [
        { op: 'splitParagraph', paragraph: list[0]!, delimiters: [','], trimDelimiters: true },
      ],
    });

    const reopened = open(savedBytes(host));
    const identities = identitiesOf(reopened, paragraphsOf(reopened, bodyOf(reopened)));
    expect(identities).toHaveLength(3);
    expect(new Set(identities).size).toBe(3);
    expect(identities.every((identity) => /^[0-9A-F]{8}$/.test(identity))).toBe(true);
  });

  test('a deletion inside a table leaves the table, its row and its other cell alone', () => {
    const source = docx(
      table(
        row(
          cell(pWithId('One', '55555555'), pWithId('Extra', '66666666')),
          cell(pWithId('Two', '77777777'))
        )
      )
    );
    const host = open(source);
    const list = paragraphsOf(host, bodyOf(host));
    expect(list).toHaveLength(4); // The last is the body's paragraph after the table.
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[1]! }] });

    const reopened = open(savedBytes(host));
    const paragraphs = paragraphsOf(reopened, bodyOf(reopened));
    expect(paragraphs).toHaveLength(3);
    const after = semanticDigest([savedMainPart(reopened)]);
    const differences = diffSemanticDigests(semanticDigest([savedMainPart(open(source))]), after);
    const changed = differences.map((difference) => difference.path).join(' ');
    expect(changed).not.toContain('Two');
  });
});
