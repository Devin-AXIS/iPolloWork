// `setSectionMark`: the op behind Word's Layout > Breaks, at the tree level.
//
// `w:type` states how a section starts relative to the previous one (ECMA-376 §17.6.22),
// so the break a caller asks for is written on the section that FOLLOWS the mark, never on
// the clone the mark mints. These pin that down, and the markup it produces.

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';
import { bodySectionOf } from '../store/tree-op-section-address.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

const SIMPLE = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>';

describe('setSectionMark writes the break on the section that STARTS at the mark', () => {
  const TWO_PARAGRAPHS =
    '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:cols w:num="1"/></w:sectPr>';

  test('continuous lands on the governing section, never on the minted clone', () => {
    // `w:type` says how a section starts relative to the previous one (§17.6.22). The
    // minted mark ENDS the first half, which starts exactly where it always did, so the
    // break the caller asked for belongs to the half that follows it.
    const part = load(TWO_PARAGRAPHS);
    const [first] = paragraphIds(part);
    const next = apply(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'continuous',
    });
    const serialized = serializeOoxmlPart(next);
    expect(serialized.match(/<w:type w:val="continuous"\/>/g)).toHaveLength(1);
    // The one `w:type` is in the BODY-level section, after the last paragraph.
    expect(serialized.indexOf('<w:type')).toBeGreaterThan(serialized.lastIndexOf('</w:p>'));
    // …and it sits before `w:pgSz`, where CT_SectPr's sequence puts it.
    expect(serialized.indexOf('<w:type')).toBeLessThan(serialized.lastIndexOf('<w:pgSz'));
  });

  test('nextPage REMOVES an inherited type, so the break really starts a page', () => {
    // The clone carries the governing `w:type` with it. Without the removal the section
    // after a next-page break stayed continuous and both halves shared one sheet.
    const part = load(
      TWO_PARAGRAPHS.replace('<w:sectPr>', '<w:sectPr><w:type w:val="continuous"/>')
    );
    const [first] = paragraphIds(part);
    const next = apply(part, { op: 'setSectionMark', paragraphId: first!, breakType: 'nextPage' });
    const serialized = serializeOoxmlPart(next);
    // Exactly one survives: the clone's, which still describes where the FIRST half starts.
    expect(serialized.match(/<w:type w:val="continuous"\/>/g)).toHaveLength(1);
    expect(serialized.indexOf('<w:type')).toBeLessThan(serialized.indexOf('</w:p>'));
  });

  test('an omitted breakType leaves the following section exactly as it was', () => {
    const part = load(TWO_PARAGRAPHS.replace('<w:sectPr>', '<w:sectPr><w:type w:val="oddPage"/>'));
    const [first] = paragraphIds(part);
    const next = apply(part, { op: 'setSectionMark', paragraphId: first! });
    expect(serializeOoxmlPart(next).match(/<w:type w:val="oddPage"\/>/g)).toHaveLength(2);
  });

  test('a document with no sectPr gets a body-level one to carry the break', () => {
    // Otherwise "continuous" commits and changes nothing the user can see: there is no
    // following section to say how it starts.
    const part = load(SIMPLE);
    const [first] = paragraphIds(part);
    const next = apply(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'continuous',
    });
    const serialized = serializeOoxmlPart(next);
    expect(serialized.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(serialized.match(/<w:type w:val="continuous"\/>/g)).toHaveLength(1);
    expect(serialized.indexOf('<w:type')).toBeGreaterThan(serialized.lastIndexOf('</w:p>'));
  });

  test('an unknown break type is refused before any tree work', () => {
    const part = load(TWO_PARAGRAPHS);
    const [first] = paragraphIds(part);
    const fingerprint = canonicalOoxmlFingerprint(part);
    const result = applyTreeOp(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'sideways' as 'continuous',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-property-value');
    expect(canonicalOoxmlFingerprint(part)).toBe(fingerprint);
  });
});

describe('setSectionMark leaves the following section alone when nothing changes', () => {
  const NO_TYPE =
    '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  test('a nextPage break writes nothing where the type is already absent', () => {
    // The ordinary break in the ordinary document. Rewriting the section to the same value
    // would break node IDENTITY, which every layout cache is keyed by, and would smuggle an
    // untracked edit into a tracked gesture for no gain at all.
    const part = load(NO_TYPE);
    const [first] = paragraphIds(part);
    const next = apply(part, { op: 'setSectionMark', paragraphId: first!, breakType: 'nextPage' });
    const body = bodySectionOf(part);
    expect(body).not.toBeNull();
    expect(bodySectionOf(next)).toBe(body);
    expect(serializeOoxmlPart(next)).not.toContain('<w:type');
  });

  test('an explicit nextPage type is left where the caller asks for nextPage', () => {
    const part = load(NO_TYPE.replace('<w:sectPr>', '<w:sectPr><w:type w:val="nextPage"/>'));
    const [first] = paragraphIds(part);
    const next = apply(part, { op: 'setSectionMark', paragraphId: first!, breakType: 'nextPage' });
    // Two now: the clone carries one too. Neither was rewritten.
    expect(serializeOoxmlPart(next).match(/<w:type w:val="nextPage"\/>/g)).toHaveLength(2);
    expect(bodySectionOf(next)).toBe(bodySectionOf(part));
  });

  test('a document with no sectPr gains no body section for a nextPage break', () => {
    // An absent section already starts on a new page, so there is nothing to carry.
    const part = load(SIMPLE);
    const [first] = paragraphIds(part);
    const next = apply(part, { op: 'setSectionMark', paragraphId: first!, breakType: 'nextPage' });
    expect(serializeOoxmlPart(next).match(/<w:sectPr>/g)).toHaveLength(1);
  });

  test('a continuous break into a locked control that owns the section is refused', () => {
    // The type lands on the section that STARTS at the mark, which hangs on a paragraph the
    // caret is nowhere near. Guarding only the marked paragraph let a caret outside a locked
    // control rewrite the section inside it.
    const part = load(
      '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>' +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:pPr><w:sectPr><w:type w:val="oddPage"/><w:pgSz w:w="12240" w:h="15840"/>' +
        '</w:sectPr></w:pPr><w:r><w:t>Inside</w:t></w:r></w:p>' +
        '</w:sdtContent></w:sdt>' +
        '<w:p><w:r><w:t>Beta</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const [first] = paragraphIds(part);
    const fingerprint = canonicalOoxmlFingerprint(part);
    const result = applyTreeOp(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'continuous',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('locked');
    expect(canonicalOoxmlFingerprint(part)).toBe(fingerprint);
    // A next-page break would REMOVE the `oddPage` inside the control, so it is refused too.
    expect(
      applyTreeOp(part, { op: 'setSectionMark', paragraphId: first!, breakType: 'nextPage' }).ok
    ).toBe(false);
  });

  test('a data-bound control owning the section refuses the same way', () => {
    const part = load(
      '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>' +
        '<w:sdt><w:sdtPr><w:dataBinding w:xpath="/root/a" w:storeItemID="{1}"/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>Inside</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:p><w:r><w:t>Beta</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const [first] = paragraphIds(part);
    const result = applyTreeOp(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'continuous',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bound');
    // Precise, not blanket: this control's section carries no `w:type`, so a next-page break
    // writes nothing into it and the guard has nothing to refuse.
    expect(
      applyTreeOp(part, { op: 'setSectionMark', paragraphId: first!, breakType: 'nextPage' }).ok
    ).toBe(true);
  });
});
