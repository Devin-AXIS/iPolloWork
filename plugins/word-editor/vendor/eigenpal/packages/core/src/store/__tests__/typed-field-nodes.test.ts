// Typed canonical field nodes + atomic UTF-16 addressing.
//
// Covers parse/serialize, fingerprint, model offsets around A[field]Z, atomic
// delete/selection segments, malformed demotion, split runs, cached result
// formatting, fldSimple, locked/dirty attrs, ffData inertness, no fetch, round-trip.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  FIELD_ATOM_CHAR,
  applyTreeOp,
  atomicFieldSpansOf,
  canonicalOoxmlFingerprint,
  fieldOnOffAttribute,
  fldCharType,
  fldSimpleInstr,
  hasLegacyFormFieldData,
  instrTextValue,
  isFldCharNode,
  isFldSimpleNode,
  isInstrTextNode,
  paragraphTextOf,
  readOoxmlPackage,
  readOoxmlPart,
  segmentsOf,
  serializeOoxmlPart,
  writeOoxmlPackage,
  type OoxmlElement,
  type OoxmlPart,
} from '../index.ts';
import { piecesOfParagraph } from '../../layout/field-projection.ts';
import { MAX_FIELD_INSTRUCTION_CHARS, parsedFieldSpansOf } from '../package/field-nodes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    metadata
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children[0] as OoxmlElement;
  const paragraph = body.children.find((child) => child.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph;
}

function reopen(part: OoxmlPart): OoxmlPart {
  const xml = serializeOoxmlPart(part);
  const again = readOoxmlPart(xml, metadata);
  expect(again.ok).toBe(true);
  if (!again.ok) throw new Error(again.reason);
  return again.part;
}

describe('typed field parse / serialize', () => {
  test('types fldChar, instrText, and fldSimple with schema attrs', () => {
    const part = parse(
      `<w:p>` +
        `<w:r>` +
        `<w:fldChar w:fldCharType="begin" w:dirty="true" w:fldLock="0"/>` +
        `<w:instrText xml:space="preserve"> PAGE </w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/>` +
        `<w:t>1</w:t>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r>` +
        `<w:fldSimple w:instr="NUMPAGES" w:dirty="true" w:fldLock="true">` +
        `<w:r><w:t>9</w:t></w:r>` +
        `</w:fldSimple>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const run = paragraph.children.find((child) => child.kind === 'run')!;
    const begin = run.children.find((child) => child.kind === 'fldChar')!;
    expect(isFldCharNode(begin)).toBe(true);
    expect(fldCharType(begin)).toBe('begin');
    expect(fieldOnOffAttribute(begin, 'dirty')).toBe(true);
    expect(fieldOnOffAttribute(begin, 'fldLock')).toBe(false);

    const instr = run.children.find((child) => child.kind === 'instrText')!;
    expect(isInstrTextNode(instr)).toBe(true);
    expect(instrTextValue(instr)).toBe(' PAGE ');

    const simple = paragraph.children.find((child) => child.kind === 'fldSimple')!;
    expect(isFldSimpleNode(simple)).toBe(true);
    expect(fldSimpleInstr(simple)).toBe('NUMPAGES');
    expect(fieldOnOffAttribute(simple, 'dirty')).toBe(true);
    expect(fieldOnOffAttribute(simple, 'fldLock')).toBe(true);
  });

  test('demotes fldChar without legal fldCharType to generic', () => {
    const part = parse(`<w:p><w:r><w:fldChar w:fldCharType="bogus"/></w:r></w:p>`);
    const run = paragraphOf(part).children.find((child) => child.kind === 'run')!;
    const node = run.children.find((child) => child.localName === 'fldChar')!;
    expect(node.kind).toBe('generic');
  });

  test('preserves unknown attrs and ffData children generically', () => {
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin" w:extra="keep">` +
        `<w:ffData>` +
        `<w:name w:val="Box"/>` +
        `<w:entryMacro w:val="EvilMacro"/>` +
        `<w:exitMacro w:val="OtherMacro"/>` +
        `</w:ffData>` +
        `</w:fldChar>` +
        `<w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r></w:p>`
    );
    const begin = paragraphOf(part)
      .children.find((child) => child.kind === 'run')!
      .children.find((child) => child.kind === 'fldChar')!;
    expect(begin.attributes.some((a) => a.localName === 'extra' && a.value === 'keep')).toBe(true);
    const ffData = begin.children.find(
      (child) => child.kind === 'generic' && child.localName === 'ffData'
    );
    expect(ffData).toBeDefined();
    expect(
      ffData!.children.some(
        (child) => child.kind !== 'textValue' && child.localName === 'entryMacro'
      )
    ).toBe(true);
  });

  test('normalized round-trip keeps fingerprint and does not rewrite fldSimple to complex', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>3</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:fldSimple w:instr="DATE"><w:r><w:t>x</w:t></w:r></w:fldSimple>` +
        `</w:p>`
    );
    const before = canonicalOoxmlFingerprint(part);
    const again = reopen(part);
    expect(canonicalOoxmlFingerprint(again)).toBe(before);
    const paragraph = paragraphOf(again);
    expect(paragraph.children.some((child) => child.kind === 'fldSimple')).toBe(true);
    expect(
      paragraph.children.some(
        (child) => child.kind === 'run' && child.children.some((grand) => grand.kind === 'fldChar')
      )
    ).toBe(true);
  });
});

describe('atomic UTF-16 addressing', () => {
  test('A[field]Z model offsets stay A, atom, Z', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>99</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}Z`);
    const segments = segmentsOf(paragraph);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ start: 0, end: 1 });
    expect(segments[1]).toMatchObject({ start: 1, end: 2 });
    expect(segments[1]!.removeNodeIds?.length).toBeGreaterThan(0);
    expect(segments[2]).toMatchObject({ start: 2, end: 3 });

    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    expect(pieces.map((p) => p.text)).toEqual(['A', '7', 'Z']);
    expect(pieces[1]).toMatchObject({ start: 1, end: 2, projected: true });
    expect(pieces[1]!.style.bold).toBe(true);
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('fldSimple is one atom and does not expose cached text as editable', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:fldSimple w:instr="DATE"><w:r><w:t>1999</w:t></w:r></w:fldSimple>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}Z`);
    const segments = segmentsOf(paragraph);
    expect(segments).toHaveLength(3);
    expect(segments[1]!.node.kind).toBe('fldSimple');
    expect(segments[1]!.removeNodeIds).toEqual([segments[1]!.node.id]);
  });

  test('atomic delete removes begin through end in one op', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>99</w:t>` +
        `<w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 1,
      end: 2,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('AZ');
    const next = paragraphOf(deleted.part);
    const xmlish = serializeOoxmlPart(deleted.part);
    expect(xmlish.includes('fldChar')).toBe(false);
    expect(xmlish.includes('instrText')).toBe(false);
    expect(next.children.some((child) => child.kind === 'fldSimple')).toBe(false);
  });

  test('insert beside a field does not land inside the instruction', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const inserted = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 1,
      text: 'X',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(paragraphTextOf(inserted.part, paragraph.id)).toBe(`${FIELD_ATOM_CHAR}XZ`);
    const again = reopen(inserted.part);
    expect(serializeOoxmlPart(again).includes('<w:instrText>PAGE</w:instrText>')).toBe(true);
  });

  test('formatting between simple fields preserves instruction and unrelated result formatting', () => {
    const part = parse(
      '<w:p><w:fldSimple w:instr="PAGE" w:dirty="true"><w:r><w:t/></w:r></w:fldSimple>' +
        '<w:r><w:t> of </w:t></w:r>' +
        '<w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:i/></w:rPr><w:t>12</w:t></w:r></w:fldSimple></w:p>'
    );
    const paragraph = paragraphOf(part);
    const formatted = applyTreeOp(part, {
      op: 'setRunProperties',
      paragraphId: paragraph.id,
      start: 0,
      end: 1,
      properties: [{ localName: 'b', attributes: { val: '1' } }],
    });
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) return;
    const xml = serializeOoxmlPart(reopen(formatted.part));
    expect(xml).toContain('w:instr="PAGE"');
    expect(xml).toContain('w:dirty="true"');
    const fields = xml.match(/<w:fldSimple[^>]*>[\s\S]*?<\/w:fldSimple>/g)!;
    expect(fields).toHaveLength(2);
    expect(fields[0]).toContain('<w:b w:val="1"/>');
    expect(fields[1]).toContain('<w:i/>');
    expect(fields[1]).not.toContain('<w:b');
    expect(fields[1]).toContain('<w:t>12</w:t>');
  });

  test('caret segments have no interior offsets inside a field', () => {
    const part = parse(
      `<w:p><w:r><w:t>A</w:t>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>12</w:t>` +
        `<w:fldChar w:fldCharType="end"/><w:t>Z</w:t></w:r></w:p>`
    );
    const segments = segmentsOf(paragraphOf(part));
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  test('field atoms inside a hyperlink stay one UTF-16 unit', () => {
    // fldSimple is not a legal hyperlink child (demotes the container to generic); a
    // complex field nested in a run keeps the typed link and still contributes one atom.
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:hyperlink w:anchor="here">` +
        `<w:r><w:t>L</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>9</w:t>` +
        `<w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>K</w:t></w:r>` +
        `</w:hyperlink>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`AL${FIELD_ATOM_CHAR}KZ`);
    const segments = segmentsOf(paragraph);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(segments[2]!.removeNodeIds?.length).toBeGreaterThan(0);

    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 2,
      end: 3,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('ALKZ');
    const xmlish = serializeOoxmlPart(deleted.part);
    expect(xmlish.includes('fldChar')).toBe(false);
    expect(xmlish.includes('instrText')).toBe(false);
  });
});

describe('editable FORMTEXT result addressing', () => {
  const formText = (result: string): string =>
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/>` +
    `<w:textInput><w:default w:val="Street"/></w:textInput></w:ffData></w:fldChar></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    result +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

  test('literal result characters keep one-to-one model and layout offsets', () => {
    const part = parse(
      `<w:p><w:r><w:t>A</w:t></w:r>` +
        formText(`<w:r><w:t>Street</w:t></w:r>`) +
        `<w:r><w:t>Z</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);

    expect(paragraphTextOf(part, paragraph.id)).toBe('AStreetZ');
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(0);
    expect(segmentsOf(paragraph).map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 7],
      [7, 8],
    ]);
    const pieces = piecesOfParagraph(paragraph);
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'Street', 'Z']);
    expect(pieces[1]).toMatchObject({
      start: 1,
      end: 7,
      fieldAtom: { formField: true },
    });
    expect(pieces[1]!.projected).toBeUndefined();
  });

  test('editing a tracked result preserves field chrome, revision, and round-trip', () => {
    const part = parse(
      `<w:p>` +
        formText(
          `<w:ins w:id="17" w:author="E" w:date="2026-08-05T11:42:40Z">` +
            `<w:r><w:t>Street</w:t></w:r></w:ins>`
        ) +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const edited = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 2,
      end: 3,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    expect(paragraphTextOf(edited.part, paragraph.id)).toBe('Street'.slice(0, 2) + 'eet');
    const xml = serializeOoxmlPart(edited.part);
    expect(xml).toContain('FORMTEXT');
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('w:author="E"');
    expect(xml).toContain('<w:fldChar');
    const again = reopen(edited.part);
    expect(paragraphTextOf(again, paragraph.id)).toBe('Steet');
    expect(canonicalOoxmlFingerprint(again)).toBe(canonicalOoxmlFingerprint(edited.part));
  });

  test('computed fields remain atomic even when ffData is present', () => {
    const part = parse(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData/></w:fldChar></w:r>` +
        `<w:r><w:instrText>REF Company</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>Street</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(FIELD_ATOM_CHAR);
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(1);
    expect(piecesOfParagraph(paragraph)[0]).toMatchObject({
      text: 'Street',
      start: 0,
      end: 1,
      projected: true,
    });
  });
});

describe('malformed demotion (fail-open)', () => {
  test('end without begin leaves surrounding text addressable', () => {
    const part = parse(
      `<w:p><w:r><w:t>A</w:t><w:fldChar w:fldCharType="end"/><w:t>Z</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('AZ');
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(0);
  });

  test('orphan instrText contributes no model text but stays in the tree', () => {
    const part = parse(
      `<w:p><w:r><w:t>A</w:t><w:instrText>PAGE</w:instrText><w:t>Z</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('AZ');
    expect(serializeOoxmlPart(part).includes('instrText')).toBe(true);
  });

  test('missing end demotes and keeps cached result text', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>99</w:t></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('A99Z');
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(0);
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    expect(pieces.map((p) => p.text)).toEqual(['A', '99', 'Z']);
    expect(pieces.every((p) => !p.projected)).toBe(true);
  });

  test('nested field result stays inside the outer field atom', () => {
    const part = parse(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>IF</w:instrText>' +
        '<w:fldChar w:fldCharType="separate"/><w:t>outer </w:t>' +
        '<w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText>' +
        '<w:fldChar w:fldCharType="separate"/><w:t>inner</w:t>' +
        '<w:fldChar w:fldCharType="end"/><w:t> tail</w:t>' +
        '<w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:t>Z</w:t></w:r></w:p>'
    );
    const paragraph = paragraphOf(part);

    expect(atomicFieldSpansOf(paragraph)).toHaveLength(1);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}Z`);
  });

  test('begin without separate still keeps following run text', () => {
    const part = parse(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:t>VISIBLE</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('VISIBLE');
    expect(piecesOfParagraph(paragraph).map((p) => p.text)).toEqual(['VISIBLE']);
  });

  test('nested fields beyond cap demote and keep content', () => {
    // 5 nested begins (> MAX_FIELD_NESTING 4)
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>KEEP</w:t>` +
        `<w:fldChar w:fldCharType="end"/>`.repeat(5) +
        `</w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('KEEP');
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(0);
  });

  test('many unmatched begins are demoted in linear time', () => {
    const begins = `<w:fldChar w:fldCharType="begin"/>`.repeat(8_000);
    const part = parse(`<w:p><w:r>${begins}<w:t>KEEP</w:t></w:r></w:p>`);
    const paragraph = paragraphOf(part);
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(0);
    expect(paragraphTextOf(part, paragraph.id)).toBe('KEEP');
  }, 1_000);

  test('fields do not form across paragraphs', () => {
    const part = parse(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText></w:r></w:p>` +
        `<w:p><w:r><w:fldChar w:fldCharType="separate"/><w:t>1</w:t>` +
        `<w:fldChar w:fldCharType="end"/><w:t>Z</w:t></w:r></w:p>`
    );
    const body = part.root.children[0] as OoxmlElement;
    const first = body.children[0]!;
    const second = body.children[1]!;
    expect(first.kind).toBe('paragraph');
    expect(second.kind).toBe('paragraph');
    if (first.kind !== 'paragraph' || second.kind !== 'paragraph') return;
    expect(atomicFieldSpansOf(first)).toHaveLength(0);
    expect(paragraphTextOf(part, second.id)).toBe('1Z');
  });
});

describe('inertness and security', () => {
  test('non-page fields paint cached text and never evaluate', () => {
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>INCLUDETEXT "http://evil.example/x"</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>cached</w:t>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 1, pageCount: 2 }).map((p) => p.text)
    ).toEqual(['cached']);
    expect(paragraphTextOf(part, paragraph.id)).toBe(FIELD_ATOM_CHAR);
  });

  test('ffData macros are preserved and never auto-resolved', () => {
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin">` +
        `<w:ffData><w:entryMacro w:val="Boom"/><w:exitMacro w:val="Gone"/></w:ffData>` +
        `</w:fldChar>` +
        `<w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/>` +
        `</w:r></w:p>`
    );
    const xml = serializeOoxmlPart(part);
    expect(xml.includes('entryMacro')).toBe(true);
    expect(xml.includes('exitMacro')).toBe(true);
    // No fetch / execution surface: projection still only reads fldCharType + instrText.
    const pieces = piecesOfParagraph(paragraphOf(part), [], { pageNumber: 4, pageCount: 4 });
    expect(pieces.map((p) => p.text)).toEqual(['4']);
    // Recognised as a form field for SHADING — from the element's presence alone. Nothing
    // reads into it, which is the point: the payload is macro names.
    expect(pieces[0]?.fieldAtom).toEqual({ formField: true });
  });

  test('hasLegacyFormFieldData asks only whether ffData is there', () => {
    const withData = parse(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/></w:ffData>` +
        `</w:fldChar></w:r></w:p>`
    );
    const without = parse(`<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>`);
    const beginOf = (part: OoxmlPart): OoxmlElement =>
      (paragraphOf(part).children[0] as OoxmlElement).children[0] as OoxmlElement;
    expect(hasLegacyFormFieldData(beginOf(withData))).toBe(true);
    expect(hasLegacyFormFieldData(beginOf(without))).toBe(false);
    // Not a `w:fldChar` at all, so not a form field however its children look.
    const run = paragraphOf(withData).children[0] as OoxmlElement;
    expect(hasLegacyFormFieldData(run)).toBe(false);
  });

  test('package save/reopen keeps complex fields and performs no network fetch', () => {
    const body =
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/>` +
      `<w:instrText>INCLUDETEXT "http://evil.example/x"</w:instrText>` +
      `<w:fldChar w:fldCharType="separate"/><w:t>safe</w:t>` +
      `<w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`;
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
        `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const written = writeOoxmlPackage(loaded.package);
    const reopened = readOoxmlPackage(written);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const doc = reopened.package.parts.get(reopened.package.mainDocumentPart);
    expect(doc).toBeDefined();
    const xml = serializeOoxmlPart(doc!);
    expect(xml.includes('INCLUDETEXT')).toBe(true);
    expect(xml.includes('safe')).toBe(true);
    expect(xml.includes('w:dirty')).toBe(true);
  });
});

describe('w:delInstrText addressing', () => {
  test('a tracked-deleted field forms one atom and swallows its delInstrText', () => {
    // Word rewrites `w:instrText` as `w:delInstrText` inside a deletion. The offset
    // authority must treat it exactly like the live form: instruction chrome, zero model
    // width, swallowed by the field's one reserved unit.
    const part = parse(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:del w:id="1" w:author="X">' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:delInstrText> PAGE </w:delInstrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:delText>3</w:delText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:del><w:r><w:t>B</w:t></w:r></w:p>'
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}B`);
    const spans = atomicFieldSpansOf(paragraph);
    expect(spans).toHaveLength(1);
    const findDelInstr = (node: OoxmlElement | { kind: 'textValue' }): OoxmlElement | undefined => {
      if (node.kind === 'textValue') return undefined;
      if (node.kind === 'generic' && node.localName === 'delInstrText') return node;
      for (const child of node.children ?? []) {
        const hit = findDelInstr(child as OoxmlElement);
        if (hit) return hit;
      }
      return undefined;
    };
    const delInstr = findDelInstr(paragraph);
    expect(delInstr).toBeDefined();
    expect(spans[0]!.removeNodeIds).toContain(delInstr!.id);
    // The instruction reader accepts the deleted form.
    expect(instrTextValue(delInstr!)).toBe(' PAGE ');
  });

  test('live and deleted instruction chunks never merge — the live one decides addressing', () => {
    // A tracked field-code edit leaves `w:delInstrText` NEXT TO `w:instrText` in one field.
    // Concatenating them read " PAGE  FORMTEXT ", which is not FORMTEXT, so the field lost
    // its editable result. The effective instruction is the live buffer alone.
    const fieldWith = (instructionRuns: string): OoxmlPart =>
      parse(
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          instructionRuns +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          '<w:r><w:t>typed</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
      );
    const spansOf = (part: OoxmlPart) => parsedFieldSpansOf(paragraphOf(part));

    // Deleted PAGE beside live FORMTEXT: accepting the deletion leaves FORMTEXT.
    const mixed = spansOf(
      fieldWith(
        '<w:r><w:delInstrText> PAGE </w:delInstrText></w:r>' +
          '<w:r><w:instrText> FORMTEXT </w:instrText></w:r>'
      )
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.addressing).toBe('editable-result');

    // The reverse: live PAGE beside a deleted FORMTEXT stays atomic.
    const reverse = spansOf(
      fieldWith(
        '<w:r><w:delInstrText> FORMTEXT </w:delInstrText></w:r>' +
          '<w:r><w:instrText> PAGE </w:instrText></w:r>'
      )
    );
    expect(reverse).toHaveLength(1);
    expect(reverse[0]!.addressing).toBe('atomic');

    // Overflow accounts per buffer: a huge deleted chunk must not overflow the small live
    // FORMTEXT instruction sitting beside it.
    const hugeDeleted = spansOf(
      fieldWith(
        `<w:r><w:delInstrText>${'X'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 40)}</w:delInstrText></w:r>` +
          '<w:r><w:instrText> FORMTEXT </w:instrText></w:r>'
      )
    );
    expect(hugeDeleted).toHaveLength(1);
    expect(hugeDeleted[0]!.addressing).toBe('editable-result');

    // A fully-deleted FORMTEXT keeps its meaning: the deleted buffer answers when no live
    // element exists at all.
    const fullyDeleted = spansOf(
      fieldWith('<w:r><w:delInstrText> FORMTEXT </w:delInstrText></w:r>')
    );
    expect(fullyDeleted).toHaveLength(1);
    expect(fullyDeleted[0]!.addressing).toBe('editable-result');
  });

  test('the store default cap agrees with the layout machine past the old 256 bound', () => {
    // The store's span parser and layout's field machine share ONE instruction bound. A
    // FORMTEXT instruction padded past the old 256-char cap must still address an editable
    // result — before the caps were unified this raw length overflowed here while layout
    // (called with its own constant) agreed, only by luck of both being 256.
    const padded = ` FORMTEXT ${' '.repeat(300)}`;
    const part = parse(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        `<w:r><w:instrText xml:space="preserve">${padded}</w:instrText></w:r>` +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>typed</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    const spans = parsedFieldSpansOf(paragraphOf(part));
    expect(spans).toHaveLength(1);
    expect(spans[0]!.addressing).toBe('editable-result');
  });

  test('an instruction past the shared cap still forms an atomic span, without a throw', () => {
    const blob = 'X'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 1);
    const part = parse(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        `<w:r><w:instrText> FORMTEXT ${blob}</w:instrText></w:r>` +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>typed</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    const spans = parsedFieldSpansOf(paragraphOf(part));
    expect(spans).toHaveLength(1);
    // Overflow fails closed: the buffer cleared itself, so addressing stays atomic.
    expect(spans[0]!.addressing).toBe('atomic');
  });
});
