// Canonical tree <-> ProseMirror binding (tasks 6.1, 6.2, 6.3).

import { describe, expect, test } from 'bun:test';
import { EditorState } from 'prosemirror-state';
import {
  readOoxmlPart,
  TreeDocumentStore,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { treeSchema } from '../tree-schema.ts';
import { bodyParagraphs, docToTreeOps, reconcileDoc, treeToDoc } from '../tree-binding.ts';
import { paragraphTextOf, ORIGIN_IDS } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstNamed(part: OoxmlPart, localName: string): OoxmlNode {
  const visit = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === localName) return node;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const found = visit(part.root);
  if (!found) throw new Error(`no ${localName}`);
  return found;
}

function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(textUnder).join('');
}

const SIMPLE = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>';

/** Apply the mapped ops through the store, the way a host would. */
function commit(part: OoxmlPart, doc: ReturnType<typeof treeToDoc>): OoxmlPart {
  const mapped = docToTreeOps(part, doc);
  if (!mapped.ok) throw new Error(`${mapped.reason}: ${mapped.detail ?? ''}`);
  const store = new TreeDocumentStore(part);
  const result = store.transact((ctx) => {
    for (const op of mapped.ops) ctx.apply(op);
  });
  if (!result.ok) throw new Error(result.reason);
  return store.part;
}

describe('projection (task 6.1)', () => {
  test('paragraphs project with their tree node id', () => {
    const part = load(SIMPLE);
    const doc = treeToDoc(part);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).attrs.nodeId).toBe(bodyParagraphs(part)[0]!.id);
    expect(doc.child(0).textContent).toBe('Hello world');
  });

  test('authored whitespace, tab and hard break project as content', () => {
    const part = load(
      '<w:p><w:r><w:t xml:space="preserve">  a </w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>'
    );
    const doc = treeToDoc(part);
    const kinds: string[] = [];
    doc.child(0).forEach((child) => kinds.push(child.isText ? 'text' : child.type.name));
    expect(kinds).toEqual(['text', 'tab', 'text', 'hardBreak', 'text']);
    expect(doc.child(0).child(0).text).toBe('  a ');
  });

  test('the accepted run property boundary projects as one mark', () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:b/><w:u w:val="double"/></w:rPr><w:t>styled</w:t></w:r></w:p>'
    );
    const text = treeToDoc(part).child(0).child(0);
    const mark = text.marks.find((candidate) => candidate.type.name === 'runProps');
    expect(mark).toBeDefined();
    expect(mark!.attrs.props).toEqual([
      { localName: 'b' },
      { localName: 'u', attributes: { val: 'double' } },
    ]);
  });

  test('paragraph properties project on the paragraph node', () => {
    const part = load('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>');
    expect(treeToDoc(part).child(0).attrs.props).toEqual([
      { localName: 'jc', attributes: { val: 'center' } },
    ]);
  });

  test('unknown content projects as an inert positional atom, never dropped', () => {
    const part = load(
      '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
        '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
        '<w:r><w:t>after</w:t></w:r></w:p>'
    );
    const paragraph = treeToDoc(part).child(0);
    const kinds: string[] = [];
    paragraph.forEach((child) => kinds.push(child.isText ? 'text' : child.type.name));
    // The clipart run keeps its POSITION between the two text runs. The legacy projection
    // dropped it entirely, which is how a picture became invisible in the editor.
    expect(kinds).toEqual(['text', 'unknownInline', 'text']);
    expect(paragraph.textContent).toBe('before after');
  });

  test('inline wrapper properties do not project as visible unknown tokens', () => {
    const part = load(
      '<w:p><w:smartTag><w:smartTagPr w:uri="urn:test"/>' +
        '<w:r><w:t>inside</w:t></w:r></w:smartTag></w:p>'
    );
    const paragraph = treeToDoc(part).child(0);
    const kinds: string[] = [];
    paragraph.forEach((child) => kinds.push(child.isText ? 'text' : child.type.name));
    expect(kinds).toEqual(['text']);
    expect(paragraph.textContent).toBe('inside');
  });

  test('an empty body still projects an editable paragraph', () => {
    expect(treeToDoc(load('')).childCount).toBe(1);
  });
});

describe('reverse mapping (task 6.2)', () => {
  test('typing maps to a minimal insertText at the edited offset', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('Hello brave world'),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'insertText', paragraphId: id, offset: 6, text: 'brave ' }]);
    expect(paragraphTextOf(commit(part, doc), id)).toBe('Hello brave world');
  });

  test('deleting maps to a minimal deleteText', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('Hello')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'deleteText', paragraphId: id, start: 5, end: 11 }]);
  });

  test('replacing a selection maps to a delete plus an insert at the same offset', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('Hello there')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([
      { op: 'deleteText', paragraphId: id, start: 6, end: 11 },
      { op: 'insertText', paragraphId: id, offset: 6, text: 'there' },
    ]);
    expect(paragraphTextOf(commit(part, doc), id)).toBe('Hello there');
  });

  test('a terminal wrapper edge round-trips an unowned insertion outside', () => {
    const part = load('<w:p><w:smartTag><w:r><w:t>BC</w:t></w:r></w:smartTag></w:p>');
    const paragraphId = bodyParagraphs(part)[0]!.id;
    const state = EditorState.create({ doc: treeToDoc(part) });
    const doc = state.apply(state.tr.insertText('X', 3)).doc;
    const mapped = docToTreeOps(part, doc);
    expect(mapped).toEqual({
      ok: true,
      ops: [{ op: 'insertText', paragraphId, offset: 2, text: 'X' }],
    });
    const next = commit(part, doc);
    expect(paragraphTextOf(next, paragraphId)).toBe('BCX');
    expect(textUnder(firstNamed(next, 'smartTag'))).toBe('BC');
  });

  test('leading wrapper edges round-trip unowned insertions outside', () => {
    const initial = load('<w:p><w:smartTag><w:r><w:t>BC</w:t></w:r></w:smartTag></w:p>');
    const initialState = EditorState.create({ doc: treeToDoc(initial) });
    const initialNext = commit(initial, initialState.apply(initialState.tr.insertText('X', 1)).doc);
    expect(paragraphTextOf(initialNext, bodyParagraphs(initialNext)[0]!.id)).toBe('XBC');
    expect(textUnder(firstNamed(initialNext, 'smartTag'))).toBe('BC');

    const adjacent = load(
      '<w:p><w:smartTag><w:r><w:t>A</w:t></w:r></w:smartTag>' +
        '<w:customXml><w:r><w:t>B</w:t></w:r></w:customXml></w:p>'
    );
    const adjacentState = EditorState.create({ doc: treeToDoc(adjacent) });
    const adjacentNext = commit(
      adjacent,
      adjacentState.apply(adjacentState.tr.insertText('X', 2)).doc
    );
    expect(paragraphTextOf(adjacentNext, bodyParagraphs(adjacentNext)[0]!.id)).toBe('AXB');
    expect(textUnder(firstNamed(adjacentNext, 'smartTag'))).toBe('A');
    expect(textUnder(firstNamed(adjacentNext, 'customXml'))).toBe('B');
  });

  test('projection and offsets share the inline-wrapper nesting cutoff', () => {
    let nested = '<w:smartTag><w:r><w:t>hidden</w:t></w:r></w:smartTag>';
    nested = `<w:smartTag><w:r><w:t>open</w:t></w:r>${nested}</w:smartTag>`;
    for (let depth = 2; depth < 32; depth += 1) nested = `<w:smartTag>${nested}</w:smartTag>`;
    const atLimit = load(`<w:p>${nested}</w:p>`);
    const paragraphId = bodyParagraphs(atLimit)[0]!.id;
    const projected = treeToDoc(atLimit);

    expect(paragraphTextOf(atLimit, paragraphId)).toBe('open');
    expect(projected.textContent).toBe('open');

    const state = EditorState.create({ doc: projected });
    const edited = state.apply(state.tr.insertText('X', 3)).doc;
    const next = commit(atLimit, edited);
    expect(paragraphTextOf(next, paragraphId)).toBe('opXen');

    let tooDeep = '<w:r><w:t>hidden</w:t></w:r>';
    for (let depth = 0; depth < 33; depth += 1) {
      tooDeep = `<w:smartTag>${tooDeep}</w:smartTag>`;
    }
    const pastLimit = load(`<w:p>${tooDeep}</w:p>`);
    const pastLimitId = bodyParagraphs(pastLimit)[0]!.id;
    expect(paragraphTextOf(pastLimit, pastLimitId)).toBe('');
    expect(treeToDoc(pastLimit).textContent).toBe('');
  });

  test('a typed tab and hard break map to content-token ops, not characters', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('a'),
        treeSchema.node('tab'),
        treeSchema.node('hardBreak'),
        treeSchema.text('b'),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([
      { op: 'insertTab', paragraphId: id, offset: 1 },
      { op: 'insertHardBreak', paragraphId: id, offset: 2 },
    ]);
    expect(paragraphTextOf(commit(part, doc), id)).toBe('a\t\nb');
  });

  test('a page break maps to insertPageBreak and round-trips through the tree', () => {
    const part = load('<w:p><w:r><w:t>a</w:t><w:br w:type="page"/><w:t>b</w:t></w:r></w:p>');
    const id = bodyParagraphs(part)[0]!.id;
    const projected = treeToDoc(part);
    expect(projected.child(0).child(1).type.name).toBe('pageBreak');
    expect(paragraphTextOf(part, id)).toBe('a\fb');

    const plain = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const plainId = bodyParagraphs(plain)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: plainId, props: [] }, [
        treeSchema.text('a'),
        treeSchema.node('pageBreak'),
        treeSchema.text('b'),
      ]),
    ]);
    const mapped = docToTreeOps(plain, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'insertPageBreak', paragraphId: plainId, offset: 1 }]);
    expect(paragraphTextOf(commit(plain, doc), plainId)).toBe('a\fb');
  });

  test('a run property change maps to setRunProperties over the affected range', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('Hello', [
          treeSchema.marks.runProps.create({ props: [{ localName: 'b' }] }),
        ]),
        treeSchema.text(' world'),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([
      {
        op: 'setRunProperties',
        paragraphId: id,
        start: 0,
        end: 5,
        properties: [{ localName: 'b', attributes: {} }],
      },
    ]);
  });

  test('a run carrying a tracked format record still takes a formatting edit', () => {
    // `w:rPrChange` holds the run as it WAS, in children of its own, and neither the
    // projection nor an op can express that. Projecting it put a name outside the accepted
    // boundary into the bag this diff builds its op from, so the store refused the whole
    // transaction as `unsupported-property` and a formatting edit over a run with a pending
    // record did nothing at all.
    const recorded = load(
      '<w:p><w:r><w:rPr><w:b/>' +
        '<w:rPrChange w:id="3" w:author="Ada" w:date="2026-01-01T00:00:00Z">' +
        '<w:rPr/></w:rPrChange>' +
        '</w:rPr><w:t>Hello world</w:t></w:r></w:p>'
    );
    const id = bodyParagraphs(recorded)[0]!.id;
    const projected = treeToDoc(recorded);
    expect(JSON.stringify(projected.toJSON())).not.toContain('rPrChange');
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('Hello', [
          treeSchema.marks.runProps.create({
            props: [{ localName: 'b' }, { localName: 'i' }],
          }),
        ]),
        treeSchema.text(' world', [
          treeSchema.marks.runProps.create({ props: [{ localName: 'b' }] }),
        ]),
      ]),
    ]);
    const mapped = docToTreeOps(recorded, doc);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    // And it commits: the record is preserved on the node the write rebuilds.
    const after = commit(recorded, doc);
    expect(paragraphTextOf(after, id)).toBe('Hello world');
  });

  test('a paragraph property change maps to setParagraphProperties', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node(
        'paragraph',
        { nodeId: id, props: [{ localName: 'jc', attributes: { val: 'center' } }] },
        [treeSchema.text('Hello world')]
      ),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops[0]!.op).toBe('setParagraphProperties');
  });

  test('property ORDER inside a run is not a change', () => {
    const part = load('<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>styled</w:t></w:r></w:p>');
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('styled', [
          treeSchema.marks.runProps.create({ props: [{ localName: 'i' }, { localName: 'b' }] }),
        ]),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([]);
  });

  test('an unchanged projection maps to ZERO ops (no feedback loop)', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>a</w:t></w:r><w:r><w:tab/><w:t>b</w:t></w:r></w:p>'
    );
    const mapped = docToTreeOps(part, treeToDoc(part));
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([]);
  });

  test('Enter maps to splitParagraph at the right offset', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('Hello')]),
      treeSchema.node('paragraph', { nodeId: null, props: [] }, [treeSchema.text(' world')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'splitParagraph', paragraphId: id, offset: 5 }]);
    expect(bodyParagraphs(commit(part, doc))).toHaveLength(2);
  });

  test('Backspace at a paragraph start maps to joinParagraphs', () => {
    const part = load(
      '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>'
    );
    const [a, b] = bodyParagraphs(part);
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: a!.id, props: [] }, [treeSchema.text('firstsecond')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'joinParagraphs', firstId: a!.id, secondId: b!.id }]);
  });

  test('a full round trip through the projection changes nothing', () => {
    const part = load(
      '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
        '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>after</w:t></w:r></w:p>'
    );
    const mapped = docToTreeOps(part, treeToDoc(part));
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([]);
  });
});

describe('unsupported transactions are refused without canonical effects (task 6.3)', () => {
  const part = load('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>');
  const [a, b] = bodyParagraphs(part);
  const paragraph = (nodeId: string | null, text: string) =>
    treeSchema.node('paragraph', { nodeId, props: [] }, text ? [treeSchema.text(text)] : []);

  test('a reorder is refused', () => {
    const doc = treeSchema.node('doc', null, [paragraph(b!.id, 'two'), paragraph(a!.id, 'one')]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('paragraph-reordered');
  });

  test('a multi-paragraph paste is refused rather than approximated', () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'one'),
      paragraph(null, 'pasted A'),
      paragraph(null, 'pasted B'),
      paragraph(b!.id, 'two'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('paragraph-count-unexplained');
  });

  test('a split combined with an edit elsewhere is refused', () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'o'),
      paragraph(null, 'ne'),
      paragraph(b!.id, 'EDITED'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('split-not-clean');
  });

  test('a split whose halves do not concatenate to the source is refused', () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'o'),
      paragraph(null, 'XX'),
      paragraph(b!.id, 'two'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('split-not-clean');
  });

  test("a split tail forging another paragraph's id is refused", () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'o'),
      paragraph(b!.id, 'ne'),
      paragraph(b!.id, 'two'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('split-not-clean');
  });

  test('a join whose result is not the concatenation is refused', () => {
    const doc = treeSchema.node('doc', null, [paragraph(a!.id, 'oneTWO')]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('join-not-clean');
  });

  test('deleting unknown content through the projection is refused', () => {
    const withClip = load(
      '<w:p><w:r><w:t>x</w:t></w:r><w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r></w:p>'
    );
    const id = bodyParagraphs(withClip)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('x')]),
    ]);
    const mapped = docToTreeOps(withClip, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('unknown-content-moved');
  });

  test('reordering unknown content is refused', () => {
    const withClip = load(
      '<w:p><w:r><w:t>x</w:t></w:r><w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r></w:p>'
    );
    const source = bodyParagraphs(withClip)[0]!;
    const projected = treeToDoc(withClip).child(0);
    const inline: ReturnType<typeof treeSchema.text>[] = [];
    projected.forEach((child) => inline.push(child as never));
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: source.id, props: [] }, [...inline].reverse()),
    ]);
    const mapped = docToTreeOps(withClip, doc);
    expect(mapped.ok).toBe(false);
  });

  test('a refused mapping produces no ops at all, so nothing can be half-applied', () => {
    const doc = treeSchema.node('doc', null, [paragraph(b!.id, 'two'), paragraph(a!.id, 'one')]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    expect('ops' in mapped).toBe(false);
  });
});

describe('incremental reconciliation with a projection-only origin (task 6.4)', () => {
  const source =
    '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>three</w:t></w:r></w:p>';

  test('a text edit reuses every untouched paragraph node by reference', () => {
    const part = load(source);
    const before = treeToDoc(part);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[1]!.id;
    const result = store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: target, offset: 3, text: '!' })
    );
    if (!result.ok || !result.change) throw new Error('expected a change');

    const after = reconcileDoc(before, store.part, result.change);

    // Untouched paragraphs are the SAME objects, so ProseMirror redraws neither.
    expect(after.child(0)).toBe(before.child(0));
    expect(after.child(2)).toBe(before.child(2));
    // The dirty one is rebuilt and carries the edit.
    expect(after.child(1)).not.toBe(before.child(1));
    expect(after.child(1).textContent).toBe('two!');
  });

  test('a reconciled doc maps to ZERO ops, so reconciliation cannot loop', () => {
    const part = load(source);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[0]!.id;
    const result = store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: target, offset: 0, text: 'X' })
    );
    if (!result.ok || !result.change) throw new Error('expected a change');

    const reconciled = reconcileDoc(treeToDoc(part), store.part, result.change);
    const mapped = docToTreeOps(store.part, reconciled);
    if (!mapped.ok) throw new Error(mapped.reason);
    // The loop this prevents: reconcile -> map -> commit -> reconcile -> ...
    expect(mapped.ops).toEqual([]);
  });

  test('a structural change falls back to a full projection', () => {
    const part = load(source);
    const before = treeToDoc(part);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[0]!.id;
    const result = store.transact((ctx) =>
      ctx.apply({ op: 'splitParagraph', paragraphId: target, offset: 1 })
    );
    if (!result.ok || !result.change) throw new Error('expected a change');

    const after = reconcileDoc(before, store.part, result.change);
    expect(after.childCount).toBe(4);
    expect(docToTreeOps(store.part, after)).toEqual({ ok: true, ops: [] });
  });

  test('no change evidence means a full projection, never a partial patch', () => {
    const part = load(source);
    const before = treeToDoc(part);
    const store = new TreeDocumentStore(part);
    store.transact((ctx) =>
      ctx.apply({
        op: 'insertText',
        paragraphId: bodyParagraphs(part)[2]!.id,
        offset: 0,
        text: 'Z',
      })
    );
    const after = reconcileDoc(before, store.part, null);
    expect(after.child(2).textContent).toBe('Zthree');
  });

  test('reconciliation runs on a projection origin and records no history entry', () => {
    const part = load(source);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[1]!.id;
    store.transact(
      (ctx) => ctx.apply({ op: 'insertText', paragraphId: target, offset: 0, text: 'R' }),
      { origin: ORIGIN_IDS.projection }
    );
    expect(store.revision).toBe(1);
    // Reconciling the view with the model is not a user intent (task 5.6).
    expect(store.historyDepth).toBe(0);
    expect(docToTreeOps(store.part, treeToDoc(store.part))).toEqual({ ok: true, ops: [] });
  });

  test('undo reconciles back to a doc that also maps to zero ops', () => {
    const part = load(source);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[0]!.id;
    store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: target, offset: 0, text: 'A' })
    );
    store.undo();
    const reconciled = treeToDoc(store.part);
    expect(reconciled.child(0).textContent).toBe('one');
    expect(docToTreeOps(store.part, reconciled)).toEqual({ ok: true, ops: [] });
  });
});

describe('split and join at every position (regression: end-of-paragraph Enter)', () => {
  const threeParagraphs = () =>
    load(
      '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>three</w:t></w:r></w:p>'
    );

  const paragraph = (nodeId: string | null, text: string) =>
    treeSchema.node('paragraph', { nodeId, props: [] }, text ? [treeSchema.text(text)] : []);

  test('Enter at the END of a paragraph splits, leaving an empty tail', () => {
    // The head is IDENTICAL to the source here, so a first-divergence scan walks past the
    // split point and refuses it. This is the most common Enter there is.
    const part = threeParagraphs();
    const ids = bodyParagraphs(part).map((p) => p.id);
    for (const [index, id] of ids.entries()) {
      const docs = ids.map((other, i) => paragraph(other, ['one', 'two', 'three'][i]!));
      docs.splice(index + 1, 0, paragraph(null, ''));
      const mapped = docToTreeOps(part, treeSchema.node('doc', null, docs));
      if (!mapped.ok) throw new Error(`${index}: ${mapped.reason}`);
      expect(mapped.ops).toEqual([
        { op: 'splitParagraph', paragraphId: id, offset: ['one', 'two', 'three'][index]!.length },
      ]);
    }
  });

  test('Enter at the START of a paragraph splits at offset 0', () => {
    const part = threeParagraphs();
    const ids = bodyParagraphs(part).map((p) => p.id);
    const docs = [
      paragraph(ids[0]!, 'one'),
      paragraph(ids[1]!, ''),
      paragraph(null, 'two'),
      paragraph(ids[2]!, 'three'),
    ];
    const mapped = docToTreeOps(part, treeSchema.node('doc', null, docs));
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'splitParagraph', paragraphId: ids[1]!, offset: 0 }]);
  });

  test('a join is found at every adjacent pair', () => {
    const part = threeParagraphs();
    const ids = bodyParagraphs(part).map((p) => p.id);
    const texts = ['one', 'two', 'three'];
    for (let index = 0; index + 1 < ids.length; index += 1) {
      const docs: ReturnType<typeof paragraph>[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        if (i === index) docs.push(paragraph(ids[i]!, texts[i]! + texts[i + 1]!));
        else if (i !== index + 1) docs.push(paragraph(ids[i]!, texts[i]!));
      }
      const mapped = docToTreeOps(part, treeSchema.node('doc', null, docs));
      if (!mapped.ok) throw new Error(`${index}: ${mapped.reason}`);
      expect(mapped.ops).toEqual([
        { op: 'joinParagraphs', firstId: ids[index]!, secondId: ids[index + 1]! },
      ]);
    }
  });
});
