// Saved field results under the two field-result modes.
//
// `atomic` (the default) keeps every field one offset unit: raw paragraph text does not change.
// `editable` addresses the result of a field that shows its saved value (DATE, MERGEFIELD,
// HYPERLINK display text) as ordinary text, and keeps live fields (PAGE) and fields holding
// another field one unit.

import { describe, expect, test } from 'bun:test';
import { canonicalOoxmlFingerprint, readOoxmlPart, serializeOoxmlPart } from '../index.ts';
import { FIELD_ATOM_CHAR } from '../package/field-nodes.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { applyTreeOp, paragraphTextOf } from '../store/tree-ops.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const EDITABLE = { fieldResults: 'editable' } as const;
const REVISION = { author: 'Reviewer', date: '2026-01-01T00:00:00Z' };

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const complex = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const simple = (instruction: string, result: string) =>
  `<w:fldSimple w:instr="${instruction}"><w:r><w:t>${result}</w:t></w:r></w:fldSimple>`;

/** `ab ` + field + ` cd` in one paragraph. */
function paragraphWith(field: string): { part: OoxmlPart; id: string } {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('ab ')}${field}${run(' cd')}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  const body = read.part.root.children[0]!;
  if (body.kind === 'textValue') throw Error('no body');
  return { part: read.part, id: body.children[0]!.id };
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op, EDITABLE);
  if (!result.ok) throw Error(result.reason);
  return result.part;
}

const KINDS = [
  { label: 'complex DATE', field: complex(' DATE ', run('2020-01-02')), result: '2020-01-02' },
  {
    label: 'complex HYPERLINK',
    field: complex(' HYPERLINK "https://e/" ', run('link')),
    result: 'link',
  },
  { label: 'simple MERGEFIELD', field: simple(' MERGEFIELD Name ', 'Name'), result: 'Name' },
] as const;

describe('raw paragraph text', () => {
  test('the default keeps every field one unit', () => {
    for (const { field } of KINDS) {
      const { part, id } = paragraphWith(field);
      expect(paragraphTextOf(part, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    }
  });

  test('the editable mode reads saved results as text, and the default does not change', () => {
    for (const { field, result } of KINDS) {
      const { part, id } = paragraphWith(field);
      expect(paragraphTextOf(part, id, EDITABLE)).toBe(`ab ${result} cd`);
      // Offsets are memoized per mode: the editable read does not leak into the default.
      expect(paragraphTextOf(part, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    }
  });

  test('live fields and fields holding another field stay one unit', () => {
    for (const field of [
      complex(' PAGE ', run('7')),
      complex(' REF bm ', run('target')),
      complex(' QUOTE "x" ', run('a ') + complex(' QUOTE "y" ', run('b')) + run(' c')),
    ]) {
      const { part, id } = paragraphWith(field);
      expect(paragraphTextOf(part, id, EDITABLE)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    }
  });
});

describe('editing a saved result', () => {
  for (const { label, field, result } of KINDS) {
    test(label, () => {
      const { part, id } = paragraphWith(field);
      const start = 3;
      const end = start + result.length;
      const text = (edited: OoxmlPart) => paragraphTextOf(edited, id, EDITABLE);

      // Typing inside lands in the result; at either edge it lands outside the field.
      const inside = apply(part, {
        op: 'insertText',
        paragraphId: id,
        offset: start + 2,
        text: '#',
      });
      expect(text(inside)).toBe(`ab ${result.slice(0, 2)}#${result.slice(2)} cd`);
      expect(paragraphTextOf(inside, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
      for (const offset of [start, end]) {
        const edge = apply(part, { op: 'insertText', paragraphId: id, offset, text: '#' });
        expect(paragraphTextOf(edge, id)).toBe(
          offset === start ? `ab #${FIELD_ATOM_CHAR} cd` : `ab ${FIELD_ATOM_CHAR}# cd`
        );
      }

      // Deleting inside edits the result; deleting the whole result keeps an empty field.
      const deleted = apply(part, {
        op: 'deleteText',
        paragraphId: id,
        start: start + 1,
        end: start + 2,
      });
      expect(text(deleted)).toBe(`ab ${result.slice(0, 1)}${result.slice(2)} cd`);
      const emptied = apply(part, { op: 'deleteText', paragraphId: id, start, end });
      expect(text(emptied)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
      expect(paragraphTextOf(emptied, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);

      // A range with one end inside the result is refused, never half applied.
      for (const [from, to] of [
        [start - 1, start + 1],
        [end - 1, end + 1],
      ] as const) {
        const refused = applyTreeOp(
          part,
          { op: 'deleteText', paragraphId: id, start: from, end: to },
          EDITABLE
        );
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.reason).toBe('field-structure');
      }

      // A range that covers the field and reaches past it removes the field.
      const removed = apply(part, {
        op: 'deleteText',
        paragraphId: id,
        start: start - 1,
        end: end + 1,
      });
      expect(paragraphTextOf(removed, id)).toBe('abcd');
      expect(serializeOoxmlPart(removed)).not.toContain('fldChar');
      expect(serializeOoxmlPart(removed)).not.toContain('fldSimple');
    });
  }
});

describe('tracked edits inside a saved result', () => {
  for (const { label, field, result } of KINDS) {
    test(label, () => {
      const { part, id } = paragraphWith(field);
      const inserted = apply(part, {
        op: 'insertText',
        paragraphId: id,
        offset: 5,
        text: '#',
        revision: REVISION,
      });
      const insertedXml = serializeOoxmlPart(inserted);
      const separate = insertedXml.indexOf('w:fldCharType="separate"');
      const insertion = insertedXml.indexOf('<w:ins ');
      const end = insertedXml.indexOf('w:fldCharType="end"');
      // The insertion sits between the separate and end markers, and the instruction stays.
      expect(separate).toBeGreaterThan(-1);
      expect(insertion).toBeGreaterThan(separate);
      expect(end).toBeGreaterThan(insertion);
      expect(paragraphTextOf(inserted, id, EDITABLE)).toBe(
        `ab ${result.slice(0, 2)}#${result.slice(2)} cd`
      );

      const struck = apply(part, {
        op: 'deleteText',
        paragraphId: id,
        start: 4,
        end: 5,
        revision: REVISION,
      });
      const struckXml = serializeOoxmlPart(struck);
      expect(struckXml).toContain(`<w:delText>${result[1]}</w:delText>`);
      expect(struckXml.indexOf('<w:del ')).toBeGreaterThan(
        struckXml.indexOf('w:fldCharType="separate"')
      );
    });
  }
});

describe('a store transaction in the editable mode', () => {
  test('edits the result, undoes, redoes, and round-trips through save', () => {
    const { part, id } = paragraphWith(complex(' MERGEFIELD Name ', run('Name')));
    const store = new TreeDocumentStore(part);
    const committed = store.transact(
      (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: 'XY' });
      },
      { fieldResults: 'editable' }
    );
    expect(committed.ok).toBe(true);
    expect(paragraphTextOf(store.part, id, EDITABLE)).toBe('ab NaXYme cd');
    store.undo();
    expect(paragraphTextOf(store.part, id, EDITABLE)).toBe('ab Name cd');
    store.redo();
    expect(paragraphTextOf(store.part, id, EDITABLE)).toBe('ab NaXYme cd');

    const reopened = readOoxmlPart(serializeOoxmlPart(store.part), {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!reopened.ok) throw Error(reopened.reason);
    expect(paragraphTextOf(reopened.part, id, EDITABLE)).toBe('ab NaXYme cd');
    expect(serializeOoxmlPart(reopened.part)).toContain('MERGEFIELD Name');
  });

  test('the default transaction keeps today offsets', () => {
    const { part, id } = paragraphWith(complex(' MERGEFIELD Name ', run('Name')));
    const store = new TreeDocumentStore(part);
    store.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 4, text: '#' });
    });
    expect(paragraphTextOf(store.part, id)).toBe(`ab ${FIELD_ATOM_CHAR}# cd`);
  });
});

describe('result edges', () => {
  for (const { label, field, result } of KINDS) {
    test(`deletes the first, the last, and every result character: ${label}`, () => {
      const { part, id } = paragraphWith(field);
      const start = 3;
      const end = start + result.length;
      const text = (edited: OoxmlPart) => paragraphTextOf(edited, id, EDITABLE);
      const first = apply(part, { op: 'deleteText', paragraphId: id, start, end: start + 1 });
      expect(text(first)).toBe(`ab ${result.slice(1)} cd`);
      const last = apply(part, { op: 'deleteText', paragraphId: id, start: end - 1, end });
      expect(text(last)).toBe(`ab ${result.slice(0, -1)} cd`);
      // Backspace through the whole result one character at a time keeps an empty field.
      let edited = part;
      for (let offset = end; offset > start; offset -= 1) {
        edited = apply(edited, {
          op: 'deleteText',
          paragraphId: id,
          start: offset - 1,
          end: offset,
        });
      }
      expect(text(edited)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
      expect(paragraphTextOf(edited, id)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    });
  }
});

describe('ops the editable mode does not support inside a result', () => {
  test('are refused inside a result and allowed at its edges', () => {
    const { part, id } = paragraphWith(complex(' DATE ', run('2020-01-02')));
    const inside: readonly TreeDocOp[] = [
      { op: 'splitParagraph', paragraphId: id, offset: 5 },
      { op: 'insertTab', paragraphId: id, offset: 5 },
      { op: 'insertHyperlink', paragraphId: id, start: 1, end: 5, anchor: 'x' },
    ];
    for (const op of inside) {
      const refused = applyTreeOp(part, op, EDITABLE);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).toBe('field-result-unsupported');
    }
    for (const offset of [3, 13]) {
      const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id, offset }, EDITABLE);
      expect(split.ok).toBe(true);
    }
  });
});

describe('rewriting a simple field before an edit inside it', () => {
  test('keeps its data, attributes, and tracked formatting in their places', () => {
    const field =
      '<w:fldSimple w:instr=" MERGEFIELD Name " w:fldLock="1" w:dirty="1">' +
      '<w:fldData>ZGF0YQ==</w:fldData>' +
      '<w:r><w:rPr><w:b/><w:rPrChange w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z">' +
      '<w:rPr/></w:rPrChange></w:rPr><w:t>Name</w:t></w:r></w:fldSimple>';
    const { part, id } = paragraphWith(field);
    const before = serializeOoxmlPart(part);
    expect(before).toContain('fldSimple');
    const result = applyTreeOp(
      part,
      { op: 'insertText', paragraphId: id, offset: 5, text: '#' },
      EDITABLE
    );
    if (!result.ok) throw Error(result.reason);
    // The effect reports the replaced field and the four new marker runs.
    const paragraph = (part.root.children[0] as { children: readonly OoxmlNode[] }).children[0]!;
    const simpleNode = (paragraph as { children: readonly OoxmlNode[] }).children.find(
      (child) =>
        child.kind !== 'textValue' && 'localName' in child && child.localName === 'fldSimple'
    )!;
    expect(result.effect.deleted).toContain(simpleNode.id);
    expect(result.effect.created.length).toBeGreaterThanOrEqual(4);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).not.toContain('fldSimple');
    // The field data sits in the begin marker, with the field's lock and dirty flags.
    const begin = /<w:fldChar[^>]*w:fldCharType="begin"[^>]*>.*?<\/w:fldChar>/.exec(xml)?.[0];
    expect(begin).toBeDefined();
    expect(begin).toContain('<w:fldData>ZGF0YQ==</w:fldData>');
    expect(begin).toContain('w:fldLock="1"');
    expect(begin).toContain('w:dirty="1"');
    expect(xml.indexOf('<w:fldData>')).toBe(xml.lastIndexOf('<w:fldData>'));
    // The tracked property change stays on the result run only: one revision, one id.
    expect(xml.match(/w:id="7"/g)?.length).toBe(1);
    expect(xml).toContain('MERGEFIELD Name');
    expect(paragraphTextOf(result.part, id, EDITABLE)).toBe('ab Na#me cd');

    // The rewritten part reopens to the same canonical structure.
    const reopened = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!reopened.ok) throw Error(reopened.reason);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
  });
});

describe('store subscribers', () => {
  test('read in the default mode, even during an editable transaction', () => {
    const { part, id } = paragraphWith(complex(' MERGEFIELD Name ', run('Name')));
    const store = new TreeDocumentStore(part);
    const seen: (string | null)[] = [];
    store.subscribe(() => seen.push(paragraphTextOf(store.part, id)));
    store.transact(
      (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: id, offset: 5, text: '#' });
      },
      { fieldResults: 'editable' }
    );
    expect(seen).toEqual([`ab ${FIELD_ATOM_CHAR} cd`]);
  });
});

describe('deciding tracked edits inside a result', () => {
  for (const decision of ['acceptAllRevisions', 'rejectAllRevisions'] as const) {
    test(decision, () => {
      const { part, id } = paragraphWith(complex(' MERGEFIELD Name ', run('Name')));
      let edited = apply(part, {
        op: 'insertText',
        paragraphId: id,
        offset: 5,
        text: '#',
        revision: REVISION,
      });
      edited = apply(edited, {
        op: 'deleteText',
        paragraphId: id,
        start: 3,
        end: 4,
        revision: REVISION,
      });
      const decided = apply(edited, { op: decision });
      expect(paragraphTextOf(decided, id, EDITABLE)).toBe(
        decision === 'acceptAllRevisions' ? 'ab a#me cd' : 'ab Name cd'
      );
      const xml = serializeOoxmlPart(decided);
      expect(xml).not.toContain('<w:ins ');
      expect(xml).not.toContain('<w:del ');
      expect(xml).toContain('w:fldCharType="separate"');
    });
  }
});

describe('splitting at the end of an atomic field', () => {
  test('keeps the whole field in the first paragraph', () => {
    const { part, id } = paragraphWith(complex(' DATE ', run('2020-01-02')));
    // `ab ` is three characters and the atomic field one more, so offset 4 is just after it.
    const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id, offset: 4 });
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const xml = serializeOoxmlPart(split.part);
    const first = xml.slice(xml.indexOf('<w:p'), xml.indexOf('</w:p>'));
    for (const marker of ['begin', 'separate', 'end'])
      expect(first).toContain(`w:fldCharType="${marker}"`);
    expect(first).toContain('2020-01-02');
    expect(first).not.toContain(' cd');
  });

  for (const [label, open, close, name] of [
    ['a hyperlink', '<w:hyperlink w:anchor="target">', '</w:hyperlink>', 'w:hyperlink'],
    [
      'a content control',
      '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>',
      '</w:sdtContent></w:sdt>',
      'w:sdt',
    ],
  ] as const) {
    test(`cuts ${label} around the field once, after its end`, () => {
      // `ab ` + wrapper(field + ` x`) + ` cd`: the split after the field leaves one wrapper in each half.
      const { part, id } = paragraphWith(
        `${open}${complex(' DATE ', run('2020'))}${run(' x')}${close}`
      );
      const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id, offset: 4 });
      expect(split.ok).toBe(true);
      if (!split.ok) return;
      const xml = serializeOoxmlPart(split.part);
      const first = xml.slice(xml.indexOf('<w:p'), xml.indexOf('</w:p>'));
      expect(first.split(`<${name}>`).length + first.split(`<${name} `).length - 2).toBe(1);
      expect(first).toContain('w:fldCharType="end"');
    });
  }
});
