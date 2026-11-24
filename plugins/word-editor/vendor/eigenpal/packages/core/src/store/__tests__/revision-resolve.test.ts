// Accept and reject over the canonical tree.
//
// The rules that matter are the ones a plausible-looking implementation gets wrong:
// containment order on nested revisions, a move resolving as one decision rather than two, and
// refusing the revision kinds whose structural semantics are not implemented instead of
// removing their markup and reporting success.

import { describe, expect, test } from 'bun:test';
import { storyEndsWithTable } from '../package/ooxml-story-end-repair.ts';
import {
  applyTreeOp,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadNotes(notes: string): OoxmlPart {
  const result = readOoxmlPart(`<w:footnotes xmlns:w="${W}">${notes}</w:footnotes>`, {
    name: '/word/footnotes.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}${result.detail ? `: ${result.detail}` : ''}`);
  return result.part;
}

function refuse(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

/** Body text as the serializer writes it, so the assertions read like the file. */
function xml(part: OoxmlPart): string {
  return serializeOoxmlPart(part);
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const QA = { id: '1', author: 'QA', date: '2026-03-26T11:00:00Z' };
const DEV = { id: '2', author: 'Dev', date: '2026-03-26T12:00:00Z' };
const wrap = (name: string, who: typeof QA, inner: string) =>
  `<w:${name} w:id="${who.id}" w:author="${who.author}" w:date="${who.date}">${inner}</w:${name}>`;

const accept = (revision: typeof QA): TreeDocOp => ({ op: 'acceptRevision', revision });
const reject = (revision: typeof QA): TreeDocOp => ({ op: 'rejectRevision', revision });

describe('insertions', () => {
  const doc = () => load(`<w:p>${run('keep ')}${wrap('ins', QA, run('new'))}</w:p>`);

  test('accepting unwraps it and keeps the content', () => {
    const out = xml(apply(doc(), accept(QA)));
    expect(out).not.toContain('<w:ins');
    expect(out).toContain('keep ');
    expect(out).toContain('new');
  });

  test('rejecting removes the wrapper and its content', () => {
    const out = xml(apply(doc(), reject(QA)));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('new');
    expect(out).toContain('keep ');
  });
});

describe('deletions', () => {
  const doc = () => load(`<w:p>${run('keep ')}${wrap('del', DEV, delRun('old'))}</w:p>`);

  test('accepting removes the wrapper and its content', () => {
    const out = xml(apply(doc(), accept(DEV)));
    expect(out).not.toContain('<w:del');
    expect(out).not.toContain('old');
  });

  test('rejecting restores the text and turns w:delText back into w:t', () => {
    const out = xml(apply(doc(), reject(DEV)));
    expect(out).not.toContain('<w:del');
    expect(out).not.toContain('delText');
    // The serializer drops `xml:space="preserve"` where it is not needed, so the assertion is
    // that the text is back in a `w:t`, not that the attribute survived a normalization.
    expect(out).toContain('>old</w:t>');
  });
});

describe('nested revisions resolve by containment', () => {
  // An insertion by QA inside a deletion by Dev.
  const doc = () => load(`<w:p>${wrap('del', DEV, wrap('ins', QA, run('x')))}</w:p>`);

  test('accepting the outer deletion takes the inner insertion with it', () => {
    const out = xml(apply(doc(), accept(DEV)));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('>x<');
  });

  test('rejecting the outer deletion leaves the inner insertion pending', () => {
    const out = xml(apply(doc(), reject(DEV)));
    expect(out).not.toContain('<w:del');
    expect(out).toContain('<w:ins');
    expect(out).toContain('>x<');
  });

  test('the result does not depend on which wrapper is addressed first', () => {
    // Resolve the inner one first, then the outer: same tree as the outer alone.
    const innerFirst = xml(apply(apply(doc(), accept(QA)), accept(DEV)));
    const outerOnly = xml(apply(doc(), accept(DEV)));
    expect(innerFirst).toBe(outerOnly);
  });

  // Resolving the INNER wrapper can leave the outer one holding nothing. A wrapper with no
  // content is not a decision anyone can take — it carded as a blank entry and kept the
  // document reporting tracked changes — so it goes with the content it wrapped.
  test('accepting the inner deletion drops the outer insertion it emptied', () => {
    const nested = load(
      `<w:p>${run('keep ')}${wrap('ins', QA, wrap('del', DEV, delRun('new')))}${run(' end')}</w:p>`
    );
    const out = xml(apply(nested, accept(DEV)));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('<w:del');
    expect(out).toContain('keep ');
    expect(out).toContain(' end');
  });

  test('rejecting the inner insertion drops the outer deletion it emptied', () => {
    const out = xml(apply(doc(), reject(QA)));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('<w:del');
  });

  test('an outer wrapper that still holds content keeps it, pending', () => {
    const nested = load(`<w:p>${wrap('ins', QA, run('a') + wrap('del', DEV, delRun('b')))}</w:p>`);
    const out = xml(apply(nested, accept(DEV)));
    expect(out).toContain('<w:ins');
    expect(out).toContain('>a<');
    expect(out).not.toContain('>b<');
  });

  test('a wrapper reduced to markers is hollow too, and the markers are hoisted', () => {
    // Word writes proofing marks and bookmark / comment-range boundaries directly inside a
    // wrapper, beside the runs. Striking the runs leaves the markers; each pairs with a
    // counterpart elsewhere, so they stay in the paragraph while the wrapper goes.
    for (const [open, close] of [
      ['<w:proofErr w:type="spellStart"/>', '<w:proofErr w:type="spellEnd"/>'],
      ['<w:bookmarkStart w:id="7" w:name="mark"/>', '<w:bookmarkEnd w:id="7"/>'],
      ['<w:commentRangeStart w:id="3"/>', '<w:commentRangeEnd w:id="3"/>'],
    ]) {
      const nested = load(
        `<w:p>${run('a')}${wrap('ins', QA, open + wrap('del', DEV, delRun('x')) + close)}${run('z')}</w:p>`
      );
      const out = xml(apply(nested, accept(DEV)));
      expect(out).not.toContain('<w:ins');
      expect(out).not.toContain('<w:del');
      expect(out).toContain(open!);
      expect(out).toContain(close!);
      expect(out.indexOf(open!)).toBeLessThan(out.indexOf(close!));
    }
  });

  test('a wrapper that arrived hollow is not this decision’s to remove', () => {
    // A producer-written `<w:ins/>` at a content position, empty or holding only a marker,
    // stays: the sweep removes only what the resolution itself emptied, so an unrelated
    // accept by another author changes nothing else.
    for (const inner of ['', '<w:proofErr w:type="spellStart"/>']) {
      const hollow = load(
        `<w:p>${wrap('ins', QA, inner)}${wrap('del', DEV, delRun('x'))}${run('z')}</w:p>`
      );
      const out = xml(apply(hollow, accept(DEV)));
      expect(out).toContain('<w:ins');
      expect(out).not.toContain('<w:del');
    }
  });
});

describe('a move is one decision', () => {
  const MOVE_NAME = 'move1';
  const doc = () =>
    load(
      '<w:p>' +
        `<w:moveFromRangeStart w:id="10" w:name="${MOVE_NAME}" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveFrom', QA, delRun('here')) +
        '<w:moveFromRangeEnd w:id="10"/>' +
        '</w:p><w:p>' +
        `<w:moveToRangeStart w:id="11" w:name="${MOVE_NAME}" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveTo', DEV, run('here')) +
        '<w:moveToRangeEnd w:id="11"/>' +
        '</w:p>'
    );

  test('accepting one half resolves both, so the content is not duplicated', () => {
    // The two halves carry DIFFERENT ids in real documents, which is why they are paired by
    // `@w:name` on the range markers rather than by id.
    const out = xml(apply(doc(), accept(QA)));
    expect(out).not.toContain('<w:moveFrom w');
    expect(out).not.toContain('<w:moveTo w');
    // Exactly one copy survives, at the destination.
    expect(out.match(/here/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('delText');
  });

  test('rejecting one half resolves both, and the content returns to its origin', () => {
    const out = xml(apply(doc(), reject(DEV)));
    expect(out).not.toContain('<w:moveFrom w');
    expect(out).not.toContain('<w:moveTo w');
    expect(out.match(/here/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('delText');
  });

  test('a half emptied by another author’s decision goes, and the other half still resolves', () => {
    // Dev strikes the moved-to text; accepting that strike leaves QA's `w:moveTo` hollow. The
    // range markers are the wrapper's SIBLINGS, so the surviving `w:moveFrom` still finds its
    // name and resolves alone — no blank card, and no marker left over afterwards.
    const struckDestination = load(
      '<w:p>' +
        `<w:moveFromRangeStart w:id="10" w:name="${MOVE_NAME}" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveFrom', QA, delRun('here')) +
        '<w:moveFromRangeEnd w:id="10"/>' +
        '</w:p><w:p>' +
        `<w:moveToRangeStart w:id="11" w:name="${MOVE_NAME}" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveTo', QA, wrap('del', DEV, delRun('here'))) +
        '<w:moveToRangeEnd w:id="11"/>' +
        '</w:p>'
    );
    const afterStrike = apply(struckDestination, accept(DEV));
    const out = xml(afterStrike);
    expect(out).not.toContain('<w:moveTo w');
    expect(out).toContain('<w:moveFrom w');
    expect(out).toContain('moveToRangeStart');
    const settled = xml(apply(afterStrike, accept(QA)));
    expect(settled).not.toContain('<w:moveFrom w');
    expect(settled).not.toContain('RangeStart');
    expect(settled).not.toContain('here');
  });

  test('the range markers go with the move they described', () => {
    // Left behind, they would be an empty named bookmark pair that pairs with nothing on the
    // next read. Word removes them when the move resolves.
    const out = xml(apply(doc(), accept(QA)));
    expect(out).not.toContain('moveFromRangeStart');
    expect(out).not.toContain('moveToRangeEnd');
  });

  test('an orphaned half degrades to insertion semantics rather than refusing the file', () => {
    const orphan = load(
      '<w:p>' +
        `<w:moveToRangeStart w:id="11" w:name="lonely" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveTo', DEV, run('arrived')) +
        '<w:moveToRangeEnd w:id="11"/></w:p>'
    );
    const out = xml(apply(orphan, accept(DEV)));
    expect(out).not.toContain('<w:moveTo w');
    expect(out).toContain('arrived');
  });
});

describe('property changes', () => {
  test('accepting a w:rPrChange keeps the current properties', () => {
    const part = load(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="QA" w:date="${QA.date}">` +
        '<w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>text</w:t></w:r></w:p>'
    );
    const out = xml(apply(part, accept(QA)));
    expect(out).not.toContain('rPrChange');
    expect(out).toContain('<w:b/>');
    expect(out).not.toContain('<w:i/>');
  });

  test('rejecting a w:rPrChange restores the recorded properties', () => {
    const part = load(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="QA" w:date="${QA.date}">` +
        '<w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>text</w:t></w:r></w:p>'
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('rPrChange');
    expect(out).toContain('<w:i/>');
    expect(out).not.toContain('<w:b/>');
  });

  test('rejecting a w:pPrChange restores the recorded paragraph properties', () => {
    const part = load(
      `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="1" w:author="QA" w:date="${QA.date}">` +
        '<w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr>' +
        `${run('text')}</w:p>`
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('pPrChange');
    expect(out).toContain('<w:jc w:val="left"/>');
    expect(out).not.toContain('center');
  });
});

describe('structural revision resolution', () => {
  test('accepting a complete tracked row deletion removes the row', () => {
    const part = load(
      `<w:tbl><w:tr><w:trPr><w:del w:id="1" w:author="QA" w:date="${QA.date}"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellDel w:id="1" w:author="QA" w:date="${QA.date}"/></w:tcPr>` +
        `<w:p>${run('cell')}</w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p>${run('keep')}</w:p></w:tc></w:tr></w:tbl>`
    );
    const out = xml(apply(part, accept(QA)));
    expect(out).not.toContain('cell');
    expect(out).toContain('keep');
    expect(out).not.toContain('cellDel');
  });

  test('a refused kind leaves the tree byte-identical', () => {
    const part = load(
      `<w:tbl><w:tr><w:tc><w:tcPr><w:cellMerge w:id="1" w:author="QA" w:date="${QA.date}" w:vMerge="invalid"/></w:tcPr>` +
        `<w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`
    );
    const before = xml(part);
    refuse(part, accept(QA));
    expect(xml(part)).toBe(before);
  });

  test('one refused site refuses the whole revision, not just that site', () => {
    // A duplicate row marker is ambiguous; its shared inline revision must remain intact.
    const part = load(
      `<w:tbl><w:tr><w:trPr><w:ins w:id="1" w:author="QA" w:date="${QA.date}"/><w:ins w:id="1" w:author="QA" w:date="${QA.date}"/></w:trPr>` +
        `<w:tc><w:p>${wrap('ins', QA, run('cell'))}</w:p></w:tc></w:tr></w:tbl>`
    );
    expect(refuse(part, accept(QA))).toBe('unsupported-revision');
    expect(xml(part)).toContain('<w:ins');
  });
});

describe('addressing', () => {
  test('a revision that is not present is refused', () => {
    const part = load(`<w:p>${run('plain')}</w:p>`);
    expect(refuse(part, accept(QA))).toBe('unknown-revision');
  });

  test('two authors sharing one id are separately addressable', () => {
    const other = { id: '1', author: 'Other', date: QA.date };
    const part = load(
      `<w:p>${wrap('ins', QA, run('mine'))}${wrap('ins', other, run('theirs'))}</w:p>`
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('mine');
    expect(out).toContain('theirs');
  });

  test('a differing date is a different revision', () => {
    const later = { id: '1', author: 'QA', date: '2026-04-01T09:00:00Z' };
    const part = load(
      `<w:p>${wrap('ins', QA, run('first'))}${wrap('ins', later, run('second'))}</w:p>`
    );
    const out = xml(apply(part, reject(later)));
    expect(out).toContain('first');
    expect(out).not.toContain('second');
  });

  test('every site sharing the triple resolves in one transaction', () => {
    const part = load(
      `<w:p>${wrap('ins', QA, run('one'))}${run(' and ')}${wrap('ins', QA, run('two'))}</w:p>`
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('one');
    expect(out).not.toContain('two');
    expect(out).toContain(' and ');
  });
});

describe('accept-all and reject-all', () => {
  const doc = () =>
    load(
      `<w:p>${run('keep ')}${wrap('ins', QA, run('new '))}${wrap('del', DEV, delRun('old'))}</w:p>`
    );

  test('accept-all produces the proposed result', () => {
    const out = xml(apply(doc(), { op: 'acceptAllRevisions' }));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('<w:del');
    expect(out).toContain('new ');
    expect(out).not.toContain('old');
  });

  test('reject-all produces the original', () => {
    const out = xml(apply(doc(), { op: 'rejectAllRevisions' }));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('<w:del');
    expect(out).not.toContain('new ');
    expect(out).toContain('old');
  });

  test('a document with no revisions refuses rather than reporting a no-op change', () => {
    expect(refuse(load(`<w:p>${run('plain')}</w:p>`), { op: 'acceptAllRevisions' })).toBe(
      'unknown-revision'
    );
  });

  test('accept-all refuses when any revision in the document is a refused kind', () => {
    const part = load(
      `<w:p>${wrap('ins', QA, run('inline'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:del w:id="9" w:author="Dev" w:date="${DEV.date}"/><w:del w:id="9" w:author="Dev" w:date="${DEV.date}"/></w:trPr>` +
        '<w:tc><w:p/></w:tc></w:tr></w:tbl>'
    );
    expect(refuse(part, { op: 'acceptAllRevisions' })).toBe('unsupported-revision');
    expect(xml(part)).toContain('<w:ins');
  });

  test('a canonical note-root scope resolves only that note despite colliding identities', () => {
    const part = loadNotes(
      `<w:footnote w:id="1"><w:p>${wrap('ins', QA, run('target'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:ins w:id="8" w:author="Row"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellIns w:id="8" w:author="Row"/></w:tcPr>` +
        `<w:p>${run('tracked row')}</w:p></w:tc></w:tr></w:tbl></w:footnote>` +
        `<w:footnote w:id="2"><w:p>${wrap('ins', QA, run('sibling'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:del w:id="9" w:author="Dev"/><w:del w:id="9" w:author="Dev"/></w:trPr>` +
        `<w:tc><w:p>${run('unsupported')}</w:p></w:tc></w:tr></w:tbl></w:footnote>`
    );
    const target = part.root.children.find(
      (node) => node.kind !== 'textValue' && node.localName === 'footnote'
    );
    if (!target || target.kind === 'textValue') throw new Error('missing target note');

    const out = xml(apply(part, { op: 'acceptAllRevisions', scopeRootId: target.id }));
    expect(out).toContain('target');
    expect(out.match(/<w:ins\b/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('cellIns');
    expect(out).toContain('tracked row');
    expect(out).toContain('sibling');
    expect(out).toContain('w:id="9"');
  });

  test('an unsupported revision inside a scoped note refuses atomically', () => {
    const part = loadNotes(
      `<w:footnote w:id="1"><w:p>${wrap('ins', QA, run('target'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:del w:id="9" w:author="Dev"/><w:del w:id="9" w:author="Dev"/></w:trPr>` +
        `<w:tc><w:p>${run('incomplete')}</w:p></w:tc></w:tr></w:tbl></w:footnote>` +
        `<w:footnote w:id="2"><w:p>${wrap('ins', QA, run('sibling'))}</w:p></w:footnote>`
    );
    const target = part.root.children.find(
      (node) => node.kind !== 'textValue' && node.localName === 'footnote'
    );
    if (!target || target.kind === 'textValue') throw new Error('missing target note');
    const before = xml(part);

    expect(refuse(part, { op: 'acceptAllRevisions', scopeRootId: target.id })).toBe(
      'unsupported-revision'
    );
    expect(xml(part)).toBe(before);
  });

  test('a scoped all-decision refuses roots that are missing or are not notes', () => {
    const part = load(`<w:p>${wrap('ins', QA, run('target'))}</w:p>`);
    const paragraph = part.root.children[0]?.kind === 'textValue' ? null : part.root.children[0];
    if (!paragraph) throw new Error('missing body');
    const body = paragraph.children[0];
    if (!body || body.kind === 'textValue') throw new Error('missing paragraph');

    expect(refuse(part, { op: 'acceptAllRevisions', scopeRootId: '' })).toBe(
      'invalid-property-value'
    );
    expect(refuse(part, { op: 'acceptAllRevisions', scopeRootId: body.id })).toBe(
      'invalid-property-value'
    );
  });

  test('a standalone VML text box is a scope; its copy under mc:Fallback is not', () => {
    const box = (text: string) =>
      '<w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape><v:textbox><w:txbxContent>' +
      `<w:p>${wrap('ins', QA, run(text))}</w:p></w:txbxContent></v:textbox></v:shape></w:pict>`;
    const part = load(
      `<w:p>${wrap('ins', QA, run('owner'))}<w:r>${box('boxed')}</w:r>` +
        '<w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
        `<mc:Choice Requires="w14"><w:t>x</w:t></mc:Choice><mc:Fallback>${box('copy')}</mc:Fallback>` +
        '</mc:AlternateContent></w:r></w:p>'
    );
    const stories: string[] = [];
    const visit = (node: OoxmlNode) => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'txbxContent') stories.push(node.id);
      node.children.forEach(visit);
    };
    visit(part.root);
    const [standalone, fallback] = stories;
    expect(refuse(part, { op: 'acceptAllRevisions', scopeRootId: fallback! })).toBe(
      'invalid-property-value'
    );
    const out = xml(apply(part, { op: 'acceptAllRevisions', scopeRootId: standalone! }));
    // Only the box's own change is decided; the owner and the fallback copy keep theirs.
    expect(out.match(/<w:ins\b/g) ?? []).toHaveLength(2);
    expect(out).toMatch(/<w:txbxContent><w:p[^>]*><w:r><w:t>boxed<\/w:t>/);
  });
});

describe('a text box that ends with a table', () => {
  test('accepting a deleted last paragraph keeps one paragraph after the table', () => {
    const mark = `<w:pPr><w:rPr><w:del w:id="1" w:author="QA" w:date="${QA.date}"/></w:rPr></w:pPr>`;
    const table = (inner: string) =>
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${inner}</w:tc></w:tr></w:tbl>`;
    for (const block of [
      table(`<w:p>${run('cell')}</w:p>`),
      `<w:sdt><w:sdtPr/><w:sdtContent>${table(`<w:p>${run('cell')}</w:p>`)}</w:sdtContent></w:sdt>`,
    ]) {
      const part = load(
        '<w:p><w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape><v:textbox><w:txbxContent>' +
          `<w:p>${run('top')}</w:p>${block}<w:p>${mark}</w:p><w:p>${mark}</w:p>` +
          '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>'
      );
      let box = '';
      const visit = (node: OoxmlNode) => {
        if (node.kind === 'textValue') return;
        if (node.localName === 'txbxContent') box = node.id;
        node.children.forEach(visit);
      };
      visit(part.root);
      const out = xml(apply(part, { op: 'acceptAllRevisions', scopeRootId: box }));
      expect(out).toMatch(/<\/w:(tbl|sdt)><w:p[ />][\s\S]*<\/w:txbxContent>/);
    }
  });
});

describe('a body that a decision would leave ending with a table', () => {
  const mark = `<w:pPr><w:rPr><w:del w:id="1" w:author="QA" w:date="${QA.date}"/></w:rPr></w:pPr>`;
  const table =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr><w:tc><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`;
  test.each([
    [
      'custom XML',
      `<w:p/><w:customXml><w:p>${run('A')}</w:p>${table}<w:p>${mark}</w:p></w:customXml>`,
    ],
    [
      'marker control',
      `${table}<w:p>${mark}</w:p><w:sdt><w:sdtPr/><w:sdtContent><w:bookmarkStart w:id="1" w:name="m"/></w:sdtContent></w:sdt>`,
    ],
  ])(
    'accepting a deleted paragraph after a table in a %s keeps a paragraph after it',
    (_, body) => {
      const part = load(body);
      const out = apply(part, { op: 'acceptAllRevisions' });
      const story = out.root.children[0]!;
      expect(story.kind !== 'textValue' && storyEndsWithTable(story.children)).toBe(false);
    }
  );
});

describe('a move recorded on the paragraph mark', () => {
  // `EG_ParaRPrTrackChanges` is `ins? del? moveFrom? moveTo?`. When a whole paragraph moves
  // with tracking on, Word records it on the MARK: `w:moveFrom` on the copy the paragraph
  // left, `w:moveTo` on the copy it arrived at. Reading only `ins`/`del` there left the move
  // raising no card at all, so a reviewer had nothing to accept.
  const moved = (name: 'moveFrom' | 'moveTo') =>
    load(
      `<w:p><w:pPr><w:rPr><w:${name} w:id="${QA.id}" w:author="${QA.author}" w:date="${QA.date}"/></w:rPr></w:pPr>` +
        `${run('first')}</w:p><w:p>${run('second')}</w:p>`
    );

  test('accepting a moveFrom mark runs the paragraph into the next one', () => {
    // Accepting the move removes THIS copy of the break, exactly as accepting a deletion does.
    const out = xml(apply(moved('moveFrom'), accept(QA)));
    expect(out).not.toContain('<w:moveFrom');
    expect(out.match(/<w:p[ >]/g)).toHaveLength(1);
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  test('rejecting a moveFrom mark keeps the break and drops the record', () => {
    const out = xml(apply(moved('moveFrom'), reject(QA)));
    expect(out).not.toContain('<w:moveFrom');
    expect(out.match(/<w:p[ >]/g)).toHaveLength(2);
  });

  test('a moveTo mark is the other half: rejecting removes the break it arrived at', () => {
    expect(xml(apply(moved('moveTo'), reject(QA))).match(/<w:p[ >]/g)).toHaveLength(1);
    expect(xml(apply(moved('moveTo'), accept(QA))).match(/<w:p[ >]/g)).toHaveLength(2);
  });

  test('a move marker in run properties refuses as malformed input', () => {
    const part = load(
      `<w:p><w:r><w:rPr><w:moveFrom w:id="${QA.id}" w:author="${QA.author}" w:date="${QA.date}"/></w:rPr><w:t>text</w:t></w:r></w:p>`
    );
    const before = xml(part);

    expect(refuse(part, accept(QA))).toBe('unsupported-revision');
    expect(xml(part)).toBe(before);
  });
});

describe('a run of removed paragraph marks', () => {
  // Word merges all of them into the paragraph whose mark survives. Resolving pairwise left
  // every second paragraph behind, so accepting sixteen deleted marks produced eight
  // paragraphs and eight blank lines that no decision asked for.
  const delMark = (text: string) =>
    `<w:p><w:pPr><w:rPr><w:del w:id="${QA.id}" w:author="${QA.author}" w:date="${QA.date}"/></w:rPr></w:pPr>` +
    `${run(text)}</w:p>`;

  test('collapses into the one survivor at its end', () => {
    const part = load(
      delMark('one ') + delMark('two ') + delMark('three ') + `<w:p>${run('four')}</w:p>`
    );
    const out = xml(apply(part, { op: 'acceptAllRevisions' }));
    expect(out.match(/<w:p[ >]/g)).toHaveLength(1);
    expect(out).toContain('one ');
    expect(out).toContain('four');
  });

  test('a trailing run keeps the last paragraph, which the others merge into', () => {
    const part = load(`<w:p>${run('keep')}</w:p>` + delMark('a ') + delMark('b '));
    const out = xml(apply(part, { op: 'acceptAllRevisions' }));
    expect(out.match(/<w:p[ >]/g)).toHaveLength(2);
    // Both members' runs, in the paragraph that survived them.
    expect(out.slice(out.lastIndexOf('<w:p>'))).toContain('a ');
    expect(out.slice(out.lastIndexOf('<w:p>'))).toContain('b ');
  });

  test('a content control is a boundary too', () => {
    // A `w:sdt` holds its own children, so the paragraph before it and the first paragraph
    // inside it are not siblings. Scanning past it merged the text into a paragraph in
    // another parent, where it arrived behind the control.
    const part = load(
      delMark('before ') +
        `<w:sdt><w:sdtContent><w:p>${run('inside')}</w:p></w:sdtContent></w:sdt>` +
        `<w:p>${run('after')}</w:p>`
    );
    const out = xml(apply(part, { op: 'acceptAllRevisions' }));
    expect(out.indexOf('before ')).toBeLessThan(out.indexOf('<w:sdt'));
    expect(out).not.toContain('before after');
  });

  test('a removed mark before a table merges into its first cell, as in Word', () => {
    // `followed` looked at any later paragraph, so the text merged into the one AFTER the
    // table and arrived behind it — in a place the reader never put it.
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
      `<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p>${run('cell')}</w:p>` +
      '</w:tc></w:tr></w:tbl>';
    const part = load(delMark('before ') + table + `<w:p>${run('after')}</w:p>`);
    const out = xml(apply(part, { op: 'acceptAllRevisions' }));
    expect(out.indexOf('before ')).toBeGreaterThan(out.indexOf('<w:tc>'));
    expect(out.indexOf('before ')).toBeLessThan(out.indexOf('cell'));
    expect(out.indexOf('before ')).toBeLessThan(out.indexOf('</w:tc>'));
    expect(out).not.toContain('before after');
  });
});

describe('joining paragraphs moves the mark, not just the section break', () => {
  // A join deletes the FIRST paragraph's mark, so the merged paragraph ends with the SECOND's.
  // Keeping the first's left the survivor proposing to delete a break the user had just
  // deleted: the next layout pass merged it into the paragraph after it, and the review pane
  // kept a card for a mark that no longer exists.
  const markDel = (id: string) =>
    `<w:pPr><w:rPr><w:del w:id="${id}" w:author="${QA.author}" w:date="${QA.date}"/></w:rPr></w:pPr>`;

  test('the survivor does not inherit a mark revision the join deleted', () => {
    const part = load(
      `<w:p>${markDel('1')}${run('Hello ')}</w:p><w:p>${run('world')}</w:p><w:p>${run('after')}</w:p>`
    );
    const ids = [...xml(part).matchAll(/<w:p[ >]/g)].length;
    expect(ids).toBe(3);
    const body = part.root.children[0]!;
    const paragraphs = (body as { children: { kind: string; id: string }[] }).children.filter(
      (child) => child.kind === 'paragraph'
    );
    const joined = applyTreeOp(part, {
      op: 'joinParagraphs',
      firstId: paragraphs[0]!.id,
      secondId: paragraphs[1]!.id,
    });
    if (!joined.ok) throw new Error(joined.reason);
    const out = xml(joined.part);
    expect(out).toContain('Hello ');
    expect(out).toContain('world');
    expect(out).not.toContain('<w:del');
  });

  test('a mark revision on the SECOND paragraph rides onto the survivor', () => {
    const part = load(
      `<w:p>${run('Hello ')}</w:p><w:p>${markDel('2')}${run('world')}</w:p><w:p>${run('after')}</w:p>`
    );
    const body = part.root.children[0]!;
    const paragraphs = (body as { children: { kind: string; id: string }[] }).children.filter(
      (child) => child.kind === 'paragraph'
    );
    const joined = applyTreeOp(part, {
      op: 'joinParagraphs',
      firstId: paragraphs[0]!.id,
      secondId: paragraphs[1]!.id,
    });
    if (!joined.ok) throw new Error(joined.reason);
    expect(xml(joined.part)).toContain('<w:del');
  });
});

describe('untouched content keeps its identity', () => {
  test('resolving one change shares every paragraph, table and run it did not touch', () => {
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      `<w:tr><w:tc><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`;
    const part = load(
      `<w:p>${run('before')}</w:p>${table}` +
        `<w:p>${run('keep ')}${wrap('ins', QA, run('new'))}${run(' tail')}</w:p>` +
        `<w:p>${run('after')}${wrap('del', DEV, delRun('gone'))}</w:p>`
    );
    const body = part.root.children[0]!;
    if (body.kind === 'textValue') throw new Error('expected a body');
    for (const action of [accept, reject]) {
      const next = apply(part, action(QA));
      const nextBody = next.root.children[0]!;
      if (nextBody.kind === 'textValue') throw new Error('expected a body');
      // The first paragraph, the table, and the paragraph holding the other author's change.
      expect(nextBody.children[0]).toBe(body.children[0]);
      expect(nextBody.children[1]).toBe(body.children[1]);
      expect(nextBody.children[3]).toBe(body.children[3]);
      // The resolved paragraph is new, but its untouched leading run is shared.
      const resolved = nextBody.children[2]!;
      const original = body.children[2]!;
      if (resolved.kind === 'textValue' || original.kind === 'textValue') {
        throw new Error('expected paragraphs');
      }
      expect(resolved).not.toBe(original);
      expect(resolved.children[0]).toBe(original.children[0]);
    }
  });
});
